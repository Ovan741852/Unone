//! `game test --jobs N`: the chosen tests, each in its own worker process (this
//! same `game` running one `--file`), at most N at a time. The slowest by the
//! last run's times start first, tests never timed before them. One report, in
//! the project's order, as a run in one process gives. A file the project lists
//! more than once runs in one worker, which reports it once per listing.
//!
//! N is an upper bound: a worker starts only when the machine has the memory
//! for it, shared with every other `game test` on the machine (`test_memory`).
//! Each worker's peak working set is kept with the times and is what that test
//! is taken to need next time. A run in one process (`--jobs 1`) waits the same
//! way for the memory its largest test needs.
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    io::{self, IsTerminal, Read},
    panic::{self, AssertUnwindSafe},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use unone_engine::{
    Diagnostic, DiagnosticSeverity, EngineResult, EngineRuntime, ProjectPaths, SelectedTest, TestCaseReport, TestSelection,
    TestSuiteReport,
};

use crate::test_memory::{self, Ledger, Probe, Wait, gb};

/// The last run's milliseconds and peak working-set bytes per test path; a
/// cache, so a bad one is ignored.
const TIMES_FILE: &str = ".unone/test-times.json";
/// How often a run waiting for memory looks again.
const POLL: Duration = Duration::from_millis(500);
/// How often a waiting run says so again.
const SAY_EVERY: Duration = Duration::from_secs(30);

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

/// A worker's cases, its diagnostics and its peak working set.
type Outcome = (Vec<TestCaseReport>, Vec<Diagnostic>, Option<u64>);

/// The chosen tests in up to `jobs` (> 1) workers at once.
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
    let mut peaks = read_peaks(project);
    let mut measured = BTreeMap::new();
    let mut ledger = Ledger::open(&label(project), Probe::os());
    let mut gate = Gate { jobs, ..Gate::default() };
    let mut queue: VecDeque<usize> = files.into_iter().collect();
    let (send, receive) = mpsc::channel::<(u64, String, Outcome)>();
    let progress = std::io::stderr().is_terminal();
    let mut cases: Vec<Option<TestCaseReport>> = vec![None; tests.len()];
    let mut warnings = Vec::new();
    let (mut done, mut running) = (0, 0);
    loop {
        while running < jobs
            && let Some(&index) = queue.front()
        {
            let test = tests[index].clone();
            let need = test_memory::need(peaks.get(&test.path).copied(), peaks.values().copied().max());
            let mut command = worker_command(&exe, project, sdk, &test, selection.rollback);
            let start = || {
                let started = Instant::now();
                let spawned = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
                (spawned.as_ref().map_or(0, Child::id), (started, spawned))
            };
            match ledger.try_start(need, &test.path, start) {
                Ok((id, (started, spawned))) => {
                    queue.pop_front();
                    running += 1;
                    gate.started(running, need);
                    let listed = slots[&test.path].len();
                    let (send, exe) = (send.clone(), exe.clone());
                    thread::spawn(move || {
                        let outcome = panic::catch_unwind(AssertUnwindSafe(|| finish_worker(spawned, started, &exe, &test, listed)))
                            .unwrap_or_else(|_| (vec![failed(&test, 0, "TEST_WORKER_FAILED: its worker thread stopped before reporting".to_string()); listed], Vec::new(), None));
                        let _ = send.send((id, test.path.clone(), outcome));
                    });
                }
                Err(wait) => {
                    gate.waiting(&test.path, wait);
                    break;
                }
            }
        }
        let waiting = running < jobs && !queue.is_empty();
        if !waiting {
            ledger.stop_waiting();
            gate.going();
        }
        if running == 0 && queue.is_empty() {
            break;
        }
        // This thread keeps a sender and every worker thread sends once, so this
        // only wakes for a finished test, or to look at the memory again.
        let message = if waiting { receive.recv_timeout(POLL).ok() } else { receive.recv().ok() };
        let Some((id, path, (reports, diagnostics, peak))) = message else { continue };
        ledger.finish(id);
        running -= 1;
        if let Some(peak) = peak {
            peaks.insert(path.clone(), peak);
            measured.insert(path.clone(), peak);
        }
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
    // Rolled-back runs take longer, and hold more, than the numbers --jobs goes by.
    if selection.rollback.is_none() {
        write_times(project, &cases, &measured);
    }
    let passed = cases.iter().all(|case| case.passed);
    let mut result = EngineResult::success(TestSuiteReport { project: name, passed, cases });
    result.diagnostics = unone_engine::test_suite_diagnostics(warnings);
    result.diagnostics.extend(gate.diagnostics(&ledger));
    result
}

