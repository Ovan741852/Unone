use std::rc::Rc;
use serde_json::{Value,json};
use unone_engine::{EngineRuntime,SourceProject,observation_digest};

fn runtime(source:&str,save:Option<Value>)->EngineRuntime {
    EngineRuntime::load_source_project(SourceProject {source:source.into(),restored_save:save,..Default::default()}).unwrap()
}

#[test]
fn immutable_save_encoding_reuses_one_generation_and_owned_reads_remain_detached() {
    let save=json!({"node":"restored","nested":[1,2],"empty":[],"large":"x".repeat(112*1024)});
    let mut game=runtime(r#"return {start=function(api)
        local saved=api.save.get();assert(saved.node=='restored');saved.nested[1]=99
        assert(api.save.get().nested[1]==1)
        end,update=function()end}"#,Some(save.clone()));
    let first=game.serialized_save_payload().unwrap();
    for _ in 0..8 {assert!(Rc::ptr_eq(&first,&game.serialized_save_payload().unwrap()));}
    assert_eq!(first.get(),serde_json::to_string(&save).unwrap());
    let mut owned=game.save_payload().unwrap();owned["nested"][0]=json!(999);
    assert_eq!(game.save_payload(),Some(save.clone()));
    let digest=observation_digest(&game.observe()).unwrap();
    game.set_save_payload(Some(json!({"replacement":true})));
    assert_eq!(game.serialized_save_payload().unwrap().get(),"{\"replacement\":true}");
    assert_eq!(observation_digest(&game.observe()).unwrap(),digest,"save remains outside canonical world digest");
    assert_eq!(first.get(),serde_json::to_string(&save).unwrap(),"old immutable host lease remains valid");
    game.set_save_payload(None);assert!(game.save_payload().is_none());assert!(game.serialized_save_payload().is_none());
}

#[test]
fn rejected_lua_saves_preserve_encoded_generation_and_nil_keeps_existing_json_null_semantics() {
    let mut game=runtime(r#"return {start=function()end,update=function(api)
        if api.input.isDown('Reject') then
            local cycle={};cycle.self=cycle
            assert(not pcall(function()api.save.set(cycle)end))
            assert(not pcall(function()api.save.set(2147483648)end))
        elseif api.input.isDown('Clear') then api.save.set(nil)
        else api.save.set({array=api.observation.array(),value='accepted'}) end
        end}"#,Some(json!({"before":"safe"})));
    let first=game.serialized_save_payload().unwrap();
    game.set_input("Reject",true);game.tick().unwrap();
    assert!(Rc::ptr_eq(&first,&game.serialized_save_payload().unwrap()));
    game.set_input("Reject",false);game.tick().unwrap();
    assert_eq!(game.save_payload(),Some(json!({"array":[],"value":"accepted"})));
    assert_eq!(game.serialized_save_payload().unwrap().get(),"{\"array\":[],\"value\":\"accepted\"}");
    game.set_input("Clear",true);game.tick().unwrap();
    assert_eq!(game.save_payload(),Some(Value::Null));
    assert_eq!(game.serialized_save_payload().unwrap().get(),"null");
}

#[cfg(feature="dev-tools")]
#[test]
fn reload_commit_and_rollback_preserve_the_matching_save_encoding() {
    let mut game=runtime("return {start=function()end,update=function()end}",Some(json!({"value":"before"})));
    let before=game.serialized_save_payload().unwrap();
    let digest=observation_digest(&game.observe()).unwrap();
    let rejected="return {start=function()end,update=function()end,onReload=function(api) api.save.set({value='rejected'});error('reject reload') end}";
    assert!(game.reload_source(rejected).is_err());
    assert!(Rc::ptr_eq(&before,&game.serialized_save_payload().unwrap()));
    assert_eq!(game.save_payload(),Some(json!({"value":"before"})));
    let accepted="return {start=function()end,update=function()end,onReload=function(api) api.save.set({value='accepted'}) end}";
    game.reload_source(accepted).unwrap();
    assert_eq!(game.serialized_save_payload().unwrap().get(),"{\"value\":\"accepted\"}");
    assert_eq!(observation_digest(&game.observe()).unwrap(),digest);
}
