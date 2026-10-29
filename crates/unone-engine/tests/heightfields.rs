use serde_json::json;
use unone_engine::{Heightfield, HeightfieldDefinition, HeightfieldPatch, HostProject, Vec3};

fn definition() -> HeightfieldDefinition {
    HeightfieldDefinition {
        width: 3, depth: 2, heights: vec![0., 1., 2., 3., 4., 5.], cell_size: 2.,
        origin: Vec3 { x: 10., y: 20., z: -30. }, texture: "texture://ground".into(),
    }
}

#[test]
fn heightfield_mesh_has_exact_samples_uvs_and_upward_triangles() {
    let field = Heightfield::new(definition()).unwrap();
    let mesh = field.mesh();
    mesh.validate().unwrap();
    assert_eq!(mesh.positions, vec![0.,0.,0., 2.,1.,0., 4.,2.,0., 0.,3.,2., 2.,4.,2., 4.,5.,2.]);
    assert_eq!(mesh.uvs, vec![0.,0., 0.5,0., 1.,0., 0.,1., 0.5,1., 1.,1.]);
    assert_eq!(mesh.indices, vec![0,3,1, 1,3,4, 1,4,2, 2,4,5]);
    assert_eq!(field.definition().origin.y, 20.); // Origin is applied by the renderer.
    for triangle in mesh.indices.chunks_exact(3) {
        let p = |index: u32| &mesh.positions[index as usize * 3..index as usize * 3 + 3];
        let (a,b,c) = (p(triangle[0]),p(triangle[1]),p(triangle[2]));
        let normal_y = (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
        assert!(normal_y > 0.);
    }
}

#[test]
fn heightfield_patch_is_atomic_and_noop_keeps_revision() {
    let mut field = Heightfield::new(definition()).unwrap();
    let before = serde_json::to_value(&field).unwrap();
    let bad = HeightfieldPatch {x:1,z:0,width:2,depth:2,heights:vec![1.,2.,4.,f32::NAN]};
    assert!(field.update(bad).is_err());
    assert_eq!(serde_json::to_value(&field).unwrap(), before);
    field.update(HeightfieldPatch {x:1,z:0,width:2,depth:2,heights:vec![1.,2.,4.,5.]}).unwrap();
    assert_eq!(field.revision(),1);
    field.update(HeightfieldPatch {x:1,z:0,width:2,depth:2,heights:vec![7.,8.,9.,10.]}).unwrap();
    assert_eq!(field.revision(),2);
    assert_eq!(field.definition().heights,vec![0.,7.,8.,3.,9.,10.]);
    assert!(field.update(HeightfieldPatch {x:u32::MAX,z:0,width:2,depth:1,heights:vec![0.,0.]}).is_err());
}

#[test]
fn heightfield_rejects_bad_dimensions_extent_and_unknown_fields() {
    for change in ["side","count","cell","origin","extent","height","texture"] {
        let mut d = definition();
        match change {
            "side" => d.width = u32::MAX,
            "count" => d.heights.pop().map(|_| ()).unwrap(),
            "cell" => d.cell_size = 0.,
            "origin" => d.origin.x = f64::INFINITY,
            "extent" => d.origin.x = 99_999.,
            "height" => d.heights[0] = f32::INFINITY,
            "texture" => d.texture.clear(),
            _ => unreachable!(),
        }
        assert!(Heightfield::new(d).is_err(),"{change}");
    }
    let mut value = serde_json::to_value(definition()).unwrap();
    value["typo"] = json!(1);
    assert!(serde_json::from_value::<HeightfieldDefinition>(value).is_err());
    let max = HeightfieldDefinition {width:512,depth:512,heights:vec![0.;512*512],cell_size:1.,origin:Vec3::default(),texture:"texture://ground".into()};
    assert!(Heightfield::new(max).is_ok());
}

fn runtime(script: &str) -> unone_engine::EngineRuntime {
    HostProject::parse(&serde_json::to_vec(&json!({
        "config":{"name":"heightfield-test","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false}},
        "script":script,"scene":{"entities":[]}
    })).unwrap()).unwrap().into_runtime(42).unwrap()
}

#[test]
fn heightfield_luau_lifecycle_and_digest_observe_geometry() {
    let mut game = runtime(r#"
local d={width=2,depth=2,heights={0,1,2,3},cell_size=1,origin={x=0,y=0,z=0},texture="texture://ground"}
local frame=0
return {start=function(api)
 api.heightfield.set("ground",d)
 assert(not pcall(api.heightfield.update,"ground",{x=1,z=1,width=2,depth=1,heights={5,6}}))
end,update=function(api)
 frame+=1
 if frame==1 then api.heightfield.set("ground",d)
 elseif frame==2 then api.heightfield.update("ground",{x=1,z=0,width=1,depth=1,heights={9}})
 elseif frame==3 then api.heightfield.remove("ground");api.heightfield.set("ground",d)
 else api.heightfield.remove("ground");assert(not pcall(api.heightfield.remove,"ground")) end
end}
"#);
    let first = game.observe().heightfields["ground"].clone();
    assert_eq!(first.revision(),1);
    assert_eq!(game.tick().unwrap().heightfields["ground"].revision(),1);
    let edited = game.tick().unwrap();
    assert_eq!(edited.heightfields["ground"].definition().heights,vec![0.,9.,2.,3.]);
    assert_eq!(edited.heightfields["ground"].revision(),2);
    assert_ne!(serde_json::to_value(first).unwrap(),serde_json::to_value(&edited.heightfields["ground"]).unwrap());
    assert_eq!(game.tick().unwrap().heightfields["ground"].revision(),3); // remove+create cannot reuse renderer cache revision.
    assert!(!serde_json::to_value(game.tick().unwrap()).unwrap().as_object().unwrap().contains_key("heightfields"));
    let a=runtime("return {start=function(api) api.heightfield.set('x',{width=2,depth=2,heights={0,0,0,0},cell_size=1,origin={x=0,y=0,z=0},texture='t'}) end,update=function()end}");
    let b=runtime("return {start=function(api) api.heightfield.set('x',{width=2,depth=2,heights={0,0,1,0},cell_size=1,origin={x=0,y=0,z=0},texture='t'}) end,update=function()end}");
    assert_ne!(unone_engine::observation_digest(&a.observe()).unwrap(),unone_engine::observation_digest(&b.observe()).unwrap());
}

#[test]
fn heightfield_world_limits_fail_without_partial_replacement() {
    let game = runtime(r#"
return {start=function(api)
 local d={width=2,depth=2,heights={0,0,0,0},cell_size=1,origin={x=0,y=0,z=0},texture='t'}
 for i=1,16 do api.heightfield.set(tostring(i),d) end
 assert(not pcall(api.heightfield.set,'17',d))
 local large=table.clone(d);large.width=512;large.depth=512;large.heights=table.create(512*512,0)
 for i=1,3 do api.heightfield.set(tostring(i),large) end
 assert(not pcall(api.heightfield.set,'4',large)) -- Other small fields still consume samples.
 assert(not pcall(api.heightfield.update,'missing',{x=0,z=0,width=1,depth=1,heights={0}}))
end,update=function()end}
"#);
    assert_eq!(game.observe().heightfields.len(),16);
    assert_eq!(game.observe().heightfields["4"].definition().width,2);
}
