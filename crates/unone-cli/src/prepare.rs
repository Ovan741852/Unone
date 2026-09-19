//! Project preparation orchestration for Web and Windows launchers.
//!
//! This is a CLI/tooling contract, not an engine or gameplay primitive.  The
//! project owns its Luau and assets; Core only verifies them, selects a trusted
//! runtime, and returns a launch descriptor for a host to execute without a
//! shell.

use anyhow::{bail, ensure, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use unone_engine::{ActionSuggestion, Diagnostic, EngineResult};

use crate::{sdk, sync};

pub(crate) const SCHEMA: &str = "unone.project-prepare.v1";
pub(crate) const PREFLIGHT_SCHEMA: &str = "unone.project-prepare-preflight.v1";

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ProjectPrepareReport {
    pub schema: String,
    pub status: String,
    pub target: String,
    pub project: String,
    pub output: String,
    pub sync: Option<sync::ProjectSyncReport>,
    pub export: Option<Value>,
    pub runtime: Option<Value>,
    pub launch: Option<Value>,
}

impl ProjectPrepareReport {
    fn new(target: &str, project: &Path, output: &Path) -> Self {
        Self {
            schema: SCHEMA.to_string(),
            status: "starting".to_string(),
            target: target.to_string(),
            project: project.display().to_string(),
            output: output.display().to_string(),
            sync: None,
            export: None,
            runtime: None,
            launch: None,
        }
    }
}

/// Read-only target/runtime/presentation discovery for a host that needs to
/// show availability before asking for a new output generation.
pub(crate) fn project_preflight(
    project: &Path,
    sdk_root: Option<&Path>,
    target: &str,
    runtime_id: Option<&str>,
    development: bool,
) -> EngineResult<Value> {
    let mut value = json!({
        "schema": PREFLIGHT_SCHEMA,
        "status": "starting",
        "target": target,
        "project": project,
        "output": null,
        "runtime": null,
    });
    if !matches!(target, "web" | "windows") {
        value["status"] = json!("unsupported");
        let diagnostic = preflight_action(
            Diagnostic::error(
                "PROJECT_PREPARE_TARGET_UNSUPPORTED",
                "Project prepare target is unsupported",
                format!(
                    "project prepare supports only web and windows, not {target}. Choose one of those targets."
                ),
            ),
            project,
            target,
        );
        return EngineResult {
            ok: false,
            value: Some(value),
            diagnostics: vec![diagnostic],
            effects: Vec::new(),
        };
    }
    match sdk::preflight(project, sdk_root, target, runtime_id, development) {
        Ok(selection) => {
            value["status"] = json!("compatible");
            value["runtime"] = selection.report();
            EngineResult::success(value)
        }
        Err(error) => {
            value["status"] = json!("incompatible");
            let diagnostic = preflight_diagnostic(
                "preflight",
                &error,
                project,
                target,
                "Fix the reported target, SDK/runtime, project system, or presentation issue; no output was created.",
            );
            EngineResult {
                ok: false,
                value: Some(value),
                diagnostics: vec![diagnostic],
                effects: Vec::new(),
            }
        }
    }
}

/// Run read-only compatibility checks, then sync and export in their required
/// order.  A newly selected output is never treated as a cache: every export
/// writes a complete generation and launch verification hashes its executable.
pub(crate) fn project_prepare(
    project: &Path,
    sdk_root: Option<&Path>,
    target: &str,
    output: &Path,
    runtime_id: Option<&str>,
    development: bool,
) -> EngineResult<ProjectPrepareReport> {
    let output = match absolute_path(output) {
        Ok(path) => path,
        Err(error) => {
            return failed(
                ProjectPrepareReport::new(target, project, output),
                prepare_diagnostic(
                    "output",
                    &error,
                    project,
                    output,
                    "Choose an output path whose parent directory can be resolved, then retry.",
                ),
            );
        }
    };
    let mut report = ProjectPrepareReport::new(target, project, &output);

    if !matches!(target, "web" | "windows") {
        report.status = "preflight_failed".to_string();
        return failed(
            report,
            Diagnostic::error(
                "PROJECT_PREPARE_TARGET_UNSUPPORTED",
                "Project prepare target is unsupported",
                format!(
                    "project prepare supports only web and windows, not {target}. Choose --target web or --target windows; Android packaging and iOS remain separate workflows."
                ),
            ),
        );
    }

    if path_exists_including_link(&output) {
        report.status = "output_rejected".to_string();
        return failed(
            report,
            Diagnostic::error(
                "PROJECT_PREPARE_OUTPUT_EXISTS",
                "Preparation output already exists",
                format!(
                    "{} is an existing file, directory, or link. Preparation only writes a new output generation; choose a new directory so an existing generation cannot be overwritten.",
                    output.display()
                ),
            ),
        );
    }

    let selection = match sdk::preflight(project, sdk_root, target, runtime_id, development) {
        Ok(selection) => selection,
        Err(error) => {
            report.status = "preflight_failed".to_string();
            return failed(
                report,
                prepare_diagnostic(
                    "preflight",
                    &error,
                    project,
                    &output,
                    "Inspect the reported target, SDK/runtime variant, project systems, and presentation settings; then retry.",
                ),
            );
        }
    };
    report.runtime = Some(selection.report());

    let synchronized = sync::sync_project(project);
    report.sync = synchronized.value;
    let mut result = EngineResult::success(report);
    result.diagnostics.extend(synchronized.diagnostics);
    result.effects.extend(synchronized.effects);
    if !synchronized.ok {
        return sync_failed(result);
    }

    let exported = match sdk::export(project, &output, sdk_root, target, runtime_id, development) {
        Ok(value) => value,
        Err(error) => {
            if let Some(report) = result.value.as_mut() {
                report.status = "export_failed".to_string();
            }
            result.ok = false;
            result.diagnostics.push(prepare_diagnostic(
                "export",
                &error,
                project,
                &output,
                "Fix the reported export input or runtime issue and retry with a new output directory.",
            ));
            return result;
        }
    };
    if let Some(report) = result.value.as_mut() {
        report.export = Some(exported.clone());
        // The exporter includes its own selection evidence. Keep the preflight
        // descriptor unless a future exporter adds richer verified fields.
        if let Some(selection_report) = exported.get("sdk_selection") {
            report.runtime = Some(selection_report.clone());
        }
    }

    let launch = match launch_descriptor(&selection, &output, &exported, development) {
        Ok(launch) => launch,
        Err(error) => {
            if let Some(report) = result.value.as_mut() {
                report.status = "launch_failed".to_string();
            }
            result.ok = false;
            result.diagnostics.push(prepare_diagnostic(
                "launch",
                &error,
                project,
                &output,
                "Keep the generated output for inspection, or remove it and retry after repairing the verified runtime/export manifest.",
            ));
            return result;
        }
    };
    let launch_root = launch
        .get("root")
        .or_else(|| launch.get("cwd"))
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(report) = result.value.as_mut() {
        report.status = "ready".to_string();
        if let Some(root) = launch_root {
            // `canonicalize` may use the Windows extended-path prefix. Keep
            // the top-level output and launch fields byte-for-byte consistent
            // for hosts that compare the authorized generation identity.
            report.output = root;
        }
        report.launch = Some(launch);
    }
    result.effects.push(format!(
        "project prepared for {} in {}",
        target,
        output.display()
    ));
    result
}

fn launch_descriptor(
    selection: &sdk::SdkSelection,
    output: &Path,
    exported: &Value,
    development: bool,
) -> Result<Value> {
    ensure!(
        exported.get("sdk_selection") == Some(&selection.report()),
        "PREPARE_SELECTION_CHANGED: export did not retain the verified runtime selection"
    );
    let output = output
        .canonicalize()
        .context("PREPARE_OUTPUT_MISSING: exporter did not create its output directory")?;
    match selection.host.id {
        "web" => {
            ensure!(
                exported["variant"] == if development { "development" } else { "production" },
                "PREPARE_EXPORT_MANIFEST_INVALID: web export variant does not match the selected runtime"
            );
            ensure!(
                output.join("index.html").is_file(),
                "PREPARE_EXPORT_MANIFEST_INVALID: web export is missing index.html"
            );
            Ok(json!({
                "kind": "static",
                "root": output,
                "entry": "index.html",
            }))
        }
        "windows" => {
            ensure!(!development, "NATIVE_DEVELOPMENT_VARIANT_UNAVAILABLE");
            let export_manifest = read_export_manifest(&output)?;
            ensure!(
                export_manifest["target"] == "windows"
                    && export_manifest["profile"] == "release"
                    && export_manifest["dev_tools"] == false
                    && export_manifest["preview_tools"] == false,
                "PREPARE_EXPORT_MANIFEST_INVALID: Windows export manifest is not a release native package"
            );
            let verified = sdk::verified_windows_executable(selection)?;
            sdk::ensure_windows_runtime_executable_path(&verified.path)?;
            let relative = verified.relative;
            let expected_hash = verified.sha256;
            let relative_text = relative.to_string_lossy().replace('\\', "/");
            let entry = export_manifest["files"]
                .as_array()
                .and_then(|files| {
                    files.iter().find(|file| {
                        file["path"].as_str() == Some(relative_text.as_str())
                    })
                })
                .context("PREPARE_EXPORT_MANIFEST_INVALID: verified executable is absent from export.json")?;
            ensure!(
                entry["sha256"].as_str().is_some_and(|hash| hash.eq_ignore_ascii_case(&expected_hash)),
                "PREPARE_EXPORT_MANIFEST_INVALID: export.json executable hash does not match runtime.json"
            );
            let exported_executable = output.join(&relative);
            let bytes = fs::read(&exported_executable).with_context(|| {
                format!(
                    "PREPARE_EXECUTABLE_MISSING: {}",
                    exported_executable.display()
                )
            })?;
            ensure!(
                digest(&bytes).eq_ignore_ascii_case(&expected_hash),
                "PREPARE_EXECUTABLE_HASH_MISMATCH: exported executable is not the verified runtime"
            );
            let exported_executable = exported_executable
                .canonicalize()
                .context("PREPARE_EXECUTABLE_MISSING: executable cannot be resolved")?;
            ensure!(
                exported_executable.starts_with(&output),
                "PREPARE_EXECUTABLE_PATH_INVALID: executable escapes the output directory"
            );
            let root = output.display().to_string();
            let executable = verified.path.display().to_string();
            Ok(json!({
                "kind": "native",
                "executable": executable,
                "executable_source": "sdk-runtime",
                "args": ["--root", root],
                "cwd": root,
            }))
        }
        other => bail!("PREPARE_TARGET_UNSUPPORTED: {other}"),
    }
}

fn read_export_manifest(output: &Path) -> Result<Value> {
    serde_json::from_slice(
        &fs::read(output.join("export.json"))
            .context("PREPARE_EXPORT_MANIFEST_MISSING: exporter did not write export.json")?,
    )
    .context("PREPARE_EXPORT_MANIFEST_INVALID: export.json is not valid JSON")
}

fn absolute_path(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

fn path_exists_including_link(path: &Path) -> bool {
    path.exists() || fs::symlink_metadata(path).is_ok()
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn failed(
    report: ProjectPrepareReport,
    diagnostic: Diagnostic,
) -> EngineResult<ProjectPrepareReport> {
    EngineResult {
        ok: false,
        value: Some(report),
        diagnostics: vec![diagnostic],
        effects: Vec::new(),
    }
}

fn sync_failed(
    mut result: EngineResult<ProjectPrepareReport>,
) -> EngineResult<ProjectPrepareReport> {
    result.ok = false;
    if let Some(report) = result.value.as_mut() {
        report.status = "sync_failed".to_string();
    }
    result
}

fn preflight_diagnostic(
    stage: &str,
    error: &anyhow::Error,
    project: &Path,
    target: &str,
    recovery: &str,
) -> Diagnostic {
    preflight_action(
        prepare_diagnostic(stage, error, project, Path::new("<not-created>"), recovery),
        project,
        target,
    )
}

fn preflight_action(mut diagnostic: Diagnostic, project: &Path, target: &str) -> Diagnostic {
    diagnostic.suggested_actions = vec![ActionSuggestion {
        action: "retry_project_preflight".to_string(),
        description: format!(
            "Re-run the read-only project preflight for the concrete {target} target; it never creates an output directory."
        ),
        command: Some(format!(
            "game --project \"{}\" --json project preflight --target {target}",
            project.display()
        )),
    }];
    diagnostic
}

fn prepare_diagnostic(
    stage: &str,
    error: &anyhow::Error,
    project: &Path,
    output: &Path,
    recovery: &str,
) -> Diagnostic {
    let raw = format!("{error:#}");
    let cause_code = raw
        .split(|character: char| character == ':' || character.is_whitespace())
        .next()
        .filter(|code| {
            !code.is_empty()
                && code.chars().all(|character| {
                    character.is_ascii_uppercase() || character == '_' || character.is_ascii_digit()
                })
        })
        .unwrap_or("PROJECT_PREPARE_FAILED");
    let mut diagnostic = Diagnostic::error(
        cause_code,
        format!("Project prepare {stage} failed"),
        format!("{raw}. Recovery: {recovery}"),
    );
    diagnostic.facts = json!({
        "schema": SCHEMA,
        "stage": stage,
        "project": project,
        "output": output,
        "cause": raw,
    });
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "retry_project_prepare".to_string(),
        description: recovery.to_string(),
        command: Some(format!(
            "game --project \"{}\" --json project prepare --target <web|windows> --output \"{}\"",
            project.display(),
            output.display()
        )),
    });
    diagnostic
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    fn write_file(path: &Path, bytes: &[u8]) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn existing_output_is_rejected_before_sdk_or_sync_work() {
        let project = tempdir().unwrap();
        let output = project.path().join("existing");
        fs::create_dir(&output).unwrap();
        let result = project_prepare(project.path(), None, "web", &output, None, false);
        assert!(!result.ok);
        assert_eq!(result.value.unwrap().status, "output_rejected");
        assert_eq!(result.diagnostics[0].code, "PROJECT_PREPARE_OUTPUT_EXISTS");
    }

    #[test]
    fn unsupported_target_is_rejected_before_any_sdk_or_sync_work() {
        let project = tempdir().unwrap();
        let result = project_prepare(
            project.path(),
            None,
            "android-x86_64",
            &project.path().join("output"),
            None,
            false,
        );
        assert!(!result.ok);
        assert_eq!(result.value.unwrap().status, "preflight_failed");
        assert_eq!(
            result.diagnostics[0].code,
            "PROJECT_PREPARE_TARGET_UNSUPPORTED"
        );
    }

    #[test]
    fn sync_failure_is_never_ready_and_does_not_create_output() {
        let project = tempdir().unwrap();
        let output = project.path().join("new-generation");
        let report = ProjectPrepareReport::new("web", project.path(), &output);
        let result = sync_failed(EngineResult::success(report));
        let report = result.value.unwrap();

        assert!(!result.ok);
        assert_eq!(report.status, "sync_failed");
        assert!(report.launch.is_none());
        assert!(report.export.is_none());
        assert!(!output.exists());
    }

    #[test]
    fn preflight_is_read_only_and_recovery_has_a_concrete_target() {
        let project = tempdir().unwrap();
        let missing_sdk = project.path().join("missing-sdk");
        let before = fs::read_dir(project.path()).unwrap().count();
        let result = project_preflight(project.path(), Some(&missing_sdk), "windows", None, false);
        let after = fs::read_dir(project.path()).unwrap().count();

        assert!(!result.ok);
        assert_eq!(result.value.unwrap()["status"], "incompatible");
        assert_eq!(before, after);
        let action = &result.diagnostics[0].suggested_actions[0];
        assert_eq!(action.action, "retry_project_preflight");
        let command = action.command.as_deref().unwrap();
        assert!(command.contains("--target windows"));
        assert!(!command.contains("--output"));
    }

    #[test]
    fn runtime_executable_must_be_a_single_hash_verified_exe() {
        let sdk = tempdir().unwrap();
        let runtime = sdk.path().join("runtime");
        fs::create_dir_all(&runtime).unwrap();
        let player = runtime.join("unone-native-player.exe");
        write_file(&player, b"player");
        let hash = digest(b"player");
        let selection = sdk::SdkSelection {
            sdk_root: sdk.path().to_path_buf(),
            templates_root: sdk.path().to_path_buf(),
            runtime_root: runtime.canonicalize().unwrap(),
            runtime_manifest: json!({
                "target": "windows",
                "executable": "unone-native-player.exe",
                "files": [{"path":"unone-native-player.exe", "sha256":hash}]
            }),
            host: crate::hosts::lookup("windows").unwrap(),
            runtime_id: "windows-production-test".to_string(),
            variant: "production".to_string(),
            engine_version: "0.1.0".to_string(),
        };
        let verified = sdk::verified_windows_executable(&selection).unwrap();
        assert_eq!(verified.relative, PathBuf::from("unone-native-player.exe"));
        assert_eq!(verified.path, player.canonicalize().unwrap());
        assert_eq!(verified.sha256, hash);
    }

    #[test]
    fn native_launch_uses_verified_sdk_runtime_and_checks_export_copy() {
        let sdk = tempdir().unwrap();
        let runtime = sdk.path().join("runtime");
        let output = sdk.path().join("output");
        fs::create_dir_all(&runtime).unwrap();
        fs::create_dir_all(&output).unwrap();
        let bytes = b"player";
        let player = runtime.join("unone-native-player.exe");
        write_file(&player, bytes);
        write_file(&output.join("unone-native-player.exe"), bytes);
        let hash = digest(bytes);
        let selection = sdk::SdkSelection {
            sdk_root: sdk.path().to_path_buf(),
            templates_root: sdk.path().to_path_buf(),
            runtime_root: runtime.canonicalize().unwrap(),
            runtime_manifest: json!({
                "target": "windows",
                "executable": "unone-native-player.exe",
                "files": [{"path":"unone-native-player.exe", "sha256":hash}]
            }),
            host: crate::hosts::lookup("windows").unwrap(),
            runtime_id: "windows-production-test".to_string(),
            variant: "production".to_string(),
            engine_version: "0.1.0".to_string(),
        };
        let output = output.canonicalize().unwrap();
        write_file(
            &output.join("export.json"),
            serde_json::to_vec(&json!({
                "target": "windows",
                "profile": "release",
                "dev_tools": false,
                "preview_tools": false,
                "files": [{"path":"unone-native-player.exe", "bytes":bytes.len(), "sha256":hash}]
            }))
            .unwrap()
            .as_slice(),
        );
        let exported = json!({"sdk_selection": selection.report()});
        let launch = launch_descriptor(&selection, &output, &exported, false).unwrap();
        assert_eq!(launch["kind"], "native");
        assert_eq!(launch["executable_source"], "sdk-runtime");
        assert_eq!(
            launch["executable"],
            selection
                .runtime_root
                .join("unone-native-player.exe")
                .canonicalize()
                .unwrap()
                .display()
                .to_string()
        );
        assert_eq!(launch["args"][0], "--root");
        assert_eq!(launch["args"][1], output.display().to_string());
        assert_eq!(launch["cwd"], output.display().to_string());
    }

    #[test]
    fn sdk_runtime_path_limit_has_actionable_error() {
        let path = PathBuf::from(format!("C:/{}", "runtime/".repeat(80)));
        let result = sdk::ensure_windows_runtime_executable_path(&path);
        let error = result.unwrap_err().to_string();
        assert!(error.contains("SDK_RUNTIME_EXECUTABLE_PATH_TOO_LONG"));
        assert!(error.contains("install the trusted SDK in a shallow directory"));
    }

    #[test]
    fn sdk_runtime_path_limit_counts_utf16_code_units() {
        let path = PathBuf::from(format!("C:/{}", "😀".repeat(130)));
        let error = sdk::ensure_windows_runtime_executable_path(&path)
            .unwrap_err()
            .to_string();
        assert!(error.contains("SDK_RUNTIME_EXECUTABLE_PATH_TOO_LONG"));
    }
}
