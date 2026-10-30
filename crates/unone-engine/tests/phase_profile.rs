#![cfg(all(feature = "phase-profile", feature = "ui"))]
use unone_engine::{EngineRuntime, PreviewRequest};

const SCRIPT: &str = r#"
local n=0
local function definition()
 return {bounds={x=0,y=0,width=10,height=10},quads={{asset='texture://art',rect={x=0,y=0,width=10,height=10}}}}
end
local function root(content)
 return {kind='screen',id='s',node='s',children={{kind='image_batch',id='art',rect={x=0,y=0,width=100,height=100},content=content}}}
end
return {
 start=function(api)
  api.ui.imageBatch.define('start-only',definition())
  api.ui.setRoot(root('start-only'))
  assert(api.debug.enabled)
  api.debug.registerTab({id='qa',label='QA'})
  api.debug.register({id='qa.repaint',tab='qa',kind='button',label='Repaint'},function()api.ui.setRoot(root(n==0 and 'start-only' or 'tick-art'))end)
 end,
 update=function(api)
  n+=1
  if n==1 then api.ui.imageBatch.define('tick-art',definition()) end
  api.ui.setRoot(root('tick-art'))
  if n==1 then api.ui.imageBatch.remove('start-only') end
  api.observation.set('n',n)
 end
}
"#;
fn runtime(script: &str) -> EngineRuntime {
    EngineRuntime::load_source("phase-profile","main.luau",script,None).unwrap()
}
fn report(r: &mut EngineRuntime) -> serde_json::Value {
    r.preview_request(PreviewRequest::Profile {}).unwrap()
}

#[test]
fn phase_only_window_preserves_state_counts_ui_boundaries_and_excludes_manual_tools() {
    let mut baseline=runtime(SCRIPT);
    let mut profiled=runtime(SCRIPT);
    let start=profiled.preview_request(PreviewRequest::ProfileStart {sampling:false}).unwrap();
    assert_eq!(start["execution"]["bytecode_optimization_level"],2);
    assert_eq!(start["execution"]["phase_profile"],true);
    assert_eq!(start["execution"]["sampling_profile"],false);
    assert_eq!(start["execution"]["build_intent"],"phase-diagnostic");
    assert_eq!(start["window"]["core_phases"]["attempted_frames"],0);
    assert!(start["window"]["vm"]["allocation_growth_bytes"].is_null());
    assert_eq!(start["window"]["vm"]["availability"]["allocation_growth"],"not-collected");
    assert_eq!(start["window"]["vm"]["capabilities"]["incremental_gc_wall_time"],false);
    assert_eq!(start["window"]["vm"]["frames"],serde_json::json!([]));
    let tools=profiled.preview_request(PreviewRequest::Tools {}).unwrap();
    profiled.preview_request(PreviewRequest::Invoke {id:"qa.repaint".into(),revision:tools["tools"]["revision"].as_u64().unwrap(),value:None}).unwrap();
    assert_eq!(report(&mut profiled)["window"]["core_phases"]["attempted_frames"],0);
    for _ in 0..3 {
        let before=baseline.tick().unwrap();
        let after=profiled.tick().unwrap();
        assert_eq!(serde_json::to_vec(&before).unwrap(),serde_json::to_vec(&after).unwrap());
    }
    let stopped=profiled.preview_request(PreviewRequest::ProfileStop {}).unwrap();
    let phases=&stopped["window"]["core_phases"];
    assert_eq!(phases["attempted_frames"],3);
    assert_eq!(phases["completed_frames"],3);
    assert_eq!(phases["failed_frames"],0);
    assert_eq!(phases["frames"][0]["frame"],1);
    for frame in phases["frames"].as_array().unwrap() {
        assert_eq!(frame["completed"],true);
        for name in ["ui_convert_ms","ui_parse_validate_ms","ui_commit_drop_ms","world_snapshot_ms","observations_clone_ms","ui_clone_ms","observe_host_state_ms"] {
            assert_eq!(frame["calls"][name],1,"{name}");
            assert!(frame["phases_ms"][name].as_f64().unwrap()>=0.);
        }
    }
    assert_eq!(phases["frames"][0]["calls"]["image_batch_convert_ms"],1);
    assert_eq!(phases["frames"][0]["calls"]["image_batch_validate_commit_ms"],1);
    assert_eq!(phases["frames"][0]["calls"]["image_batch_remove_ms"],1);
    assert_eq!(phases["frames"][1]["calls"]["image_batch_convert_ms"],0);
    profiled.tick().unwrap();
    let _standalone=profiled.observe();
    let later=report(&mut profiled);
    assert_eq!(later["window"],stopped["window"]);
    assert_eq!(later["performance"]["frames"],3);
}

#[test]
fn phase_only_rejects_sampling_before_mutating_a_window_and_freezes_on_update_error() {
    let mut r=runtime("local n=0 return {start=function()end,update=function()n+=1;if n==1 then error('intentional')end end}");
    let before=report(&mut r);
    let err=r.preview_request(PreviewRequest::ProfileStart {sampling:true}).unwrap_err();
    assert_eq!(err.code,"PROFILE_SAMPLING_UNAVAILABLE");
    assert_eq!(report(&mut r)["window"],before["window"]);
    r.preview_request(PreviewRequest::ProfileStart {sampling:false}).unwrap();
    assert!(r.tick().is_err());
    let failed=report(&mut r);
    assert_eq!(failed["window"]["active"],false);
    assert_eq!(failed["window"]["core_phases"]["attempted_frames"],1);
    assert_eq!(failed["window"]["core_phases"]["failed_frames"],1);
    assert_eq!(failed["window"]["core_phases"]["frames"][0]["frame"],1);
    assert_eq!(failed["window"]["core_phases"]["frames"][0]["completed"],false);
    assert_eq!(failed["window"]["core_phases"]["frames"][0]["calls"]["script_total_ms"],1);
    r.tick().unwrap();
    assert_eq!(report(&mut r)["window"],failed["window"]);
    let next=r.preview_request(PreviewRequest::ProfileStart {sampling:false}).unwrap();
    assert_eq!(next["window"]["id"],2);
    assert_eq!(next["window"]["core_phases"]["attempted_frames"],0);
    r.tick().unwrap();
    assert_eq!(report(&mut r)["window"]["core_phases"]["frames"][0]["frame"],2);
}

#[test]
fn caught_invalid_ui_attempts_are_timed_without_inventing_a_commit() {
    let mut r=runtime(r#"return {start=function()end,update=function(api)
     assert(not pcall(function()api.ui.setRoot({kind='bad',id='s',node='s',children={}})end))
     api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='image_batch',id='i',rect={x=0,y=0,width=100,height=100},quads={{asset='texture://a',rect={x=0,y=0,width=100,height=100}}}}}})
    end}"#);
    r.preview_request(PreviewRequest::ProfileStart {sampling:false}).unwrap();
    r.tick().unwrap();
    let p=report(&mut r);
    let frame=&p["window"]["core_phases"]["frames"][0];
    assert_eq!(frame["completed"],true);
    assert_eq!(frame["calls"]["ui_convert_ms"],2);
    assert_eq!(frame["calls"]["ui_parse_validate_ms"],2);
    assert_eq!(frame["calls"]["ui_commit_drop_ms"],1);
}
