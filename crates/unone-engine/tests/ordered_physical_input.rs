use serde_json::{json,Value};
use unone_engine::{EngineRuntime,InputFrame};
const SOURCE:&str=r#"
local Game={}
local function read(api)
    if not api.input.getPhysicalBatch then return {missing=true} end
    return api.input.getPhysicalBatch()
end
function Game.start(api) api.observation.set('outside',read(api)==nil) end
function Game.update(api)
    local batch=read(api)
    api.observation.set('batch',batch)
    if batch and batch.events then
        batch.events[1].received_us=999
        api.observation.set('detached',read(api).events[1].received_us~=999)
    end
    if api.input.isDown('Fail') then
        api.observation.set('partial',42)
        error('execution fault')
    end
end
Game.replay={id='ordered',version='1',inspect=function(_,api) return read(api)==nil end}
return Game
"#;
fn runtime()->EngineRuntime {EngineRuntime::load_source("ordered","main.luau",SOURCE,None).unwrap()}
fn batch(epoch:u64,after:u64,time:u64)->Value {
    json!({"profile":"ordered_physical_v1","epoch":epoch,"after_sequence":after,"through_sequence":after+1,
        "events":[{"sequence":after+1,"received_us":time,"origin":"fixture","route":"control",
        "kind":"reset","scope":"all","reason":"load"}]})
}
fn frame(value:Value)->InputFrame {serde_json::from_value(json!({"physical":value})).unwrap()}
#[test]
fn api_exists_but_is_nil_outside_tick_scope(){
    let r=runtime();assert_eq!(r.semantic_observations()["outside"],true);
}
#[test]
fn success_pins_epoch_time_receipt_and_getter_is_detached(){
    let mut r=runtime();let snapshot=r.tick_with_input(&frame(batch(8,0,10))).unwrap();
    assert_eq!(r.semantic_observations()["detached"],true);
    assert_eq!(serde_json::to_value(snapshot).unwrap()["physical_input_receipt"]["through_sequence"],1);
    for bad in [batch(9,1,11),batch(8,0,11),batch(8,1,9)] {assert!(r.tick_with_input(&frame(bad)).is_err());}
    r.tick_with_input(&frame(batch(8,1,10))).unwrap();
    r.tick_with_input(&InputFrame::default()).unwrap();
}
#[test]
fn first_execution_failure_is_terminal_even_before_epoch_commit(){
    let mut r=runtime();let mut f=frame(batch(1,0,5));f.actions.insert("Fail".into(),true);
    assert!(r.tick_with_input(&f).is_err());assert_eq!(r.semantic_observations()["partial"],42);
    assert!(r.tick_with_input(&frame(batch(2,0,5))).unwrap_err().explanation.contains("PHYSICAL"));
}
#[test]
fn late_invalid_control_route_does_not_run_or_bind(){
    let mut r=runtime();let mut b=batch(1,0,10);b["events"][0]["route"]=json!("host_ui");
    assert!(serde_json::from_value::<InputFrame>(json!({"physical":b})).map_or(true,|f|r.tick_with_input(&f).is_err()));
    assert_eq!(r.observe().frame,0);r.tick_with_input(&frame(batch(7,0,1))).unwrap();
}
#[test]
fn optional_fields_reject_explicit_null_and_capture_fact_is_consistent(){
    let base=json!({"sequence":1,"received_us":1,"origin":"fixture","route":"game","kind":"key","code":"KeyA","location":0,"state":"down","repeat":false,"is_composing":false,"modifiers":{"shift":false,"control":false,"alt":false,"meta":false,"alt_graph":null}});
    let mut b=batch(1,0,1);b["events"][0]=base;
    assert!(serde_json::from_value::<InputFrame>(json!({"physical":b})).is_err());
    let mut b=batch(1,0,1);b["events"][0]=json!({"sequence":1,"received_us":1,"origin":"fixture","route":"control","kind":"capture","pointer_id":3,"source":"lost","captured":true});
    assert!(frame(b).validate().is_err());
}
#[test]
fn empty_batch_commits_epoch_and_time_is_retained_across_empty_and_omitted_ticks(){
    let mut empty=batch(4,0,100);empty["events"]=json!([]);empty["through_sequence"]=json!(0);
    // This script only mutates the first row when it exists.
    let mut r=EngineRuntime::load_source("empty","main.luau","return {start=function()end,update=function(api) local b=api.input.getPhysicalBatch(); if b then api.observation.set('count',#b.events) end end}",None).unwrap();
    r.tick_with_input(&frame(empty.clone())).unwrap();assert_eq!(r.physical_input_report()["receipt"]["epoch"],4);
    assert_eq!(r.physical_input_report()["last_receive"],Value::Null);r.tick_with_input(&frame(batch(4,0,100))).unwrap();
    empty["after_sequence"]=json!(1);empty["through_sequence"]=json!(1);r.tick_with_input(&frame(empty)).unwrap();
    r.tick_with_input(&InputFrame::default()).unwrap();assert_eq!(r.physical_input_report()["last_receive"],100);
    assert!(r.tick_with_input(&frame(batch(4,1,99))).is_err());r.tick_with_input(&frame(batch(4,1,100))).unwrap();
}
#[test]
fn accepted_failure_keeps_attempt_evidence_and_new_load_is_the_recovery_boundary(){
    let mut r=runtime();let mut f=frame(batch(12,0,55));f.actions.insert("Fail".into(),true);
    assert!(r.tick_with_input(&f).is_err());let report=r.physical_input_report();
    assert_eq!(report["last_attempt"]["epoch"],12);assert_eq!(report["receipt"],Value::Null);
    assert!(report["terminal"].as_str().unwrap().contains("not rolled back"));
    assert!(r.tick().is_err());assert_eq!(r.physical_input_report()["last_attempt"],report["last_attempt"]);
    let mut fresh=runtime();fresh.tick_with_input(&frame(batch(13,0,1))).unwrap();
}
#[test]
fn host_slot_rejects_second_frame_atomically_and_retains_first_accepted_batch(){
    let mut h=unone_engine::HostInputState::default();h.queue_frame(frame(batch(1,0,3))).unwrap();
    assert!(h.queue_frame(frame(batch(2,0,4))).unwrap_err().contains("ALREADY_QUEUED"));
    let mut r=runtime();let first=h.consume_frame();assert_eq!(first.physical.unwrap().epoch,1);
    h.queue_frame(frame(batch(1,0,3))).unwrap();r.tick_with_input(&h.consume_frame()).unwrap();
    assert_eq!(r.physical_input_report()["receipt"]["epoch"],1);
}
#[test]
fn recorded_physical_batches_replay_exactly_with_explicit_profile_and_no_live_source(){
    let dir=tempfile::tempdir().unwrap();std::fs::write(dir.path().join("main.luau"),SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"),json!({"name":"ordered-replay","entry_script":"main.luau"}).to_string()).unwrap();
    let result=unone_engine::record_run(dir.path(),2,42,&[frame(batch(3,0,5)),frame(batch(3,1,5))]);assert!(result.ok,"{:?}",result.diagnostics);
    let baseline=result.value.unwrap();let mut wire=serde_json::to_value(&baseline).unwrap();
    assert_eq!(wire["physical_input_profile"],"ordered_physical_v1");assert!(unone_engine::diff_run(dir.path(),&baseline).value.unwrap().identical);
    wire.as_object_mut().unwrap().remove("physical_input_profile");let missing=serde_json::from_value(wire).unwrap();
    assert!(!unone_engine::diff_run(dir.path(),&missing).ok);
}
#[test]
fn healthy_reload_has_no_active_batch_and_preserves_cursor_while_faulted_reload_is_rejected(){
    let mut r=runtime();r.tick_with_input(&frame(batch(3,0,5))).unwrap();
    let source="return {start=function()end,onReload=function(api) assert(api.input.getPhysicalBatch()==nil);api.observation.set('reload_nil',true) end,update=function()end}";
    r.reload_source(source).unwrap();assert_eq!(r.semantic_observations()["reload_nil"],true);
    r.tick_with_input(&frame(batch(3,1,6))).unwrap();assert_eq!(r.physical_input_report()["receipt"]["through_sequence"],2);
    let mut failed=runtime();let mut f=frame(batch(9,0,1));f.actions.insert("Fail".into(),true);assert!(failed.tick_with_input(&f).is_err());
    assert!(failed.reload_source(source).is_err());assert_eq!(failed.physical_input_report()["last_attempt"]["epoch"],9);
}
#[test]
fn developer_recording_requires_one_physical_tick_and_explicit_profile_on_replay(){
    let dir=tempfile::tempdir().unwrap();std::fs::write(dir.path().join("main.luau"),SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"),json!({"name":"developer-ordered","entry_script":"main.luau"}).to_string()).unwrap();
    let mut protocol=unone_engine::DeveloperProtocol::default();let opened=protocol.execute_json(dir.path(),json!({"command":"open"})).value.unwrap();
    let session=opened["session"].clone();let revision=opened["revision"].clone();let input=json!({"physical":batch(3,0,1)});
    let bad=protocol.execute_json(dir.path(),json!({"command":"step","session":session,"expected_revision":revision,"frames":2,"input":input}));
    assert!(!bad.ok);assert_eq!(bad.diagnostics[0].code,"INPUT_PHYSICAL_STEP_SINGLE_TICK");
    let step=protocol.execute_json(dir.path(),json!({"command":"step","session":session,"expected_revision":revision,"frames":1,"input":input}));assert!(step.ok,"{:?}",step.diagnostics);
    let mut recording=protocol.execute_json(dir.path(),json!({"command":"recording","session":session})).value.unwrap();assert_eq!(recording["physical_input_profile"],"ordered_physical_v1");
    assert!(protocol.execute_json(dir.path(),json!({"command":"replay","recording":recording})).ok);
    recording.as_object_mut().unwrap().remove("physical_input_profile");assert!(!protocol.execute_json(dir.path(),json!({"command":"replay","recording":recording})).ok);
}
#[test]
fn structural_schema_matches_present_nonnull_and_closed_flattened_event_contract(){
    let schema=unone_engine::contract_schema("input").unwrap();
    assert_eq!(schema["properties"]["physical"]["$ref"],"#/$defs/PhysicalBatch");
    for key in ["alt_graph","caps_lock","num_lock"]{assert_eq!(schema["$defs"]["Modifiers"]["properties"][key]["type"],"boolean");}
    let event=&schema["$defs"]["PhysicalEvent"];
    assert_eq!(event["unevaluatedProperties"],false);
    let variants=event["oneOf"].as_array().unwrap();
    assert_eq!(variants[1]["properties"]["point"]["$ref"],"#/$defs/Point");
    assert_eq!(variants[5]["properties"]["pointer_id"]["type"],"integer");
}
