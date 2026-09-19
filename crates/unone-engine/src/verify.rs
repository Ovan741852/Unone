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
    /// The gate found something, but the project declared it advisory. Reported
    /// in full; does not fail the run.
    Advisory,
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
    #[serde(skip_serializing_if = "usize_is_zero")]
    pub advisory: usize,
    pub not_applicable: usize,
    /// Where the step order came from: `default` or `project`.
    pub step_source: String,
}

fn usize_is_zero(value: &usize) -> bool {
    *value == 0
}

/// The gates this build knows, in the order it runs them when a project says
/// nothing.
pub const DEFAULT_VERIFY_STEPS: [&str; 4] = ["types", "assets", "layout", "tests"];

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
    let plan = match resolve_plan(config.verify.as_ref()) {
        Ok(plan) => plan,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let step_source = if config.verify.is_some() {
        "project"
    } else {
        "default"
    };
    let mut steps = Vec::new();

    for (name, required) in &plan {
        match name.as_str() {
            "types" => steps.push(types_step(project_root, *required)),
            "assets" => steps.push(assets_step(project_root, *required)),
            "layout" => {
                if config.ui_previews.is_empty() {
                    steps.push(layout_step(project_root, None, &paths.root, *required));
                } else {
                    for preview in &config.ui_previews {
                        steps.push(layout_step(
                            project_root,
                            Some(preview),
                            &paths.root,
                            *required,
                        ));
                    }
                }
            }
            "tests" => steps.push(tests_step(project_root, &paths, *required)),
            _ => unreachable!("resolve_plan rejects unknown ids"),
        }
    }

    finish(config.name, steps, step_source)
}

/// Which gates to run, and whether each one may fail without failing the run.
///
/// The default order is the engine's opinion, not a law. What the engine does
/// keep is that a skipped gate has to be a written decision: an empty list, an
/// unknown id and a duplicate are all errors, so no gate goes missing quietly.
fn resolve_plan(
    declared: Option<&crate::project::VerifyConfig>,
) -> Result<Vec<(String, bool)>, Box<Diagnostic>> {
    let Some(declared) = declared else {
        return Ok(DEFAULT_VERIFY_STEPS
            .iter()
            .map(|name| ((*name).to_string(), true))
            .collect());
    };
    if declared.steps.is_empty() {
        let mut diagnostic = Diagnostic::error(
            "VERIFY_STEPS_EMPTY",
            "verify declared an empty gate list",
            "verify.steps was declared without any gates, which disables every verification while still reporting success. Use required: false to make individual gates advisory; remove the entire field to use the default order.".to_string(),
        );
        diagnostic.facts = serde_json::json!({ "available": DEFAULT_VERIFY_STEPS });
        return Err(Box::new(diagnostic));
    }
    let mut plan: Vec<(String, bool)> = Vec::new();
    for spec in &declared.steps {
        let name = spec.step().to_string();
        if spec.reserved_command() {
            return Err(Box::new(Diagnostic::error(
                "VERIFY_STEP_NOT_IMPLEMENTED",
                "verify command steps are not implemented",
                format!(
                    "gate '{name}' declares a command: the project-command extension point is reserved, but this build does not implement it. Declaring it executes nothing, so the configuration is invalid."
                ),
            )));
        }
        if !DEFAULT_VERIFY_STEPS.contains(&name.as_str()) {
            let mut diagnostic = Diagnostic::error(
                "VERIFY_STEP_UNKNOWN",
                "verify declared an unavailable gate",
                format!(
                    "The engine does not provide gate '{name}'; a typo must not silently disable a gate."
                ),
            );
            diagnostic.facts = serde_json::json!({
                "step": name,
                "available": DEFAULT_VERIFY_STEPS,
            });
            return Err(Box::new(diagnostic));
        }
        if plan.iter().any(|(existing, _)| *existing == name) {
            return Err(Box::new(Diagnostic::error(
                "VERIFY_STEP_DUPLICATED",
                "verify declared a duplicate gate",
                format!(
                    "gate '{name}' is declared more than once; running the same gate twice adds no verification and only makes the report harder to read."
                ),
            )));
        }
        plan.push((name, spec.required()));
    }
    Ok(plan)
}

/// A failing gate the project declared advisory is reported, not fatal.
fn resolve_status(ok: bool, required: bool) -> StepStatus {
    match (ok, required) {
        (true, _) => StepStatus::Passed,
        (false, true) => StepStatus::Failed,
        (false, false) => StepStatus::Advisory,
    }
}

