//! Execute the real Luau binding and lifecycle, not a model of the wrapper.
use serde_json::{Value, json};
use unone_engine::{EngineRuntime, HostProject};

const SOURCE: &str = r#"
local values = {}
return {
 start=function(api) table.insert(values,api.hostTime.sample('start')) end,
 update=function(api)
  table.insert(values,api.hostTime.sample('before'))
  table.insert(values,api.hostTime.sample('after'))
  api.observation.set('values',values)
 end,
}
"#;

fn tape() -> Value {
    json!({"schema_version":1,"transactions":[
      {"phase":"start","frame":0,"samples":[{"tag":"start","milliseconds":4294967297u64}]},
      {"phase":"tick","frame":0,"samples":[{"tag":"before","milliseconds":4294967298u64},{"tag":"after","milliseconds":4294967379u64}]}
    ]})
}

fn load(source: &str, policy: Value) -> EngineRuntime {
    let payload = json!({"config":{"name":"clock","host_time":policy},"script":source});
    HostProject::parse(&serde_json::to_vec(&payload).unwrap())
        .unwrap().into_runtime(42).unwrap()
}

#[test]
fn ordered_replay_uses_every_read_and_keeps_values_above_u32() {
    let mut runtime=load(SOURCE,json!({"mode":"replay","tape":tape()}));
    let snapshot=runtime.tick().unwrap();
    assert_eq!(snapshot.observations["values"],json!([4294967297f64,4294967298f64,4294967379f64]));
}

#[test]
fn default_runtime_rejects_time_instead_of_silently_becoming_nondeterministic() {
    let error=EngineRuntime::load_source("disabled","main.luau",SOURCE,None).err().unwrap();
    assert!(error.explanation.contains("HOST_TIME_DISABLED"));
}

#[test]
fn wrong_order_extra_read_and_unread_sample_are_terminal_even_if_caught() {
    for changed in [SOURCE.replace("'before'", "'wrong'"),
        SOURCE.replace("table.insert(values,api.hostTime.sample('after'))", ""),
        SOURCE.replace("api.observation.set('values',values)", "pcall(function() api.hostTime.sample('extra') end)")] {
        let mut runtime=load(&changed,json!({"mode":"replay","tape":tape()}));
        assert!(runtime.tick().is_err());
        let failed=runtime.host_time_report();
        assert!(failed["fault"].is_string());
        assert_eq!(failed["committed_transactions"],1);
        assert_eq!(failed["physical_source_calls"],0);
        assert!(runtime.tick().is_err());
        assert!(runtime.reload_source(SOURCE).is_err());
        assert_eq!(runtime.host_time_report(),failed);
    }
}

#[test]
fn report_and_snapshot_do_not_consume_and_full_tape_requires_complete_replay() {
    let mut runtime=load(SOURCE,json!({"mode":"replay","tape":tape()}));
    let before=runtime.host_time_report();
    assert!(runtime.host_time_replay_complete().is_err());
    for _ in 0..3 { let _=runtime.observe(); let _=runtime.host_time_tape(); }
    assert_eq!(runtime.host_time_report(),before);
    runtime.tick().unwrap();
    assert!(runtime.host_time_replay_complete().is_ok());
    assert!(runtime.tick().is_err());
}

#[test]
fn ordinary_luau_error_keeps_partial_samples_and_requires_full_new_load() {
    let changed=SOURCE.replace("api.observation.set('values',values)","error('after samples')");
    let mut runtime=load(&changed,json!({"mode":"record"}));
    assert!(runtime.tick().is_err());
    let report=runtime.host_time_report();
    assert_eq!(report["physical_source_calls"],3);
    assert_eq!(report["failed_attempt"]["samples"].as_array().unwrap().len(),2);
    assert_eq!(runtime.host_time_tape().unwrap().transactions.len(),1);
    assert!(runtime.tick().is_err());
    assert_eq!(runtime.host_time_report(),report);
}

