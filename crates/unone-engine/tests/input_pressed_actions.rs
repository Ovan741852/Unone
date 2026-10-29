use serde_json::{Value,json};
use unone_engine::{EngineRuntime,InputFrame};

const SOURCE: &str=r#"
local history={}
local function read(api)
 local any=api.input.hasPressedActions()
 local values={any=any,A=api.input.wasPressed('A'),mapped=api.input.wasPressed('MappedKey'),ui=api.input.wasPressed('UiButton'),
  unknown=api.input.wasPressed('CustomSemanticAction'),releasedA=api.input.wasReleased('A'),releasedMapped=api.input.wasReleased('MappedKey'),
  heldA=api.input.isDown('A'),slider=api.input.getSliderInteraction('gain'),text=api.input.getTextInputInteraction('name')}
 assert(any==api.input.hasPressedActions(),'reading individual edges must not consume aggregate state')
 assert(values.A==api.input.wasPressed('A'))
 return values
end
return {
 start=function(api)api.observation.set('start',read(api))end,
 onReload=function(api)
  api.observation.set('reload',read(api))
  if api.input.isDown('ReloadFail')then error('reload failed')end
 end,
 update=function(api)
  local current=read(api)
  api.observation.set('current',current)
  table.insert(history,current.any)
  api.observation.set('history',history)
  if api.input.isDown('Fail')then error('tick failed')end
 end,
 replay={id='aggregate-input-press',version='1',inspect=function(_,api)return read(api)end}
}
"#;
fn runtime()->EngineRuntime {
    EngineRuntime::load_source("aggregate-input-press","main.luau",SOURCE,None).unwrap()
}
fn frame(value:Value)->InputFrame {serde_json::from_value(value).unwrap()}
fn current(r:&EngineRuntime)->Value {r.semantic_observations()["current"].clone()}

#[test]
fn aggregate_is_repeated_readable_semantic_press_not_held_or_release() {
    let mut r=runtime();assert_eq!(r.semantic_observations()["start"]["any"],false);
    for (actions,any,a) in [
        (json!({}),false,false),
        (json!({"A":true}),true,true),
        (json!({"A":true}),false,false),
        (json!({"A":true,"CustomSemanticAction":true}),true,false),
        (json!({"A":false,"CustomSemanticAction":false}),false,false),
        (json!({}),false,false),
        (json!({"A":true}),true,true),
    ] {
        r.tick_with_input(&frame(json!({"actions":actions}))).unwrap();
        assert_eq!(current(&r)["any"],any);assert_eq!(current(&r)["A"],a);
    }
    let fresh=runtime();assert_eq!(fresh.semantic_observations()["start"]["any"],false);
}

fn physical(after:u64,state:&str)->Value {
    json!({"profile":"ordered_physical_v1","epoch":7,"after_sequence":after,"through_sequence":after+1,
        "events":[{"sequence":after+1,"received_us":after+10,"origin":"fixture","route":"game","kind":"key","code":"KeyA","location":0,
            "state":state,"repeat":false,"is_composing":false,"modifiers":{"shift":false,"control":false,"alt":false,"meta":false}}]})
}

#[test]
fn physical_and_projected_ui_use_existing_semantic_actions_not_raw_event_presence() {
    let mut r=runtime();
    r.tick_with_input(&frame(json!({"physical":physical(0,"down")}))).unwrap();
    assert_eq!(current(&r)["any"],false,"raw key ingress does not invent a semantic action");
    r.tick_with_input(&frame(json!({"physical":physical(1,"down"),"actions":{"MappedKey":true}}))).unwrap();
    assert_eq!(current(&r)["any"],true);assert_eq!(current(&r)["mapped"],true);
    r.tick_with_input(&frame(json!({"physical":physical(2,"up"),"actions":{"MappedKey":false}}))).unwrap();
    assert_eq!(current(&r)["any"],false);assert_eq!(current(&r)["releasedMapped"],true);
    // This is the same semantic frame emitted by an official host after a UI
    // button hit; Core does not perform host hit testing or duplicate mappings.
    r.tick_with_input(&frame(json!({"actions":{"UiButton":true}}))).unwrap();
    assert_eq!(current(&r)["any"],true);assert_eq!(current(&r)["ui"],true);
    r.tick_with_input(&frame(json!({"actions":{"UiButton":true}}))).unwrap();
    assert_eq!(current(&r)["any"],false);assert_eq!(current(&r)["ui"],false);
}

#[test]
fn pointer_slider_and_text_activity_remains_readable_without_a_semantic_press() {
    let mut r=runtime();
    r.tick_with_input(&frame(json!({"pointer":{"position":{"x":20,"y":30},"screen_position":{"x":40,"y":50},"down":true},
        "ui_sliders":{"gain":{"phase":"drag","ratio":0.75}},
        "ui_text_inputs":{"name":{"phase":"submit","text":"王重陽","composing":false}}}))).unwrap();
    let value=current(&r);assert_eq!(value["any"],false);
    assert_eq!(value["slider"]["phase"],"drag");assert_eq!(value["text"]["text"],"王重陽");
    r.tick_with_input(&InputFrame::default()).unwrap();assert_eq!(current(&r)["any"],false);
}

