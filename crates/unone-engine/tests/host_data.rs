// Host data (docs/host-data.md): a custom renderer hands Luau one JSON value per channel, read with
// api.input.getHostData in the successful tick that consumes it.
use serde_json::json;
use unone_engine::{EngineRuntime,InputFrame,ProjectConfig,SourceProject};

fn runtime()->EngineRuntime {
    let config:ProjectConfig=serde_json::from_value(json!({"name":"host-data"})).unwrap();
    let source=r#"
return {start=function(api) end,update=function(api)
 local state=api.input.getHostData('game.state')
 local again=api.input.getHostData('game.state')
 assert((state==nil)==(again==nil))
 if api.input.isDown('Fail') then error('retry host data') end
 api.observation.set('present',state~=nil)
 if state then
  api.observation.set('serial',state.serial)
  api.observation.set('first',state.players[1].x)
  api.observation.set('count',#state.players)
  api.observation.set('big',state.big or 0)
  api.observation.set('name',state.name or '')
 end
 api.observation.set('other',api.input.getHostData('other')~=nil)
end}
"#;
    EngineRuntime::load_source_project(SourceProject{config,source:source.into(),..Default::default()}).unwrap()
}

fn frame(value:serde_json::Value)->InputFrame {serde_json::from_value(value).unwrap()}
fn state(serial:u32)->String {json!({"serial":serial,"players":[{"x":1.5},{"x":2}],"big":4294967296.0_f64,"name":"狐狸"}).to_string()}

#[test]
fn one_tick_reads_the_whole_value_as_a_table_and_later_ticks_read_nil() {
    let mut r=runtime();
    r.tick_with_input(&frame(json!({"host_data":{"game.state":state(1)}}))).unwrap();
    let o=r.semantic_observations();
    assert_eq!(o["present"],true);assert_eq!(o["serial"],1.0);assert_eq!(o["first"],1.5);assert_eq!(o["count"],2.0);
    assert_eq!(o["big"],4294967296.0,"numbers keep binary64, like observations");assert_eq!(o["name"],"狐狸");assert_eq!(o["other"],false);
    r.tick().unwrap();
    assert_eq!(r.semantic_observations()["present"],false,"consumed by one successful tick");
}

#[test]
fn a_failed_tick_keeps_the_value_for_the_retry_and_a_newer_frame_replaces_it() {
    let mut r=runtime();
    assert!(r.tick_with_input(&frame(json!({"actions":{"Fail":true},"host_data":{"game.state":state(1)}}))).is_err());
    r.tick_with_input(&frame(json!({"actions":{"Fail":false}}))).unwrap();
    assert_eq!(r.semantic_observations()["serial"],1.0,"the retry still reads the value of the failed tick");
    assert!(r.tick_with_input(&frame(json!({"actions":{"Fail":true},"host_data":{"game.state":state(2)}}))).is_err());
    r.tick_with_input(&frame(json!({"actions":{"Fail":false},"host_data":{"game.state":state(3)}}))).unwrap();
    assert_eq!(r.semantic_observations()["serial"],3.0,"latest state wins; host data never conflicts like a UI edit");
}

#[test]
fn text_that_is_not_json_rejects_the_whole_frame() {
    let mut r=runtime();
    let error=r.tick_with_input(&frame(json!({"actions":{"Fail":true},"host_data":{"game.state":"{\"serial\":"}}))).unwrap_err();
    assert_eq!(error.code,"INPUT_HOST_DATA_INVALID");
    assert_eq!(r.observe().frame,0);
    r.tick().unwrap();
    assert_eq!(r.semantic_observations()["present"],false,"nothing of the rejected frame was admitted (not even its actions)");
}

#[test]
fn channels_and_sizes_are_bounded() {
    let many:serde_json::Map<String,serde_json::Value>=(0..17).map(|i|(format!("c{i}"),json!("1"))).collect();
    for bad in [json!({"host_data":many}),json!({"host_data":{"":"1"}}),json!({"host_data":{"  ":"1"}}),json!({"host_data":{"a\u{7}b":"1"}}),
        json!({"host_data":{"x".repeat(129):"1"}}),json!({"host_data":{"game.state":format!("\"{}\"","x".repeat(262_143))}})] {
        assert!(frame(bad).validate().is_err());
    }
    let sixteen:serde_json::Map<String,serde_json::Value>=(0..16).map(|i|(format!("c{i}"),json!("1"))).collect();
    assert!(frame(json!({"host_data":sixteen})).validate().is_ok());
    assert!(frame(json!({"host_data":{"game.state":format!("\"{}\"","x".repeat(262_142))}})).validate().is_ok());
}
