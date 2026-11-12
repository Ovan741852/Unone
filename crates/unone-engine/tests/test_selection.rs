//! A test run takes some of a project's tests (by name or path, or one shard),
//! and a case that cannot run fails alone while the others still run.
use serde_json::json;
use unone_engine::{EngineRuntime, TestSelection};

const SOURCE: &str = r#"
return {
 start=function(_api) end,
 update=function(api)
  if api.input.isDown('Boom') then error('boom on purpose') end
  api.observation.set('ok', true)
 end,
}
"#;

fn project(tests: &[(&str, serde_json::Value)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("tests")).unwrap();
    std::fs::write(dir.path().join("main.luau"), SOURCE).unwrap();
    let files: Vec<String> = tests.iter().map(|(file, _)| format!("tests/{file}")).collect();
    std::fs::write(dir.path().join("project.unone.json"), json!({
        "name":"selection", "entry_script":"main.luau", "test_files":files, "input_actions":["Boom"]
    }).to_string()).unwrap();
    for (file, case) in tests {
        std::fs::write(dir.path().join("tests").join(file), case.to_string()).unwrap();
    }
    dir
}

fn case(name: &str) -> serde_json::Value {
    json!({"name":name, "frames":1, "assertions":[{"observation":{"key":"ok","equals":true}}]})
}

fn names(dir: &tempfile::TempDir, selection: &TestSelection) -> Vec<String> {
    let report = EngineRuntime::run_tests_with(dir.path(), selection);
    assert!(report.ok, "{:?}", report.diagnostics);
    report.value.unwrap().cases.into_iter().map(|case| case.name).collect()
}

#[test]
fn filters_keep_tests_by_name_or_path_and_shards_split_what_they_keep() {
    let dir = project(&[("walk.test.json", case("walk")), ("jump.test.json", case("jump")), ("run.test.json", case("sprint"))]);
    let all = TestSelection::default();
    assert_eq!(names(&dir, &all), ["walk", "jump", "sprint"]);
    let filter = |texts: &[&str]| TestSelection { filters: texts.iter().map(|t| t.to_string()).collect(), ..Default::default() };
    assert_eq!(names(&dir, &filter(&["jump"])), ["jump"]);
    assert_eq!(names(&dir, &filter(&["run.test"])), ["sprint"], "a path matches as well as a name");
    assert_eq!(names(&dir, &filter(&["walk", "sprint"])), ["walk", "sprint"]);
    let shard = |k, n| TestSelection { shard: Some((k, n)), ..Default::default() };
    assert_eq!(names(&dir, &shard(1, 2)), ["walk", "sprint"]);
    assert_eq!(names(&dir, &shard(2, 2)), ["jump"]);
    assert!(names(&dir, &shard(4, 4)).is_empty(), "more shards than tests leaves some empty");
    let file = TestSelection { files: vec!["tests/jump.test.json".to_string()], ..Default::default() };
    assert_eq!(names(&dir, &file), ["jump"]);
    let listed = EngineRuntime::list_tests(dir.path(), &filter(&["jump"])).value.unwrap();
    assert_eq!((listed[0].path.as_str(), listed[0].name.as_str(), listed[0].frames), ("tests/jump.test.json", "jump", 1));
    let report = EngineRuntime::run_tests_with(dir.path(), &filter(&["jump"])).value.unwrap();
    assert_eq!(report.cases[0].path, "tests/jump.test.json");
}

#[test]
fn a_selection_of_nothing_or_a_bad_shard_is_refused() {
    let dir = project(&[("walk.test.json", case("walk"))]);
    let none = TestSelection { filters: vec!["swim".to_string()], ..Default::default() };
    let report = EngineRuntime::run_tests_with(dir.path(), &none);
    assert!(!report.ok);
    assert_eq!(report.diagnostics[0].code, "TESTS_NONE_SELECTED");
    for shard in [(0, 2), (3, 2), (1, 0)] {
        let report = EngineRuntime::run_tests_with(dir.path(), &TestSelection { shard: Some(shard), ..Default::default() });
        assert_eq!(report.diagnostics[0].code, "TEST_SHARD_INVALID", "{shard:?}");
    }
}

#[test]
fn a_case_that_cannot_run_fails_alone() {
    let mut boom = case("boom");
    boom["input"] = json!({"Boom": true});
    let dir = project(&[("walk.test.json", case("walk")), ("boom.test.json", boom), ("jump.test.json", case("jump"))]);
    let result = EngineRuntime::run_tests(dir.path());
    assert!(result.ok, "the suite ran: {:?}", result.diagnostics);
    assert!(result.diagnostics.iter().any(|d| d.explanation.contains("boom on purpose")), "{:?}", result.diagnostics);
    let report = result.value.unwrap();
    assert!(!report.passed);
    let verdicts: Vec<(&str, bool)> = report.cases.iter().map(|case| (case.name.as_str(), case.passed)).collect();
    assert_eq!(verdicts, [("walk", true), ("boom", false), ("jump", true)]);
    assert!(report.cases[1].failures[0].contains("boom on purpose"), "{:?}", report.cases[1].failures);
}
