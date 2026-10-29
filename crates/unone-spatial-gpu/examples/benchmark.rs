//! Synthetic reusable executor benchmark; no world/game inputs or rendering.
use std::time::Instant;
use unone_engine::spatial::{CpuSpatialExecutor,SpatialExecutor,SpatialBatch,SpatialBody,SpatialQuery};
use unone_spatial_gpu::SpatialGpuExecutor;
use serde_json::{json,Value};

fn distribution(values:impl Iterator<Item=f64>)->Value {
 let mut v:Vec<_>=values.collect();assert!(!v.is_empty()&&v.iter().all(|n|n.is_finite()&&*n>=0.));v.sort_by(f64::total_cmp);
 json!({"samples":v.len(),"min":v[0],"p50":v[(v.len() as f64*0.5).ceil() as usize-1],"p95":v[(v.len() as f64*0.95).ceil() as usize-1],"max":v[v.len()-1],"mean":v.iter().sum::<f64>()/v.len() as f64})
}
fn run(executor:&mut dyn SpatialExecutor,batch:&SpatialBatch,warmup:usize,samples:usize,setup_ms:f64)->Value {
 let mut output=Vec::new();
 for sample in 0..warmup+samples {
  let began=Instant::now();let result=executor.execute(batch).expect("benchmark requires successful actual executor");let elapsed=began.elapsed().as_secs_f64()*1000.;let profile=executor.take_profile();
  assert_eq!(result.results.len(),batch.queries.len());
  for(i,result)in result.results.iter().enumerate(){assert_eq!(result.hits.len(),1);assert_eq!(result.hits[0].id,(i%batch.bodies.len())as u32);}
  if sample>=warmup {output.push(json!({"executor_wall_ms":elapsed,"executor_profile":profile}));}
 }
 json!({"backend":executor.name(),"setup_ms":setup_ms,"executor_wall_ms":distribution(output.iter().map(|v|v["executor_wall_ms"].as_f64().unwrap())),"samples":output})
}
fn main(){
 let(mut bodies,mut queries,mut warmup,mut samples)=(4096usize,128usize,3usize,9usize);let mut backend="both".to_string();
 let args:Vec<_>=std::env::args().skip(1).collect();assert_eq!(args.len()%2,0,"expected --option value pairs");
 for pair in args.chunks_exact(2){match pair[0].as_str(){"--bodies"=>bodies=pair[1].parse().unwrap(),"--queries"=>queries=pair[1].parse().unwrap(),"--warmup"=>warmup=pair[1].parse().unwrap(),"--samples"=>samples=pair[1].parse().unwrap(),"--backend"=>backend=pair[1].clone(),_=>panic!("unknown option")}}
 assert!((1..=65536).contains(&bodies)&&(1..=1024).contains(&queries)&&warmup<=20&&(3..=31).contains(&samples));assert!(["both","cpu","gpu"].contains(&backend.as_str()));
 let position=|i:usize|[(i%256)as f32,(i/256)as f32,0.];
 let batch=SpatialBatch{version:1,bodies:(0..bodies).map(|i|SpatialBody{id:i as u32,position:position(i),radius:0.,category:1,previous_position:None}).collect(),queries:(0..queries).map(|i|SpatialQuery::Nearest{point:position(i%bodies),max_distance:0.,mask:1,exclude_id:None}).collect()};
 let mut runs=Vec::new();let mut adapter=None;
 if backend!="gpu" {let started=Instant::now();let mut cpu=CpuSpatialExecutor;let setup=started.elapsed().as_secs_f64()*1000.;runs.push(run(&mut cpu,&batch,warmup,samples,setup));}
 if backend!="cpu" {let started=Instant::now();let mut gpu=SpatialGpuExecutor::new().expect("actual GPU adapter required, no CPU fallback");let setup=started.elapsed().as_secs_f64()*1000.;adapter=Some(gpu.adapter_name().to_string());runs.push(run(&mut gpu,&batch,warmup,samples,setup));}
 println!("{}",serde_json::to_string_pretty(&json!({"schema":"unone.spatial.executor-benchmark.v1","ok":true,"clock":"host_monotonic","build_profile":if cfg!(debug_assertions){"debug"}else{"release"},"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH,"configuration":{"bodies":bodies,"queries":queries,"warmup":warmup,"samples":samples},"adapter":adapter,"runs":runs,"limitations":["Direct executor call, no Luau, bridge, caller application or rendered frame; setup measured separately.","Nearest-rank quantiles in one process, warmups excluded; build_profile affects CPU/validation cost. Individual host samples are not a universal speedup or automatic crossover threshold.","GPU executor_profile phases may overlap and are host wall timings; absent kernel timestamp remains explicitly unavailable."]})).unwrap());
}
