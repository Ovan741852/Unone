//! `game test`: every test file is one deterministic case. A run may take only
//! some of them (by name or path, or one shard of them); a case that cannot load
//! or run fails on its own instead of ending the suite.
use std::{
    fmt::Write as _,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::{Deserialize, Serialize};

use super::{EngineRuntime, TestCaseReport, TestSuiteReport};
use crate::{
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult},
    project::{InputFrame, ProjectConfig, ProjectPaths, TestAssertion, TestSpec},
    ui::UiTree,
    world::WorldSnapshot,
};

/// Which of the project's tests a run takes. The default takes them all.
#[derive(Debug, Clone, Default)]
pub struct TestSelection {
    /// Keep tests whose name or project-relative path contains any of these.
    pub filters: Vec<String>,
    /// Keep the tests at exactly these project-relative paths.
    pub files: Vec<String>,
    /// `(k, n)`, k counted from 1: of the tests kept, every n-th from the k-th.
    pub shard: Option<(usize, usize)>,
    /// Run each kept test rolled back this many ticks before every tick and
    /// compare it with the straight run (docs/rollback.md).
    pub rollback: Option<u32>,
}

impl TestSelection {
    fn narrows(&self) -> bool {
        !self.filters.is_empty() || !self.files.is_empty()
    }
}

/// A test a selection keeps, in the project's order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectedTest {
    /// The test file, relative to the project root.
    pub path: String,
    pub name: String,
    pub frames: u64,
}

struct Case {
    path: String,
    spec: TestSpec,
}

impl EngineRuntime {
    pub fn run_tests(project_root: impl AsRef<Path>) -> EngineResult<TestSuiteReport> {
        Self::run_tests_with(project_root, &TestSelection::default())
    }

    /// The tests a selection keeps, checked as a run checks them, without running any.
    pub fn list_tests(project_root: impl AsRef<Path>, selection: &TestSelection) -> EngineResult<Vec<SelectedTest>> {
        match selected_cases(project_root.as_ref(), selection) {
            Ok((_, _, cases)) => EngineResult::success(
                cases
                    .into_iter()
                    .map(|case| SelectedTest { path: case.path, name: case.spec.name, frames: case.spec.frames })
                    .collect(),
            ),
            Err(diagnostic) => EngineResult::failure(*diagnostic),
        }
    }

    pub fn run_tests_with(project_root: impl AsRef<Path>, selection: &TestSelection) -> EngineResult<TestSuiteReport> {
        let (config, root, cases) = match selected_cases(project_root.as_ref(), selection) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let mut diagnostics = Vec::new();
        let cases: Vec<TestCaseReport> = cases
            .into_iter()
            .map(|case| match selection.rollback {
                Some(rollback) => run_rollback_case(&root, case, rollback, &mut diagnostics),
                None => run_case(&root, case, &mut diagnostics),
            })
            .collect();
        let passed = cases.iter().all(|case| case.passed);
        let mut result = EngineResult::success(TestSuiteReport { project: config.name, passed, cases });
        result.diagnostics = test_suite_diagnostics(diagnostics);
        result
    }
}

/// What a suite's cases reported, as the suite reports it wherever they ran: why
/// a case could not load or run (each once, though many cases fail alike), then
/// one warning, from the case that saw the most.
pub fn test_suite_diagnostics(diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    let (errors, warnings): (Vec<Diagnostic>, Vec<Diagnostic>) =
        diagnostics.into_iter().partition(crate::input_actions::is_error);
    let mut suite: Vec<Diagnostic> = Vec::new();
    for error in errors {
        if !suite.iter().any(|seen| seen.code == error.code && seen.explanation == error.explanation) {
            suite.push(error);
        }
    }
    suite.extend(crate::input_actions::suite_warning(warnings));
    suite
}

