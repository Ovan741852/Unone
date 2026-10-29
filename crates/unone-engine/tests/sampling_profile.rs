#![cfg(all(feature = "sampling-profile", not(feature = "phase-profile")))]
use unone_engine::{EngineRuntime,PreviewRequest};

#[test]
fn optimized_sampler_attributes_source_and_chains_vm_probes_without_changing_outputs() {
    // Pass the hot function as a value to pcall: opt2 cannot inline its call
    // through that native boundary. Ordinary small direct calls remain free to
    // inline, so the test does not demand impossible optimized stack recovery.
    let source=r#"
local function optimizedHot()
 local sum=0
 for i=1,400000 do sum+=math.sqrt(i) end
 return sum
end
return {start=function()end,update=function(api)
 local churn=table.create(800,1)
 local ok,value=pcall(optimizedHot)
 assert(ok)
 api.observation.set('sum',value+#churn)
end}
"#;
    let make=||EngineRuntime::load_source("opt2-sampling","opt2-sampler.luau",source,None).unwrap();
    let mut baseline=make();let mut sampled=make();
    let start=sampled.preview_request(PreviewRequest::ProfileStart {sampling:true}).unwrap();
    assert_eq!(start["execution"]["sampling_profile"],true);
    assert_eq!(start["execution"]["phase_profile"],false);
    assert_eq!(start["execution"]["build_intent"],"sampling-diagnostic");
    assert_eq!(start["execution"]["bytecode_optimization_level"],2);
    assert_eq!(start["execution"]["luau_execution"],"interpreter");
    for _ in 0..3 {
        let a=baseline.tick().unwrap();let b=sampled.tick().unwrap();
        assert_eq!(serde_json::to_vec(&a).unwrap(),serde_json::to_vec(&b).unwrap());
    }
    let stopped=sampled.preview_request(PreviewRequest::ProfileStop {}).unwrap();
    let window=&stopped["window"];
    assert_eq!(window["sampling"],true);
    assert!(window["samples"].as_u64().unwrap()>0);
    assert!(window["functions"].as_object().unwrap().values().any(|f|
        f["source"].as_str().is_some_and(|s|s.contains("opt2-sampler.luau"))&&
        f["name"]=="optimizedHot"&&f["inclusive_samples"].as_u64().unwrap()>0),"{}",window["functions"]);
    assert_eq!(window["vm"]["tick_count"],3);
    assert_eq!(window["vm"]["availability"]["allocation_growth"],"measured");
    assert!(window["vm"]["allocation_growth_events"].as_u64().unwrap()>0);
    assert!(window["core_phases"].is_null());
    sampled.tick().unwrap();
    assert_eq!(sampled.preview_request(PreviewRequest::Profile {}).unwrap()["window"],*window);
}
