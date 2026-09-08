use serde_json::json;
use unone_engine::HostProject;

#[test]
fn lua_batch_copies_buffer_and_rejects_invalid_calls_atomically() {
    let script = r#"local G={}
function G.start(api)
 local b=buffer.create(24);buffer.writef32(b,12,10)
 local h=api.particle.play_batch("spark",b,42)
 buffer.writef32(b,12,900)
 for _,n in ipairs({0,11,13,49164}) do
  assert(not pcall(function() api.particle.play_batch("spark",buffer.create(n)) end))
 end
 assert(not pcall(function() api.particle.play_batch("missing",b) end))
 assert(api.particle.stats().active_handles==1)
 api.observation.set("handle",h)
end
function G.update(api,dt) end
return G"#;
    let definition: serde_json::Value=serde_json::from_str(include_str!("../../../tests/fixtures/spark.particle.json")).unwrap();
    let payload=json!({"config":{"name":"particle-batch-test","entry_script":"main.luau"},"script":script,"scene":{"entities":[],"particle_effects":{"spark":definition}}});
    let mut runtime=HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
    let snapshot=runtime.tick().unwrap();
    assert!(!snapshot.particles.is_empty());
    assert!(snapshot.particles.iter().all(|p|p.position.x<100.));
    let mut second=HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
    assert_eq!(unone_engine::observation_digest(&snapshot).unwrap(),unone_engine::observation_digest(&second.tick().unwrap()).unwrap());
}
