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

#[test]
fn includes_checks_only_the_keys_it_gives_and_names_the_first_difference() {
    let failures = run(json!([
        {"observation":{"key":"mixed","includes":{"count":3}}},
        {"observation":{"key":"mixed","includes":{"list":[1, 2.0], "name":"x"}}}
    ]));
    assert!(failures.is_empty(), "{failures:?}");
    let failures = run(json!([
        {"observation":{"key":"mixed","includes":{"count":4}}},
        {"observation":{"key":"mixed","includes":{"absent":1}}},
        {"observation":{"key":"mixed","equals":{"count":3, "ratio":0.5, "list":[1, 3], "name":"x"}}}
    ]));
    assert_eq!(failures.len(), 3, "{failures:?}");
    assert!(failures[0].contains("First difference: mixed.count = 3, expected 4."), "{}", failures[0]);
    assert!(failures[1].contains("mixed.absent is missing"), "{}", failures[1]);
    assert!(failures[2].contains("First difference: mixed.list[1] = 2, expected 3."), "{}", failures[2]);
}

#[test]
fn an_observation_assertion_gives_equals_or_includes_but_not_both() {
    for assertion in [json!({"observation":{"key":"level"}}), json!({"observation":{"key":"level","equals":2001,"includes":2001}})] {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.luau"), SOURCE).unwrap();
        std::fs::write(dir.path().join("project.unone.json"), json!({
            "name":"assertions", "entry_script":"main.luau", "test_files":["a.test.json"]
        }).to_string()).unwrap();
        std::fs::write(dir.path().join("a.test.json"), json!({"name":"a", "frames":1, "assertions":[assertion]}).to_string()).unwrap();
        let report = EngineRuntime::run_tests(dir.path());
        assert!(!report.ok);
        assert_eq!(report.diagnostics[0].code, "TEST_ASSERTION_INVALID", "{:?}", report.diagnostics);
    }
}
