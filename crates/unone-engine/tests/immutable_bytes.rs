use unone_engine::EngineRuntime;

/// The same fixture runs in the Wasm player via
/// scripts/verify-immutable-bytes-wasm.mjs, which expects these observations.
#[test]
fn frozen_buffers_reject_every_write_and_snapshots_never_alias() {
    let runtime = EngineRuntime::load_source(
        "immutable-bytes",
        "main.luau",
        include_str!("fixtures/immutable-bytes.luau"),
        None,
    )
    .unwrap();
    let observed = runtime.semantic_observations();
    let number = |key: &str| observed[key].as_f64().unwrap();
    assert_eq!(number("rejected_writes"), 14.0);
    assert_eq!(number("frozen_value"), f64::from(0xDEADBEEFu32));
    assert_eq!(number("copied_value"), f64::from(0xDEADBEEFu32));
    assert_eq!((number("snapshot_whole"), number("snapshot_tail")), (42.0, 42.0));
    assert_eq!((number("rejected_ranges"), number("rejected_types")), (3.0, 3.0));
    assert!(number("frozen_input_index") >= 0.0);
}