/// Every test file read and checked (a bad one fails the run before anything
/// runs), then those the selection keeps.
fn selected_cases(project_root: &Path, selection: &TestSelection) -> Result<(ProjectConfig, PathBuf, Vec<Case>), Box<Diagnostic>> {
    let (config, paths) = ProjectPaths::discover(project_root)?;
    if paths.test_files.is_empty() {
        return Err(Box::new(Diagnostic::error(
            "TESTS_NOT_CONFIGURED",
            "The project has no test files configured",
            "Add .test.json files to the test_files array in project.unone.json.",
        )));
    }
    if let Some((k, n)) = selection.shard
        && (n == 0 || k == 0 || k > n)
    {
        return Err(Box::new(Diagnostic::error(
            "TEST_SHARD_INVALID",
            "Test shard is out of range",
            format!("shard {k}/{n}: give k/n with 1 <= k <= n, for example 2/4."),
        )));
    }
    let mut cases = Vec::new();
    for (index, file) in paths.test_files.iter().enumerate() {
        let path = config.test_files.get(index).cloned().unwrap_or_else(|| file.display().to_string()).replace('\\', "/");
        let spec = read_case(file)?;
        if spec.host_time.is_none() {
            EngineRuntime::require_replayable_host_time(&config)?;
        }
        cases.push(Case { path, spec });
    }
    let kept: Vec<Case> = cases
        .into_iter()
        .filter(|case| selection.files.is_empty() || selection.files.iter().any(|file| file.replace('\\', "/") == case.path))
        .filter(|case| {
            selection.filters.is_empty()
                || selection.filters.iter().any(|filter| case.spec.name.contains(filter.as_str()) || case.path.contains(filter.as_str()))
        })
        .collect();
    if kept.is_empty() && selection.narrows() {
        let mut diagnostic = Diagnostic::error(
            "TESTS_NONE_SELECTED",
            "No test matches the selection",
            format!(
                "No test name or path contains {:?}{}. A run of nothing would pass whatever the game does.",
                selection.filters,
                if selection.files.is_empty() { String::new() } else { format!(" or is one of {:?}", selection.files) }
            ),
        );
        diagnostic.suggested_actions = vec![ActionSuggestion {
            action: "list_tests".to_string(),
            description: "List every test's name and path.".to_string(),
            command: Some("game test --list".to_string()),
        }];
        return Err(Box::new(diagnostic));
    }
    let kept = match selection.shard {
        Some((k, n)) => kept.into_iter().enumerate().filter(|(index, _)| index % n == k - 1).map(|(_, case)| case).collect(),
        None => kept,
    };
    Ok((config, paths.root, kept))
}

fn read_case(file: &Path) -> Result<TestSpec, Box<Diagnostic>> {
    let text = fs::read_to_string(file).map_err(|err| {
        Box::new(Diagnostic::error("TEST_READ_FAILED", "Unable to read test file", format!("{}: {}", file.display(), err)))
    })?;
    let spec: TestSpec = serde_json::from_str(&text).map_err(|err| {
        Box::new(Diagnostic::error("TEST_INVALID", "Test file is not valid JSON", format!("{}: {}", file.display(), err)))
    })?;
    if spec.assertions.is_empty() {
        let mut diagnostic = Diagnostic::error(
            "TEST_NO_ASSERTIONS",
            "Test checks nothing",
            format!(
                "{} declares no assertions, so it would pass whatever the game does. A running game is not evidence; assert what this case should have produced.",
                file.display()
            ),
        );
        diagnostic.suggested_actions = vec![ActionSuggestion {
            action: "add_assertion".to_string(),
            description: "Add an entity, observation or UI entry to `assertions`, for example {\"observation\":{\"key\":\"score\",\"equals\":1}}; test.schema.json lists every form.".to_string(),
            command: Some("game schema test".to_string()),
        }];
        return Err(Box::new(diagnostic));
    }
    for (index, assertion) in spec.assertions.iter().enumerate() {
        if let Err(error) = assertion.validate() {
            return Err(Box::new(Diagnostic::error(
                "TEST_ASSERTION_INVALID",
                "Test assertion does not satisfy the single-target contract",
                format!("{} assertions[{index}]: {error}. Fix it according to test.schema.json in the package.", file.display()),
            )));
        }
    }
    Ok(spec)
}