fn types_step(project_root: &Path, required: bool) -> VerifyStep {
    let types = EngineRuntime::check_with_types(project_root);
    step(
        "types",
        "game check --types",
        resolve_status(types.ok, required),
        match types.value.as_ref() {
            Some(report) if types.ok => format!(
                "entrypoints {:?}, strict_mode {}",
                report.entrypoints, report.strict_mode
            ),
            _ => "the entry script did not pass the Luau contract or type check".to_string(),
        },
        types.diagnostics,
    )
}

fn assets_step(project_root: &Path, required: bool) -> VerifyStep {
    let assets = asset::inspect_strict(project_root);
    step(
        "assets",
        "game asset inspect --strict",
        resolve_status(assets.ok, required),
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
    )
}

fn tests_step(project_root: &Path, paths: &ProjectPaths, required: bool) -> VerifyStep {
    if paths.test_files.is_empty() {
        return step(
            "tests",
            "game test",
            resolve_status(false, required),
            "the project declares no test files",
            vec![tests_missing_diagnostic()],
        );
    }
    let tests = EngineRuntime::run_tests(project_root);
    let suite_passed = tests
        .value
        .as_ref()
        .is_some_and(|report| report.passed);
    let summary = match tests.value.as_ref() {
        Some(report) => {
            let passed = report.cases.iter().filter(|case| case.passed).count();
            format!("{passed}/{} deterministic cases passed", report.cases.len())
        }
        None => "the test suite could not run".to_string(),
    };
    let mut diagnostics = tests.diagnostics;
    if let Some(report) = tests.value.as_ref() {
        if !report.passed {
            let failed_cases = report
                .cases
                .iter()
                .filter(|case| !case.passed)
                .map(|case| {
                    serde_json::json!({
                        "name": &case.name,
                        "failures": &case.failures,
                    })
                })
                .collect::<Vec<_>>();
            let mut diagnostic = Diagnostic::error(
                "TEST_ASSERTIONS_FAILED",
                "A deterministic test assertion failed",
                "The test runner completed, but one or more declared assertions did not match the observed world. Fix the assertion or the game behavior before activation.",
            );
            diagnostic.facts = serde_json::json!({ "failed_cases": failed_cases });
            diagnostics.push(diagnostic);
        }
    }
    step(
        "tests",
        "game test",
        resolve_status(tests.ok && suite_passed, required),
        summary,
        diagnostics,
    )
}

