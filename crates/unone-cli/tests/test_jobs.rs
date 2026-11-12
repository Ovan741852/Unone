//! `game test --jobs N` runs the chosen tests in worker processes and reports
//! them as one run in one process would.
use serde_json::{Value, json};
use std::{path::Path, process::Command};

const SOURCE: &str = r#"
return {
 start=function(_api) end,
 update=function(api)
  if api.input.isDown('Boom') then error('boom on purpose') end
  api.observation.set('ok', true)
 end,
}
"#;

fn project(dir: &Path) {
    std::fs::create_dir_all(dir.join("tests")).unwrap();
    std::fs::write(dir.join("main.luau"), SOURCE).unwrap();
    let case = |name: &str, ok: bool| json!({"name": name, "frames": 1, "assertions": [{"observation": {"key": "ok", "equals": ok}}]});
    let mut boom = case("boom", true);
    boom["input"] = json!({"Boom": true});
    for (file, case) in [("walk", case("walk", true)), ("wrong", case("wrong", false)), ("boom", boom), ("jump", case("jump", true))] {
        std::fs::write(dir.join(format!("tests/{file}.test.json")), case.to_string()).unwrap();
    }
    // walk is listed twice: it runs once and is reported for each listing.
    let files = ["tests/walk.test.json", "tests/wrong.test.json", "tests/boom.test.json", "tests/walk.test.json", "tests/jump.test.json"];
    std::fs::write(dir.join("project.unone.json"), json!({
        "name": "jobs", "entry_script": "main.luau", "test_files": files, "input_actions": ["Boom"]
    }).to_string()).unwrap();
}

fn game(dir: &Path, args: &[&str]) -> (Option<i32>, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_game")).arg("--project").arg(dir).arg("--json").arg("test").args(args).output().unwrap();
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)));
    (output.status.code(), report)
}

fn verdicts(report: &Value) -> Vec<(String, bool)> {
    report["value"]["cases"].as_array().unwrap().iter().map(|case| (case["name"].as_str().unwrap().to_string(), case["passed"].as_bool().unwrap())).collect()
}

#[test]
fn workers_report_every_case_in_the_projects_order() {
    let dir = tempfile::tempdir().unwrap();
    project(dir.path());
    let (one_code, one) = game(dir.path(), &[]);
    let (code, jobs) = game(dir.path(), &["--jobs", "3"]);
    assert_eq!((one_code, code), (Some(1), Some(1)), "a failed case fails the command");
    let expected: Vec<(String, bool)> =
        [("walk", true), ("wrong", false), ("boom", false), ("walk", true), ("jump", true)].iter().map(|(n, p)| (n.to_string(), *p)).collect();
    assert_eq!(verdicts(&one), expected);
    assert_eq!(verdicts(&jobs), expected, "{jobs:#}");
    assert_eq!(jobs["ok"], json!(true));
    let cases = jobs["value"]["cases"].as_array().unwrap();
    assert!(cases[1]["failures"][0].as_str().unwrap().contains("First difference: ok = true, expected false."), "{:#}", cases[1]);
    assert!(cases[2]["failures"][0].as_str().unwrap().contains("boom on purpose"), "{:#}", cases[2]);
    assert!(jobs["diagnostics"].as_array().unwrap().iter().any(|d| d["explanation"].as_str().unwrap().contains("boom on purpose")));
    assert_eq!(cases[4]["path"], json!("tests/jump.test.json"));
    // The run leaves each file's time for the next one to start the slowest first.
    let times: Value = serde_json::from_slice(&std::fs::read(dir.path().join(".unone/test-times.json")).unwrap()).unwrap();
    assert_eq!(times["elapsed_ms"].as_object().unwrap().len(), 4);
}

#[test]
fn filters_shards_and_lists_choose_the_same_tests_with_or_without_workers() {
    let dir = tempfile::tempdir().unwrap();
    project(dir.path());
    let (code, report) = game(dir.path(), &["--filter", "walk", "--filter", "jump", "--jobs", "2"]);
    assert_eq!(code, Some(0));
    assert_eq!(verdicts(&report).len(), 3);
    let (_, shard) = game(dir.path(), &["--shard", "2/2", "--list"]);
    let paths: Vec<&str> = shard["value"].as_array().unwrap().iter().map(|test| test["path"].as_str().unwrap()).collect();
    assert_eq!(paths, ["tests/wrong.test.json", "tests/walk.test.json"]);
    let (code, none) = game(dir.path(), &["--filter", "swim", "--jobs", "2"]);
    assert_eq!(code, Some(1));
    assert_eq!(none["diagnostics"][0]["code"], json!("TESTS_NONE_SELECTED"));
}
