//! Mistakes AI authors make that used to pass silently, or to fail without
//! saying what was wrong.
use serde_json::{Value, json};
use std::{fs, path::Path};
use tempfile::tempdir;
use unone_engine::{Diagnostic, EngineRuntime, StepStatus, verify};

const OK_TEST: &str = r#"{"name":"runs","frames":1,"assertions":[{"observation":{"key":"ok","equals":true}}]}"#;

fn write_project(root: &Path, config: Value, script: &str, test: &str) {
    fs::create_dir_all(root.join("scripts")).unwrap();
    fs::create_dir_all(root.join("tests")).unwrap();
    let mut project = json!({"name": "guards", "entry_script": "scripts/main.luau", "test_files": ["tests/case.test.json"]});
    project.as_object_mut().unwrap().extend(config.as_object().unwrap().clone());
    fs::write(root.join("project.unone.json"), project.to_string()).unwrap();
    fs::write(root.join("scripts/main.luau"), script).unwrap();
    fs::write(root.join("tests/case.test.json"), test).unwrap();
}

/// A game whose update runs `update` and then publishes the observation OK_TEST asserts.
fn game(update: &str) -> String {
    format!("return {{start=function(api) end, update=function(api)\n{update}\napi.observation.set('ok',true)\nend}}")
}

fn unknown_action(diagnostics: &[Diagnostic]) -> Option<&Diagnostic> {
    diagnostics.iter().find(|diagnostic| diagnostic.code == "INPUT_ACTION_UNKNOWN")
}

fn names(diagnostic: &Diagnostic) -> Vec<&str> {
    diagnostic.facts["names"].as_array().unwrap().iter().map(|name| name["name"].as_str().unwrap()).collect()
}

#[test]
fn a_test_with_no_assertions_is_refused_because_it_would_always_pass() {
    let dir = tempdir().unwrap();
    for test in [r#"{"name":"empty","frames":1,"assertions":[]}"#, r#"{"name":"absent","frames":1}"#] {
        write_project(dir.path(), json!({}), &game(""), test);
        let result = EngineRuntime::run_tests(dir.path());
        assert!(!result.ok, "{test}");
        assert_eq!(result.diagnostics[0].code, "TEST_NO_ASSERTIONS", "{test}");
        assert!(result.diagnostics[0].explanation.contains("case.test.json"));
        let report = verify(dir.path()).value.unwrap();
        let tests = report.steps.iter().find(|step| step.name == "tests").unwrap();
        assert_eq!(tests.status, StepStatus::Failed, "{test}");
    }
}

