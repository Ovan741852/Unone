use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use unone_engine::{
    BundleManager, BundlePackReport, BundleReport, EngineResult, VerifyReport, pack_project, verify,
};

/// The single AI-facing authoring-to-runtime synchronization operation.
///
/// The engine already owns the individual pack, verify, and activation
/// contracts. This SDK-level orchestration makes their required order
/// explicit without asking an AI to remember a shell recipe. A failed stage
/// preserves all reports produced before it and never activates a bundle after
/// a failed verify.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectSyncReport {
    pub project_root: String,
    pub status: String,
    pub pack: Option<BundlePackReport>,
    pub verify: Option<VerifyReport>,
    pub activation: Option<BundleReport>,
}

fn active_matches(pack: &BundlePackReport, active: &BundleReport) -> bool {
    if !active.valid || active.active_generation.is_none() {
        return false;
    }

    let expected = pack
        .bundles
        .iter()
        .map(|bundle| (bundle.id.clone(), bundle.sha256.clone()))
        .collect::<BTreeMap<_, _>>();
    expected == active.active_bundles
}

pub fn sync_project(project_root: &Path) -> EngineResult<ProjectSyncReport> {
    let mut report = ProjectSyncReport {
        project_root: project_root.display().to_string(),
        status: "starting".to_string(),
        pack: None,
        verify: None,
        activation: None,
    };

    let packed = pack_project(project_root, None);
    let Some(pack_report) = packed.value else {
        report.status = "pack_failed".to_string();
        return EngineResult {
            ok: false,
            value: Some(report),
            diagnostics: packed.diagnostics,
            effects: packed.effects,
        };
    };
    report.pack = Some(pack_report);

    let verified = verify(project_root);
    report.verify = verified.value;
    let mut result = EngineResult::success(report);
    result.diagnostics.extend(verified.diagnostics);
    result.effects.extend(verified.effects);
    if !verified.ok {
        result.ok = false;
        if let Some(report) = result.value.as_mut() {
            report.status = "verify_failed".to_string();
        }
        return result;
    }

    let manager = match BundleManager::from_project(project_root) {
        Ok(manager) => manager,
        Err(diagnostic) => {
            result.ok = false;
            result.diagnostics.push(*diagnostic);
            if let Some(report) = result.value.as_mut() {
                report.status = "activation_unavailable".to_string();
            }
            return result;
        }
    };

    // Re-running an unchanged project is intentionally idempotent. The
    // active generation is already the verified result, so avoid creating a
    // new generation merely because an AI repeated the same sync request.
    let inspected = manager.inspect();
    result.diagnostics.extend(inspected.diagnostics.clone());
    result.effects.extend(inspected.effects.clone());
    if let Some(active) = inspected.value {
        let unchanged = result
            .value
            .as_ref()
            .and_then(|report| report.pack.as_ref())
            .is_some_and(|pack| active_matches(pack, &active));
        if unchanged {
            if let Some(report) = result.value.as_mut() {
                report.status = "synced".to_string();
                report.activation = Some(active);
            }
            result.effects.push("project sync reused active generation".to_string());
            return result;
        }
    }

    let activated = manager.install_selected(None, true);
    result.diagnostics.extend(activated.diagnostics);
    result.effects.extend(activated.effects);
    if let Some(activation) = activated.value {
        if let Some(report) = result.value.as_mut() {
            report.status = "synced".to_string();
            report.activation = Some(activation);
        }
        result.effects.push("project sync completed".to_string());
    } else {
        result.ok = false;
        if let Some(report) = result.value.as_mut() {
            report.status = "activation_failed".to_string();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;
    use unone_engine::BundleManager;

    use super::sync_project;

    fn write_project(dir: &std::path::Path, with_test: bool) {
        fs::create_dir_all(dir.join("tests")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            if with_test {
                r#"{"name":"SyncFixture","entry_script":"main.luau","test_files":["tests/smoke.test.json"],"verify":{"steps":["assets","tests"]}}"#
            } else {
                r#"{"name":"SyncBlocked","entry_script":"main.luau","verify":{"steps":["assets","tests"]}}"#
            },
        )
        .unwrap();
        fs::write(
            dir.join("main.luau"),
            "--!strict\nlocal Game = {}\nfunction Game.start(_api) end\nfunction Game.update(api, _dt) api.observation.set(\"sync_ok\", true) end\nreturn Game\n",
        )
        .unwrap();
        if with_test {
            fs::write(
                dir.join("tests/smoke.test.json"),
                r#"{"name":"sync observation","frames":1,"assertions":[{"observation":{"key":"sync_ok","equals":true}}]}"#,
            )
            .unwrap();
        }
    }

    #[test]
    fn sync_runs_pack_verify_and_activation_as_one_operation() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), true);

        let result = sync_project(dir.path());

        assert!(result.ok, "sync should pass: {:?}", result.diagnostics);
        let report = result.value.unwrap();
        assert_eq!(report.status, "synced");
        assert!(report.pack.is_some());
        assert!(report.verify.is_some());
        assert_eq!(report.activation.unwrap().active_generation, Some(1));
    }

    #[test]
    fn missing_project_is_reported_as_pack_failure() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("missing-project");

        let result = sync_project(&missing);

        assert!(!result.ok);
        let report = result.value.unwrap();
        assert_eq!(report.status, "pack_failed");
        assert!(report.pack.is_none());
        assert!(report.verify.is_none());
        assert!(report.activation.is_none());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "PROJECT_ROOT_NOT_FOUND"));
    }

    #[test]
    fn failed_verify_is_reported_without_activation() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), false);

        let result = sync_project(dir.path());

        assert!(!result.ok);
        let report = result.value.unwrap();
        assert_eq!(report.status, "verify_failed");
        assert!(report.pack.is_some());
        assert!(report.verify.is_some());
        assert!(report.activation.is_none());
        assert!(!dir.path().join(".unone/active/bundles").exists());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "VERIFY_FAILED"));
    }

    #[test]
    fn unchanged_sync_reuses_the_active_generation() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), true);

        let first = sync_project(dir.path());
        assert!(first.ok, "first sync should pass: {:?}", first.diagnostics);
        let first_generation = first
            .value
            .as_ref()
            .and_then(|report| report.activation.as_ref())
            .and_then(|activation| activation.active_generation);

        let second = sync_project(dir.path());
        assert!(second.ok, "second sync should pass: {:?}", second.diagnostics);
        let second_report = second.value.unwrap();
        let second_generation = second_report
            .activation
            .as_ref()
            .and_then(|activation| activation.active_generation);
        assert_eq!(first_generation, Some(1));
        assert_eq!(second_generation, first_generation);
        assert!(second
            .effects
            .iter()
            .any(|effect| effect.contains("reused active generation")));
    }

    #[test]
    fn failed_assertion_does_not_replace_an_existing_active_generation() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), true);

        let first = sync_project(dir.path());
        assert!(first.ok, "first sync should pass: {:?}", first.diagnostics);
        assert_eq!(
            BundleManager::from_project(dir.path())
                .unwrap()
                .inspect()
                .value
                .unwrap()
                .active_generation,
            Some(1)
        );

        fs::write(
            dir.path().join("tests/smoke.test.json"),
            r#"{"name":"sync observation","frames":1,"assertions":[{"observation":{"key":"sync_ok","equals":false}}]}"#,
        )
        .unwrap();
        let failure = sync_project(dir.path());

        assert!(!failure.ok, "failed assertions must block sync");
        let report = failure.value.unwrap();
        assert_eq!(report.status, "verify_failed");
        assert!(report.activation.is_none());
        assert!(report
            .verify
            .as_ref()
            .unwrap()
            .steps
            .iter()
            .flat_map(|step| step.diagnostics.iter())
            .any(|diagnostic| diagnostic.code == "TEST_ASSERTIONS_FAILED"));
        assert_eq!(
            BundleManager::from_project(dir.path())
                .unwrap()
                .inspect()
                .value
                .unwrap()
                .active_generation,
            Some(1),
            "a failed sync must retain the previous active generation"
        );
    }

    #[test]
    fn a_verified_content_change_creates_a_new_active_generation() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), true);

        let first = sync_project(dir.path());
        assert!(first.ok, "first sync should pass: {:?}", first.diagnostics);

        let mut script = fs::read_to_string(dir.path().join("main.luau")).unwrap();
        script.push_str("\n-- verified content change\n");
        fs::write(dir.path().join("main.luau"), script).unwrap();
        let changed = sync_project(dir.path());

        assert!(changed.ok, "changed sync should pass: {:?}", changed.diagnostics);
        let report = changed.value.unwrap();
        assert_eq!(report.status, "synced");
        assert_eq!(report.activation.unwrap().active_generation, Some(2));
        assert!(changed
            .effects
            .iter()
            .any(|effect| effect.contains("active bundle generation 2 created")));
    }
}
