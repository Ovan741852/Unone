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

/// The slowest frame says which spans it ran, nested ones with their depth,
/// and every kept frame holds only its own frame's spans.
#[test]
fn the_slowest_frame_names_the_spans_it_ran() {
    let source = r#"
local frame = 0
return {
  start = function(api) end,
  update = function(api, dt)
    frame += 1
    local sum = api.profile.span('outer', function()
      local s = api.profile.span('inner', function() return 1 end)
      if frame == 3 then
        s += api.profile.span('heavy', function() local t = 0 for i = 1, 3000000 do t += i % 7 end return t end)
      end
      return s
    end)
    api.observation.set('sum', sum)
  end,
}"#;
    let mut runtime = EngineRuntime::load_source("slow", "main.luau", source.to_string(), None).unwrap();
    let run = runtime.run(6, 42).value.unwrap();
    // All six frames are kept, so frame 3 is found by its number: which frame
    // the machine made slowest is the scheduler's business, not the test's.
    let frames = &run.performance.slowest_frames;
    assert_eq!(frames.len(), 6);
    let heavy = frames.iter().find(|f| f.frame == 3).expect("frame 3 kept");
    let mut shape: Vec<(&str, Option<&str>, u32, u64)> = heavy.spans.iter().map(|s| (s.name.as_str(), s.parent.as_deref(), s.depth, s.calls)).collect();
    assert_eq!(shape[0].0, "outer", "a span contains what runs inside it");
    shape.sort();
    assert_eq!(shape, [("heavy", Some("outer"), 1, 1), ("inner", Some("outer"), 1, 1), ("outer", None, 0, 1)]);
    for frame in frames.iter().filter(|f| f.frame != 3) {
        let mut names: Vec<(&str, u64)> = frame.spans.iter().map(|s| (s.name.as_str(), s.calls)).collect();
        names.sort();
        assert_eq!(names, [("inner", 1), ("outer", 1)], "frame {}", frame.frame);
    }
    assert_eq!(run.performance.slowest_frame.as_ref().map(|f| f.frame), Some(frames[0].frame));
    let json = serde_json::to_value(&run.performance).unwrap();
    let named = |f: &serde_json::Value, name: &str| f["spans"].as_array().unwrap().iter().any(|s| s["name"] == name);
    assert!(json["slowest_frames"].as_array().unwrap().iter().any(|f| f["frame"] == 3 && named(f, "heavy")));
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

#[test]
fn marks_record_the_frame_the_game_declared_and_leave_the_run_unchanged() {
    let marked = r#"
local ticks = 0
return {
  start = function(api) api.profile.mark('boot') end,
  update = function(api, dt)
    ticks += 1
    if ticks == 3 then api.profile.mark('city.interactive') end
    api.observation.set('ticks', ticks)
  end,
}"#;
    let plain = r#"
local ticks = 0
return {
  start = function(api) end,
  update = function(api, dt)
    ticks += 1
    api.observation.set('ticks', ticks)
  end,
}"#;
    let mut runtime = EngineRuntime::load_source("marks", "main.luau", marked.to_string(), None).unwrap();
    let run = runtime.run(5, 42).value.unwrap();
    let marks: Vec<(&str, u64, u64)> = run.performance.marks.iter().map(|m| (m.name.as_str(), m.frame, m.sequence)).collect();
    assert_eq!(marks, [("boot", 0, 1), ("city.interactive", 3, 2)], "Game.start marks the loaded frame; an update marks the frame it produces");
    let mut unmarked = EngineRuntime::load_source("marks", "main.luau", plain.to_string(), None).unwrap();
    let unmarked = unmarked.run(5, 42).value.unwrap();
    assert_eq!(run.observation_digest, unmarked.observation_digest, "marks never change the run");
    assert!(unmarked.performance.marks.is_empty());
    assert!(!serde_json::to_value(&run).unwrap()["world"].to_string().contains("city.interactive"), "marks never reach the world");
    assert_eq!(runtime.profile_marks_since(1).marks.len(), 1);
}

#[test]
fn marks_are_bounded_and_say_how_many_were_dropped() {
    let source = r#"
return {
  start = function(api) for i = 1, 300 do api.profile.mark('m') end end,
  update = function(api, dt) end,
}"#;
    let mut runtime = EngineRuntime::load_source("marks", "main.luau", source.to_string(), None).unwrap();
    let run = runtime.run(1, 42).value.unwrap();
    assert_eq!(run.performance.marks.len(), unone_engine::MAX_PROFILE_MARKS);
    assert!(run.performance.notes.iter().any(|note| note.contains("44 later marks were dropped")), "{:?}", run.performance.notes);
    let update = runtime.profile_marks_since(0);
    assert_eq!((update.dropped, update.revision), (44, unone_engine::MAX_PROFILE_MARKS as u64 + 1));
    let mut invalid = EngineRuntime::load_source("marks", "main.luau", "return {start=function() end,update=function(api) api.profile.mark('') end}".to_string(), None).unwrap();
    let report = invalid.run(1, 42);
    assert!(!report.ok && report.diagnostics.iter().any(|d| d.explanation.contains("PROFILE_NAME_INVALID") || d.summary.contains("PROFILE_NAME_INVALID")), "{:?}", report.diagnostics);
}
