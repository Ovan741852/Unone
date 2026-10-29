//! Actual Luau -> engine manager -> wgpu compute -> Luau delivery integration.
use serde_json::json;
use unone_engine::{EngineRuntime,HostProject,observation_digest};
use unone_spatial_gpu::SpatialGpuExecutor;

fn runtime(backend:&str)->EngineRuntime {
 let source=r#"
local index,ticket
local phase=0
return {
 start=function(api)
  index=api.spatial.create({
   {id=17,position={2,0,0},radius=1,category=1},
   {id=23,position={4,0,0},previous_position={-4,0,0},radius=0.5,category=2},
  })
 end,
 update=function(api)
  phase+=1
  assert(api.spatial.info().backend=='__BACKEND__')
  if phase==1 then
   ticket=api.spatial.submit(index,{
    {kind='nearest',point={0,0,0},max_distance=2,mask=1},
    {kind='overlap_sphere',center={0,0,0},radius=1,mask=1},
    {kind='sweep_sphere',from={-6,0,0},to={10,0,0},radius=1,mask=1},
    {kind='sweep_sphere',from={0,0,0},to={0,0,0},radius=0.5,mask=2},
   })
   assert(not pcall(api.spatial.take,ticket))
  elseif phase==2 then
   local result=api.spatial.take(ticket)
   assert(result.version==1 and #result.results==4)
   assert(result.results[1].hits[1].id==17)
   assert(result.results[2].hits[1].id==17)
   assert(result.results[3].hits[1].fraction==0.375)
   assert(result.results[4].hits[1].id==23 and result.results[4].hits[1].fraction==0.375)
   api.observation.set('geometry',result)
  end
 end,
}
"#.replace("__BACKEND__",backend);
 HostProject::parse(&serde_json::to_vec(&json!({
  "config":{"name":"generic-spatial-compute-test","entry_script":"main.luau","systems":{
   "physics2d":false,"physics3d":false,"camera2d":false,"camera3d":false,
   "random":false,"ui":false,"save":false,"audio":false,"spine":false,
   "particle":false,"effekseer":false,"jobs":false
  }},"script":source,"scene":{"entities":[]}
 })).unwrap()).unwrap().into_runtime(42).unwrap()
}

#[test]
fn required_gpu_luau_batches_match_cpu_through_fixed_tick_delivery(){
 let mut cpu=runtime("cpu");
 let mut gpu=runtime("wgpu");
 let executor=SpatialGpuExecutor::new().expect("required real GPU compute adapter");
 eprintln!("Luau spatial GPU adapter: {}",executor.adapter_name());
 gpu.set_spatial_executor(Box::new(executor)).unwrap();
 assert_eq!(gpu.spatial_report()["backend"],"wgpu");
 cpu.tick().unwrap();gpu.tick().unwrap();
 let cpu_before=observation_digest(&cpu.observe()).unwrap();let gpu_before=observation_digest(&gpu.observe()).unwrap();
 let cpu_profile=cpu.spatial_profile();let gpu_profile=gpu.spatial_profile();
 assert_eq!(observation_digest(&cpu.observe()).unwrap(),cpu_before);assert_eq!(observation_digest(&gpu.observe()).unwrap(),gpu_before);
 assert_eq!(cpu.spatial_profile(),cpu_profile);assert_eq!(gpu.spatial_profile(),gpu_profile);
 for profile in [&cpu_profile,&gpu_profile]{
  assert_eq!(profile["totals"]["completed_batches"],1);
  assert_eq!(profile["last"]["bodies"],2);
  assert_eq!(profile["last"]["queries"],4);
  assert_eq!(profile["last"]["pair_tests_upper_bound"],8);
  assert_eq!(profile["last"]["returned_hits"],4);
 }
 assert!(cpu_profile["last"]["executor"]["phases_ms"]["cpu_execute"].is_number());
 assert!(gpu_profile["last"]["executor"]["phases_ms"]["readback_wait"].is_number());
 assert!(gpu_profile["last"]["executor"]["phases_ms"]["gpu_kernel"].is_null());
 eprintln!("Spatial host phase measurements (one cold batch, not a speed comparison): {}",json!({"cpu":cpu_profile,"gpu":gpu_profile}));
 assert_eq!(observation_digest(&cpu.observe()).unwrap(),observation_digest(&gpu.observe()).unwrap());
 cpu.tick().unwrap();gpu.tick().unwrap();
 assert!(gpu.semantic_observations().contains_key("geometry"));
 assert_eq!(cpu.semantic_observations(),gpu.semantic_observations());
 assert_eq!(observation_digest(&cpu.observe()).unwrap(),observation_digest(&gpu.observe()).unwrap());
}
