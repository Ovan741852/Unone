//! `game test --jobs N` runs the chosen tests in worker processes and reports
//! them as one run in one process would.
use serde_json::{Value, json};
use std::{
    path::Path,
    process::{Command, Stdio},
};

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

/// `game test` on `dir`, sharing memory only with runs given the same `ledger`.
fn command(dir: &Path, ledger: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_game"));
    command.arg("--project").arg(dir).arg("--json").arg("test").args(args).env("UNONE_TEST_MEMORY_DIR", ledger);
    command
}

fn report(output: std::process::Output) -> (Option<i32>, Value) {
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("{error}: {}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)));
    (output.status.code(), report)
}

fn game(dir: &Path, args: &[&str]) -> (Option<i32>, Value) {
    report(command(dir, &dir.join(".memory"), args).output().unwrap())
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

fn memory_note(report: &Value) -> Option<&Value> {
    report["diagnostics"].as_array().unwrap().iter().find(|d| d["code"] == json!("TEST_JOBS_MEMORY"))
}

#[test]
fn memory_holds_workers_back_across_runs_and_each_worker_leaves_its_peak() {
    let (one, two) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    project(one.path());
    project(two.path());
    let ledger = tempfile::tempdir().unwrap();
    let expected: Vec<(String, bool)> =
        [("walk", true), ("wrong", false), ("boom", false), ("walk", true), ("jump", true)].iter().map(|(n, p)| (n.to_string(), *p)).collect();
    // A reserve larger than any machine: a test starts only when the machine runs none.
    let start = |dir: &Path| command(dir, ledger.path(), &["--jobs", "3"]).env("UNONE_TEST_MEMORY_RESERVE", "1048576G").stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let runs = [start(one.path()), start(two.path())];
    let mut notes = Vec::new();
    for run in runs {
        let output = run.wait_with_output().unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let (code, report) = report(output);
        assert_eq!(code, Some(1));
        assert_eq!(verdicts(&report), expected, "the memory changes when tests run, not what they find: {report:#}");
        let note = memory_note(&report).unwrap_or_else(|| panic!("the run says the memory held it back: {report:#}")).clone();
        assert_eq!((note["severity"].as_str(), note["facts"]["jobs"].as_u64(), note["facts"]["most_at_once"].as_u64()), (Some("INFO"), Some(3), Some(1)), "{note:#}");
        assert!(stderr.contains("game test: waiting for memory to start"), "a waiting run says so: {stderr}");
        notes.push(note);
    }
    assert!(
        notes.iter().any(|note| !note["facts"]["other_runs"].as_array().unwrap().is_empty()),
        "one of two runs started together waited for the other: {notes:#?}"
    );
    // Both runs left the ledger as they found it.
    let book: Value = serde_json::from_slice(&std::fs::read(ledger.path().join("ledger.json")).unwrap()).unwrap();
    assert_eq!(book["entries"], json!([]), "{book:#}");
    let alive = std::fs::read_dir(ledger.path()).unwrap().flatten().filter(|item| item.file_name().to_string_lossy().ends_with(".alive")).count();
    assert_eq!(alive, 0);
    // Each worker's peak working set is what that test is taken to need next time.
    let times: Value = serde_json::from_slice(&std::fs::read(one.path().join(".unone/test-times.json")).unwrap()).unwrap();
    let peaks = times["peak_bytes"].as_object().unwrap();
    assert_eq!(peaks.len(), 4, "{times:#}");
    assert!(peaks.values().all(|peak| peak.as_u64().unwrap() > 1 << 20), "{times:#}");
    // A run in one process that never waited says nothing about memory.
    let (_, here) = game(one.path(), &["--filter", "jump"]);
    assert!(memory_note(&here).is_none(), "{here:#}");
}
