//! `display.pixels`: a game that draws its own screen pixels (api.projected, physical points) in design pixels sees
//! the design size scaled to fit the drawing buffer, whatever the window; the engine converts its scissors back.
use serde_json::{Value, json};
use std::{fs, path::Path};
use tempfile::tempdir;
use unone_engine::{EngineRuntime, InputFrame};

/// Publishes the projected viewport, sets one batch with a design-pixel scissor and reports the first point it got.
const SCRIPT: &str = r#"
local function triangle()
    local v = buffer.create(120)
    for i, p in {{-1, -1}, {1, -1}, {0, 1}} do
        local at = (i - 1) * 40
        for j, n in {p[1], p[2], 0.5, 1, 0, 0, 1, 1, 1, 1} do buffer.writef32(v, at + (j - 1) * 4, n) end
    end
    local ix = buffer.create(12)
    for i = 0, 2 do buffer.writeu32(ix, i * 4, i) end
    return v, ix
end
return {start = function(api) end, update = function(api)
    local view = api.projected.getViewport()
    api.observation.set('view', {width = view.width, height = view.height, aspect = view.aspect, scale = view.scale})
    local v, ix = triangle()
    api.projected.set('hud', {texture = 'texture://white', vertices = v, indices = ix, scissor = {x = 0, y = 0, width = 640, height = 360}})
    local batch = api.input.getPhysicalBatch()
    if batch then
        for _, e in batch.events do
            if e.point then api.observation.set('point', e.point) end
            if e.kind == 'viewport' then api.observation.set('viewport_event', e.viewport) end
        end
    end
end}
"#;

fn project(root: &Path, display: Value) {
    fs::create_dir_all(root.join("scripts")).unwrap();
    fs::write(root.join("project.unone.json"), json!({"name": "pixels", "entry_script": "scripts/main.luau", "display": display}).to_string()).unwrap();
    fs::write(root.join("scripts/main.luau"), SCRIPT).unwrap();
}

fn viewport(width: u32, height: u32) -> Value {
    json!({"revision": 1, "width": width, "height": height, "rect_left": 0, "rect_top": 0, "css_width": width, "css_height": height, "device_pixel_ratio": 1})
}

/// A viewport event, then a pointer at (x, y) physical pixels of a width x height drawing buffer.
fn pointer(width: u32, height: u32, x: f64, y: f64) -> InputFrame {
    let event = |sequence: u64, route: &str, kind: Value| {
        let mut e = json!({"sequence": sequence, "received_us": sequence, "origin": "fixture", "route": route});
        e.as_object_mut().unwrap().extend(kind.as_object().unwrap().clone());
        e
    };
    let batch = json!({"profile": "ordered_physical_v1", "epoch": 1, "after_sequence": 0, "through_sequence": 2, "events": [
        event(1, "control", json!({"kind": "viewport", "viewport": viewport(width, height)})),
        event(2, "game", json!({"kind": "pointer", "pointer_id": 1, "pointer_type": "mouse", "phase": "move", "button": -1, "buttons": 0,
            "point": {"x": x, "y": y, "inside": true, "viewport": viewport(width, height)},
            "modifiers": {"shift": false, "control": false, "alt": false, "meta": false}})),
    ]});
    serde_json::from_value(json!({"physical": batch})).unwrap()
}

fn run(display: Value, width: u32, height: u32, x: f64, y: f64) -> (Value, Value) {
    let dir = tempdir().unwrap();
    project(dir.path(), display);
    let mut runtime = EngineRuntime::load_with_seed(dir.path(), 1).unwrap();
    runtime.set_viewport_size(width, height).unwrap();
    let snapshot = serde_json::to_value(runtime.tick_with_input(&pointer(width, height, x, y)).unwrap()).unwrap();
    (serde_json::to_value(runtime.semantic_observations()).unwrap(), snapshot)
}

fn close(a: &Value, b: f64) -> bool { (a.as_f64().unwrap() - b).abs() < 1e-9 }

