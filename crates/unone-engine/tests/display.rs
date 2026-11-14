//! The screen a project declares it is designed for (`display`).
use serde_json::{Value, json};
use std::{fs, path::Path};
use tempfile::tempdir;
use unone_engine::{AspectMode, EngineRuntime};

/// A game that publishes the viewport shape it sees.
const SCRIPT: &str = "return {start=function(api) end, update=function(api)\napi.observation.set('aspect', api.ui.getViewport().aspect)\nend}";

fn write_project(root: &Path, config: Value) {
    fs::create_dir_all(root.join("scripts")).unwrap();
    let mut project = json!({"name": "display", "entry_script": "scripts/main.luau"});
    project.as_object_mut().unwrap().extend(config.as_object().unwrap().clone());
    fs::write(root.join("project.unone.json"), project.to_string()).unwrap();
    fs::write(root.join("scripts/main.luau"), SCRIPT).unwrap();
}

fn seen_aspect(root: &Path) -> f64 {
    let run = EngineRuntime::load_with_seed(root, 1).unwrap().run(1, 1);
    let report = run.value.unwrap_or_else(|| panic!("{:?}", run.diagnostics));
    report.world.observations["aspect"].as_f64().expect("the game published its aspect")
}

#[test]
fn headless_runs_see_the_declared_design_shape() {
    let dir = tempdir().unwrap();
    write_project(dir.path(), json!({}));
    assert!((seen_aspect(dir.path()) - 16.0 / 9.0).abs() < 1e-9, "undeclared keeps the 16:9 reference");

    write_project(dir.path(), json!({"display": {"width": 1080, "height": 1920}}));
    assert!((seen_aspect(dir.path()) - 1080.0 / 1920.0).abs() < 1e-9, "a portrait design is what headless runs and tests see");
    let runtime = EngineRuntime::load(dir.path()).unwrap();
    let display = runtime.display().expect("declared");
    assert_eq!(display.aspect, AspectMode::Expand, "undeclared aspect mode expands");
    assert_eq!((display.width.get(), display.height.get()), (1080, 1920));

    write_project(dir.path(), json!({"display": {"width": 800, "height": 600, "aspect": "keep"}}));
    assert_eq!(EngineRuntime::load(dir.path()).unwrap().display().unwrap().aspect, AspectMode::Keep);
}

#[test]
fn a_display_no_screen_can_have_is_refused() {
    let dir = tempdir().unwrap();
    for display in [
        json!({"width": 0, "height": 720}),
        json!({"width": 1280}),
        json!({"width": 1280, "height": 720, "aspect": "stretch"}),
        json!({"width": 1280, "height": 720, "fit": "keep"}),
    ] {
        write_project(dir.path(), json!({"display": display}));
        let checked = EngineRuntime::check(dir.path());
        assert!(!checked.ok, "{display} must be refused");
        assert_eq!(checked.diagnostics[0].code, "PROJECT_CONFIG_INVALID", "{display}");
    }
}