/// The chosen tests in this process (`--jobs 1`), once the machine has the
/// memory the largest of them needs.
pub fn run_here(project: &Path, selection: &TestSelection) -> EngineResult<TestSuiteReport> {
    let tests = EngineRuntime::list_tests(project, selection).value.unwrap_or_default();
    let mut held = None;
    if !tests.is_empty() {
        let peaks = read_peaks(project);
        let largest = peaks.values().copied().max();
        let need = tests.iter().map(|test| test_memory::need(peaks.get(&test.path).copied(), largest)).max().unwrap_or_default();
        let what = match tests.as_slice() {
            [test] => test.path.clone(),
            _ => format!("{} tests", tests.len()),
        };
        let mut ledger = Ledger::open(&label(project), Probe::os());
        let mut gate = Gate { jobs: 1, ..Gate::default() };
        let id = loop {
            match ledger.try_start(need, &what, || (std::process::id(), ())) {
                Ok((id, ())) => break id,
                Err(wait) => {
                    gate.waiting(&what, wait);
                    thread::sleep(POLL);
                }
            }
        };
        gate.going();
        gate.started(1, need);
        held = Some((ledger, gate, id));
    }
    let mut result = EngineRuntime::run_tests_with(project, selection);
    if let Some(report) = result.value.as_ref().filter(|_| selection.rollback.is_none()) {
        write_times(project, &report.cases, &BTreeMap::new());
    }
    if let Some((mut ledger, gate, id)) = held {
        ledger.finish(id);
        result.diagnostics.extend(gate.diagnostics(&ledger));
    }
    result
}

/// The project as other runs on the machine see it while this one waits or runs.
fn label(project: &Path) -> String {
    std::path::absolute(project).unwrap_or_else(|_| project.to_path_buf()).display().to_string()
}

/// How the memory held a run back, for its report.
#[derive(Default)]
struct Gate {
    jobs: usize,
    /// The most tests that ran at once.
    most: usize,
    waits: usize,
    waited: Duration,
    since: Option<Instant>,
    said: Option<Instant>,
    largest_need: u64,
    last: Option<Wait>,
    others: BTreeSet<String>,
}

impl Gate {
    fn waiting(&mut self, test: &str, wait: Wait) {
        let now = Instant::now();
        if self.since.is_none() {
            self.since = Some(now);
            self.waits += 1;
        }
        if self.said.is_none_or(|said| now - said >= SAY_EVERY) {
            eprintln!("game test: waiting for memory to start {test}: {}", wait.sentence());
            self.said = Some(now);
        }
        self.others.extend(wait.others.iter().cloned());
        self.last = Some(wait);
    }

    fn going(&mut self) {
        if let Some(since) = self.since.take() {
            self.waited += since.elapsed();
        }
    }

    fn started(&mut self, running: usize, need: u64) {
        self.most = self.most.max(running);
        self.largest_need = self.largest_need.max(need);
    }

    /// `TEST_JOBS_MEMORY` when the memory held a test back, and
    /// `TEST_MEMORY_NOT_SHARED` when other runs could not be counted.
    fn diagnostics(&self, ledger: &Ledger) -> Vec<Diagnostic> {
        let mut diagnostics = Vec::new();
        if let Some(problem) = &ledger.problem {
            diagnostics.push(Diagnostic::warning(
                "TEST_MEMORY_NOT_SHARED",
                "This run could not share the memory with other game test runs",
                format!(
                    "{problem}. It counted only its own tests against the free memory; set {} to a directory every game test on this machine can write.",
                    test_memory::DIR_VARIABLE
                ),
            ));
        }
        let Some(last) = self.last.as_ref() else { return diagnostics };
        let summary = if self.most < self.jobs {
            format!("Memory held --jobs {} to at most {} test(s) at once", self.jobs, self.most)
        } else {
            format!("Waited {:.0} s for memory before starting tests", self.waited.as_secs_f64())
        };
        let counted = ledger.dir().map_or_else(
            || "this run's tests only".to_string(),
            |dir| format!("the tests of every game test on this machine (ledger in {})", dir.display()),
        );
        let others = if self.others.is_empty() { "none".to_string() } else { self.others.iter().cloned().collect::<Vec<_>>().join(", ") };
        let mut diagnostic = Diagnostic::warning(
            "TEST_JOBS_MEMORY",
            summary,
            format!(
                "A test started only while {} of {} stayed free after it and what the running tests may still grow (set {} to change what stays free; the default is a quarter of the memory, at least 8 GB). Counted: {counted}. The largest test was taken to need {} (its last peak and an eighth more, or {} before any test of the project was measured). Waited {:.0} s in {} wait(s). Other runs seen: {others}.",
                gb(last.reserve),
                gb(last.memory.total),
                test_memory::RESERVE_VARIABLE,
                gb(self.largest_need),
                gb(test_memory::DEFAULT_NEED),
                self.waited.as_secs_f64(),
                self.waits,
            ),
        );
        diagnostic.severity = DiagnosticSeverity::Info;
        diagnostic.facts = serde_json::json!({
            "jobs": self.jobs,
            "most_at_once": self.most,
            "waits": self.waits,
            "waited_ms": u64::try_from(self.waited.as_millis()).unwrap_or(u64::MAX),
            "largest_need_bytes": self.largest_need,
            "reserve_bytes": last.reserve,
            "total_bytes": last.memory.total,
            "other_runs": self.others,
            "ledger_dir": ledger.dir().map(|dir| dir.display().to_string()),
            "last_wait": last,
        });
        diagnostics.push(diagnostic);
        diagnostics
    }
}