#[test]
fn healthy_reload_is_private_but_actual_source_reads_cannot_be_unread() {
    let mut runtime=load(SOURCE,json!({"mode":"record"}));
    std::thread::sleep(std::time::Duration::from_millis(10));
    let rejected="return {start=function()end,update=function()end,onReload=function(api) api.hostTime.sample('rejected'); error('reject candidate') end}";
    let before=runtime.host_time_tape().unwrap();
    assert!(runtime.reload_source(rejected).is_err());
    assert_eq!(runtime.host_time_tape().unwrap(),before);
    assert_eq!(runtime.host_time_report()["physical_source_calls"],2);
    assert!(runtime.host_time_report()["fault"].is_null());
    runtime.tick().unwrap();
    let accepted="return {start=function()end,update=function()end,onReload=function(api) api.observation.set('reload',api.hostTime.sample('accepted')) end}";
    runtime.reload_source(accepted).unwrap();
    assert_eq!(runtime.host_time_tape().unwrap().transactions[2].phase,"reload");
    assert_eq!(runtime.host_time_report()["physical_source_calls"],5);
    assert_eq!(runtime.host_time_report()["committed_samples"],4);
    assert!(runtime.observe().observations["reload"].as_f64().unwrap()>=9.,"successful reload must retain the original monotonic origin");
}

#[test]
fn live_is_explicit_and_does_not_retain_session_tape() {
    let mut runtime=load(SOURCE,json!({"mode":"live"}));
    for _ in 0..120 { runtime.tick().unwrap(); }
    let report=runtime.host_time_report();
    assert_eq!(report["physical_source_calls"],241);
    assert_eq!(report["retained_transactions"],0);
    assert!(runtime.host_time_tape().is_none());
}

#[test]
fn record_capacity_fails_without_dropping_and_invalid_tapes_fail_before_start() {
    let mut runtime=load(SOURCE,json!({"mode":"record","max_samples":2,"max_transactions":4}));
    assert!(runtime.tick().is_err());
    assert_eq!(runtime.host_time_report()["physical_source_calls"],2);
    assert_eq!(runtime.host_time_tape().unwrap().transactions.len(),1);
    for invalid in [json!({"schema_version":2,"transactions":[]}),
        json!({"schema_version":1,"transactions":[{"phase":"start","frame":0,"samples":[{"tag":"x","milliseconds":9007199254740992u64}]}]})] {
        let payload=json!({"config":{"name":"invalid","host_time":{"mode":"replay","tape":invalid}},"script":SOURCE});
        assert!(HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).is_err());
    }
}

#[test]
fn live_recorder_selects_record_before_start_and_diff_never_resamples() {
    let dir=tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("main.luau"),SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"),
        json!({"name":"roundtrip","entry_script":"main.luau","host_time":{"mode":"live"}}).to_string()).unwrap();
    let recorded=unone_engine::record_run(dir.path(),3,42,&[]);
    assert!(recorded.ok,"{:?}",recorded.diagnostics);
    let mut baseline=recorded.value.unwrap();
    let tape=baseline.host_time.as_ref().unwrap();
    assert_eq!(tape.transactions.len(),4);
    assert_eq!(tape.transactions[0].samples[0].tag,"start");
    assert_eq!(tape.transactions[1].samples.len(),2);
    std::thread::sleep(std::time::Duration::from_millis(10));
    let diff=unone_engine::diff_run(dir.path(),&baseline);
    assert!(diff.ok,"{:?}",diff.diagnostics);
    assert!(diff.value.unwrap().identical);
    baseline.host_time=None;
    let missing=unone_engine::diff_run(dir.path(),&baseline);
    assert!(!missing.ok);
    assert_eq!(missing.diagnostics[0].code,"HOST_TIME_REPLAY_TAPE_MISSING");
}

#[test]
fn invalid_argument_cannot_be_swallowed_into_successful_replay() {
    let mut runtime=load("return {start=function()end,update=function(api) pcall(function() api.hostTime.sample(123) end) end}",json!({"mode":"live"}));
    assert!(runtime.tick().is_err());
    assert_eq!(runtime.host_time_report()["physical_source_calls"],0);
}

#[test]
fn recorder_from_longer_replay_retains_only_the_successfully_recorded_prefix() {
    let dir=tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("main.luau"),SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"),
        json!({"name":"prefix","entry_script":"main.luau","host_time":{"mode":"replay","tape":tape()}}).to_string()).unwrap();
    let baseline=unone_engine::record_run(dir.path(),0,42,&[]).value.unwrap();
    assert_eq!(baseline.host_time.as_ref().unwrap().transactions.len(),1);
    assert!(unone_engine::diff_run(dir.path(),&baseline).ok);
}
