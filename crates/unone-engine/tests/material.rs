use serde_json::json;
use unone_engine::{EngineRuntime, HostProject};

fn host(scene: serde_json::Value, start: &str) -> Result<EngineRuntime, String> {
    let payload = json!({
        "config": {"name": "materials", "entry_script": "main.luau", "systems": {"camera3d": true}},
        "scene": scene,
        "script": format!("return {{start=function(api)\n{start}\nend, update=function() end}}"),
    });
    HostProject::parse(payload.to_string().as_bytes())
        .and_then(|project| project.into_runtime(42))
        .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))
}

fn scene(extra: serde_json::Value) -> serde_json::Value {
    let mut scene = json!({
        "camera": {"projection": "perspective", "position": {"x": 0, "y": 4, "z": 8}, "target": {"x": 0, "y": 0, "z": 0}},
        "materials": {"steel": {"metallic": 1, "roughness": 0.4}},
        "lighting": {"hemisphere": {"sky": "#a0c0ff"}},
        "entities": [{"id": "box", "transform3d": {"position": {"x": 0, "y": 0, "z": 0}}, "mesh3d": {"asset": "mesh://primitive/box", "material": "steel"}}]
    });
    scene.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    scene
}

#[test]
fn materials_are_declared_set_spawned_and_published() {
    let runtime = host(scene(json!({})), r##"
        api.material.set("glow", {color = "#202020", emissive = "#ff8800", emissive_intensity = 3})
        local steel = api.material.get("steel")
        api.observation.set("steel", steel.color .. ":" .. steel.metallic .. ":" .. steel.roughness)
        api.observation.set("missing", api.material.get("glass") == nil)
        api.entity.spawn("lamp", {mesh3d = {asset = "mesh://primitive/sphere", material = "glow"}, transform3d = {position = {x = 1, y = 0, z = 0}}})
        local ok, err = pcall(api.entity.spawn, "ghost", {mesh3d = {asset = "mesh://primitive/box", material = "glass"}, transform3d = {position = {x = 0, y = 0, z = 0}}})
        api.observation.set("unknown", tostring(err))
    "##).unwrap();
    let observations = runtime.semantic_observations();
    assert_eq!(observations["steel"], "#ffffff:1:0.4", "defaults are filled in");
    assert_eq!(observations["missing"], true);
    assert!(observations["unknown"].as_str().unwrap().contains("MATERIAL_UNKNOWN"));
    let snapshot = serde_json::to_value(runtime.observe()).unwrap();
    assert_eq!(snapshot["materials"]["glow"]["emissive_intensity"], 3.0);
    assert_eq!(snapshot["lighting"]["hemisphere"], json!({"sky": "#a0c0ff", "ground": "#444444", "intensity": 0.5}));
    let lamp = snapshot["entities"].as_object().unwrap().values().find(|entity| entity["name"] == "lamp").unwrap();
    assert_eq!(lamp["mesh3d"]["material"], "glow");
}

#[test]
fn unknown_or_invalid_materials_fail_with_the_reason() {
    let error = host(scene(json!({"materials": {}})), "").err().unwrap();
    assert!(error.starts_with("SCENE_MATERIAL_INVALID") && error.contains("steel"), "{error}");
    let error = host(scene(json!({"materials": {"steel": {"roughness": 3}}})), "").err().unwrap();
    assert!(error.starts_with("SCENE_MATERIAL_INVALID") && error.contains("roughness"), "{error}");
    let runtime = host(scene(json!({})), r#"
        local ok, err = pcall(api.material.set, "steel", {metallic = 2})
        api.observation.set("err", tostring(err))
    "#).unwrap();
    assert!(runtime.semantic_observations()["err"].as_str().unwrap().contains("MATERIAL_INVALID"));
    assert_eq!(serde_json::to_value(runtime.observe()).unwrap()["materials"]["steel"]["metallic"], 1.0, "a rejected set keeps the old value");
}
