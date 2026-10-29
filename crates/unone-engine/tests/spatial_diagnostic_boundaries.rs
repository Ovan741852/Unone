use serde_json::json;
use unone_engine::{EngineRuntime,HostProject,observation_digest};
use unone_engine::spatial::{SpatialExecutor,SpatialBatch,SpatialBatchResult,SpatialExecutionProfile,SpatialExecutionPhases,execute_cpu};

fn runtime(source:&str)->EngineRuntime {
 HostProject::parse(&serde_json::to_vec(&json!({"config":{"name":"generic-diagnostic-boundary","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false,"jobs":false}},"script":source,"scene":{"entities":[]}})).unwrap()).unwrap().into_runtime(42).unwrap()
}
struct InvalidExecutor(u8);
impl SpatialExecutor for InvalidExecutor {
 fn name(&self)->&str {"synthetic-invalid-executor"}
 fn execute(&mut self,batch:&SpatialBatch)->Result<SpatialBatchResult,String>{
  if self.0==2{return Err("synthetic executor failed".into());}
  let mut result=execute_cpu(batch)?;if self.0==0{result.version+=1;}Ok(result)
 }
 fn take_profile(&mut self)->Option<SpatialExecutionProfile>{
  (self.0==1).then(||SpatialExecutionProfile{clock:"host_monotonic".into(),total_ms:-1.0,phases_ms:SpatialExecutionPhases::default(),gpu_kernel_unavailable_reason:Some("synthetic unavailable timestamp".into()),upload_bytes:0,readback_bytes:0})
 }
}

#[test]
fn detailed_terminal_diagnostics_survive_runtime_tick_failure_and_are_readable_by_host(){
 for(mode,code,path)in [(0,"SPATIAL_RESULT_INVALID",Some("result.version")),(1,"SPATIAL_PROFILE_INVALID",Some("profile.total_ms")),(2,"SPATIAL_EXECUTOR_FAILED",None)]{
  let mut runtime=runtime("local i return {start=function(api)i=api.spatial.create({})end,update=function(api)api.spatial.submit(i,{})end}");
  runtime.set_spatial_executor(Box::new(InvalidExecutor(mode))).unwrap();assert!(runtime.tick().is_err());
  let d=runtime.spatial_diagnostic().unwrap();assert_eq!(d.code,code);assert_eq!(d.path.as_deref(),path);assert_eq!(d.operation,"spatial.finish");assert!(d.terminal&&!d.recoverable);assert_eq!(d.recovery.retry,"new_session");assert!(d.context.ticket.is_some());
  let digest=observation_digest(&runtime.observe()).unwrap();let mut changed=d.clone();changed.code="caller mutation".into();assert_eq!(runtime.spatial_diagnostic().unwrap(),d);assert_eq!(observation_digest(&runtime.observe()).unwrap(),digest);
  assert_eq!(runtime.spatial_report()["tickets"],0);
 }
}

#[test]
fn per_tick_limit_requires_next_tick_even_when_all_tickets_are_cancelled(){
 let mut runtime=runtime(r#"local i,phase=0,0 return {
 start=function(api)i=api.spatial.create({})end,
 update=function(api)
 phase+=1
 if phase==1 then
  for _=1,4 do local t=api.spatial.submit(i,{});api.spatial.cancel(t)end
  assert(api.spatial.info().tickets==0)
  assert(not pcall(api.spatial.submit,i,{}))
  local d=api.spatial.lastDiagnostic();assert(d.code=='SPATIAL_TICKET_LIMIT' and d.recovery.retry=='next_tick')
  api.observation.set('limit',d)
 elseif phase==2 then local t=api.spatial.submit(i,{});api.spatial.cancel(t);api.observation.set('recovered',true) end
 end}"#);
 runtime.tick().unwrap();runtime.tick().unwrap();assert_eq!(runtime.semantic_observations()["recovered"],true);
}

#[test]
fn outstanding_limit_requires_release_and_can_recover_in_same_tick(){
 let mut runtime=runtime(r#"local i,phase=0,0 local held={} return {
 start=function(api)i=api.spatial.create({})end,
 update=function(api)
 phase+=1
 if phase<=4 then for _=1,4 do table.insert(held,api.spatial.submit(i,{}))end
 else
  assert(not pcall(api.spatial.submit,i,{}))
  local d=api.spatial.lastDiagnostic();assert(d.code=='SPATIAL_TICKET_LIMIT' and d.recovery.retry=='after_release')
  api.spatial.cancel(held[1]);local t=api.spatial.submit(i,{});api.spatial.cancel(t);api.observation.set('recovered',true)
 end end}"#);
 for _ in 0..5{runtime.tick().unwrap();}assert_eq!(runtime.semantic_observations()["recovered"],true);
}