/// One case: loaded fresh, run, its assertions checked. A load or run that fails
/// is this case's failure, and its diagnostic goes to the suite's.
fn run_case(root: &Path, case: Case, diagnostics: &mut Vec<Diagnostic>) -> TestCaseReport {
    let started = Instant::now();
    let Case { path, spec } = case;
    let mut report = TestCaseReport {
        name: spec.name.clone(),
        path,
        passed: false,
        frames: 0,
        observation_digest: None,
        save_payload: None,
        failures: Vec::new(),
        elapsed_ms: 0,
    };
    let host_time = spec.host_time.clone().map(|tape| crate::HostTimeConfig::Replay { tape });
    match EngineRuntime::load_with_seed_save_and_host_time(root, spec.seed, spec.load_save.clone(), host_time) {
        Err(diagnostic) => {
            report.failures.push(describe(&diagnostic));
            diagnostics.push(*diagnostic);
        }
        Ok(mut runtime) => {
            for (action, is_down) in &spec.input {
                runtime.set_input(action.clone(), *is_down);
            }
            let run = if spec.input_sequence.is_empty() {
                runtime.run(spec.frames, spec.seed)
            } else {
                runtime.run_with_input_sequence(spec.frames, spec.seed, &spec.input_sequence)
            };
            let ran = run.value.is_some();
            for diagnostic in run.diagnostics {
                if crate::input_actions::is_error(&diagnostic) {
                    report.failures.push(describe(&diagnostic));
                    // A run that ended in it: why the case could not run.
                    if !ran {
                        diagnostics.push(diagnostic);
                    }
                } else if ran {
                    diagnostics.push(diagnostic);
                } else {
                    report.failures.push(describe(&diagnostic));
                }
            }
            match run.value {
                None => {
                    if report.failures.is_empty() {
                        report.failures.push("TEST_RUN_FAILED: the test runtime produced no result.".to_string());
                    }
                }
                Some(run) => {
                    if let Err(error) = runtime.host_time_replay_complete() {
                        report.failures.push(error);
                    }
                    for assertion in &spec.assertions {
                        if let Err(failure) = evaluate_assertion(&run.world, assertion) {
                            report.failures.push(failure);
                        }
                    }
                    report.frames = run.frames;
                    report.observation_digest = Some(run.observation_digest);
                    report.save_payload = run.save_payload;
                }
            }
        }
    }
    report.passed = report.failures.is_empty();
    report.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    report
}

/// One case run twice in step (docs/rollback.md): straight, and rolled back
/// before every tick (checkpoint, up to `rollback` ticks on wrong input, restore,
/// then the real tick). Both must observe the same world after every tick, and
/// the rolled-back run must still pass the case's assertions.
fn run_rollback_case(root: &Path, case: Case, rollback: u32, diagnostics: &mut Vec<Diagnostic>) -> TestCaseReport {
    let started = Instant::now();
    let Case { path, spec } = case;
    let mut report = TestCaseReport {
        name: spec.name.clone(),
        path,
        passed: false,
        frames: 0,
        observation_digest: None,
        save_payload: None,
        failures: Vec::new(),
        elapsed_ms: 0,
    };
    if let Err(diagnostic) = roll_back_case(root, &spec, rollback, &mut report) {
        report.failures.push(describe(&diagnostic));
        diagnostics.push(*diagnostic);
    }
    report.passed = report.failures.is_empty();
    report.elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    report
}

/// A divergence is the case's failure (the report says where); a runtime that
/// cannot load, run or checkpoint is the error.
fn roll_back_case(root: &Path, spec: &TestSpec, rollback: u32, report: &mut TestCaseReport) -> Result<(), Box<Diagnostic>> {
    let mut straight = load_case(root, spec)?;
    let mut rolled = load_case(root, spec)?;
    let unhooked = !rolled.has_state_hooks();
    let mut last = None;
    for frame in 0..spec.frames {
        let tick = frame + 1;
        let expected = step(&mut straight, spec, frame)?;
        let saved = rolled.observe();
        let checkpoint = rolled.checkpoint()?;
        let ahead = u64::from(rollback).min(spec.frames - frame);
        for predicted in 0..ahead {
            if let Err(diagnostic) = rolled.tick_with_input(&InputFrame::default()) {
                report.failures.push(format!(
                    "ROLLBACK_PREDICTED_TICK_FAILED: tick {} on predicted input (nothing held) failed: {}",
                    tick + predicted,
                    describe(&diagnostic)
                ));
                return Ok(());
            }
        }
        rolled.restore(&checkpoint)?;
        if let Some(difference) = digest_difference(&rolled.observe(), &saved)? {
            report.failures.push(format!(
                "ROLLBACK_RESTORE_INCOMPLETE: restoring the checkpoint taken before tick {tick} left a different world than it saved ({difference}). The checkpoint misses engine state; report it as an engine bug."
            ));
            return Ok(());
        }
        let actual = step(&mut rolled, spec, frame)?;
        if let Some(difference) = digest_difference(&actual, &expected)? {
            let plural = if ahead == 1 { "" } else { "s" };
            let hint = if unhooked {
                "The game defines no Game.saveState and Game.loadState, so its Luau variables kept what the predicted ticks left in them; return that state from Game.saveState(api) and take it back in Game.loadState(api, state)."
            } else {
                "Game.saveState missed Luau state the predicted ticks changed (module locals, caches, counters); everything update reads must come back through Game.loadState."
            };
            report.failures.push(format!(
                "ROLLBACK_DIVERGED: tick {tick}, run again after rolling back {ahead} predicted tick{plural}, differs from the straight run ({difference}). {hint} See docs/rollback.md."
            ));
            return Ok(());
        }
        last = Some(actual);
    }
    if let Err(error) = rolled.host_time_replay_complete() {
        report.failures.push(error);
    }
    let world = last.unwrap_or_else(|| rolled.observe());
    for assertion in &spec.assertions {
        if let Err(failure) = evaluate_assertion(&world, assertion) {
            report.failures.push(failure);
        }
    }
    report.frames = spec.frames;
    report.observation_digest = Some(digest(&world)?);
    report.save_payload = rolled.save_payload();
    Ok(())
}

