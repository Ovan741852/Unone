#![cfg(feature = "ui")]
use serde_json::json;
use unone_engine::{EngineRuntime, ProjectConfig, SourceProject};

#[test]
fn retained_image_batch_constructor_is_pure_and_copies_only_small_instance_state() {
    let config:ProjectConfig=serde_json::from_value(json!({"name":"retained-package","entry_script":"main.luau","runtime_packages":{"@unone/ui":"0.5.0"}})).unwrap();
    let source=r#"return {start=function(api)
        api.ui.imageBatch.define('shared',{bounds={x=0,y=0,width=10,height=10},quads={{asset='texture://tile',rect={x=0,y=0,width=10,height=10}}}})
        local kit=api.ui.components.create()
        local transform={a=1,b=0,c=0,d=1,tx=2,ty=3}
        local art=kit.imageBatch({id='art',content='shared',rect={x=0,y=0,width=100,height=100},transform=transform})
        transform.tx=99;assert(art.transform.tx==2 and art.quads==nil)
        assert(not pcall(kit.imageBatch,{id='bad',content='shared',rect=art.rect,quads={}}))
        assert(not pcall(kit.imageBatch,{id='bad',content='shared',rect=art.rect,transform={a=1,b=0,c=0,d=1,tx=0,ty=0,extra=true}}))
        api.ui.setRoot(kit.screen({id='s',node='s',children={art}}))
    end,update=function()end}"#;
    let runtime=EngineRuntime::load_source_project(SourceProject{config,source:source.into(),..Default::default()}).unwrap();
    let snapshot=runtime.observe();
    assert_eq!(snapshot.ui_image_batches.len(),1);
    let wire=serde_json::to_value(snapshot.ui.unwrap()).unwrap();
    assert_eq!(wire["children"][0]["content"],"shared");
    assert_eq!(wire["children"][0]["transform"]["tx"],2.);
}

#[test]
fn image_batch_constructor_is_detached_typed_artwork_with_no_theme_or_actions() {
    let config: ProjectConfig = serde_json::from_value(json!({
        "name":"image-batch-package","entry_script":"main.luau",
        "systems":{"ui":true},"runtime_packages":{"@unone/ui":"0.5.0"}
    })).unwrap();
    let source = r#"
return {start=function(api)
    local ui=api.ui.components.create({image={opacity=.2}})
    local quads={
        {asset='texture://floor',rect={x=10,y=20,width=30,height=20},source={x=32,y=0,width=64,height=32}},
        {asset='texture://mist',rect={x=20,y=25,width=20,height=10},opacity=.6},
    }
    local art=ui.imageBatch({id='art',rect={x=0,y=0,width=100,height=100},quads=quads})
    assert(art.kind=='image_batch' and art.style==nil)
    quads[1].source.x=999;quads[2].opacity=0
    assert(art.quads[1].source.x==32 and art.quads[2].opacity==.6)
    for _,bad in ipairs({
        function()ui.imageBatch({id='a',rect=art.rect,quads=art.quads,action='Attack'})end,
        function()ui.imageBatch({id='a',anchor='center',size={width=100,height=100},quads=art.quads})end,
        function()ui.imageBatch({id='a',rect=art.rect,quads={{asset='x',rect=art.rect,text='Hidden'}}})end,
        function()ui.imageBatch({id='a',rect=art.rect,quads={[2]=art.quads[1]}})end,
    })do local ok=pcall(bad);assert(not ok)end
    api.ui.setRoot(ui.screen({id='screen',node='art',children={art,
        ui.button({id='go',action='Go',text='Go',rect={x=50,y=50,width=10,height=10}})}}))
end,update=function()end}
"#;
    let runtime=EngineRuntime::load_source_project(SourceProject{
        config,source:source.into(),..SourceProject::default()
    }).unwrap();
    let tree=serde_json::to_value(runtime.observe().ui.unwrap()).unwrap();
    assert_eq!(tree["children"][0]["kind"],"image_batch");
    assert_eq!(tree["children"][0]["quads"][0]["asset"],"texture://floor");
    assert_eq!(tree["children"][0]["quads"][0]["source"]["x"],32.0);
    assert_eq!(tree["children"][1]["kind"],"button");
    assert_eq!(tree["children"][1]["action"],"Go");
}
