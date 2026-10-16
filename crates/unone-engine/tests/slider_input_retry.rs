use serde_json::json;
use unone_engine::{EngineRuntime, InputFrame, ProjectConfig, SourceProject};

#[test]
fn failed_ticks_preserve_pending_slider_events_until_a_successful_retry() {
    let source = r#"
return {start=function() end, update=function(api)
 local event=api.input.getSliderInteraction('gain')
 if api.input.isDown('Fail') then error('retry slider input') end
 api.observation.set('phase',event and event.phase or 'none')
 api.observation.set('ratio',event and event.ratio or -1)
end}
"#;
    let config: ProjectConfig = serde_json::from_value(json!({"name":"slider-retry"})).unwrap();
    let mut runtime = EngineRuntime::load_source_project(SourceProject { config, source: source.into(), ..Default::default() }).unwrap();
    let input: InputFrame = serde_json::from_value(json!({"actions":{"Fail":true},"ui_sliders":{"gain":{"phase":"start","ratio":0.75}}})).unwrap();
    assert!(runtime.tick_with_input(&input).is_err());
    assert_eq!(runtime.observe().frame, 0);
    runtime.set_input("Fail", false);
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["phase"], "start");
    assert_eq!(runtime.semantic_observations()["ratio"], 0.75);
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["phase"], "none");
}
