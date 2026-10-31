//! Game scripts `require` the `.luau` files beside the entry script; see
//! docs/script-modules.md.
use serde_json::json;
use std::path::Path;
use unone_engine::{EngineRuntime, HostProject};

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

const MAIN: &str = r#"--!strict
local terrain = require("./world/terrain")
local shared = require("./shared")
return {
  start = function(api) api.observation.set("start", terrain.height(3) + shared.loads) end,
  update = function(api, dt) api.observation.set("loads", shared.loads) end,
}"#;
const TERRAIN: &str = r#"local shared = require("../shared")
return {height = function(x: number): number return x * shared.scale end}"#;
const SHARED: &str = r#"local M = {scale = 10, loads = 0}
M.loads += 1
return M"#;

fn modules() -> Vec<(&'static str, &'static str)> {
    vec![("world/terrain.luau", TERRAIN), ("shared.luau", SHARED)]
}

fn disk(dir: &Path, main: &str, extra: &[(&str, &str)]) {
    write(&dir.join("project.unone.json"), &json!({"name": "modules", "entry_script": "scripts/main.luau"}).to_string());
    write(&dir.join("scripts/main.luau"), main);
    for (path, text) in extra {
        write(&dir.join("scripts").join(path), text);
    }
}

#[test]
fn modules_load_once_relative_to_the_requiring_file() {
    let dir = tempfile::tempdir().unwrap();
    disk(dir.path(), MAIN, &modules());
    let mut runtime = EngineRuntime::load_with_seed(dir.path(), 42).unwrap();
    let report = runtime.run(2, 42);
    assert!(report.ok, "{:?}", report.diagnostics);
    let observations = &report.value.as_ref().unwrap().world.observations;
    // shared.luau ran once although both main and terrain require it.
    assert_eq!(observations["start"], json!(31));
    assert_eq!(observations["loads"], json!(1));

    // A host delivering the same sources runs the same game.
    let payload = json!({"config": {"name": "modules", "entry_script": "scripts/main.luau"}, "script": MAIN,
        "script_modules": modules().into_iter().collect::<std::collections::BTreeMap<_, _>>()});
    let mut hosted = HostProject::parse(payload.to_string().as_bytes()).unwrap().into_runtime(42).unwrap();
    let hosted = hosted.run(2, 42);
    assert!(hosted.ok, "{:?}", hosted.diagnostics);
    assert_eq!(hosted.value.unwrap().observation_digest, report.value.unwrap().observation_digest);
}

fn load_error(main: &str, extra: &[(&str, &str)]) -> String {
    let dir = tempfile::tempdir().unwrap();
    disk(dir.path(), main, extra);
    match EngineRuntime::load_with_seed(dir.path(), 42) {
        Ok(_) => panic!("expected a load failure"),
        Err(diagnostic) => format!("{} {}", diagnostic.summary, diagnostic.explanation),
    }
}

const GAME: &str = "return {start = function(api) end, update = function(api, dt) end}";

#[test]
fn bad_requires_fail_with_the_module_named() {
    let missing = load_error(&format!("require('./nowhere')\n{GAME}"), &[]);
    assert!(missing.contains("SCRIPT_MODULE_NOT_FOUND"), "{missing}");
    let outside = load_error(&format!("require('../project')\n{GAME}"), &[]);
    assert!(outside.contains("SCRIPT_REQUIRE_PATH"), "{outside}");
    let bare = load_error(&format!("require('shared')\n{GAME}"), &[("shared.luau", "return 1")]);
    assert!(bare.contains("SCRIPT_REQUIRE_PATH"), "{bare}");
    let cycle = load_error(&format!("require('./a')\n{GAME}"), &[("a.luau", "return require('./b')"), ("b.luau", "return require('./a')")]);
    assert!(cycle.contains("SCRIPT_REQUIRE_CYCLE: a.luau -> b.luau -> a.luau"), "{cycle}");
    let empty = load_error(&format!("require('./a')\n{GAME}"), &[("a.luau", "local x = 1")]);
    assert!(empty.contains("SCRIPT_MODULE_RETURN: a.luau"), "{empty}");
    // A runtime error names the module's file and line.
    let failing = load_error(&format!("require('./world/bad')\n{GAME}"), &[("world/bad.luau", "local x = 1\nerror('broken terrain')\nreturn x")]);
    assert!(failing.contains("scripts/world/bad.luau") && failing.contains(":2: broken terrain"), "{failing}");
}

#[test]
fn check_evaluates_the_entry_with_its_modules() {
    let dir = tempfile::tempdir().unwrap();
    disk(dir.path(), MAIN, &modules());
    let report = EngineRuntime::check(dir.path());
    assert!(report.ok, "{:?}", report.diagnostics);
}