fn load_case(root: &Path, spec: &TestSpec) -> Result<EngineRuntime, Box<Diagnostic>> {
    let host_time = spec.host_time.clone().map(|tape| crate::HostTimeConfig::Replay { tape });
    let mut runtime = EngineRuntime::load_with_seed_save_and_host_time(root, spec.seed, spec.load_save.clone(), host_time)?;
    for (action, is_down) in &spec.input {
        runtime.set_input(action.clone(), *is_down);
    }
    Ok(runtime)
}

/// One tick of the case, with its input as `game test` gives it.
fn step(runtime: &mut EngineRuntime, spec: &TestSpec, frame: u64) -> Result<WorldSnapshot, Box<Diagnostic>> {
    if spec.input_sequence.is_empty() {
        return runtime.tick();
    }
    match usize::try_from(frame).ok().and_then(|index| spec.input_sequence.get(index)) {
        Some(input) => runtime.tick_with_input(input),
        None => runtime.tick_with_input(&InputFrame::default()),
    }
}

fn digest(world: &WorldSnapshot) -> Result<String, Box<Diagnostic>> {
    super::observation_digest(world).map_err(|error| {
        Box::new(Diagnostic::error(
            "OBSERVATION_SERIALIZATION_FAILED",
            "Unable to serialize observation snapshot",
            format!("WorldSnapshot could not be serialized, so the observation digest cannot be computed: {error}"),
        ))
    })
}

/// Where two observations first differ, if their digests do.
fn digest_difference(actual: &WorldSnapshot, expected: &WorldSnapshot) -> Result<Option<String>, Box<Diagnostic>> {
    if digest(actual)? == digest(expected)? {
        return Ok(None);
    }
    let value = |world: &WorldSnapshot| serde_json::to_value(world).unwrap_or(serde_json::Value::Null);
    Ok(Some(
        json_difference(&value(actual), &value(expected), false, &mut "world".to_string())
            .unwrap_or_else(|| "the digests differ only in how numbers are written".to_string()),
    ))
}

/// A diagnostic as one failure line: code, explanation and where.
fn describe(diagnostic: &Diagnostic) -> String {
    let mut text = format!("{}: {}", diagnostic.code, diagnostic.explanation);
    if let Some(source) = &diagnostic.source {
        let _ = write!(text, " ({}", source.file);
        if let Some(line) = source.line {
            let _ = write!(text, ":{line}");
        }
        text.push(')');
    }
    text
}

