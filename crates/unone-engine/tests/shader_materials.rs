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

#[test]
fn meshes_take_a_vertex_stage_material_and_its_declared_vertex_layout() {
    let payload = json!({
        "config":{"name":"mesh-shader","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false}},
        "script":r#"local G={}
local function triangle(floats)
 local v=buffer.create(3*floats*4)
 for i=0,2 do
  local o=i*floats*4
  buffer.writef32(v,o,i);buffer.writef32(v,o+8,i%2)
  for c=0,3 do buffer.writef32(v,o+20+c*4,1) end
  for a=9,floats-1 do buffer.writef32(v,o+a*4,-70000+i) end
 end
 local ix=buffer.create(12);for i=0,2 do buffer.writeu32(ix,i*4,i) end
 return v,ix
end
function G.start(api)
 local v,ix=triangle(13)
 api.geometry3d.set("land",{vertices=v,indices=ix,material={shader="exact",blend="cutout"}})
 api.shader.setUniform("exact","zoom",40786)
 -- The layout comes from the material: plain 36-byte vertices do not fit it.
 local plain,pix=triangle(9)
 assert(not pcall(api.geometry3d.set,"land",{vertices=plain,indices=pix,material={shader="exact"}}))
 assert(not pcall(api.geometry3d.set,"other",{vertices=v,indices=ix,material={shader="missing"}}))
 assert(not pcall(api.shader.setMaterial,"ship","exact"))
 local texels=buffer.create(16);for i=0,3 do buffer.writei32(texels,i*4,-1000*i) end
 api.texture.set("heights",{width=2,height=2,format="r32i",data=texels})
 api.shader.setTexture("exact","heights",{data="heights"})
 assert(not pcall(api.shader.setTexture,"exact","heights",{data="missing"}))
 assert(not pcall(api.shader.setTexture,"exact","heights",{bad="x"}))
 assert(not pcall(api.texture.set,"bad",{width=2,height=2,format="r16",data=texels}))
 assert(not pcall(api.texture.remove,"heights"))
end
function G.update(api,dt) end
return G"#,
        "scene":{
            "entities":[{"id":"ship","sprite":{"asset":"image://ship"}}],
            "shader_materials":{"exact":{
                "vertex":"vec4 unoneVertex(vec3 position, mat4 model){shade=vec4(cell.z);return vec4(cell.xy*zoom,0.0,1.0);}",
                "fragment":"vec4 unoneShade(vec2 uv, vec4 color){return color*shade;}",
                "uniforms":{"zoom":1.0},
                "attributes":[{"name":"cell","size":3},{"name":"corner","size":1}],
                "varyings":[{"name":"shade","size":4,"interpolation":"flat"}],
                "samplers":{"heights":{"type":"int"}}
            }}
        }
    });
    let mut runtime = HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
    runtime.tick_with_input(&Default::default()).unwrap();
    let json = serde_json::to_value(runtime.observe()).unwrap();
    let land = &json["geometry3d"]["land"];
    assert_eq!((land["format"].as_str(), land["vertex_count"].as_u64()), (Some("f32le-p3-uv2-rgba4-attr-u32-v1"), Some(3)));
    assert_eq!((land["material"]["shader"].as_str(), land["material"]["blend"].as_str()), (Some("exact"), Some("cutout")));
    let exact = &json["shader_materials"]["exact"];
    assert_eq!(exact["uniforms"]["zoom"], 40786.0);
    assert_eq!(exact["attributes"][1], json!({"name":"corner","size":1}));
    assert_eq!(exact["varyings"][0]["interpolation"], "flat");
    assert_eq!(exact["samplers"]["heights"], json!({"type":"int","source":{"data":"heights"}}));
    assert_eq!(json["data_textures"]["heights"], json!({"width":2,"height":2,"format":"r32i","revision":1}));
    // A sprite entity cannot be declared with a vertex-stage material either.
    let mut sprite = payload.clone();
    sprite["scene"]["entities"][0]["shader_material"] = json!("exact");
    let error = HostProject::parse(&serde_json::to_vec(&sprite).unwrap()).and_then(|p| p.into_runtime(42).map(|_| ()));
    assert!(format!("{error:?}").contains("SHADER_MATERIAL_REFERENCE_INVALID"), "{error:?}");
}
