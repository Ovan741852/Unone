#![cfg(feature="ui")]
use serde_json::json;
use unone_engine::{EngineRuntime,InputFrame,ProjectConfig,SourceProject,UiTree};

fn runtime()->EngineRuntime {
    let config:ProjectConfig=serde_json::from_value(json!({"name":"plain-text-input","runtime_packages":{"@unone/ui":"0.5.0"}})).unwrap();
    let source=r#"
return {start=function(api)
 local ui=api.ui.components.create()
 api.ui.setRoot(ui.screen({id='screen',node='name',children={ui.textInput({id='name',text='',placeholder='稱呼',max_length=12,focused=true,rect={x=10,y=40,width=80,height=10}})}}))
end,update=function(api)
 local event=api.input.getTextInputInteraction('name')
 local again=api.input.getTextInputInteraction('name')
 assert((event==nil)==(again==nil))
 if event then assert(event.text==again.text and event.phase==again.phase) end
 if api.input.isDown('Fail') then error('retry text input') end
 api.observation.set('phase',event and event.phase or 'none')
 api.observation.set('text',event and event.text or '')
 api.observation.set('composing',event and event.composing or false)
end}
"#;
    EngineRuntime::load_source_project(SourceProject{config,source:source.into(),..Default::default()}).unwrap()
}

#[test]
fn canonical_constructor_and_unicode_tick_snapshots() {
    let mut r=runtime();
    let node=serde_json::to_value(r.observe().ui.unwrap()).unwrap();
    assert_eq!(node["children"][0]["kind"],"text_input");
    assert_eq!(node["children"][0]["placeholder"],"稱呼");
    for (phase,text,composing) in [("focus","",false),("change","ㄌㄧㄥ",true),("change","令狐沖",false),("submit","令狐沖",false),("blur","令狐沖",false)] {
        let frame:InputFrame=serde_json::from_value(json!({"ui_text_inputs":{"name":{"phase":phase,"text":text,"composing":composing}}})).unwrap();
        r.tick_with_input(&frame).unwrap();
        assert_eq!(r.semantic_observations()["text"],text);
        assert_eq!(r.semantic_observations()["phase"],phase);
        assert_eq!(r.semantic_observations()["composing"],composing);
        r.tick().unwrap();assert_eq!(r.semantic_observations()["phase"],"none");
    }
}

#[test]
fn invalid_input_is_rejected_before_advancing_the_runtime() {
    let mut r=runtime();
    let frame:InputFrame=serde_json::from_value(json!({"ui_text_inputs":{"name":{"phase":"submit","text":"王重陽","composing":true}}})).unwrap();
    assert!(r.tick_with_input(&frame).is_err());
    assert_eq!(r.observe().frame,0);
    let good:InputFrame=serde_json::from_value(json!({"ui_text_inputs":{"name":{"phase":"change","text":"王重陽","composing":false}}})).unwrap();
    r.tick_with_input(&good).unwrap();
    assert_eq!(r.semantic_observations()["text"],"王重陽");
    r.tick().unwrap();assert_eq!(r.semantic_observations()["phase"],"none");
}

#[test]
fn text_validation_is_bounded_and_does_not_submit_ime_candidates() {
    for value in [json!({"phase":"submit","text":"候選","composing":true}),json!({"phase":"change","text":"a\nb","composing":false}),json!({"phase":"change","text":"x".repeat(65537),"composing":false})] {
        let frame:InputFrame=serde_json::from_value(json!({"ui_text_inputs":{"name":value}})).unwrap();assert!(frame.validate().is_err());
    }
    for extra in [json!({"max_length":0}),json!({"max_length":16385}),json!({"text":"a\nb"}),json!({"action":"invented"})] {
        let mut node=json!({"kind":"text_input","id":"field","rect":{"x":0,"y":0,"width":20,"height":8},"text":""});
        for (k,v) in extra.as_object().unwrap() {node[k]=v.clone();}
        assert!(UiTree::from_json(json!({"kind":"screen","id":"screen","node":"name","children":[node]})).is_err());
    }
}
