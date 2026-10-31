//! Retained world meshes and the curved/rect camera through the Luau API.
use unone_engine::{EngineRuntime, InputFrame};

const SCRIPT: &str = r#"
local function quad(lift)
  local v=buffer.create(4*36)
  for i,p in {{0,0},{1,0},{0,1},{1,1}} do
    local o=(i-1)*36
    buffer.writef32(v,o,p[1]);buffer.writef32(v,o+4,lift);buffer.writef32(v,o+8,p[2])
    buffer.writef32(v,o+12,p[1]);buffer.writef32(v,o+16,p[2])
    for c=0,3 do buffer.writef32(v,o+20+c*4,1) end
  end
  local ix=buffer.create(24)
  for i,n in {0,2,1,1,2,3} do buffer.writeu32(ix,(i-1)*4,n) end
  return v,ix
end
local ticks=0
return {start=function(api)
  api.camera.setTransform({projection='perspective',position={x=0,y=10,z=10},target={x=0,y=0,z=0},
    curvature=0.002,rect={x=0.2,y=0,width=0.8,height=1}})
  local v,ix=quad(0)
  api.geometry3d.set('ground',{vertices=v,indices=ix,texture='texture://ground',material={filter='nearest',double_sided=true}})
  local t=api.camera.getTransform()
  assert(t.curvature==0.002 and t.rect.x==0.2 and t.rect.width==0.8)
  -- Invalid content fails before changing the current mesh.
  local bad=buffer.create(35)
  assert(not pcall(api.geometry3d.set,'ground',{vertices=bad,indices=ix}))
  assert(not pcall(api.geometry3d.set,'ground',{vertices=v,indices=ix,material={blend='glow'}}))
  assert(not pcall(api.geometry3d.set,'ground',{vertices=v,indices=ix,extra=1}))
  assert(not pcall(api.geometry3d.setTransform,'missing',{}))
  assert(not pcall(api.camera.setTransform,{projection='perspective',position={x=0,y=1,z=1},target={x=0,y=0,z=0},rect={x=0.5,y=0,width=0.8,height=1}}))
  assert(not pcall(api.camera.setTransform,{projection='perspective',position={x=0,y=1,z=1},target={x=0,y=0,z=0},curvature=0/0}))
end,update=function(api)
  ticks+=1
  if ticks==1 then api.geometry3d.setTransform('ground',{position={x=3,y=0,z=0}}) end
  if ticks==2 then api.geometry3d.setVisible('ground',false) end
  if ticks==3 then local v,ix=quad(1);api.geometry3d.set('ground',{vertices=v,indices=ix,texture='texture://ground'}) end
  if ticks==4 then api.geometry3d.remove('ground') end
  -- Omitted curvature/rect keep their values.
  api.camera.setTransform({projection='perspective',position={x=ticks,y=10,z=10},target={x=0,y=0,z=0}})
end}"#;

#[test]
fn retained_meshes_keep_their_revision_across_placement_and_camera_changes() {
    let mut runtime = EngineRuntime::load_source("geometry", "main.luau", SCRIPT, None).unwrap();
    let snapshot = runtime.observe();
    let ground = &snapshot.geometry3d["ground"];
    let first = ground.revision;
    assert_eq!((ground.vertex_count(), ground.index_count()), (4, 6));
    let json = serde_json::to_value(&snapshot).unwrap();
    assert_eq!(json["camera3d"]["curvature"], 0.002);
    assert_eq!(json["camera3d"]["rect"]["width"], 0.8);
    assert_eq!(json["geometry3d"]["ground"]["material"]["filter"], "nearest");
    assert!(json["geometry3d"]["ground"]["vertices"].is_string(), "canonical observations hold the complete mesh");
    assert!(json["geometry3d"]["ground"].get("transform").is_none(), "placement is published apart from content");
    assert_eq!(json["geometry3d_placements"]["ground"]["visible"], true);
    let idle = InputFrame::default();
    runtime.tick_with_input(&idle).unwrap();
    let moved = runtime.observe();
    assert_eq!(moved.geometry3d["ground"].revision, first);
    assert_eq!(moved.geometry3d["ground"].transform.position.x, 3.0);
    assert_eq!(moved.camera3d.as_ref().unwrap().curvature, 0.002);
    assert_eq!(moved.camera3d.as_ref().unwrap().position.x, 1.0);
    runtime.tick_with_input(&idle).unwrap();
    assert!(!runtime.observe().geometry3d["ground"].visible);
    runtime.tick_with_input(&idle).unwrap();
    let changed = runtime.observe();
    assert_eq!(changed.geometry3d["ground"].revision, first + 1);
    assert!(changed.geometry3d["ground"].visible, "set replaces placement too");
    runtime.tick_with_input(&idle).unwrap();
    assert!(runtime.observe().geometry3d.is_empty());
    assert!(serde_json::to_value(runtime.observe()).unwrap().get("geometry3d").is_none());
}

#[test]
fn orthographic_cameras_reject_perspective_only_settings() {
    let script = "return {start=function(api)
      assert(not pcall(api.camera.setTransform,{projection='orthographic',position={x=0,y=0,z=0},curvature=0.1}))
      assert(not pcall(api.camera.setTransform,{projection='orthographic',position={x=0,y=0,z=0},rect={x=0,y=0,width=1,height=1}}))
    end,update=function()end}";
    let runtime = EngineRuntime::load_source("ortho", "main.luau", script, None).unwrap();
    assert!(runtime.observe().camera3d.is_none());
}