/// Where `actual` first departs from `expected`, as `path = actual, expected
/// value`. Numbers compare by value: Luau has one number type, so an observed
/// 2.0 and an expected 2 (or 4294967297.0 and 4294967297) agree. With `subset`
/// an object needs only the keys `expected` gives (at every depth; arrays still
/// match item by item and in length).
fn json_difference(actual: &serde_json::Value, expected: &serde_json::Value, subset: bool, path: &mut String) -> Option<String> {
    use serde_json::Value;
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let same = match (integral(a), integral(b)) {
                (Some(a), Some(b)) => a == b,
                _ => a.as_f64() == b.as_f64(),
            };
            (!same).then(|| format!("{path} = {a}, expected {b}"))
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!("{path} has {} items, expected {}", a.len(), b.len()));
            }
            for (index, (a, b)) in a.iter().zip(b).enumerate() {
                let length = path.len();
                let _ = write!(path, "[{index}]");
                if let Some(difference) = json_difference(a, b, subset, path) {
                    return Some(difference);
                }
                path.truncate(length);
            }
            None
        }
        (Value::Object(a), Value::Object(b)) => {
            for (key, want) in b {
                let length = path.len();
                let _ = write!(path, ".{key}");
                match a.get(key) {
                    None => return Some(format!("{path} is missing, expected {want}")),
                    Some(got) => {
                        if let Some(difference) = json_difference(got, want, subset, path) {
                            return Some(difference);
                        }
                    }
                }
                path.truncate(length);
            }
            if !subset && let Some((key, got)) = a.iter().find(|(key, _)| !b.contains_key(*key)) {
                return Some(format!("{path}.{key} = {got}, not expected"));
            }
            None
        }
        _ => (actual != expected).then(|| format!("{path} = {actual}, expected {expected}")),
    }
}

fn json_equal(actual: &serde_json::Value, expected: &serde_json::Value) -> bool {
    json_difference(actual, expected, false, &mut String::new()).is_none()
}

/// An integral JSON number exactly, whether written as an integer or a float.
fn integral(number: &serde_json::Number) -> Option<i128> {
    if let Some(value) = number.as_i64() {
        return Some(i128::from(value));
    }
    if let Some(value) = number.as_u64() {
        return Some(i128::from(value));
    }
    let value = number.as_f64()?;
    (value.fract() == 0.0 && value.abs() < 1e38).then_some(value as i128)
}

fn evaluate_observation(world: &WorldSnapshot, observation: &crate::project::ObservationAssertion) -> Result<(), String> {
    let key = &observation.key;
    let actual = world.observations.get(key).ok_or_else(|| format!("Observation '{key}' does not exist."))?;
    let mut path = key.clone();
    if let Some(expected) = &observation.equals
        && let Some(difference) = json_difference(actual, expected, false, &mut path)
    {
        return Err(format!("Observation '{key}' = {actual}, does not equal expected {expected}. First difference: {difference}."));
    }
    if let Some(expected) = &observation.includes
        && let Some(difference) = json_difference(actual, expected, true, &mut path)
    {
        return Err(format!("Observation '{key}' = {actual}, does not include expected {expected}. First difference: {difference}."));
    }
    Ok(())
}

fn evaluate_assertion(world: &WorldSnapshot, assertion: &TestAssertion) -> Result<(), String> {
    if let Some(ui) = &assertion.ui {
        let actual = world.ui.as_deref().ok_or_else(|| "UI tree does not exist.".to_string())?;
        let expected = UiTree::from_json_for_viewport_with_resources(ui.equals.clone(), crate::ui::UI_REFERENCE_ASPECT, &world.ui_image_batches)
            .map_err(|error| format!("UI assertion is not a valid UI tree: {error}"))?;
        if actual != &expected {
            return Err(format!(
                "UI tree does not equal the expected value; actual={} expected={}",
                serde_json::to_string(actual).unwrap_or_else(|_| "<unserializable>".to_string()),
                serde_json::to_string(&expected).unwrap_or_else(|_| "<unserializable>".to_string())
            ));
        }
        return Ok(());
    }
    if let Some(animation) = &assertion.animation {
        let entity = world
            .entities
            .get(&animation.entity)
            .ok_or_else(|| format!("Entity '{}' does not exist.", animation.entity))?;
        let actual = serde_json::to_value(&entity.animation).map_err(|error| format!("Unable to serialize animation state: {error}"))?;
        if !json_equal(&actual, &animation.equals) {
            return Err(format!("Entity '{}' animation = {actual}, does not equal expected {}.", animation.entity, animation.equals));
        }
        return Ok(());
    }
    if let Some(effects) = &assertion.effects {
        let actual = serde_json::to_value(&world.effects).map_err(|error| format!("Unable to serialize effects: {error}"))?;
        if !json_equal(&actual, &effects.equals) {
            return Err(format!("effects = {actual}, does not equal expected {}.", effects.equals));
        }
        return Ok(());
    }
    if let Some(audio) = &assertion.audio {
        if let Some(expected) = &audio.events {
            let actual = serde_json::to_value(&world.audio_events).map_err(|error| format!("Unable to serialize audio events: {error}"))?;
            if !json_equal(&actual, expected) {
                return Err(format!("audio events = {actual}, does not equal expected {expected}."));
            }
        }
        if let Some(expected) = &audio.loops {
            let actual = serde_json::to_value(&world.audio_loops).map_err(|error| format!("Unable to serialize audio loops: {error}"))?;
            if !json_equal(&actual, expected) {
                return Err(format!("audio loops = {actual}, does not equal expected {expected}."));
            }
        }
        return Ok(());
    }
    if let Some(observation) = &assertion.observation {
        return evaluate_observation(world, observation);
    }
    evaluate_entity(world, assertion)
}

