#![cfg(feature = "save")]

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use unone_engine::{EngineRuntime, observation_digest};

const FIXTURE: &str = include_str!("fixtures/immutable-bytes.luau");

fn runtime() -> EngineRuntime {
    EngineRuntime::load_source_with_seed("immutable-bytes", "main.luau", FIXTURE, None, 42).unwrap()
}

fn checkpoint(runtime: &EngineRuntime) -> Value {
    let world = runtime.observe();
    json!({
        "frame": world.frame,
        "observation_digest": observation_digest(&world).unwrap(),
        "observations": runtime.semantic_observations(),
        "save_payload": runtime.save_payload(),
        "world": serde_json::to_value(world).unwrap(),
    })
}

/// The same fixture runs in the Wasm player via
/// scripts/verify-immutable-bytes-functional-wasm.mjs expects these observations.
#[test]
fn frozen_buffers_reject_every_write_and_snapshots_never_alias() {
    let runtime = runtime();
    let observed = runtime.semantic_observations();
    let number = |key: &str| observed[key].as_f64().unwrap();
    assert_eq!(number("rejected_writes"), 14.0);
    assert_eq!(number("frozen_value"), f64::from(0xDEADBEEFu32));
    assert_eq!(number("copied_value"), f64::from(0xDEADBEEFu32));
    assert_eq!((number("snapshot_whole"), number("snapshot_tail")), (42.0, 42.0));
    assert_eq!((number("rejected_ranges"), number("rejected_types")), (3.0, 3.0));
    assert!(number("frozen_input_index") >= 0.0);
    assert_eq!(observed["immutable_bytes_pass"], true);
    assert_eq!(observed["immutable_bytes_signature"], "bytes-v2:256:32640:4294967295");
    assert!(number("immutable_bytes_checks") >= 300.0);
    assert!(number("immutable_bytes_rejections") >= 40.0);
    assert_eq!(observed["immutable_bytes_boundary"], "unchanged");
    assert_eq!(runtime.save_payload(), Some(json!({"immutable_bytes":"portable-only","revision":1})));
}

#[test]
fn full_canonical_state_repeats_and_nested_views_survive_fixed_ticks_and_runtime_reset() {
    let mut actual = runtime();
    let mut control = runtime();
    let mut checkpoints = vec![checkpoint(&actual)];
    assert_eq!(checkpoints[0], checkpoint(&control));
    for frame in 1..=3 {
        actual.tick().unwrap();
        control.tick().unwrap();
        let current = checkpoint(&actual);
        assert_eq!(current, checkpoint(&control));
        assert_eq!(current["frame"], frame);
        assert_eq!(current["observations"]["immutable_bytes_ticks"], frame);
        assert_eq!(current["observations"]["immutable_bytes_lifetime_value"], 17);
        checkpoints.push(current);
    }
    drop(actual);
    drop(control);
    assert_eq!(checkpoint(&runtime()), checkpoints[0]);

    if let Some(path) = std::env::var_os("UNONE_BYTES_NATIVE_REPORT") {
        use std::io::Write;
        let report = json!({
            "schema_version":1,
            "ok":true,
            "fixture_sha256":format!("{:x}", Sha256::digest(FIXTURE.as_bytes())),
            "seed":42,
            "config":{"name":"immutable-bytes","entry_script":"main.luau"},
            "checkpoints":checkpoints,
            "scope":"Executed native public API fixture, deterministic canonical state and reset; no FPS/GC-frequency conclusion.",
        });
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();
        file.write_all(serde_json::to_string_pretty(&report).unwrap().as_bytes()).unwrap();
    }
}

#[cfg(feature = "dev-tools")]
#[test]
fn failed_reload_keeps_old_view_readable_and_rolls_back_portable_state() {
    let mut actual = runtime();
    let mut control = runtime();
    actual.tick().unwrap();
    control.tick().unwrap();
    let before = checkpoint(&actual);
    let error = actual.reload_source(r#"
return {start=function()end,onReload=function(api)
 local parent=api.bytes.freeze(buffer.fromstring('candidate'))
 local child=api.bytes.span(parent,1,3)
 assert(buffer.readstring(child,0,3)=='and')
 api.observation.set('candidate_bytes',true)
 api.save.set({candidate=true})
 error('immutable bytes reload rollback')
end,update=function()error('rejected candidate must never run')end}
"#).unwrap_err();
    assert!(error.explanation.contains("immutable bytes reload rollback"));
    assert_eq!(checkpoint(&actual), before);
    actual.tick().unwrap();
    control.tick().unwrap();
    assert_eq!(checkpoint(&actual), checkpoint(&control));
}

#[cfg(feature = "dev-tools")]
#[test]
fn successful_reload_owns_new_nested_views_without_relying_on_old_parent_handles() {
    let mut actual = runtime();
    actual.tick().unwrap();
    actual.reload_source(r#"
local child
return {start=function()end,onReload=function(api)
 local parent=api.bytes.freeze(buffer.fromstring('X\0reloadY'))
 child=api.bytes.span(api.bytes.span(parent,1,7),1,6)
 assert(buffer.readstring(child,0,6)=='reload')
 api.observation.set('bytes_reload',true)
end,update=function(api)
 assert(api.bytes.isFrozen(child) and buffer.len(child)==6)
 assert(buffer.readstring(child,0,6)=='reload')
 api.observation.set('bytes_reload_value',buffer.readu8(child,0))
end}
"#).unwrap();
    for _ in 0..3 { actual.tick().unwrap(); }
    assert_eq!(actual.semantic_observations()["bytes_reload"], true);
    assert_eq!(actual.semantic_observations()["bytes_reload_value"], 114);
    assert_eq!(actual.save_payload(), Some(json!({"immutable_bytes":"portable-only","revision":1})));
}
