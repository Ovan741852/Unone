//! Where a project's ticks go: replays a test file's input to reach a state,
//! then samples Luau functions and VM GC over further ticks. Not part of the
//! regular suite; run on an optimized sampling build:
//! UNONE_TICK_PROJECT=<dir> UNONE_TICK_INPUT=<test.json> [UNONE_TICK_FRAMES=120]
//! cargo test --release -p unone-engine --features sampling-profile --test tick_profile -- --ignored --nocapture
//! With `--features phase-profile` instead, it times the engine's own phases
//! (script, UI conversion and validation, observation, snapshot) per tick.
#![cfg(any(feature = "sampling-profile", feature = "phase-profile"))]
use std::time::Instant;
use unone_engine::{InputFrame, PreviewRequest};

#[test]
#[ignore = "benchmark"]
fn tick_profile() {
    let Some(dir) = std::env::var_os("UNONE_TICK_PROJECT") else { return };
    let dir = std::path::PathBuf::from(dir);
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("project.unone.json")).unwrap()).unwrap();
    let script = std::fs::read_to_string(dir.join(config["entry_script"].as_str().unwrap())).unwrap();
    let scene: Option<serde_json::Value> = config["main_scene"].as_str()
        .map(|path| serde_json::from_slice(&std::fs::read(dir.join(path)).unwrap()).unwrap());
    let payload = serde_json::json!({"config": config, "script": script, "scene": scene}).to_string();
    let started = Instant::now();
    let mut runtime = unone_engine::HostProject::parse(payload.as_bytes()).unwrap().into_runtime(42).unwrap();
    println!("load {:.0} ms", started.elapsed().as_secs_f64() * 1000.);
    let inputs: Vec<InputFrame> = std::env::var_os("UNONE_TICK_INPUT").map(|path| {
        let test: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        serde_json::from_value(test["input_sequence"].clone()).unwrap()
    }).unwrap_or_default();
    let idle = inputs.last().cloned().unwrap_or_default();
    for frame in &inputs { runtime.tick_with_input(frame).unwrap(); }
    let frames: usize = std::env::var("UNONE_TICK_FRAMES").ok().and_then(|v| v.parse().ok()).unwrap_or(120);
    for _ in 0..10 { runtime.tick_with_input(&idle).unwrap(); }
    let phases = cfg!(feature = "phase-profile");
    runtime.preview_request(PreviewRequest::ProfileStart { sampling: !phases }).unwrap();
    let mut times = Vec::with_capacity(frames);
    for _ in 0..frames {
        let started = Instant::now();
        runtime.tick_with_input(&idle).unwrap();
        times.push(started.elapsed().as_secs_f64() * 1000.);
    }
    let stopped = runtime.preview_request(PreviewRequest::ProfileStop {}).unwrap();
    times.sort_by(f64::total_cmp);
    println!("{frames} ticks: median {:.1} ms, p95 {:.1} ms, max {:.1} ms",
        times[frames / 2], times[frames * 95 / 100], times[frames - 1]);
    let window = &stopped["window"];
    if phases {
        let mut phases: Vec<(&String, &serde_json::Value)> = window["core_phases"]["phases"].as_object().unwrap().iter().collect();
        phases.sort_by(|a, b| b.1["total_ms"].as_f64().partial_cmp(&a.1["total_ms"].as_f64()).unwrap());
        for (name, phase) in phases {
            println!("  {name:32} mean {:7.3} ms  p95 {:7.3} ms  calls {}",
                phase["mean_ms"].as_f64().unwrap_or(0.), phase["p95_ms"].as_f64().unwrap_or(0.), phase["calls"]);
        }
        return;
    }
    println!("vm: {}", window["vm"]);
    let mut functions: Vec<&serde_json::Value> = window["functions"].as_object().unwrap().values().collect();
    let total = window["samples"].as_u64().unwrap_or(1).max(1) as f64;
    for (label, key) in [("self", "self_samples"), ("inclusive", "inclusive_samples")] {
        functions.sort_by_key(|f| std::cmp::Reverse(f[key].as_u64().unwrap_or(0)));
        println!("top {label} ({total} samples):");
        for f in functions.iter().take(25) {
            println!("  {:5.1}%  {} {}:{}", f[key].as_u64().unwrap_or(0) as f64 * 100. / total,
                f["name"].as_str().unwrap_or("?"), f["source"].as_str().unwrap_or("?"), f["line"]);
        }
    }
}
