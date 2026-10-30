use unone_engine::EngineRuntime;

fn game(source: &str) -> EngineRuntime {
    EngineRuntime::load_source("entity-assembly", "main.luau", source, None).unwrap()
}

fn failure(call: &str) -> String {
    let runtime = game(&format!(
        r#"
return {{start=function(api)
    local ok, err = pcall(function() {call} end)
    assert(not ok, "expected a failure")
    api.observation.set("error", tostring(err))
end, update=function() end}}
"#
    ));
    assert!(runtime.observe().entities.is_empty(), "a failed spawn must create nothing");
    runtime.semantic_observations()["error"].as_str().unwrap().to_string()
}

#[test]
fn spawn_assembles_rendered_and_physical_objects_like_scene_entities() {
    let mut runtime = game(
        r#"
return {start=function(api)
    api.entity.spawn("fish", {transform={x=-8,y=2}, rotation=0.5,
        sprite={asset="texture://fish/red", size={x=1.5,y=1}, layer=2},
        rigidbody={velocity={x=3,y=0}}})
    api.entity.spawn("fish", {mesh3d={asset="mesh://fish"}, transform3d={position={x=1,y=2,z=3}, rotation={x=0,y=0,z=0}, scale={x=1,y=1,z=1}}})
    api.entity.spawn("bare")
    api.entity.spawn("empty", {})
end, update=function() end}
"#,
    );
    let start = runtime.observe();
    let fish = &start.entities["fish"];
    let sprite = fish.sprite.as_ref().unwrap();
    assert_eq!((sprite.asset.as_str(), sprite.size.x, sprite.layer, sprite.visible), ("texture://fish/red", 1.5, 2, true));
    assert_eq!((fish.transform.x, fish.rotation), (-8.0, 0.5));
    assert_eq!(start.entities["fish_2"].mesh3d.as_ref().unwrap().asset, "mesh://fish");
    assert_eq!(start.entities["fish_2"].transform3d.as_ref().unwrap().position.z, 3.0);
    assert!(start.entities["bare"].sprite.is_none() && start.entities["empty"].sprite.is_none());
    for _ in 0..30 {
        runtime.tick().unwrap();
    }
    assert!(runtime.observe().entities["fish"].transform.x > -8.0, "a spawned dynamic body is stepped");
}

#[test]
fn spawn_rejects_typos_reserved_fields_and_invalid_values_without_creating() {
    assert!(failure(r#"api.entity.spawn("fish", {sprit={asset="a"}})"#).contains("ENTITY_COMPONENTS_INVALID"));
    assert!(failure(r#"api.entity.spawn("fish", {sprite={asset="a", Size={x=1,y=1}}})"#).contains("unknown field"));
    assert!(failure(r#"api.entity.spawn("fish", {id="fish_1"})"#).contains("assigned by entity.spawn"));
    assert!(failure(r#"api.entity.spawn("fish", {sprite={asset="a", size={x=0,y=1}}})"#).contains("SCENE_SPRITE_INVALID"));
    assert!(failure(r#"api.entity.spawn("fish", {rigidbody={mass=-1}})"#).contains("SCENE_PHYSICS_INVALID"));
    assert!(failure(r#"api.entity.spawn("fish", {sprite={asset="a"}, shader_material="glow"})"#).contains("SHADER_MATERIAL_REFERENCE_INVALID"));
    assert!(failure(r#"api.entity.spawn("fish", {transform={x=0/0,y=0}})"#).len() > 0);
}

#[test]
fn set_sprite_swaps_or_removes_the_sprite_and_validates_it() {
    let runtime = game(
        r#"
return {start=function(api)
    local fish = api.entity.spawn("fish", {sprite={asset="texture://fish/red", layer=2}})
    api.entity.setSprite(fish, {asset="texture://fish/gold", size={x=2,y=1}, layer=3})
    local bare = api.entity.spawn("bare")
    api.entity.setSprite(bare, {asset="texture://coin"})
    local gone = api.entity.spawn("gone", {sprite={asset="texture://x"}})
    api.entity.setSprite(gone, nil)
    for _, call in {function() api.entity.setSprite(fish, {asset="a", layr=1}) end,
        function() api.entity.setSprite(fish, {asset="a", size={x=-1,y=1}}) end,
        function() api.entity.setSprite("missing", {asset="a"}) end} do
        local ok, err = pcall(call)
        assert(not ok)
        api.observation.set("last_error", tostring(err))
    end
end, update=function() end}
"#,
    );
    let world = runtime.observe();
    let gold = world.entities["fish"].sprite.as_ref().unwrap();
    assert_eq!((gold.asset.as_str(), gold.size.x, gold.layer), ("texture://fish/gold", 2.0, 3));
    assert_eq!(world.entities["bare"].sprite.as_ref().unwrap().asset, "texture://coin");
    assert!(world.entities["gone"].sprite.is_none());
    assert!(runtime.semantic_observations()["last_error"].as_str().unwrap().contains("Entity 'missing' does not exist."));
}
