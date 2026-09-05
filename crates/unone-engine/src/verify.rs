//! One command that runs every gate a game must pass.
//!
//! The handoff contract used to be a list of commands with instructions to run
//! them in order and judge each result. That is judgement an author can get
//! wrong: skip a step, misread a warning, stop at the first failure and never
//! learn about the rest. A gate that can be a tool should not be a document.
//!
//! This runs all of them, always, and returns one verdict plus what each step
//! found. It adds no checks of its own; every step is an existing operation.

use std::path::Path;

use serde::Serialize;

use crate::{
    asset,
    diagnostics::{ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult},
    layout,
    project::ProjectPaths,
    runtime::EngineRuntime,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Passed,
    Failed,
    /// The project does not use this capability, so there is nothing to check.
    NotApplicable,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyStep {
    pub name: String,
    pub status: StepStatus,
    pub summary: String,
    /// The command that reproduces this step on its own.
    pub command: String,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyReport {
    pub project: String,
    pub steps: Vec<VerifyStep>,
    pub passed: usize,
    pub failed: usize,
    pub not_applicable: usize,
}

fn step(
    name: &str,
    command: &str,
    status: StepStatus,
    summary: impl Into<String>,
    diagnostics: Vec<Diagnostic>,
) -> VerifyStep {
    VerifyStep {
        name: name.to_string(),
        status,
        summary: summary.into(),
        command: command.to_string(),
        diagnostics,
    }
}

/// Run every gate: types, assets, screen layout, and the deterministic tests.
///
/// Every step runs even after one fails, because an author needs the whole
/// picture to plan, not just the first thing that broke.
pub fn verify(project_root: impl AsRef<Path>) -> EngineResult<VerifyReport> {
    let project_root = project_root.as_ref();
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let mut steps = Vec::new();

    let types = EngineRuntime::check_with_types(project_root);
    steps.push(step(
        "types",
        "game check --types",
        if types.ok {
            StepStatus::Passed
        } else {
            StepStatus::Failed
        },
        match types.value.as_ref() {
            Some(report) if types.ok => format!(
                "entrypoints {:?}, strict_mode {}",
                report.entrypoints, report.strict_mode
            ),
            _ => "the entry script did not pass the Luau contract or type check".to_string(),
        },
        types.diagnostics,
    ));

    let assets = asset::inspect_strict(project_root);
    steps.push(step(
        "assets",
        "game asset inspect --strict",
        if assets.ok {
            StepStatus::Passed
        } else {
            StepStatus::Failed
        },
        match assets.value.as_ref() {
            Some(report) => format!(
                "{} declared, {} scene references, ready_for_packaging {}",
                report.assets.len(),
                report.references.len(),
                report.ready_for_packaging
            ),
            None => "asset declarations could not be inspected".to_string(),
        },
        assets.diagnostics,
    ));

    if config.ui_previews.is_empty() {
        steps.push(layout_step(project_root, None, &paths.root));
    } else {
        for preview in &config.ui_previews {
            steps.push(layout_step(project_root, Some(preview), &paths.root));
        }
    }

    if paths.test_files.is_empty() {
        steps.push(step(
            "tests",
            "game test",
            StepStatus::Failed,
            "the project declares no test files",
            vec![tests_missing_diagnostic()],
        ));
    } else {
        let tests = EngineRuntime::run_tests(project_root);
        let summary = match tests.value.as_ref() {
            Some(report) => {
                let passed = report.cases.iter().filter(|case| case.passed).count();
                format!("{passed}/{} deterministic cases passed", report.cases.len())
            }
            None => "the test suite could not run".to_string(),
        };
        steps.push(step(
            "tests",
            "game test",
            if tests.ok {
                StepStatus::Passed
            } else {
                StepStatus::Failed
            },
            summary,
            tests.diagnostics,
        ));
    }

    let failed = steps
        .iter()
        .filter(|step| step.status == StepStatus::Failed)
        .count();
    let passed = steps
        .iter()
        .filter(|step| step.status == StepStatus::Passed)
        .count();
    let not_applicable = steps
        .iter()
        .filter(|step| step.status == StepStatus::NotApplicable)
        .count();

    let report = VerifyReport {
        project: config.name,
        steps,
        passed,
        failed,
        not_applicable,
    };
    let mut result = if failed == 0 {
        EngineResult::success(report)
    } else {
        let mut diagnostic = Diagnostic::error(
            "VERIFY_FAILED",
            "有 gate 沒有通過",
            format!("{failed} 個步驟失敗；每個步驟的 command 欄位可以單獨重跑。"),
        );
        diagnostic.facts = serde_json::json!({
            "failed_steps": report
                .steps
                .iter()
                .filter(|step| step.status == StepStatus::Failed)
                .map(|step| step.name.clone())
                .collect::<Vec<_>>(),
        });
        let mut result = EngineResult::success(report);
        result.ok = false;
        result.diagnostics.push(diagnostic);
        result
    };
    if let Some(report) = result.value.as_ref() {
        result.effects.push(format!(
            "verify ran {} gates: {} passed, {} failed, {} not applicable",
            report.steps.len(),
            report.passed,
            report.failed,
            report.not_applicable
        ));
    }
    result
}

/// Run the project to a screen and check the layout it publishes.
fn layout_step(
    project_root: &Path,
    preview: Option<&crate::project::UiPreviewSpec>,
    root: &Path,
) -> VerifyStep {
    let name = match preview {
        Some(preview) => format!("layout:{}", preview.name),
        None => "layout".to_string(),
    };
    let frames = preview.map(|preview| preview.frames).unwrap_or(1);
    let seed = preview.map(|preview| preview.seed).unwrap_or(42);
    let command = match preview.and_then(|preview| preview.input_sequence.as_deref()) {
        Some(sequence) => format!(
            "game ui preview --strict --frames {frames} --seed {seed} --input-sequence {sequence}"
        ),
        None => format!("game ui preview --strict --frames {frames} --seed {seed}"),
    };
    let command = command.as_str();
    let mut sequence = Vec::new();
    if let Some(path) = preview.and_then(|preview| preview.input_sequence.as_deref()) {
        match std::fs::read_to_string(root.join(path)).map_err(|error| error.to_string()).and_then(
            |text| serde_json::from_str::<Vec<crate::project::InputFrame>>(&text)
                .map_err(|error| error.to_string()),
        ) {
            Ok(frames) => sequence = frames,
            Err(error) => {
                return step(
                    &name,
                    command,
                    StepStatus::Failed,
                    "the declared input sequence could not be read",
                    vec![Diagnostic::error(
                        "INPUT_SEQUENCE_INVALID",
                        "無法讀取 ui_previews 宣告的 input sequence",
                        format!("{path}：{error}"),
                    )],
                );
            }
        }
    }
    let mut runtime = match EngineRuntime::load_with_seed(project_root, seed) {
        Ok(runtime) => runtime,
        Err(diagnostic) => {
            return step(
                &name,
                command,
                StepStatus::Failed,
                "the project could not be loaded to draw its screen",
                vec![*diagnostic],
            );
        }
    };
    let run = if sequence.is_empty() {
        runtime.run(frames, seed)
    } else {
        runtime.run_with_input_sequence(frames, seed, &sequence)
    };
    if !run.ok {
        return step(
            &name,
            command,
            StepStatus::Failed,
            "the project could not reach this screen",
            run.diagnostics,
        );
    }
    let Some(tree) = runtime.observe().ui else {
        return step(
            &name,
            command,
            StepStatus::NotApplicable,
            "the game publishes no UI tree",
            Vec::new(),
        );
    };
    let report = layout::inspect(&tree, layout::DEFAULT_LAYOUT_COLS, layout::DEFAULT_LAYOUT_ROWS);
    let diagnostics = report
        .findings
        .iter()
        .map(|finding| {
            let mut diagnostic = Diagnostic::error(
                finding.code.clone(),
                "UI layout 有結構問題",
                finding.detail.clone(),
            );
            diagnostic.facts = serde_json::json!({"nodes": finding.nodes});
            diagnostic.suggested_actions.push(ActionSuggestion {
                action: "resolve_layout_finding".to_string(),
                description: finding.resolution.clone(),
                command: Some("game ui preview --strict".to_string()),
            });
            diagnostic
        })
        .collect::<Vec<_>>();
    step(
        &name,
        command,
        if report.readable {
            StepStatus::Passed
        } else {
            StepStatus::Failed
        },
        // Name the nodes, not just how many. Two declared screens that report
        // the same node list are almost certainly the same screen reached
        // twice, which is a gate that proves nothing — but "almost certainly"
        // is a judgement, so this reports the fact and leaves the call to the
        // reader.
        format!(
            "{} findings; nodes: {}",
            report.findings.len(),
            report
                .nodes
                .iter()
                .map(|node| node.id.clone())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        diagnostics,
    )
}

fn tests_missing_diagnostic() -> Diagnostic {
    let mut diagnostic = Diagnostic {
        code: "TESTS_NOT_CONFIGURED".to_string(),
        severity: DiagnosticSeverity::Error,
        summary: "專案沒有設定測試檔".to_string(),
        explanation: "verify 要求可重播的 deterministic 測試；沒有測試就沒有通過的依據。".to_string(),
        facts: serde_json::json!({}),
        likely_causes: Vec::new(),
        suggested_actions: Vec::new(),
        source: None,
    };
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "add_test_files".to_string(),
        description: "在 project.unone.json 的 test_files 加入 .test.json 檔案。".to_string(),
        command: Some("game project inspect --json".to_string()),
    });
    diagnostic
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{StepStatus, verify};

    fn write_project(dir: &std::path::Path, script: &str, test_files: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::create_dir_all(dir.join("tests")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            format!(
                r#"{{"name": "VerifyFixture", "entry_script": "scripts/main.luau", "test_files": {test_files}}}"#
            ),
        )
        .unwrap();
        fs::write(dir.join("scripts/main.luau"), script).unwrap();
    }

    const GOOD_SCRIPT: &str = r#"--!strict
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.observation.set("frame_ok", true)
end
return Game
"#;

    #[test]
    fn every_gate_runs_even_after_one_fails() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), GOOD_SCRIPT, "[]");
        let result = verify(dir.path());
        let report = result.value.expect("verify always reports its steps");

        // Four gates, always, so an author sees the whole picture at once.
        let names: Vec<&str> = report.steps.iter().map(|step| step.name.as_str()).collect();
        assert_eq!(names, vec!["types", "assets", "layout", "tests"]);
        assert!(!result.ok, "a project without tests must not pass");
        assert_eq!(
            report
                .steps
                .iter()
                .find(|step| step.name == "tests")
                .unwrap()
                .status,
            StepStatus::Failed
        );
        // A game with no screen is not a failure, it is not applicable.
        assert_eq!(
            report
                .steps
                .iter()
                .find(|step| step.name == "layout")
                .unwrap()
                .status,
            StepStatus::NotApplicable
        );
        // Every step names the command that reproduces it alone.
        assert!(report.steps.iter().all(|step| !step.command.is_empty()));
    }

    /// The types step needs the official analyzer, which a bare `cargo test`
    /// environment may not have. That is an environment fact, not a game fact,
    /// so this asserts the game-owned gates and states which case it saw.
    #[test]
    fn the_gates_a_project_owns_pass_when_the_project_is_sound() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), GOOD_SCRIPT, r#"["tests/smoke.test.json"]"#);
        fs::write(
            dir.path().join("tests/smoke.test.json"),
            r#"{"name": "publishes an observation", "frames": 1, "seed": 42,
                "assertions": [{"observation": {"key": "frame_ok", "equals": true}}]}"#,
        )
        .unwrap();
        let report = verify(dir.path()).value.expect("verify reports its steps");
        let status = |name: &str| {
            report
                .steps
                .iter()
                .find(|step| step.name == name)
                .unwrap_or_else(|| panic!("missing step {name}"))
                .status
        };
        assert_eq!(status("assets"), StepStatus::Passed);
        assert_eq!(status("tests"), StepStatus::Passed);
        assert_eq!(status("layout"), StepStatus::NotApplicable);

        let types = report
            .steps
            .iter()
            .find(|step| step.name == "types")
            .unwrap();
        if types.status == StepStatus::Failed {
            assert!(
                types
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.code == "LUAU_ANALYZER_NOT_FOUND"),
                "types failed for a reason other than a missing analyzer: {:?}",
                types.diagnostics
            );
        }
    }
}
