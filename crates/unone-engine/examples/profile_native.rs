//! Bounded native CPU profiling through the same API used by developer hosts.
use unone_engine::{EngineRuntime, HostProject, PreviewRequest};
fn main() -> Result<(), Box<dyn std::error::Error>> {
 let args:Vec<String>=std::env::args().collect();
 if args.len()!=6 { return Err("usage: profile_native PROJECT_OR_HOST_JSON WARMUP FRAMES SAMPLING OUTPUT_JSON".into()); }
 let warmup:u64=args[2].parse()?;let frames:u64=args[3].parse()?;let sampling:bool=args[4].parse()?;
 let path=std::path::Path::new(&args[1]);
 let mut runtime=if path.is_file(){HostProject::parse(&std::fs::read(path)?).map_err(|e|e.explanation)?.into_runtime(42).map_err(|e|e.explanation)?}else{EngineRuntime::load_with_seed(path,42).map_err(|e|e.explanation)?};
 for _ in 0..warmup {runtime.tick().map_err(|e|e.explanation)?;}
 runtime.preview_request(PreviewRequest::ProfileStart{sampling}).map_err(|e|e.explanation)?;
 for _ in 0..frames {runtime.tick().map_err(|e|e.explanation)?;}
 let mut report=runtime.preview_request(PreviewRequest::ProfileStop{}).map_err(|e|e.explanation)?;
 report["observation_digest"]=serde_json::json!(unone_engine::observation_digest(&runtime.observe()).map_err(|e|e.to_string())?);
 report["measurement"]=serde_json::json!({"seed":42,"warmup_ticks":warmup,"measured_ticks":frames,"sampling":sampling,"renderer_included":false,"synthetic_serialization":false});
 std::fs::write(&args[5],serde_json::to_vec_pretty(&report)?)?;Ok(())
}
