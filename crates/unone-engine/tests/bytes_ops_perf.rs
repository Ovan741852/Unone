//! Shared-source byte-operation microbenchmark, separate from bytes_perf.rs.
//! Run explicitly in an optimized build; timings are not allocation counts/FPS.
use std::time::Instant;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use unone_engine::{EngineRuntime, InputFrame};

const SOURCE: &str = include_str!("fixtures/immutable-bytes-ops-perf.luau");
const SIZES: [usize; 3] = [4096, 65536, 1048576];
const NAMES: [&str; 11] = [
    "span", "equals_mutable", "equals_frozen", "equals_mixed",
    "equals_range_mutable", "equals_range_frozen", "equals_range_mixed",
    "snapshot_mutable", "snapshot_partial_frozen", "snapshot_whole_frozen",
    "readstring_same_content",
];
const ROUNDS: usize = 3;
const TICKS: usize = 4;
const WARMUP: usize = 3;

fn frame(size: usize, operation: usize, baseline: bool) -> InputFrame {
    let actions = serde_json::Map::from_iter([
        (format!("BytesSize{size}"), json!(true)),
        (format!("BytesOp{operation}"), json!(true)),
        ("BytesBaseline".into(), json!(baseline)),
    ]);
    serde_json::from_value(json!({"actions":actions})).unwrap()
}

fn sample(runtime: &mut EngineRuntime, size: usize, operation: usize, baseline: bool) -> f64 {
    let input = frame(size, operation, baseline);
    // Input construction, selector warm-up and observations are outside timing.
    for _ in 0..WARMUP { runtime.tick_with_input(&input).unwrap(); }
    let start = Instant::now();
    for _ in 0..TICKS { runtime.tick_with_input(&input).unwrap(); }
    let elapsed = start.elapsed().as_secs_f64() * 1e9 / TICKS as f64;
    let observed = runtime.semantic_observations();
    let repetitions = if operation == 1 || operation == 10 { 512 } else { 1048576 / size };
    assert_eq!(observed["bytes_ops_size"], size);
    assert_eq!(observed["bytes_ops_case"], operation);
    assert_eq!(observed["bytes_ops_baseline"], baseline);
    assert_eq!(observed["bytes_ops_repetitions"], repetitions);
    assert_eq!(observed["bytes_ops_checksum"], repetitions);
    elapsed
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[sorted.len() / 2]
}

#[test]
#[ignore = "bounded byte-operation benchmark; execute separately from acceptance"]
fn immutable_byte_operation_costs() {
    let mut runtime = EngineRuntime::load_source_with_seed(
        "immutable-bytes-ops-perf", "main.luau", SOURCE, None, 42,
    ).unwrap();
    assert_eq!(runtime.semantic_observations()["bytes_ops_ready"], true);
    let mut results = Vec::<Value>::new();
    for size in SIZES {
        for (index, name) in NAMES.iter().enumerate() {
            let operation = index + 1;
            let repetitions = if operation == 1 || operation == 10 { 512 } else { 1048576 / size };
            let (mut baseline, mut actual) = (Vec::new(), Vec::new());
            for round in 0..ROUNDS {
                if round % 2 == 0 {
                    baseline.push(sample(&mut runtime, size, operation, true));
                    actual.push(sample(&mut runtime, size, operation, false));
                } else {
                    actual.push(sample(&mut runtime, size, operation, false));
                    baseline.push(sample(&mut runtime, size, operation, true));
                }
            }
            let baseline_ns = median(&baseline) / repetitions as f64;
            let raw_ns = median(&actual) / repetitions as f64;
            results.push(json!({"operation":name,"index":operation,"size_bytes":size,
                "range_offset":size/4,"range_length":size/2,"repetitions_per_tick":repetitions,
                "raw_tick_ns":actual,"baseline_tick_ns":baseline,
                "raw_ns_per_op":raw_ns,"baseline_ns_per_op":baseline_ns,
                "adjusted_ns_per_op":raw_ns-baseline_ns}));
        }
    }
    println!("{}", serde_json::to_string(&json!({
        "schema":"unone.bytes-operations.native-perf.v1","fixture_sha256":format!("{:x}",Sha256::digest(SOURCE.as_bytes())),
        "seed":42,"rounds":ROUNDS,"ticks_per_round":TICKS,"warmup_per_sample":WARMUP,
        "execution":unone_engine::execution_mode(),"results":results,
        "scope":"Native whole tick including input acceptance/selection, operation loop and scalar publication; matching-loop subtraction is not an allocation counter or CPU-only API cost. Natural GC remains active. Distinct equal inputs compare current bytes; readstring repeats content and includes string interning. Raw and negative noise-adjusted results are retained. No FPS/zero-allocation/current-WASM performance claim."
    })).unwrap());
}