/// The worker that runs one test file.
fn worker_command(exe: &Path, project: &Path, sdk: Option<&Path>, test: &SelectedTest, rollback: Option<u32>) -> Command {
    let mut command = Command::new(exe);
    command.arg("--project").arg(project).arg("--json");
    if let Some(sdk) = sdk {
        command.arg("--sdk").arg(sdk);
    }
    command.args(["test", "--file", &test.path]);
    if let Some(rollback) = rollback {
        command.args(["--rollback", &rollback.to_string()]);
    }
    command
}

/// One test file's worker, listed `listed` times, to its end: whatever it ends
/// in becomes its cases.
fn finish_worker(spawned: io::Result<Child>, started: Instant, exe: &Path, test: &SelectedTest, listed: usize) -> Outcome {
    let elapsed = || u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let every = |elapsed: u64, why: String| vec![failed(test, elapsed, why); listed];
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => return (every(elapsed(), format!("TEST_WORKER_FAILED: cannot start {}: {error}", exe.display())), Vec::new(), None),
    };
    let stderr = child.stderr.take();
    let errors = thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_end(&mut bytes);
        }
        bytes
    });
    let mut stdout = Vec::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_end(&mut stdout);
    }
    let stderr = errors.join().unwrap_or_default();
    let (status, peak) = match test_memory::wait_with_peak(&mut child) {
        Ok(ended) => ended,
        Err(error) => return (every(elapsed(), format!("TEST_WORKER_FAILED: lost the worker: {error}")), Vec::new(), None),
    };
    let elapsed = elapsed();
    let (cases, diagnostics) = match serde_json::from_slice::<WorkerResult>(&stdout) {
        Ok(WorkerResult { value: Some(suite), diagnostics }) if suite.cases.len() == listed => (suite.cases, diagnostics),
        Ok(WorkerResult { value: Some(suite), .. }) => {
            (every(elapsed, format!("TEST_WORKER_FAILED: the worker reported {} cases of {}, listed {listed} times", suite.cases.len(), test.path)), Vec::new())
        }
        Ok(WorkerResult { value: None, diagnostics }) if !diagnostics.is_empty() => {
            let why = diagnostics.iter().map(|d| format!("{}: {}", d.code, d.explanation)).collect::<Vec<_>>().join("; ");
            (every(elapsed, why), diagnostics)
        }
        _ => {
            let stderr = String::from_utf8_lossy(&stderr);
            let tail: String = stderr.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
            let why = format!("TEST_WORKER_FAILED: the worker ended with {status} and printed no report. {}", tail.trim());
            (every(elapsed, why), Vec::new())
        }
    };
    (cases, diagnostics, peak)
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

/// One per-path map of the times file.
fn read_field(project: &Path, field: &str) -> BTreeMap<String, u64> {
    std::fs::read(times_path(project))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| serde_json::from_value(value[field].clone()).ok())
        .unwrap_or_default()
}

fn read_times(project: &Path) -> BTreeMap<String, u64> {
    read_field(project, "elapsed_ms")
}

/// Each test's last measured peak working set, in bytes.
fn read_peaks(project: &Path) -> BTreeMap<String, u64> {
    read_field(project, "peak_bytes")
}

/// This run's times and peaks over the last ones (tests not run keep theirs).
pub fn write_times(project: &Path, cases: &[TestCaseReport], peaks: &BTreeMap<String, u64>) {
    let mut times = read_times(project);
    for case in cases {
        times.insert(case.path.clone(), case.elapsed_ms);
    }
    let mut stored = read_peaks(project);
    stored.extend(peaks.iter().map(|(path, peak)| (path.clone(), *peak)));
    let path = times_path(project);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let value = serde_json::json!({"version": 1, "elapsed_ms": times, "peak_bytes": stored});
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap_or_default());
}
