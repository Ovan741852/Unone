//! `api.profile` measures a game's own Luau without changing what it does.
use unone_engine::EngineRuntime;

fn game(work: &str) -> String {
    format!(r#"
return {{
  start = function(api) end,
  update = function(api, dt)
    local sum = {work}
    api.observation.set("sum", sum)
  end,
}}"#)
}

const LOOP: &str = "(function() local s = 0 for i = 1, 1000 do s += i end return s end)()";

#[test]
fn spans_and_counters_are_reported_and_leave_the_run_unchanged() {
    let profiled = game(&format!(
        "api.profile.span('work', function() api.profile.count('hits'); api.profile.count('nodes', 3); return {LOOP} end)"
    ));
    let mut runtime = EngineRuntime::load_source("profile", "main.luau", profiled, None).unwrap();
    let report = runtime.run(10, 42);
    assert!(report.ok, "{:?}", report.diagnostics);
    let run = report.value.unwrap();
    let performance = &run.performance;
    let span = &performance.spans[0];
    assert_eq!((span.name.as_str(), span.calls), ("work", 10));
    assert!(span.max_ms >= span.mean_ms && span.p95_ms <= span.max_ms);
    let counter = |name: &str| performance.counters.iter().find(|c| c.name == name).unwrap();
    assert_eq!((counter("hits").total, counter("hits").per_frame_mean, counter("hits").per_frame_max), (10.0, 1.0, 1.0));
    assert_eq!((counter("nodes").total, counter("nodes").per_frame_max), (30.0, 3.0));
    assert!(performance.startup.is_some(), "a loaded runtime reports its startup");

    // The same game without profiling produces the same run.
    let mut plain = EngineRuntime::load_source("profile", "main.luau", game(LOOP), None).unwrap();
    let plain = plain.run(10, 42).value.unwrap();
    assert_eq!(run.observation_digest, plain.observation_digest);
    assert!(plain.performance.spans.is_empty() && plain.performance.counters.is_empty());
    let json = serde_json::to_value(&run).unwrap();
    assert!(!json["world"].to_string().contains("\"work\""), "spans never reach the world");
}

#[test]
fn invalid_names_and_amounts_are_rejected() {
    for (work, code) in [("api.profile.count('', 1)", "PROFILE_NAME_INVALID"), ("api.profile.count('n', math.huge)", "PROFILE_COUNT_INVALID")] {
        let mut runtime = EngineRuntime::load_source("profile", "main.luau", game(&format!("(function() {work} return 0 end)()")), None).unwrap();
        let report = runtime.run(1, 42);
        assert!(!report.ok);
        assert!(report.diagnostics.iter().any(|d| d.explanation.contains(code) || d.summary.contains(code)), "{code}: {:?}", report.diagnostics);
    }
}