#[test]
fn zero_argument_query_rejects_invented_options_without_mutating_input() {
    let r=EngineRuntime::load_source("arguments","main.luau",r#"
return {start=function(api)
 for _,value in ipairs({{}, {pressed=true}, false, 'A'})do
  local ok,message=pcall(api.input.hasPressedActions,value)
  assert(not ok and string.find(tostring(message),'INPUT_ARGUMENTS_INVALID',1,true))
 end
 assert(not pcall(api.input.hasPressedActions,nil))
 assert(api.input.hasPressedActions()==false)
end,update=function()end}
"#,None).unwrap();
    assert_eq!(r.current_frame(),0);
    assert!(serde_json::from_value::<InputFrame>(json!({"actions":{},"hasPressedActions":true})).is_err());
}

#[test]
fn headless_sequence_uses_the_same_press_snapshot() {
    let mut r=runtime();
    let inputs=[frame(json!({"actions":{"A":true}})),frame(json!({"actions":{"A":true}}))];
    assert!(r.run_with_input_sequence(4,42,&inputs).ok);
    assert_eq!(r.semantic_observations()["history"],json!([true,false,false,false]));
}

#[cfg(feature="dev-tools")]
fn inspect(r:&EngineRuntime)->Value {r.replay_adapter_call("inspect",json!({})).unwrap()}

#[test]
#[cfg(feature="dev-tools")]
fn failure_reload_and_inspection_share_was_pressed_transaction_lifetime() {
    let mut r=runtime();r.set_input("A",true);r.set_input("Fail",true);
    assert!(r.tick().is_err());assert_eq!(inspect(&r)["any"],false);assert_eq!(inspect(&r)["A"],false);
    r.set_input("Fail",false);r.tick().unwrap();assert_eq!(current(&r)["any"],true);
    r.set_input("A",false);r.set_input("Fail",true);assert!(r.tick().is_err());
    assert_eq!(inspect(&r)["any"],true);assert_eq!(inspect(&r)["A"],true);assert_eq!(inspect(&r)["heldA"],false);
    r.set_input("Fail",false);r.reload_source(SOURCE).unwrap();
    assert_eq!(r.semantic_observations()["reload"]["any"],true);assert_eq!(inspect(&r)["any"],true);
    r.tick().unwrap();assert_eq!(current(&r)["any"],false);assert_eq!(current(&r)["releasedA"],true);
    r.set_input("ReloadFail",true);assert!(r.reload_source(SOURCE).is_err());assert_eq!(inspect(&r)["any"],false);
    r.set_input("ReloadFail",false);r.set_input("A",true);r.tick().unwrap();assert_eq!(current(&r)["any"],true);
}

#[test]
#[cfg(feature="dev-tools")]
fn failed_physical_execution_restores_press_snapshot_and_fresh_runtime_restarts_released() {
    let mut failed=runtime();
    let input=frame(json!({"physical":physical(0,"down"),"actions":{"A":true,"Fail":true}}));
    assert!(failed.tick_with_input(&input).is_err());
    assert_eq!(failed.semantic_observations()["current"]["any"],true,"attempt observed its semantic press");
    assert_eq!(inspect(&failed)["any"],false,"published snapshot rolls back even when physical execution faults");
    assert!(failed.tick().is_err());assert_eq!(inspect(&failed)["any"],false);
    let mut fresh=runtime();assert_eq!(fresh.semantic_observations()["start"]["any"],false);
    fresh.tick_with_input(&frame(json!({"physical":physical(0,"down"),"actions":{"A":true}}))).unwrap();
    assert_eq!(current(&fresh)["any"],true);assert_eq!(current(&fresh)["A"],true);
}

#[test]
#[cfg(feature="dev-tools")]
fn recorded_physical_and_semantic_edges_replay_with_equal_aggregate_results() {
    let dir=tempfile::tempdir().unwrap();std::fs::write(dir.path().join("main.luau"),SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"),json!({"name":"aggregate-replay","entry_script":"main.luau"}).to_string()).unwrap();
    let sequence=[
        frame(json!({"physical":physical(0,"down"),"actions":{"MappedKey":true}})),
        frame(json!({"physical":physical(1,"down"),"actions":{"MappedKey":true,"UiButton":true}})),
        frame(json!({"physical":physical(2,"up"),"actions":{}})),
    ];
    let result=unone_engine::record_run(dir.path(),3,42,&sequence);assert!(result.ok,"{:?}",result.diagnostics);
    let recording=result.value.unwrap();
    let replay=unone_engine::diff_run(dir.path(),&recording);assert!(replay.ok,"{:?}",replay.diagnostics);
    assert!(replay.value.unwrap().identical);
}
