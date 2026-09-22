use serde_json::json;
use unone_engine::HostProject;

#[test]
fn luau_can_follow_a_moving_emitter_and_finish_its_trail() {
    let script = r#"local Game={}
function Game.start(api)
 local handle=api.particle.play("trail",{x=0,y=0,z=0},42)
 assert(api.particle.move(handle,{x=5,y=0,z=0}))
 assert(api.particle.finish(handle))
 assert(not api.particle.move("unknown",{x=0,y=0,z=0}))
 api.observation.set("handle",handle)
end
function Game.update(api,dt) end
return Game"#;
    let mut definition: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/spark.particle.json")).unwrap();
    definition["duration_frames"] = json!(12);
    definition["emitters"][0]["count"] = json!(1);
    definition["emitters"][0]["lifetime_frames"] = json!(3);
    definition["emitters"][0]["spread"] = json!({"x":0,"y":0,"z":0});
    definition["emitters"][0]["velocity_min"] = json!({"x":0,"y":0,"z":0});
    definition["emitters"][0]["velocity_max"] = json!({"x":0,"y":0,"z":0});
    definition["emitters"][0]["gravity"] = json!({"x":0,"y":0,"z":0});
    let payload = json!({
        "config":{"name":"particle-follow-test","entry_script":"main.luau"},
        "script":script,
        "scene":{"entities":[],"particle_effects":{"trail":definition}}
    });
    let mut runtime = HostProject::parse(&serde_json::to_vec(&payload).unwrap())
        .unwrap()
        .into_runtime(42)
        .unwrap();
    let first = runtime.tick().unwrap();
    assert_eq!(first.particles.len(), 1);
    assert_eq!(first.particles[0].position.x, 5.0);
    assert_eq!(runtime.tick().unwrap().particles.len(), 1);
    assert!(runtime.tick().unwrap().particles.is_empty());
}
