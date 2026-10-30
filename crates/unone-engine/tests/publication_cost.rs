//! Where a tick's Web publication time goes: game update + snapshot, then
//! JSON encoding, the canonical digest and the instance rewrite round trip.
//! Not part of the regular suite; point it at a project:
//! UNONE_PUBLICATION_PROJECT=<dir> cargo test --release -p unone-engine --test publication_cost -- --ignored --nocapture
use std::time::{Duration, Instant};

#[test]
#[ignore = "benchmark"]
fn publication_cost_breakdown() {
    let Some(dir) = std::env::var_os("UNONE_PUBLICATION_PROJECT") else { return };
    let dir = std::path::PathBuf::from(dir);
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("project.unone.json")).unwrap()).unwrap();
    let script = std::fs::read_to_string(dir.join(config["entry_script"].as_str().unwrap())).unwrap();
    let scene: Option<serde_json::Value> = config["main_scene"].as_str()
        .map(|path| serde_json::from_slice(&std::fs::read(dir.join(path)).unwrap()).unwrap());
    let payload = serde_json::json!({"config": config, "script": script, "scene": scene}).to_string();
    let mut runtime = unone_engine::HostProject::parse(payload.as_bytes()).unwrap().into_runtime(42).unwrap();
    let mut hasher = unone_engine::CanonicalHasher::default();
    let [mut tick, mut encode, mut digest, mut roundtrip] = [Duration::ZERO; 4];
    let (frames, mut bytes) = (300, 0);
    for _ in 0..30 { runtime.tick().unwrap(); }
    for _ in 0..frames {
        let started = Instant::now();
        let snapshot = runtime.tick().unwrap();
        tick += started.elapsed();
        let started = Instant::now();
        let world = serde_json::value::to_raw_value(&snapshot).unwrap();
        encode += started.elapsed();
        bytes = world.get().len();
        let started = Instant::now();
        std::hint::black_box(hasher.hash(world.get().as_bytes()));
        digest += started.elapsed();
        let started = Instant::now();
        let value: serde_json::Value = serde_json::from_str(world.get()).unwrap();
        std::hint::black_box(serde_json::to_vec(&value).unwrap());
        roundtrip += started.elapsed();
    }
    let ms = |d: Duration| d.as_secs_f64() * 1000.0 / frames as f64;
    println!("world {:.1} KB/frame: tick+snapshot {:.3} ms, encode {:.3} ms, digest {:.3} ms, parse+re-encode {:.3} ms",
        bytes as f64 / 1024.0, ms(tick), ms(encode), ms(digest), ms(roundtrip));
}
