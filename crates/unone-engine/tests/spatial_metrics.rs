use serde_json::json;
use unone_engine::{HostProject,observation_digest};

#[test]
fn binding_costs_count_attempts_correlate_tickets_and_remain_observer_pure() {
 let source=r#"
local index,ticket,phase=0,0,0
return {
 start=function(api)
  local packed=api.spatial.pack({{id=7,position={0,0,0},radius=0}})
  index=api.spatial.create(packed)
  assert(not pcall(api.spatial.update,index,{{id=7,position={0,0,0},radius=-1}}))
  local p=api.spatial.profile()
  assert(p.bindings.calls==3 and p.bindings.failed_calls==1)
  assert(p.bindings.last.operation=='spatial.update' and p.bindings.last.index==index)
  assert(not p.bindings.last.success)
  api.spatial.info();api.spatial.lastDiagnostic()
  local p2=api.spatial.profile()
  assert(p2.bindings.calls==p.bindings.calls and p2.bindings.input_decode_ms==p.bindings.input_decode_ms)
 end,
 update=function(api)
  phase+=1
  if phase==1 then
   ticket=api.spatial.submit(index,{{kind='nearest',point={0,0,0},max_distance=1}})
   assert(not pcall(api.spatial.take,ticket))
  elseif phase==2 then
   local r=api.spatial.take(ticket);assert(r.results[1].hits[1].id==7)
   local p=api.spatial.profile();local b=p.bindings
   assert(b.calls==6 and b.failed_calls==2 and b.last.ticket==ticket)
   assert(b.last.operation=='spatial.take' and b.last.success)
   assert(b.input_decode_ms>=0 and b.output_encode_ms>=0 and b.last.output_encode_ms>=0)
   api.observation.set('binding_profile',b)
  end
 end,
}
"#;
 let payload=serde_json::to_vec(&json!({"config":{"name":"generic-spatial-conversion","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false,"jobs":false}},"script":source,"scene":{"entities":[]}})).unwrap();
 let mut runtime=HostProject::parse(&payload).unwrap().into_runtime(42).unwrap();
 let digest=observation_digest(&runtime.observe()).unwrap();let first=runtime.spatial_profile();assert_eq!(first,runtime.spatial_profile());assert_eq!(digest,observation_digest(&runtime.observe()).unwrap());
 runtime.tick().unwrap();runtime.tick().unwrap();assert_eq!(runtime.semantic_observations()["binding_profile"]["calls"],6);
}
