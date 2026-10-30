//! Per-read cost of immutable binary data in game Luau. Not part of the
//! regular suite; run it on an optimized build:
//! cargo test --release -p unone-engine --test bytes_perf -- --ignored --nocapture
use std::time::Instant;
use unone_engine::EngineRuntime;

const READS: usize = 65_536;
const TICKS: usize = 40;

const SETUP: &str = r#"
local N = 65536
local data = buffer.create(N * 4)
for i = 0, N - 1 do buffer.writeu32(data, i * 4, (i * 2654435761) % 4294967296) end
local text = buffer.tostring(data)
"#;

/// Median wall time of one tick whose update performs `body` once.
fn tick_ns(setup: &str, body: &str) -> f64 {
    let source = format!(
        "{SETUP}\n{setup}\nreturn {{start=function(api) end, update=function(api)\n local s = 0\n {body}\n api.observation.set('sum', s)\nend}}"
    );
    let mut runtime = EngineRuntime::load_source("bytes-perf", "main.luau", &source, None).unwrap();
    for _ in 0..3 {
        runtime.tick().unwrap();
    }
    let mut samples: Vec<f64> = (0..TICKS)
        .map(|_| {
            let started = Instant::now();
            runtime.tick().unwrap();
            started.elapsed().as_nanos() as f64
        })
        .collect();
    samples.sort_by(f64::total_cmp);
    samples[samples.len() / 2]
}

#[test]
#[ignore = "benchmark"]
fn immutable_read_cost() {
    let empty = tick_ns("", "for i = 0, N - 1 do s += i end");
    let cases: Vec<(&str, String, &str)> = vec![
        ("buffer.readu32", String::new(), "for i = 0, N - 1 do s += buffer.readu32(data, i * 4) end"),
        (
            "frozen buffer.readu32",
            "local frozen".to_string(),
            "frozen = frozen or api.bytes.snapshot(data)
 for i = 0, N - 1 do s += buffer.readu32(frozen, i * 4) end",
        ),
        ("buffer.writeu32 (writable)", String::new(), "for i = 0, N - 1 do buffer.writeu32(data, i * 4, i) end"),
        (
            "string.byte x4",
            String::new(),
            "for i = 0, N - 1 do local a, b, c, d = string.byte(text, i * 4 + 1, i * 4 + 4); s += a + b * 256 + c * 65536 + d * 16777216 end",
        ),
        ("string.unpack <I4", String::new(), "for i = 0, N - 1 do s += string.unpack('<I4', text, i * 4 + 1) end"),
        (
            "populous readonly_bytes.u32",
            include_str!("fixtures/populous-readonly-bytes.luau").to_string(),
            "for i = 0, N - 1 do s += R.u32(value, i * 4) end",
        ),
    ];
    println!("empty loop: {:.2} ns/iteration", empty / READS as f64);
    for (name, setup, body) in cases {
        let ns = (tick_ns(&setup, body) - empty) / READS as f64;
        println!("{name:32} {ns:7.2} ns/read");
    }
}

