//! Where a very large entry script's load time goes. Not part of the regular
//! suite; point it at a project and run on an optimized build:
//! UNONE_LARGE_PROJECT=<dir> cargo test --release -p unone-engine --test large_script_load -- --ignored --nocapture
use std::time::Instant;

#[test]
#[ignore = "benchmark"]
fn large_script_load_breakdown() {
    let Some(dir) = std::env::var_os("UNONE_LARGE_PROJECT") else { return };
    let dir = std::path::PathBuf::from(dir);
    let mut config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("project.unone.json")).unwrap()).unwrap();
    if config["runtime_packages"]["@unone/ui"].is_string() {
        config["runtime_packages"]["@unone/ui"] = "0.6.0".into();
    }
    let entry = config["entry_script"].as_str().unwrap().to_string();
    let source = std::fs::read_to_string(dir.join(&entry)).unwrap();
    let scene: Option<serde_json::Value> = config["main_scene"].as_str()
        .map(|path| serde_json::from_slice(&std::fs::read(dir.join(path)).unwrap()).unwrap());

    let started = Instant::now();
    let bytecode = mlua::Compiler::new().set_optimization_level(2).compile(&source).unwrap();
    let compile = started.elapsed();
    println!("source {:.1} MB -> bytecode {:.1} MB, compile {:.0} ms",
        source.len() as f64 / 1048576.0, bytecode.len() as f64 / 1048576.0, compile.as_secs_f64() * 1000.0);

    let payload = serde_json::json!({"config": config, "script": source, "scene": scene}).to_string();
    let started = Instant::now();
    let project = unone_engine::HostProject::parse(payload.as_bytes()).unwrap();
    let parse = started.elapsed();
    let started = Instant::now();
    let runtime = project.into_runtime(42).unwrap();
    let load = started.elapsed();
    println!("payload {:.1} MB: serde parse {:.0} ms, compile + chunk + start {:.0} ms (frame {})",
        payload.len() as f64 / 1048576.0, parse.as_secs_f64() * 1000.0, load.as_secs_f64() * 1000.0, runtime.observe().frame);
}
