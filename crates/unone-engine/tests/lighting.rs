use unone_engine::{EngineRuntime, HostProject};

fn host(lighting: serde_json::Value, start: &str) -> Result<EngineRuntime, String> {
    let mut scene = serde_json::json!({
        "camera": {"projection": "perspective", "position": {"x": 0, "y": 4, "z": 8}, "target": {"x": 0, "y": 0, "z": 0}},
        "entities": []
    });
    if !lighting.is_null() {
        scene["lighting"] = lighting;
    }
    let payload = serde_json::json!({
        "config": {"name": "lighting", "entry_script": "main.luau", "systems": {"camera3d": true}},
        "scene": scene,
        "script": format!("return {{start=function(api)\n{start}\nend, update=function() end}}"),
    });
    HostProject::parse(payload.to_string().as_bytes())
        .and_then(|project| project.into_runtime(42))
        .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))
}

#[test]
fn scene_lighting_is_published_and_replaced_through_the_api() {
    let runtime = host(
        serde_json::json!({"sun": {"direction": {"x": -1, "y": -2, "z": 0}, "shadows": {"distance": 12}}}),
        r##"
        local light = api.lighting.get()
        api.observation.set("start", light.ambient.intensity .. ":" .. light.sun.shadows.size .. ":" .. light.sun.shadows.distance)
        light.points = {{position = {x = 0, y = 2, z = 0}, color = "#ffaa44", range = 6}}
        light.sun.intensity = 0.5
        api.lighting.set(light)
        "##,
    )
    .unwrap();
    assert_eq!(runtime.semantic_observations()["start"], "0.3:2048:12", "defaults are filled in");
    let lighting = serde_json::to_value(runtime.observe()).unwrap()["lighting"].clone();
    assert_eq!(lighting["sun"]["intensity"], 0.5);
    assert_eq!(lighting["points"][0], serde_json::json!({"position": {"x": 0.0, "y": 2.0, "z": 0.0}, "color": "#ffaa44", "intensity": 1.0, "range": 6.0}));
}

#[test]
fn an_unlit_scene_has_no_lighting_and_nil_turns_it_off() {
    let runtime = host(serde_json::Value::Null, r#"
        api.observation.set("unlit", api.lighting.get() == nil)
        api.lighting.set({ambient = {intensity = 1}})
        api.lighting.set(nil)
    "#)
    .unwrap();
    assert_eq!(runtime.semantic_observations()["unlit"], true);
    assert!(serde_json::to_value(runtime.observe()).unwrap().get("lighting").is_none(), "unlit games keep their snapshot bytes");
}

#[test]
fn invalid_lighting_fails_with_the_field_and_keeps_the_old_value() {
    let error = host(serde_json::json!({"sun": {"direction": {"x": 0, "y": 0, "z": 0}}}), "").err().unwrap();
    assert!(error.starts_with("SCENE_LIGHTING_INVALID") && error.contains("must not be zero"), "{error}");
    let runtime = host(serde_json::json!({"ambient": {"intensity": 0.5}}), r#"
        local errors = {}
        for _, value in {
            {ambient = {intensity = 99}},
            {sun = {direction = {x = 0, y = -1, z = 0}, shadows = {size = 100}}},
            {glow = true},
        } do
            local ok, err = pcall(api.lighting.set, value)
            assert(not ok)
            table.insert(errors, tostring(err))
        end
        api.observation.set("errors", table.concat(errors, "\n"))
    "#)
    .unwrap();
    let errors = runtime.semantic_observations()["errors"].as_str().unwrap().to_string();
    for expected in ["ambient.intensity", "shadows.size", "unknown field"] {
        assert!(errors.contains(expected) && errors.contains("LIGHTING_INVALID"), "expected {expected} in {errors}");
    }
    let lighting = serde_json::to_value(runtime.observe()).unwrap()["lighting"].clone();
    assert_eq!(lighting["ambient"]["intensity"], 0.5, "a rejected change leaves the lighting as it was");
}
