use serde_json::{Value, json};
use unone_engine::{EngineRuntime, HostProject, InputFrame};

fn runtime() -> EngineRuntime {
    HostProject::parse(&serde_json::to_vec(&json!({
        "config":{"name":"input-admission","entry_script":"main.luau",
            "systems":{"physics2d":false,"physics3d":false,"jobs":false}},
        "script":r#"
local index, ticket
local phase = 0
return {start=function(api) index=api.spatial.create({}) end,update=function(api)
    phase += 1
    if phase == 1 then ticket=api.spatial.submit(index,{})
    else
        if ticket then api.spatial.take(ticket); ticket=nil end
        api.observation.set('physical',api.input.getPhysicalBatch())
        api.observation.set('slider',api.input.getSliderInteraction('gain'))
        api.observation.set('text',api.input.getTextInputInteraction('name'))
    end
end}
"#,
        "scene":{"entities":[]}
    })).unwrap()).unwrap().into_runtime(42).unwrap()
}

fn pending_frame() -> InputFrame {
    serde_json::from_value(json!({
        "physical":{"profile":"ordered_physical_v1","epoch":3,
            "after_sequence":0,"through_sequence":1,"events":[{
                "sequence":1,"received_us":5,"origin":"fixture","route":"control",
                "kind":"reset","scope":"all","reason":"load"}]},
        "ui_sliders":{"gain":{"phase":"end","ratio":0.75}},
        "ui_text_inputs":{"name":{"phase":"submit","text":"王重陽","composing":false}}
    })).unwrap()
}

#[test]
fn retryable_spatial_barrier_preserves_physical_and_ui_input_until_success() {
    for retry_same_frame in [false, true] {
        let mut runtime = runtime();
        runtime.set_spatial_external_backend("test-host".into()).unwrap();
        runtime.tick().unwrap();
        let task = runtime.drain_spatial_tasks().pop().unwrap();
        let frame = pending_frame();
        assert!(runtime.tick_with_input(&frame).unwrap_err().explanation.contains("SPATIAL_PENDING"));
        assert_eq!(runtime.current_frame(), 1);
        assert!(runtime.physical_input_report()["terminal"].is_null());
        assert!(runtime.physical_input_report()["last_attempt"].is_null());
        // An empty later host frame is not permission to discard the lease.
        assert!(runtime.tick_with_input(&InputFrame::default()).unwrap_err().explanation.contains("SPATIAL_PENDING"));
        runtime.complete_spatial_task(task.id, unone_engine::spatial::execute_cpu(&task.batch).unwrap()).unwrap();
        let snapshot = if retry_same_frame { runtime.tick_with_input(&frame) } else { runtime.tick() }.unwrap();
        assert_eq!(snapshot.physical_input_receipt.unwrap().through_sequence, 1);
        assert_eq!(snapshot.observations["physical"]["epoch"], 3);
        assert_eq!(snapshot.observations["slider"]["phase"], "end");
        assert_eq!(snapshot.observations["text"]["phase"], "submit");
        assert_eq!(snapshot.observations["text"]["text"], "王重陽");
        let next = runtime.tick_with_input(&InputFrame::default()).unwrap();
        assert_eq!(next.observations["physical"], Value::Null);
        assert_eq!(next.observations["slider"], Value::Null);
        assert_eq!(next.observations["text"], Value::Null);
    }
}

#[test]
fn generic_script_failure_retains_semantic_events_for_an_empty_frame_retry() {
    let mut runtime = EngineRuntime::load_source("semantic-retry", "main.luau", r#"
return {start=function()end,update=function(api)
    if api.input.isDown('Fail') then error('retry this input') end
    api.observation.set('text',api.input.getTextInputInteraction('name'))
    api.observation.set('slider',api.input.getSliderInteraction('gain'))
end}
"#, None).unwrap();
    let mut frame = pending_frame();
    frame.physical = None;
    frame.actions.insert("Fail".into(), true);
    assert!(runtime.tick_with_input(&frame).unwrap_err().explanation.contains("retry this input"));
    assert!(runtime.spatial_report()["fault"].is_null());
    let retried = runtime.tick_with_input(&InputFrame::default()).unwrap();
    assert_eq!(retried.observations["text"]["phase"], "submit");
    assert_eq!(retried.observations["slider"]["phase"], "end");
    let cleared = runtime.tick_with_input(&InputFrame::default()).unwrap();
    assert_eq!(cleared.observations["text"], Value::Null);
    assert_eq!(cleared.observations["slider"], Value::Null);
}

#[test]
fn conflicting_pending_input_is_rejected_without_replacing_any_accepted_event() {
    let mut runtime = runtime();
    runtime.set_spatial_external_backend("test-host".into()).unwrap();
    runtime.tick().unwrap();
    let task = runtime.drain_spatial_tasks().pop().unwrap();
    let frame = pending_frame();
    assert!(runtime.tick_with_input(&frame).is_err());
    let mut replacement = frame.clone();
    replacement.ui_text_inputs.get_mut("name").unwrap().text = "replacement".into();
    assert_eq!(runtime.tick_with_input(&replacement).unwrap_err().code, "INPUT_UI_PENDING");
    let mut replacement = InputFrame::default();
    replacement.physical = frame.physical.clone();
    replacement.physical.as_mut().unwrap().epoch = 7;
    assert!(runtime.tick_with_input(&replacement).unwrap_err().explanation.contains("ALREADY_QUEUED"));
    runtime.complete_spatial_task(task.id, unone_engine::spatial::execute_cpu(&task.batch).unwrap()).unwrap();
    let snapshot = runtime.tick().unwrap();
    assert_eq!(snapshot.observations["physical"]["epoch"], 3);
    assert_eq!(snapshot.observations["text"]["text"], "王重陽");
    assert_eq!(snapshot.observations["slider"]["phase"], "end");
}
