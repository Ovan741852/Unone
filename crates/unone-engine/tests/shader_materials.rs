use serde_json::json;
use unone_engine::{HostProject, ShaderUniform};

fn project(script: &str) -> serde_json::Value {
    json!({
        "config":{"name":"shader-api","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false,"camera3d":false}},
        "script":script,
        "scene":{
            "entities":[{"id":"ship","sprite":{"asset":"image://ship"}},{"id":"plain"}],
            "shader_materials":{"shield":{
                "fragment":"vec4 unoneShade(vec2 uv, vec4 color){return color*strength;}",
                "uniforms":{"strength":0.5,"tint":[1,0.5,0.25]}
            }}
        }
    })
}

#[test]
fn luau_assigns_updates_and_clears_declarative_materials() {
    let payload = project(
        r#"local G={}
function G.start(api)
 api.shader.setMaterial("ship","shield")
 api.shader.setUniform("shield","strength",0.75)
 api.shader.setUniform("shield","tint",{0.2,0.4,0.6})
 for _,call in ipairs({
  function() api.shader.setUniform("shield","strength",{1,2}) end,
  function() api.shader.setUniform("shield","missing",1) end,
  function() api.shader.setUniform("shield","strength",0/0) end,
  function() api.shader.setUniform("shield","strength",1e100) end,
  function() api.shader.setMaterial("plain","shield") end,
  function() api.shader.setMaterial("ship","unknown") end,
 }) do assert(not pcall(call)) end
end
function G.update(api,dt) api.shader.clearMaterial("ship") end
return G"#,
    );
    let mut runtime = HostProject::parse(&serde_json::to_vec(&payload).unwrap())
        .unwrap()
        .into_runtime(42)
        .unwrap();
    let first = runtime.observe();
    assert_eq!(
        first.entities["ship"].shader_material.as_deref(),
        Some("shield")
    );
    assert_eq!(
        first.shader_materials["shield"].uniforms["strength"],
        ShaderUniform::Float(0.75)
    );
    assert_eq!(
        first.shader_materials["shield"].uniforms["tint"],
        ShaderUniform::Vec3([0.2, 0.4, 0.6])
    );
    assert!(
        runtime.tick().unwrap().entities["ship"]
            .shader_material
            .is_none()
    );
}

#[test]
fn invalid_shader_resources_and_references_fail_before_game_start() {
    let base =
        project("return {start=function(api) error('must not start') end,update=function() end}");
    for (key, value) in [
        ("unone_time", json!(1)),
        ("gl_color", json!(1)),
        ("bad-name", json!(1)),
        ("good", json!([1, 2, 3, 4, 5])),
    ] {
        let mut payload = base.clone();
        payload["scene"]["shader_materials"]["shield"]["uniforms"] = json!({key:value});
        let result = HostProject::parse(&serde_json::to_vec(&payload).unwrap())
            .and_then(|p| p.into_runtime(1));
        let error=result.err().expect("invalid uniform must fail before game.start");
        assert!(error.code.starts_with("SHADER_") || error.code == "SCENE_INVALID" || error.explanation.contains("SHADER_"), "invalid uniform {key}: {error:?}");
    }
    let mut payload = base.clone();
    payload["scene"]["entities"][0]["shader_material"] = json!("missing");
    let error = HostProject::parse(&serde_json::to_vec(&payload).unwrap())
        .and_then(|p| p.into_runtime(1))
        .err()
        .expect("invalid reference must fail");
    assert!(error.explanation.contains("shader") || error.code.contains("SHADER"));
    let mut payload = base;
    payload["scene"]["shader_materials"]["shield"]["fragment"] =
        json!("#version 300 es\nvec4 unoneShade(vec2 uv,vec4 color){return color;}");
    assert!(
        HostProject::parse(&serde_json::to_vec(&payload).unwrap())
            .and_then(|p| p.into_runtime(1))
            .is_err()
    );
}

#[test]
fn shader_data_round_trips_through_the_scene_contract() {
    let scene =
        unone_engine::parse_scene_fragment(&project("return {}")["scene"].to_string()).unwrap();
    let encoded = serde_json::to_string(&scene).unwrap();
    let decoded = unone_engine::parse_scene_fragment(&encoded).unwrap();
    assert_eq!(scene.shader_materials, decoded.shader_materials);
}