#[test]
fn design_pixels_fit_the_design_size_and_extend_the_longer_side() {
    // A wide window: the height fits 720 design pixels, the width extends past 1280.
    let (seen, snapshot) = run(json!({"width": 1280, "height": 720, "pixels": "design"}), 1882, 1242, 941.0, 621.0);
    let scale = 1882.0 / 1280.0; // nominal: the width is the limit here
    assert_eq!((seen["view"]["width"].as_u64(), seen["view"]["height"].as_u64()), (Some(1280), Some(845)), "{seen}");
    assert!(close(&seen["view"]["scale"], scale) && close(&seen["view"]["aspect"], 1280.0 / 845.0));
    // The point and its viewport in design pixels (the exact per-axis mapping of the buffer onto 1280x845), inside
    // recomputed; the page's rect stays.
    let point = &seen["point"];
    assert!(close(&point["x"], 941.0 * 1280.0 / 1882.0) && close(&point["y"], 621.0 * 845.0 / 1242.0), "{point}");
    assert_eq!((point["viewport"]["width"].as_u64(), point["viewport"]["height"].as_u64(), point["inside"].as_bool()), (Some(1280), Some(845), Some(true)));
    assert_eq!(point["viewport"]["css_width"].as_f64(), Some(1882.0));
    assert_eq!((seen["viewport_event"]["width"].as_u64(), seen["viewport_event"]["height"].as_u64()), (Some(1280), Some(845)));
    // The scissor the game gave in design pixels reaches the host in physical pixels, outward.
    let scissor = &snapshot["projected_geometry"]["hud"]["scissor"];
    assert_eq!(scissor, &json!({"x": 0, "y": 0, "width": 941, "height": 530}), "{snapshot}");

    // A tall window: the width fits 1280, the height extends.
    let (seen, _) = run(json!({"width": 1280, "height": 720, "pixels": "design"}), 900, 1600, 450.0, 1599.0);
    assert_eq!((seen["view"]["width"].as_u64(), seen["view"]["height"].as_u64()), (Some(1280), Some(2276)), "{seen}");
    assert_eq!(seen["point"]["inside"].as_bool(), Some(true));
    // At the design size nothing changes.
    let (seen, snapshot) = run(json!({"width": 1280, "height": 720, "pixels": "design"}), 1280, 720, 10.5, 20.25);
    assert_eq!((seen["view"]["width"].as_u64(), seen["view"]["height"].as_u64(), seen["view"]["scale"].as_f64()), (Some(1280), Some(720), Some(1.0)));
    assert!(close(&seen["point"]["x"], 10.5) && close(&seen["point"]["y"], 20.25));
    assert_eq!(snapshot["projected_geometry"]["hud"]["scissor"], json!({"x": 0, "y": 0, "width": 640, "height": 360}));
}

#[test]
fn the_whole_buffer_maps_onto_the_viewport_exactly() {
    // 3840x2161 is 1280x720 at 3 (2161/3 is 720.33): the last physical row still lands inside the viewport.
    let (seen, _) = run(json!({"width": 1280, "height": 720, "pixels": "design"}), 3840, 2161, 3839.5, 2160.5);
    assert_eq!((seen["view"]["width"].as_u64(), seen["view"]["height"].as_u64()), (Some(1280), Some(720)));
    assert_eq!(seen["point"]["inside"].as_bool(), Some(true), "{seen}");
    assert!(seen["point"]["y"].as_f64().unwrap() < 720.0);
    // 896x504 is 1280x720 at 0.7: design row 90 starts on physical row 63 exactly (not 62 by a float rounding).
    let dir = tempdir().unwrap();
    project(dir.path(), json!({"width": 1280, "height": 720, "pixels": "design"}));
    fs::write(dir.path().join("scripts/main.luau"), SCRIPT.replace("scissor = {x = 0, y = 0, width = 640, height = 360}", "scissor = {x = 10, y = 90, width = 100, height = 100}")).unwrap();
    let mut runtime = EngineRuntime::load_with_seed(dir.path(), 1).unwrap();
    runtime.set_viewport_size(896, 504).unwrap();
    let snapshot = serde_json::to_value(runtime.tick_with_input(&InputFrame::default()).unwrap()).unwrap();
    assert_eq!(snapshot["projected_geometry"]["hud"]["scissor"], json!({"x": 7, "y": 63, "width": 70, "height": 70}));
}

#[test]
fn an_undeclared_pixel_unit_is_not_written_back() {
    let display: unone_engine::DisplayConfig = serde_json::from_value(json!({"width": 1280, "height": 720})).unwrap();
    assert_eq!(display.pixels, unone_engine::PixelUnit::Device);
    assert_eq!(serde_json::to_value(display).unwrap(), json!({"width": 1280, "height": 720, "aspect": "expand"}), "a runtime without the field still loads it");
    let design: unone_engine::DisplayConfig = serde_json::from_value(json!({"width": 1280, "height": 720, "pixels": "design"})).unwrap();
    assert_eq!(serde_json::to_value(design).unwrap()["pixels"], "design");
}

#[test]
fn device_pixels_are_the_drawing_buffer() {
    for display in [json!({"width": 1280, "height": 720}), json!({"width": 1280, "height": 720, "pixels": "device"})] {
        let (seen, snapshot) = run(display, 1882, 1242, 941.0, 621.0);
        assert_eq!((seen["view"]["width"].as_u64(), seen["view"]["height"].as_u64(), seen["view"]["scale"].as_f64()), (Some(1882), Some(1242), Some(1.0)));
        assert!(close(&seen["point"]["x"], 941.0));
        assert_eq!(snapshot["projected_geometry"]["hud"]["scissor"], json!({"x": 0, "y": 0, "width": 640, "height": 360}));
    }
}

#[test]
fn an_unknown_pixel_unit_is_refused() {
    let dir = tempdir().unwrap();
    project(dir.path(), json!({"width": 1280, "height": 720, "pixels": "css"}));
    let checked = EngineRuntime::check(dir.path());
    assert!(!checked.ok);
    assert_eq!(checked.diagnostics[0].code, "PROJECT_CONFIG_INVALID");
}
