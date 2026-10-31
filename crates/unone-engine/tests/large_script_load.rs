//! Where a very large entry script's load time and memory go. Not part of the
//! regular suite; point it at a project and run on an optimized build:
//! UNONE_LARGE_PROJECT=<dir> cargo test --release -p unone-engine --test large_script_load -- --ignored --nocapture
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::Instant;

/// Heap bytes live now and the peak since the last `reset_peak`. A Wasm
/// player's linear memory grows to the peak and never shrinks.
struct Counting;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() { PEAK.fetch_max(LIVE.fetch_add(layout.size(), Relaxed) + layout.size(), Relaxed); }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        LIVE.fetch_sub(layout.size(), Relaxed);
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let next = unsafe { System.realloc(pointer, layout, size) };
        if !next.is_null() {
            if size >= layout.size() { PEAK.fetch_max(LIVE.fetch_add(size - layout.size(), Relaxed) + size - layout.size(), Relaxed); }
            else { LIVE.fetch_sub(layout.size() - size, Relaxed); }
        }
        next
    }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;
const MB: f64 = 1048576.0;
fn reset_peak() -> usize { let live = LIVE.load(Relaxed); PEAK.store(live, Relaxed); live }
fn report(stage: &str, before: usize, started: Instant) {
    println!("{stage:<28} {:>7.0} ms  peak +{:>6.1} MB  live +{:>6.1} MB", started.elapsed().as_secs_f64() * 1000.,
        (PEAK.load(Relaxed) - before) as f64 / MB, (LIVE.load(Relaxed) as f64 - before as f64) / MB);
}

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
    println!("source {:.1} MB", source.len() as f64 / MB);

    let before = reset_peak(); let started = Instant::now();
    let bytecode = mlua::Compiler::new().set_optimization_level(2).compile(&source).unwrap();
    report("compile alone (opt 2)", before, started);
    println!("  bytecode {:.1} MB", bytecode.len() as f64 / MB);
    let before = reset_peak(); let started = Instant::now();
    let lua = mlua::Lua::new();
    lua.load(&bytecode).set_mode(mlua::ChunkMode::Binary).into_function().unwrap();
    report("load bytecode alone", before, started);
    drop(lua); drop(bytecode);

    let payload = serde_json::json!({"config": config, "script": source, "scene": scene}).to_string();
    drop(source);
    let before = reset_peak(); let started = Instant::now();
    let project = unone_engine::HostProject::parse(payload.as_bytes()).unwrap();
    report("payload parse", before, started);
    let before = reset_peak(); let started = Instant::now();
    let runtime = project.into_runtime(42).unwrap();
    report("compile + chunk + start", before, started);
    drop(payload);
    println!("live after load {:.1} MB (frame {})", LIVE.load(Relaxed) as f64 / MB, runtime.observe().frame);
}

/// Splits engine load time into compiling, running the chunk's top level and
/// the game's own `start`, using a plain VM with the production compiler.
#[test]
#[ignore = "benchmark"]
fn large_script_chunk_time() {
    let Some(dir) = std::env::var_os("UNONE_LARGE_PROJECT") else { return };
    let dir = std::path::PathBuf::from(dir);
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("project.unone.json")).unwrap()).unwrap();
    let source = std::fs::read_to_string(dir.join(config["entry_script"].as_str().unwrap())).unwrap();
    let lua = mlua::Lua::new();
    lua.set_compiler(mlua::Compiler::new().set_optimization_level(2));
    let started = Instant::now();
    let chunk = lua.load(&source).into_function().unwrap();
    println!("compile + load {:.0} ms", started.elapsed().as_secs_f64() * 1000.);
    let started = Instant::now();
    let game: mlua::Value = chunk.call(()).unwrap();
    println!("chunk top level {:.0} ms -> {}", started.elapsed().as_secs_f64() * 1000., game.type_name());
    println!("vm {:.1} MB", lua.used_memory() as f64 / MB);
}

/// The same project configuration and scene with an empty game: engine-side
/// setup cost without the game's own start.
#[test]
#[ignore = "benchmark"]
fn large_script_engine_setup_time() {
    let Some(dir) = std::env::var_os("UNONE_LARGE_PROJECT") else { return };
    let dir = std::path::PathBuf::from(dir);
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("project.unone.json")).unwrap()).unwrap();
    let scene: Option<serde_json::Value> = config["main_scene"].as_str()
        .map(|path| serde_json::from_slice(&std::fs::read(dir.join(path)).unwrap()).unwrap());
    let payload = serde_json::json!({"config": config, "script": "return {start=function()end,update=function()end}", "scene": scene}).to_string();
    let started = Instant::now();
    let runtime = unone_engine::HostProject::parse(payload.as_bytes()).unwrap().into_runtime(42).unwrap();
    println!("engine setup {:.0} ms (frame {})", started.elapsed().as_secs_f64() * 1000., runtime.observe().frame);
}

/// Writes the entry script as production Web bytecode for a player benchmark:
/// UNONE_LARGE_PROJECT=<dir> UNONE_BYTECODE_OUT=<file> ... large_script_write_bytecode
#[test]
#[ignore = "benchmark"]
fn large_script_write_bytecode() {
    let (Some(dir), Some(out)) = (std::env::var_os("UNONE_LARGE_PROJECT"), std::env::var_os("UNONE_BYTECODE_OUT")) else { return };
    let dir = std::path::PathBuf::from(dir);
    let config: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("project.unone.json")).unwrap()).unwrap();
    let source = std::fs::read_to_string(dir.join(config["entry_script"].as_str().unwrap())).unwrap();
    let compiled = unone_engine::compile_production_script(&source, false).unwrap();
    std::fs::write(&out, &compiled.bytes).unwrap();
    println!("{}", serde_json::json!({"format": compiled.format, "byte_length": compiled.bytes.len()}));
}
