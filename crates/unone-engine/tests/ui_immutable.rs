#![cfg(feature = "ui")]

use mlua::{Lua, Table};
use serde_json::{Value, json};
use unone_engine::{EngineRuntime, ProjectConfig, SourceProject};

fn embedded_components() -> String {
    let mut source=String::from("local failPublication=false\nlocal helpers=(function(...)\n");
    source.push_str(include_str!("../src/runtime/bindings/scroll.luau"));
    source.push_str("\nend)(function(value)if failPublication then error('controlled publication failure')end;api.ui.setRoot(value)end,function(callback,...)return callback(...)end)\nlocal components=(function(...)\n");
    source.push_str(include_str!("../../../packages/unone-ui/src/components.luau"));
    source.push_str("\nend)({name='@unone/ui',version='0.6.0'},true,helpers.isManagedNode,helpers)\n");
    source
}

#[test]
fn immutable_ownership_bounds_copy_on_write_and_managed_lifecycle() {
    let mut source=String::from("return {start=function(api)\n");
    source.push_str(&embedded_components());
    source.push_str(include_str!("fixtures/ui-immutable-ownership.luau"));
    source.push_str("\nend,update=function()end}");
    let config:ProjectConfig=serde_json::from_value(json!({"name":"immutable-ownership","entry_script":"main.luau","systems":{"ui":true}})).unwrap();
    let runtime=EngineRuntime::load_source_project(SourceProject{config,source,..SourceProject::default()}).unwrap();
    assert_eq!(runtime.semantic_observations()["immutable_functional"],true);
}

#[test]
fn global_and_function_environment_shadowing_cannot_forge_ownership_authority() {
    let mut source=String::from("return {start=function(api)\n");
    source.push_str(&embedded_components());
    source.push_str(include_str!("fixtures/ui-immutable-authority.luau"));
    source.push_str("\nend,update=function()end}");
    let config:ProjectConfig=serde_json::from_value(json!({"name":"immutable-authority","entry_script":"main.luau"})).unwrap();
    let runtime=EngineRuntime::load_source_project(SourceProject{config,source,..SourceProject::default()}).unwrap();
    assert_eq!(runtime.semantic_observations()["immutable_authority"],true);
}

#[test]
fn weak_ownership_grants_do_not_retain_retired_values_while_kit_stays_live() {
    // Unit-only collection checks ownership reachability. No collector is
    // forced in the production player or any FPS/memory acceptance run.
    let lua=Lua::new();
    let publish=lua.create_function(|_,_:mlua::Value|Ok(())).unwrap();
    let pure=lua.load("return function(callback,...)return callback(...)end").eval::<mlua::Function>().unwrap();
    let helpers:Table=lua.load(include_str!("../src/runtime/bindings/scroll.luau")).call((publish,pure)).unwrap();
    let metadata=lua.create_table().unwrap();metadata.set("name","@unone/ui").unwrap();metadata.set("version","0.6.0").unwrap();
    let components:Table=lua.load(include_str!("../../../packages/unone-ui/src/components.luau"))
        .call((metadata,true,helpers.get::<mlua::Function>("isManagedNode").unwrap(),helpers)).unwrap();
    lua.globals().set("components",components).unwrap();
    lua.load(r#"
        watch=setmetatable({},{__mode='v'})
        do
            local c=components.create({text={color={1,1,1,1}}})
            liveKit=c
            local leaf=c.text({id='old',text='Old',rect={x=0,y=0,width=20,height=10}})
            local parent=c.component({id='parent',component='test',rect={x=0,y=0,width=100,height=100},children={leaf}})
            watch[1]=leaf;watch[2]=leaf.rect;watch[3]=parent;watch[4]=parent.children
        end
    "#).exec().unwrap();
    for _ in 0..3 {lua.gc_collect().unwrap();}
    lua.load("assert(next(watch)==nil,'private grants retained obsolete node graphs');assert(liveKit.text({id='new',rect={x=0,y=0,width=1,height=1}}))").exec().unwrap();
}

#[test]
fn immutable_generations_survive_reload_without_reusing_mutable_authored_state() {
    let manifest:Value=serde_json::from_str(include_str!("../../../packages/unone-ui/package.unone.json")).unwrap();
    let config:ProjectConfig=serde_json::from_value(json!({"name":"immutable-reload","entry_script":"main.luau","runtime_packages":{"@unone/ui":manifest["version"]}})).unwrap();
    let source=r#"
local ui
local old
local function view(text)
 return ui.screen({id='root',node='test',children={ui.text({id='value',text=text,rect={x=0,y=0,width=20,height=10}})}})
end
return {start=function(api)ui=api.ui.components;old=view('before');api.ui.setRoot(old)end,
onReload=function(api)
 ui=api.ui.components;local next=view('after');assert(table.isfrozen(next.children[1].rect));api.ui.setRoot(next)
end,update=function()end}
"#;
    let mut runtime=EngineRuntime::load_source_project(SourceProject{config,source:source.into(),..SourceProject::default()}).unwrap();
    let before=runtime.observe();
    #[cfg(feature="dev-tools")]
    {
        runtime.reload_source(source).unwrap();
        let after=runtime.observe();
        assert_eq!(serde_json::to_value(before.ui).unwrap()["children"][0]["text"],"before");
        assert_eq!(serde_json::to_value(after.ui).unwrap()["children"][0]["text"],"after");
    }
    #[cfg(not(feature="dev-tools"))]
    { let _=(before,&mut runtime); }
}
