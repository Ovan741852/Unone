use unone_engine::EngineRuntime;

#[test]
fn alpha_compare_is_atomic_default_compatible_and_revision_sensitive() {
    let script=format!(r#"{FIXTURE}
local turn=0
return {{start=function(api) api.projected.set('tri',d) end,update=function(api)
 turn+=1
 if turn==1 then d.alpha_compare='greater_equal'
 elseif turn==2 then d.alpha_compare='greater'
 elseif turn==4 then d.alpha_compare=nil end
 api.projected.set('tri',d)
 for _,bad in {{'less','Greater','',false,1,{{}}}} do
  local invalid=table.clone(d);invalid.alpha_compare=bad
  assert(not pcall(api.projected.set,'tri',invalid))
 end
end}}"#);
    let mut runtime=game(&script);
    let initial=serde_json::to_value(runtime.observe()).unwrap();
    assert!(initial["projected_geometry"]["tri"].get("alpha_compare").is_none());
    runtime.tick().unwrap();let explicit=serde_json::to_value(runtime.observe()).unwrap();
    assert_eq!(initial["projected_geometry"],explicit["projected_geometry"]);
    runtime.tick().unwrap();let strict=serde_json::to_value(runtime.observe()).unwrap();
    assert_eq!(strict["projected_geometry"]["tri"]["alpha_compare"],"greater");
    assert_eq!(strict["projected_geometry"]["tri"]["revision"],2);
    assert_eq!(strict["projected_geometry"]["tri"]["vertices"],initial["projected_geometry"]["tri"]["vertices"]);
    runtime.tick().unwrap();let repeat=serde_json::to_value(runtime.observe()).unwrap();
    assert_eq!(strict["projected_geometry"],repeat["projected_geometry"]);
    runtime.tick().unwrap();let restored=serde_json::to_value(runtime.observe()).unwrap();
    assert!(restored["projected_geometry"]["tri"].get("alpha_compare").is_none());
    assert_eq!(restored["projected_geometry"]["tri"]["revision"],3);
}

fn game(script: &str) -> EngineRuntime {
    EngineRuntime::load_source("projected-test", "main.luau", script, None).unwrap()
}

const FIXTURE: &str = r#"
local v=buffer.create(120)
for i=0,2 do
 local values={if i==0 then -0.5 else 0.5,if i==2 then 0.5 else -0.5,0.25,1,0,0,1,1,1,1}
 for j,x in values do buffer.writef32(v,i*40+(j-1)*4,x) end
end
local ix=buffer.create(12);buffer.writeu32(ix,4,1);buffer.writeu32(ix,8,2)
local d={texture='texture://test',vertices=v,indices=ix}
"#;

#[test]
fn packed_geometry_lifecycle_is_atomic_and_revision_is_non_consuming() {
    let script=format!(r#"{FIXTURE}
local turn=0
return {{start=function(api)
 api.projected.set('tri',d)
 buffer.writef32(v,0,0/0)
 assert(not pcall(api.projected.set,'tri',d))
 buffer.writef32(v,0,-0.5)
end,update=function(api)
 turn+=1
 if turn==1 then api.projected.set('tri',d)
 elseif turn==2 then api.projected.remove('tri');api.projected.set('tri',d)
 else api.projected.remove('tri');assert(not pcall(api.projected.remove,'tri')) end
end}}
"#);
    let mut runtime=game(&script);
    let json=|r:&EngineRuntime|serde_json::to_value(r.observe()).unwrap();
    let first=json(&runtime);let record=&first["projected_geometry"]["tri"];
    assert_eq!(record["vertex_count"],3);assert_eq!(record["index_count"],3);
    assert_eq!(record["format"],"f32le-clip4-uv2-rgba4-u32-v1");
    assert_eq!(record["revision"],1);
    assert_eq!(first,json(&runtime));
    runtime.tick().unwrap();assert_eq!(json(&runtime)["projected_geometry"]["tri"]["revision"],1);
    runtime.tick().unwrap();assert_eq!(json(&runtime)["projected_geometry"]["tri"]["revision"],2);
    runtime.tick().unwrap();assert!(json(&runtime).get("projected_geometry").is_none());
}

#[test]
fn packed_geometry_rejects_invalid_values_indices_and_unknown_options() {
    let script=format!(r#"{FIXTURE}
return {{start=function(api)
 api.projected.set('tri',d)
 for _,field in {{'typo','vertices','indices','texture','order','depth_test','depth_write'}} do
  local bad=table.clone(d)
  if field=='vertices' then bad.vertices=buffer.create(119)
  elseif field=='indices' then bad.indices=buffer.create(11)
  elseif field=='texture' then bad.texture=''
  elseif field=='order' then bad.order=0.5
  elseif field=='depth_test' or field=='depth_write' then bad[field]='yes'
  else bad[field]=1 end
  assert(not pcall(api.projected.set,'tri',bad),field)
 end
 for _,offset in {{0,12,24}} do
  local old=buffer.readf32(v,offset)
  buffer.writef32(v,offset,if offset==12 then 0 elseif offset==24 then 2 else math.huge)
  assert(not pcall(api.projected.set,'tri',d));buffer.writef32(v,offset,old)
 end
 buffer.writeu32(ix,0,3);assert(not pcall(api.projected.set,'tri',d))
 assert(not pcall(api.projected.set,'',d))
end,update=function()end}}
"#);
    let runtime=game(&script);
    let snapshot=serde_json::to_value(runtime.observe()).unwrap();
    assert_eq!(snapshot["projected_geometry"]["tri"]["revision"],1);
}

#[test]
fn viewport_has_pixel_dimensions_and_reading_never_advances_it() {
    let runtime=game("return {start=function(api) local a=api.projected.getViewport();local b=api.projected.getViewport();assert(a.width==1280 and a.height==720 and a.aspect==1280/720 and a.revision==b.revision) end,update=function()end}");
    assert_eq!(runtime.observe().frame,0);
}

#[test]
fn material_policy_defaults_and_updates_are_validated_atomically() {
    let script=format!(r#"{FIXTURE}
local turn=0
return {{start=function(api)
 api.projected.set('tri',d)
end,update=function(api)
 turn+=1
 if turn==1 then
  d.color_mode='encoded';d.filter='linear';d.sampling_space='encoded';d.address_mode='repeat';d.alpha_cutoff=127/255
  api.projected.set('tri',d)
  for _,entry in {{{{'color_mode','legacy'}},{{'filter','cubic'}},{{'sampling_space','legacy'}},{{'address_mode','mirror'}},{{'alpha_cutoff',-0.1}},{{'alpha_cutoff',1.1}},{{'alpha_cutoff',0/0}},{{'alpha_cutoff','0.5'}}}} do
   local bad=table.clone(d);bad[entry[1]]=entry[2];assert(not pcall(api.projected.set,'tri',bad))
  end
 else api.projected.set('tri',d) end
end}}
"#);
    let mut runtime=game(&script);
    let first=serde_json::to_value(runtime.observe()).unwrap();
    let b=&first["projected_geometry"]["tri"];
    assert_eq!(b["color_mode"],"linear");assert_eq!(b["filter"],"nearest");assert_eq!(b["alpha_cutoff"].as_f64().unwrap() as f32,0.05);
    assert_eq!(b["sampling_space"],"linear");
    assert_eq!(b["address_mode"],"clamp");
    runtime.tick().unwrap();let second=serde_json::to_value(runtime.observe()).unwrap();let b=&second["projected_geometry"]["tri"];
    assert_eq!(b["revision"],2);assert_eq!(b["color_mode"],"encoded");assert_eq!(b["filter"],"linear");
    assert_eq!(b["sampling_space"],"encoded");
    assert_eq!(b["address_mode"],"repeat");
    assert!((b["alpha_cutoff"].as_f64().unwrap()-127./255.).abs()<1e-7);
    runtime.tick().unwrap();assert_eq!(serde_json::to_value(runtime.observe()).unwrap()["projected_geometry"]["tri"]["revision"],2);
}

#[test]
fn scissor_is_physical_top_left_bounded_atomic_and_clipped_to_new_viewport() {
    let script=format!(r#"{FIXTURE}
return {{start=function(api)
 d.scissor={{x=128,y=0,width=512,height=480}};api.projected.set('tri',d)
 for _,s in {{{{x=0,y=0,width=0,height=1}},{{x=0.5,y=0,width=1,height=1}},{{x=32768,y=0,width=1,height=1}},{{x=0,y=0,width=1,height=1,typo=1}}}} do
  local bad=table.clone(d);bad.scissor=s;assert(not pcall(api.projected.set,'tri',bad))
 end
end,update=function()end}}
"#);
    let runtime=game(&script);let snapshot=runtime.observe();let batch=&snapshot.projected_geometry["tri"];
    let s=batch.scissor.as_ref().unwrap();assert_eq!(batch.revision,1);
    assert_eq!(s.intersection(360,900),Some([128,0,232,480]));assert_eq!(s.intersection(100,100),None);
    assert_eq!(serde_json::to_value(batch).unwrap()["scissor"],serde_json::json!({"x":128,"y":0,"width":512,"height":480}));
}

#[test]
fn host_dimensions_exist_before_start_and_resize_is_atomic() {
    let bytes=serde_json::to_vec(&serde_json::json!({"config":{"name":"viewport","entry_script":"main.luau"},
        "viewport_size":[1920,1080],"script":"return {start=function(api) local v=api.projected.getViewport();assert(v.width==1920 and v.height==1080);api.projected.setWorldVisible(false) end,update=function(api) local v=api.projected.getViewport();api.observation.set('size',{v.width,v.height,v.revision}) end}"})).unwrap();
    let mut runtime=unone_engine::HostProject::parse(&bytes).unwrap().into_runtime(42).unwrap();
    assert!(!runtime.observe().projected_world_visible);
    assert!(runtime.set_viewport_size(0,1080).is_err());
    runtime.tick().unwrap();assert_eq!(runtime.observe().observations["size"],serde_json::json!([1920,1080,2]));
    runtime.set_viewport_size(1920,1080).unwrap();runtime.tick().unwrap();assert_eq!(runtime.observe().observations["size"][2],2);
    runtime.set_viewport_size(360,900).unwrap();runtime.tick().unwrap();assert_eq!(runtime.observe().observations["size"],serde_json::json!([360,900,3]));
}

#[test]
fn world_geometry_and_batch_limits_reject_without_partial_mutation() {
    let script=format!(r#"{FIXTURE}
return {{start=function(api)
 for i=1,256 do api.projected.set(tostring(i),d) end
 assert(not pcall(api.projected.set,'overflow',d))
 api.projected.setWorldVisible(false)
 assert(not pcall(api.projected.setWorldVisible,'false'))
end,update=function()end}}
"#);
    let runtime=game(&script);let snapshot=runtime.observe();
    assert_eq!(snapshot.projected_geometry.len(),256);assert!(!snapshot.projected_world_visible);
    let a=game(&format!("{FIXTURE}\nreturn {{start=function(api) api.projected.set('t',d) end,update=function()end}}"));
    let b=game(&format!("{FIXTURE}\nbuffer.writef32(v,0,0.25)\nreturn {{start=function(api) api.projected.set('t',d) end,update=function()end}}"));
    assert_ne!(unone_engine::observation_digest(&a.observe()).unwrap(),unone_engine::observation_digest(&b.observe()).unwrap());
}
