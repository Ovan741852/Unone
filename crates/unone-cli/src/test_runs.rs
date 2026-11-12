//! `game test --jobs N`: the chosen tests, each in its own worker process (this
//! same `game` running one `--file`), N at a time. The slowest by the last run's
//! times start first, tests never timed before them. One report, in the
//! project's order, as a run in one process gives. A file the project lists more
//! than once runs in one worker, which reports it once per listing.
use std::{
    collections::{BTreeMap, VecDeque},
    io::IsTerminal,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Instant,
};

use serde::Deserialize;
use unone_engine::{
    Diagnostic, EngineResult, EngineRuntime, ProjectPaths, SelectedTest, TestCaseReport, TestSelection, TestSuiteReport,
};

/// The last run's milliseconds per test path; a cache, so a bad one is ignored.
const TIMES_FILE: &str = ".unone/test-times.json";

#[derive(Deserialize)]
struct WorkerResult {
    value: Option<TestSuiteReport>,
    #[serde(default)]
    diagnostics: Vec<Diagnostic>,
}

/// What `--jobs 0` means: one worker per processor.
pub fn workers(jobs: usize) -> usize {
    if jobs > 0 { jobs } else { thread::available_parallelism().map_or(1, |count| count.get()) }
}

/// The chosen tests in `jobs` (> 1) workers at once.
pub fn run(project: &Path, sdk: Option<&Path>, selection: &TestSelection, jobs: usize) -> EngineResult<TestSuiteReport> {
    let listed = EngineRuntime::list_tests(project, selection);
    let Some(tests) = listed.value else {
        return EngineResult { ok: false, value: None, diagnostics: listed.diagnostics, effects: Vec::new() };
    };
    let name = match ProjectPaths::discover(project) {
        Ok((config, _)) => config.name,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    // Imports once here: the workers then find them done instead of racing on them.
    if let Err(diagnostic) = unone_engine::prepare_imports(project) {
        return EngineResult::failure(*diagnostic);
    }
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "TEST_WORKER_FAILED",
                "Cannot find this game executable to start test workers",
                error.to_string(),
            ));
        }
    };
    // Each file once, with where it stands in the project's list.
    let mut slots: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut files: Vec<usize> = Vec::new();
    for (index, test) in tests.iter().enumerate() {
        let at = slots.entry(test.path.clone()).or_default();
        if at.is_empty() {
            files.push(index);
        }
        at.push(index);
    }
    let times = read_times(project);
    files.sort_by_key(|&index| std::cmp::Reverse(times.get(&tests[index].path).copied().unwrap_or(u64::MAX)));
    let jobs = jobs.min(files.len());
    let queue = Arc::new(Mutex::new(files.into_iter().collect::<VecDeque<usize>>()));
    let tests = Arc::new(tests);
    let slots = Arc::new(slots);
    let (send, receive) = mpsc::channel();
    for _ in 0..jobs {
        let (queue, tests, slots, send) = (queue.clone(), tests.clone(), slots.clone(), send.clone());
        let (exe, project, sdk) = (exe.clone(), project.to_path_buf(), sdk.map(Path::to_path_buf));
        thread::spawn(move || {
            loop {
                let next = queue.lock().ok().and_then(|mut queue| queue.pop_front());
                let Some(index) = next else { break };
                let test = &tests[index];
                let listed = slots.get(&test.path).map_or(1, Vec::len);
                let result = run_worker(&exe, &project, sdk.as_deref(), test, listed);
                if send.send((test.path.clone(), result)).is_err() {
                    break;
                }
            }
        });
    }
    drop(send);
    let progress = std::io::stderr().is_terminal();
    let mut cases: Vec<Option<TestCaseReport>> = vec![None; tests.len()];
    let mut warnings = Vec::new();
    let mut done = 0;
    for (path, (reports, diagnostics)) in receive {
        for (index, case) in slots[&path].iter().zip(reports) {
            done += 1;
            if progress {
                let verdict = if case.passed { "passed" } else { "FAILED" };
                eprintln!("[{done}/{}] {verdict} {} ({:.1} s)", tests.len(), case.name, case.elapsed_ms as f64 / 1000.0);
            }
            cases[*index] = Some(case);
        }
        warnings.extend(diagnostics);
    }
    let cases: Vec<TestCaseReport> = cases
        .into_iter()
        .zip(tests.iter())
        .map(|(case, test)| case.unwrap_or_else(|| failed(test, 0, "TEST_WORKER_FAILED: its worker thread stopped before reporting".to_string())))
        .collect();
    write_times(project, &cases);
    let passed = cases.iter().all(|case| case.passed);
    let mut result = EngineResult::success(TestSuiteReport { project: name, passed, cases });
    result.diagnostics = unone_engine::test_suite_diagnostics(warnings);
    result
}

/// One test file in its own process, listed `listed` times; whatever it ends in
/// becomes its cases.
fn run_worker(exe: &Path, project: &Path, sdk: Option<&Path>, test: &SelectedTest, listed: usize) -> (Vec<TestCaseReport>, Vec<Diagnostic>) {
    let started = Instant::now();
    let mut command = Command::new(exe);
    command.arg("--project").arg(project).arg("--json");
    if let Some(sdk) = sdk {
        command.arg("--sdk").arg(sdk);
    }
    command.args(["test", "--file", &test.path]);
    let output = command.output();
    let elapsed = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let every = |why: String| vec![failed(test, elapsed, why); listed];
    let output = match output {
        Ok(output) => output,
        Err(error) => return (every(format!("TEST_WORKER_FAILED: cannot start {}: {error}", exe.display())), Vec::new()),
    };
    match serde_json::from_slice::<WorkerResult>(&output.stdout) {
        Ok(WorkerResult { value: Some(suite), diagnostics }) if suite.cases.len() == listed => (suite.cases, diagnostics),
        Ok(WorkerResult { value: Some(suite), .. }) => {
            (every(format!("TEST_WORKER_FAILED: the worker reported {} cases of {}, listed {listed} times", suite.cases.len(), test.path)), Vec::new())
        }
        Ok(WorkerResult { value: None, diagnostics }) if !diagnostics.is_empty() => {
            let why = diagnostics.iter().map(|d| format!("{}: {}", d.code, d.explanation)).collect::<Vec<_>>().join("; ");
            (every(why), diagnostics)
        }
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail: String = stderr.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
            let why = format!("TEST_WORKER_FAILED: the worker ended with {} and printed no report. {}", output.status, tail.trim());
            (every(why), Vec::new())
        }
    }
}

fn failed(test: &SelectedTest, elapsed_ms: u64, why: String) -> TestCaseReport {
    TestCaseReport {
        name: test.name.clone(),
        path: test.path.clone(),
        passed: false,
        frames: 0,
        observation_digest: None,
        save_payload: None,
        failures: vec![why],
        elapsed_ms,
    }
}

fn times_path(project: &Path) -> PathBuf {
    ProjectPaths::discover(project).map_or_else(|_| project.to_path_buf(), |(_, paths)| paths.root).join(TIMES_FILE)
}

fn read_times(project: &Path) -> BTreeMap<String, u64> {
    std::fs::read(times_path(project))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| serde_json::from_value(value["elapsed_ms"].clone()).ok())
        .unwrap_or_default()
}

/// This run's times over the last ones (tests not run keep theirs).
pub fn write_times(project: &Path, cases: &[TestCaseReport]) {
    let mut times = read_times(project);
    for case in cases {
        times.insert(case.path.clone(), case.elapsed_ms);
    }
    let path = times_path(project);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let value = serde_json::json!({"version": 1, "elapsed_ms": times});
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap_or_default());
}