fn evaluate_entity(world: &WorldSnapshot, assertion: &TestAssertion) -> Result<(), String> {
    let entity_id = assertion
        .entity
        .as_deref()
        .ok_or_else(|| "Assertion must provide entity/field or observation.".to_string())?;
    let field = assertion.field.as_deref().ok_or_else(|| "Entity assertion must provide field.".to_string())?;
    let entity = world.entities.get(entity_id).ok_or_else(|| format!("Entity '{}' does not exist.", entity_id))?;
    let actual = match field {
        "transform.x" => entity.transform.x,
        "transform.y" => entity.transform.y,
        field => {
            return Err(format!(
                "Unsupported assertion field '{field}'; currently supported fields are transform.x and transform.y."
            ));
        }
    };
    if let Some(expected) = assertion.equals
        && (actual - expected).abs() > 0.000_001
    {
        return Err(format!("{} {} does not equal expected {}.", entity_id, field, expected));
    }
    if let Some(expected) = assertion.greater_than
        && actual <= expected
    {
        return Err(format!("{} {} = {} is not greater than {}.", entity_id, field, actual, expected));
    }
    if let Some(expected) = assertion.less_than
        && actual >= expected
    {
        return Err(format!("{} {} = {} is not less than {}.", entity_id, field, actual, expected));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    fn difference(actual: serde_json::Value, expected: serde_json::Value, subset: bool) -> Option<String> {
        super::json_difference(&actual, &expected, subset, &mut "v".to_string())
    }

    #[test]
    fn the_first_difference_names_its_path() {
        let actual = json!({"name": "guard", "stops": {"51A2A0": 31, "4EA02B": 4}, "list": [1, {"x": 2}]});
        assert_eq!(difference(actual.clone(), actual.clone(), false), None);
        assert_eq!(
            difference(actual.clone(), json!({"name": "guard", "stops": {"51A2A0": 30, "4EA02B": 4}, "list": [1, {"x": 2}]}), false).as_deref(),
            Some("v.stops.51A2A0 = 31, expected 30")
        );
        assert_eq!(difference(actual.clone(), json!({"list": [1, {"x": 2.5}]}), true).as_deref(), Some("v.list[1].x = 2, expected 2.5"));
        assert_eq!(difference(actual.clone(), json!({"list": [1]}), true).as_deref(), Some("v.list has 2 items, expected 1"));
        assert_eq!(difference(actual.clone(), json!({"first": "none"}), true).as_deref(), Some("v.first is missing, expected \"none\""));
        assert_eq!(difference(json!({"a": 1, "b": 2}), json!({"a": 1}), false).as_deref(), Some("v.b = 2, not expected"));
    }

    #[test]
    fn a_subset_compares_only_the_keys_it_gives_at_every_depth() {
        let actual = json!({"name": "guard", "same": 247, "stops": {"51A2A0": 31, "4EA02B": 4}});
        assert_eq!(difference(actual.clone(), json!({"name": "guard"}), true), None);
        assert_eq!(difference(actual.clone(), json!({"stops": {"4EA02B": 4.0}}), true), None);
        assert!(difference(actual.clone(), json!({"stops": {"4EA02B": 4.0}}), false).is_some());
        assert_eq!(difference(json!(4294967297.0), json!(4294967297u64), true), None);
    }
}