#[test]
fn a_guessed_api_method_is_named_with_the_closest_real_ones() {
    let dir = tempdir().unwrap();
    write_project(dir.path(), json!({}), &game("if api.input.isActionJustPressed('Right') then end"), OK_TEST);
    let mut runtime = EngineRuntime::load_with_seed(dir.path(), 1).unwrap();
    let error = runtime.tick().unwrap_err();
    assert_eq!(error.code, "LUAU_RUNTIME_ERROR");
    assert_eq!(error.summary, "api.input.isActionJustPressed does not exist");
    assert!(error.explanation.contains("api.input.wasPressed"), "{}", error.explanation);
    assert_eq!(error.suggested_actions[0].command.as_deref(), Some(r#"game api search "is action just pressed""#));
}

#[test]
fn unknown_members_are_named_at_every_level_and_real_reads_are_unchanged() {
    let dir = tempdir().unwrap();
    let script = r#"
local function message(read)
    local ok, why = pcall(read)
    return if ok then 'no error' else tostring(why)
end
return {start=function(api)
    api.observation.set('namespace', message(function() return api.physcis end))
    api.observation.set('member', message(function() return api.input.isDwon end))
    api.observation.set('disabled_unknown', message(function() return api.audio.ply end))
    api.observation.set('disabled_real', message(function() return api.audio.play('x') end))
    api.observation.set('debug', message(function() return api.debug.enabled end))
    api.observation.set('index', api.input[1] == nil)
    api.observation.set('real', type(api.input.isDown) == 'function' and type(api.ui.setRoot) == 'function')
    local members = 0
    for _ in api.input do members += 1 end
    api.observation.set('iterates', members > 0)
end, update=function(api) end}"#;
    write_project(dir.path(), json!({"systems": {"audio": false}}), script, OK_TEST);
    let runtime = EngineRuntime::load_with_seed(dir.path(), 1).unwrap();
    let observed = runtime.semantic_observations();
    let text = |key: &str| observed[key].as_str().unwrap().to_string();
    assert!(text("namespace").contains("api.physcis does not exist. Closest: api.physics"), "{}", text("namespace"));
    assert!(text("member").contains("api.input.isDwon does not exist. Closest: api.input.isDown"), "{}", text("member"));
    assert!(text("disabled_unknown").contains("api.audio.ply does not exist"), "{}", text("disabled_unknown"));
    assert!(text("disabled_real").contains("SYSTEM_DISABLED"), "{}", text("disabled_real"));
    assert_eq!(text("debug"), "no error", "api.debug keeps its own guard");
    assert_eq!((&observed["index"], &observed["real"], &observed["iterates"]), (&json!(true), &json!(true), &json!(true)));
}

#[test]
fn a_misspelled_action_warns_until_the_project_declares_its_actions_then_fails() {
    let dir = tempdir().unwrap();
    let script = game("if api.input.isDown('Rigth') then end");

    write_project(dir.path(), json!({}), &script, OK_TEST);
    let check = EngineRuntime::check(dir.path());
    assert!(check.ok);
    assert!(unknown_action(&check.diagnostics).unwrap().explanation.contains("did you mean 'Right'"));
    let mut runtime = EngineRuntime::load_with_seed(dir.path(), 1).unwrap();
    let run = runtime.run(1, 1);
    assert!(run.ok);
    assert!(unknown_action(&run.diagnostics).is_some());
    let tests = EngineRuntime::run_tests(dir.path());
    assert!(tests.value.as_ref().unwrap().passed);
    assert_eq!(tests.diagnostics.iter().filter(|d| d.code == "INPUT_ACTION_UNKNOWN").count(), 1);

    write_project(dir.path(), json!({"input_actions": []}), &script, OK_TEST);
    let check = EngineRuntime::check(dir.path());
    assert!(!check.ok);
    let diagnostic = unknown_action(&check.diagnostics).unwrap();
    assert_eq!(diagnostic.source.as_ref().unwrap().line, Some(2));
    let mut runtime = EngineRuntime::load_with_seed(dir.path(), 1).unwrap();
    let run = runtime.run(1, 1);
    assert!(!run.ok, "the run completed, but it read a name nothing can press");
    assert!(run.value.is_some());
    let report = EngineRuntime::run_tests(dir.path()).value.unwrap();
    assert!(!report.passed);
    assert!(report.cases[0].failures[0].starts_with("INPUT_ACTION_UNKNOWN"), "{:?}", report.cases[0].failures);

    write_project(dir.path(), json!({"input_actions": ["Rigth"]}), &script, OK_TEST);
    assert!(unknown_action(&EngineRuntime::check(dir.path()).diagnostics).is_none());
    assert!(EngineRuntime::run_tests(dir.path()).value.unwrap().passed);
}

#[test]
fn check_sees_branches_a_run_never_reaches_and_a_run_sees_names_built_at_runtime() {
    let dir = tempdir().unwrap();
    let strict = json!({"input_actions": []});

    write_project(dir.path(), strict.clone(), &game("if false then api.input.wasPressed('Rigth') end"), OK_TEST);
    assert!(!EngineRuntime::check(dir.path()).ok, "check reads the source");
    assert!(EngineRuntime::load_with_seed(dir.path(), 1).unwrap().run(1, 1).ok, "the run never asked");

    write_project(dir.path(), strict, &game("local name = 'Rig' .. 'th'; api.input.wasReleased(name)"), OK_TEST);
    assert!(EngineRuntime::check(dir.path()).ok, "no whole literal to read");
    let run = EngineRuntime::load_with_seed(dir.path(), 1).unwrap().run(1, 1);
    assert_eq!(names(unknown_action(&run.diagnostics).unwrap()), ["Rigth"]);
}

#[test]
fn a_test_feeding_a_name_nothing_produces_fails_even_when_the_script_reads_it_too() {
    let dir = tempdir().unwrap();
    for test in [
        r#"{"name":"held","frames":1,"input":{"Jmup":true},"assertions":[{"observation":{"key":"ok","equals":true}}]}"#,
        r#"{"name":"frames","frames":1,"input_sequence":[{"actions":{"Jmup":true}}],"assertions":[{"observation":{"key":"ok","equals":true}}]}"#,
    ] {
        write_project(dir.path(), json!({"input_actions": ["Jump"]}), &game("if api.input.isDown('Jump') then end"), test);
        let report = EngineRuntime::run_tests(dir.path()).value.unwrap();
        assert!(!report.passed, "{test}");
        assert!(report.cases[0].failures[0].contains("did you mean 'Jump'"), "{:?}", report.cases[0].failures);
    }
}

#[test]
fn keys_ui_actions_and_declared_families_are_all_real_names() {
    let dir = tempdir().unwrap();
    let script = r#"
return {start=function(api)
    local action = 'Bu' .. 'y'
    api.ui.setRoot({kind='screen',id='s',node='s',children={
        {kind='button',id='built',text='t',action=action,rect={x=0,y=0,width=10,height=10}},
        {kind='component',id='c',component='row',rect={x=0,y=20,width=10,height=10},children={
            {kind='button',id='nested',text='t',action='Nested',rect={x=0,y=20,width=10,height=10}}}}}})
end, update=function(api)
    local read = api.input.wasPressed
    for _, name in {'Buy', 'Nested', 'Later', 'Debug_1', 'Right', 'Space', 'W', '7', 'KeyW', 'MouseRight'} do read(name) end
    if api.input.isDown('Nested') or api.input.isDown('Later') then end
    api.observation.set('ok', true)
end, screenNeverReached = {action = 'Later'}}"#;
    write_project(dir.path(), json!({"input_actions": ["Debug_*"]}), script, OK_TEST);
    let run = EngineRuntime::load_with_seed(dir.path(), 1).unwrap().run(1, 1);
    assert!(unknown_action(&run.diagnostics).is_none(), "{:?}", run.diagnostics);
    assert!(run.ok);
}

#[test]
fn an_input_actions_entry_must_be_a_name_or_a_prefix_family() {
    let dir = tempdir().unwrap();
    write_project(dir.path(), json!({"input_actions": ["*"]}), &game(""), OK_TEST);
    let check = EngineRuntime::check(dir.path());
    assert!(!check.ok);
    assert_eq!(check.diagnostics[0].code, "INPUT_ACTIONS_INVALID");
}