fn finish(
    project: String,
    steps: Vec<VerifyStep>,
    step_source: &str,
) -> EngineResult<VerifyReport> {
    let failed = steps
        .iter()
        .filter(|step| step.status == StepStatus::Failed)
        .count();
    let passed = steps
        .iter()
        .filter(|step| step.status == StepStatus::Passed)
        .count();
    let advisory = steps
        .iter()
        .filter(|step| step.status == StepStatus::Advisory)
        .count();
    let not_applicable = steps
        .iter()
        .filter(|step| step.status == StepStatus::NotApplicable)
        .count();

    let report = VerifyReport {
        project,
        steps,
        passed,
        failed,
        advisory,
        not_applicable,
        step_source: step_source.to_string(),
    };
    let mut result = if failed == 0 {
        EngineResult::success(report)
    } else {
        let mut diagnostic = Diagnostic::error(
            "VERIFY_FAILED",
            "A verify gate failed",
            format!("{failed} steps failed; each step's command field can be rerun independently."),
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
        // Name the advisory gates in the effect line rather than leaving them
        // in the step list: a run that is green only because something was
        // declared advisory should say so where a reader cannot miss it.
        let advisory = if report.advisory > 0 {
            format!(
                ", {} advisory ({})",
                report.advisory,
                report
                    .steps
                    .iter()
                    .filter(|step| step.status == StepStatus::Advisory)
                    .map(|step| step.name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        } else {
            String::new()
        };
        result.effects.push(format!(
            "verify ran {} gates in the {} order: {} passed, {} failed{advisory}, {} not applicable",
            report.steps.len(),
            report.step_source,
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
    required: bool,
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
        match std::fs::read_to_string(root.join(path))
            .map_err(|error| error.to_string())
            .and_then(|text| {
                serde_json::from_str::<Vec<crate::project::InputFrame>>(&text)
                    .map_err(|error| error.to_string())
            }) {
            Ok(frames) => sequence = frames,
            Err(error) => {
                return step(
                    &name,
                    command,
                    resolve_status(false, required),
                    "the declared input sequence could not be read",
                    vec![Diagnostic::error(
                        "INPUT_SEQUENCE_INVALID",
                        "Could not read the input sequence declared by ui_previews",
                        format!("{path}: {error}"),
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
                resolve_status(false, required),
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
            resolve_status(false, required),
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
    let report = layout::inspect(
        &tree,
        layout::DEFAULT_LAYOUT_COLS,
        layout::DEFAULT_LAYOUT_ROWS,
    );
    let diagnostics = report
        .findings
        .iter()
        .map(|finding| {
            let mut diagnostic = Diagnostic::error(
                finding.code.clone(),
                "UI layout has structural problems",
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
        resolve_status(report.readable, required),
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
        summary: "The project declares no test files".to_string(),
        explanation: "verify requires replayable deterministic tests; without tests there is no basis for a passing result.".to_string(),
        facts: serde_json::json!({}),
        likely_causes: Vec::new(),
        suggested_actions: Vec::new(),
        source: None,
    };
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "add_test_files".to_string(),
        description: "Add .test.json files to test_files in project.unone.json.".to_string(),
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
        assert_eq!(report.step_source, "default");
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

    /// The point of the whole feature: a project decides its own order and
    /// which gates may fail, and the engine still refuses to lose one quietly.
    #[test]
    fn a_project_owns_its_gate_order_and_which_gates_are_advisory() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::write(dir.path().join("scripts/main.luau"), GOOD_SCRIPT).unwrap();
        let write_config = |verify: &str| {
            fs::write(
                dir.path().join("project.unone.json"),
                format!(
                    r#"{{"name": "VerifyPlan", "entry_script": "scripts/main.luau", "verify": {verify}}}"#
                ),
            )
            .unwrap();
        };

        // Reordered, and the missing tests declared advisory.
        write_config(r#"{"steps": ["assets", {"step": "tests", "required": false}]}"#);
        let result = verify(dir.path());
        let report = result.value.as_ref().expect("verify reports its steps");
        let names: Vec<&str> = report.steps.iter().map(|step| step.name.as_str()).collect();
        assert_eq!(names, vec!["assets", "tests"]);
        assert_eq!(report.step_source, "project");
        assert_eq!(report.advisory, 1);
        assert!(
            result.ok,
            "an advisory gate must not fail the run: {:?}",
            result.diagnostics
        );
        assert!(
            result
                .effects
                .iter()
                .any(|effect| effect.contains("advisory (tests)")),
            "the run must say which gate was let through: {:?}",
            result.effects
        );
        // Advisory means reported, not hidden.
        assert!(!report.steps[1].diagnostics.is_empty());

        // The same gate, required, fails the run.
        write_config(r#"{"steps": ["tests"]}"#);
        assert!(!verify(dir.path()).ok);

        for (declared, code) in [
            (r#"{"steps": []}"#, "VERIFY_STEPS_EMPTY"),
            (r#"{"steps": ["typechecks"]}"#, "VERIFY_STEP_UNKNOWN"),
            (r#"{"steps": ["tests", "tests"]}"#, "VERIFY_STEP_DUPLICATED"),
            (
                r#"{"steps": [{"step": "tests", "command": "npm test"}]}"#,
                "VERIFY_STEP_NOT_IMPLEMENTED",
            ),
        ] {
            write_config(declared);
            let result = verify(dir.path());
            assert!(!result.ok, "{declared} must be refused");
            assert_eq!(result.diagnostics[0].code, code, "{declared}");
        }
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

    #[test]
    fn failed_test_assertions_fail_the_required_verify_gate() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), GOOD_SCRIPT, r#"["tests/fail.test.json"]"#);
        fs::write(
            dir.path().join("tests/fail.test.json"),
            r#"{"name":"fails intentionally","frames":1,"assertions":[{"observation":{"key":"frame_ok","equals":false}}]}"#,
        )
        .unwrap();

        let result = verify(dir.path());
        let report = result.value.expect("verify reports its steps");
        let tests = report
            .steps
            .iter()
            .find(|step| step.name == "tests")
            .expect("tests step");
        assert!(!result.ok, "a failed assertion must block activation");
        assert_eq!(tests.status, StepStatus::Failed);
        assert!(tests.summary.contains("0/1 deterministic cases passed"));
        assert!(tests
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "TEST_ASSERTIONS_FAILED"));
    }
}
