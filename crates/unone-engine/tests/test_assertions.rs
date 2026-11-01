//! Deterministic test assertions compare JSON values the way JSON means them.
use serde_json::json;
use unone_engine::EngineRuntime;

const SOURCE: &str = r#"
return {
 start=function(_api) end,
 update=function(api)
  api.observation.set('level', 2001)
  api.observation.set('mixed', {count=3, ratio=0.5, list={1, 2}, name='x'})
 end,
}
"#;

fn run(assertions: serde_json::Value) -> Vec<String> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("main.luau"), SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"), json!({
        "name":"assertions", "entry_script":"main.luau", "test_files":["a.test.json"]
    }).to_string()).unwrap();
    std::fs::write(dir.path().join("a.test.json"), json!({"name":"a", "frames":1, "assertions":assertions}).to_string()).unwrap();
    let report = EngineRuntime::run_tests(dir.path());
    assert!(report.ok, "{:?}", report.diagnostics);
    report.value.unwrap().cases.remove(0).failures
}

#[test]
fn integer_literals_equal_luau_numbers_of_the_same_value() {
    let failures = run(json!([
        {"observation":{"key":"level","equals":2001}},
        {"observation":{"key":"mixed","equals":{"count":3, "ratio":0.5, "list":[1, 2.0], "name":"x"}}}
    ]));
    assert!(failures.is_empty(), "{failures:?}");
}

#[test]
fn different_numbers_still_fail() {
    let failures = run(json!([
        {"observation":{"key":"level","equals":2002}},
        {"observation":{"key":"mixed","equals":{"count":3, "ratio":0.25, "list":[1, 2], "name":"x"}}},
        {"observation":{"key":"level","equals":"2001"}}
    ]));
    assert_eq!(failures.len(), 3, "{failures:?}");
}
