//! Retained Luau heap and GC cost over a long replay. Not part of the regular
//! suite; point it at a project and run on an optimized build:
//! UNONE_SOAK_PROJECT=<dir> UNONE_SOAK_INPUT=<test.json or input array>
//! [UNONE_SOAK_TICKS=6000] [UNONE_SOAK_EVERY=600] [UNONE_SOAK_WARMUP=600] [UNONE_SOAK_LABEL=idle]
//! cargo test --release -p unone-engine --test memory_soak -- --ignored --nocapture
//! After the input it repeats the last frame. Every EVERY ticks it closes a VM
//! profile window (allocation growth and incremental GC per tick) and takes an
//! explicit full-GC `memory.sample` under one label, so samples compare the same
//! phase of the same workload; samples before WARMUP ticks are warmup.
#![cfg(feature = "preview-tools")]
use std::time::Instant;
use unone_engine::{EngineRuntime, InputFrame, PreviewRequest};

const MB: f64 = 1048576.0;

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn stats(values: &mut [f64]) -> String {
    if values.is_empty() { return "n/a".into(); }
    values.sort_by(f64::total_cmp);
    let n = values.len();
    format!("median {:.3} p95 {:.3} max {:.3}", values[n / 2], values[(n * 95 / 100).min(n - 1)], values[n - 1])
}

#[test]
#[ignore = "benchmark"]
fn memory_soak() {
    let Some(dir) = std::env::var_os("UNONE_SOAK_PROJECT") else { return };
    let mut runtime = EngineRuntime::load_with_seed(std::path::PathBuf::from(dir), 42).unwrap();
    let inputs: Vec<InputFrame> = std::env::var_os("UNONE_SOAK_INPUT").map(|path| {
        let test: serde_json::Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let sequence = if test.is_array() { test } else { test["input_sequence"].clone() };
        serde_json::from_value(sequence).unwrap()
    }).unwrap_or_default();
    let idle = inputs.last().cloned().unwrap_or_default();
    let (ticks, every, warmup) = (env("UNONE_SOAK_TICKS", 6000), env("UNONE_SOAK_EVERY", 600).max(1), env("UNONE_SOAK_WARMUP", 600));
    let label = std::env::var("UNONE_SOAK_LABEL").unwrap_or_else(|_| "idle".into());
    // (wall ms, allocation growth bytes, incremental GC ms, GC steps, longest GC step ms) per tick
    let mut rows: Vec<(f64, f64, f64, f64, f64)> = Vec::with_capacity(ticks);
    println!("{:>6} {:>10} {:>10} {:>10} {:>9} {:>11} {:>9}", "tick", "used MB", "retained", "reclaimed", "full GC", "alloc MB", "inc GC ms");
    let mut tick = 0;
    while tick < ticks {
        runtime.preview_request(PreviewRequest::ProfileStart { sampling: false }).unwrap();
        let start = rows.len();
        for _ in 0..every.min(ticks - tick) {
            let frame = inputs.get(tick).unwrap_or(&idle);
            let started = Instant::now();
            runtime.tick_with_input(frame).unwrap();
            rows.push((started.elapsed().as_secs_f64() * 1000., 0., 0., 0., 0.));
            tick += 1;
        }
        let window = runtime.preview_request(PreviewRequest::ProfileStop {}).unwrap();
        let frames = window["window"]["vm"]["frames"].as_array().cloned().unwrap_or_default();
        // The window keeps the most recent frames; align them to the end of this chunk.
        let offset = rows.len() - frames.len().min(rows.len() - start);
        for (row, frame) in rows[offset..].iter_mut().zip(&frames) {
            let number = |key: &str| frame[key].as_f64().unwrap_or(0.);
            *row = (row.0, number("allocation_growth_bytes"), number("incremental_gc_ms"), number("incremental_gc_steps"), number("incremental_gc_max_step_ms"));
        }
        let sample = runtime.preview_request(PreviewRequest::MemorySample { label: label.clone(), collect: true, warmup: tick <= warmup }).unwrap();
        let sample = &sample["samples"].as_array().and_then(|s| s.last().cloned()).unwrap_or(sample);
        let bytes = |key: &str| sample[key].as_f64().unwrap_or(f64::NAN) / MB;
        let chunk = &rows[start..];
        println!("{tick:>6} {:>10.2} {:>10.2} {:>10.2} {:>7.1}ms {:>11.1} {:>9.1}{}",
            bytes("lua_used_before_bytes"), bytes("lua_used_after_bytes"), bytes("reclaimed_bytes"),
            sample["full_gc_wall_ms"].as_f64().unwrap_or(f64::NAN),
            chunk.iter().map(|r| r.1).sum::<f64>() / MB, chunk.iter().map(|r| r.2).sum::<f64>(),
            if tick <= warmup { "  (warmup)" } else { "" });
    }
    let report = runtime.preview_request(PreviewRequest::MemoryReport {}).unwrap();
    println!("trends: {}", report["trends"]);
    println!("sampled peak: {:.1} MB", report["sampled_peak_bytes"].as_f64().unwrap_or(f64::NAN) / MB);
    let measured: Vec<_> = rows.iter().skip(warmup.min(rows.len())).collect();
    let column = |index: usize| -> Vec<f64> { measured.iter().map(|r| [r.0, r.1, r.2, r.3, r.4][index]).collect() };
    println!("ticks after warmup: {}", measured.len());
    println!("  tick wall ms        {}", stats(&mut column(0)));
    println!("  alloc growth KB     {}", stats(&mut column(1).iter().map(|b| b / 1024.).collect::<Vec<_>>()));
    println!("  incremental GC ms   {}", stats(&mut column(2)));
    println!("  GC steps per tick   {}", stats(&mut column(3)));
    println!("  longest GC step ms  {}", stats(&mut column(4)));
    let gc: f64 = column(2).iter().sum();
    let wall: f64 = column(0).iter().sum();
    println!("  incremental GC total {gc:.1} ms of {wall:.1} ms tick wall ({:.1}%)", 100. * gc / wall.max(1e-9));
}
