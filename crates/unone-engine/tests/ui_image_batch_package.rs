#![cfg(feature = "ui")]
use serde_json::json;
use unone_engine::{EngineRuntime, ProjectConfig, SourceProject};

#[test]
fn image_batch_constructor_is_detached_typed_artwork_with_no_theme_or_actions() {
    let config: ProjectConfig = serde_json::from_value(json!({
        "name":"image-batch-package","entry_script":"main.luau",
        "systems":{"ui":true},"runtime_packages":{"@unone/ui":"0.4.0"}
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
