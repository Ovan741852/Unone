use serde_json::{Value, json};
use unone_engine::{UiTree, inspect_layout};

fn rect() -> Value { json!({"x":10.0,"y":10.0,"width":30.0,"height":10.0}) }
fn tree(children: Value) -> Value {
    json!({"kind":"screen","id":"screen","node":"test","children":children})
}
fn label() -> Value {
    json!({"kind":"text","id":"label","text":"繁中 AB","rect":rect(),
        "style":{"font_size":5,"font_weight":400,"padding":{},
            "text_shadow":{"offset_x":0.25,"offset_y":0.5,"color":[0.04,0.02,0.0,1.0]}}})
}
fn region(id: &str) -> Value {
    json!({"kind":"input_region","id":id,"action":"Owner","rect":rect()})
}

#[test]
fn shadow_is_typed_data_without_altering_foreground_geometry() {
    let source=label();
    let parsed=UiTree::from_json(tree(json!([source.clone()]))).unwrap();
    let output=serde_json::to_value(&parsed).unwrap();
    assert_eq!(output["children"][0]["rect"],source["rect"]);
    assert_eq!(output["children"][0]["style"]["text_shadow"],source["style"]["text_shadow"]);
    assert_eq!(parsed.usage().render_regions_upper_bound,2);
}

#[test]
fn shadow_invalid_and_inapplicable_contracts_are_rejected() {
    for value in [json!({}),json!({"offset_x":0,"offset_y":0,"color":[0,0,0]}),
        json!({"offset_x":101,"offset_y":0,"color":[0,0,0,1]}),
        json!({"offset_x":0,"offset_y":-101,"color":[0,0,0,1]}),
        json!({"offset_x":0,"offset_y":0,"color":[0,0,0,1.1]}),
        json!({"offset_x":"1","offset_y":0,"color":[0,0,0,1]}),
        json!({"offset_x":0,"offset_y":0,"color":[0,0,0,1],"blur":1})] {
        let mut node=label();node["style"]["text_shadow"]=value;
        assert!(UiTree::from_json(tree(json!([node]))).is_err());
    }
    for kind in ["image","panel"] {
        let mut node=label();node["kind"]=kind.into();
        node.as_object_mut().unwrap().remove("text");
        if kind=="image" {node["asset"]="texture://fixture/image".into();}
        assert!(UiTree::from_json(tree(json!([node]))).is_err());
    }
}

#[test]
fn input_region_has_no_visual_or_typography_fields_and_zero_paint_cost() {
    let parsed=UiTree::from_json(tree(json!([region("owner")]))).unwrap();
    assert_eq!(parsed.usage().logical_nodes,1);
    assert_eq!(parsed.usage().leaf_nodes,1);
    assert_eq!(parsed.usage().render_regions_upper_bound,0);
    for (key,value) in [("text",json!("")),("style",json!({})),("children",json!([])),
        ("asset",json!("texture://fixture/image")),("enabled",json!(false)),("action",json!(" "))] {
        let mut node=region("owner");node[key]=value;
        assert!(UiTree::from_json(tree(json!([node]))).is_err(),"{key}");
    }
}

#[test]
fn nonvisual_input_does_not_collide_with_art_but_interactive_conflicts_remain() {
    let parsed=UiTree::from_json(tree(json!([label(),region("owner")]))).unwrap();
    let report=inspect_layout(&parsed,96,48);
    assert!(report.readable,"{:?}",report.findings);
    assert!(report.allowed_overlaps.is_empty());
    let button=json!({"kind":"button","id":"button","text":"TC","action":"Go","rect":rect()});
    for children in [json!([region("one"),region("two")]),json!([region("one"),button.clone()]),
        json!([label(),button])] {
        let parsed=UiTree::from_json(tree(children)).unwrap();
        assert!(inspect_layout(&parsed,96,48).findings.iter().any(|f|f.code=="UI_NODES_OVERLAP"));
    }
}

#[test]
fn canonical_package_publishes_typed_region_and_shadow_in_the_normal_runtime() {
    use unone_engine::{EngineRuntime,ProjectConfig,SourceProject};
    let config:ProjectConfig=serde_json::from_value(json!({"name":"presentation-input",
        "entry_script":"main.luau","systems":{"ui":true},"runtime_packages":{"@unone/ui":"0.5.0"}})).unwrap();
    let source=r#"return {start=function(api)
        local ui=api.ui.components.create()
        local r={x=10,y=10,width=30,height=10}
        api.ui.setRoot(ui.screen({id='test',node='test',children={
            ui.text({id='label',text='繁中 AB',rect=r,style={font_size=5,font_weight=400,
                text_shadow={offset_x=.25,offset_y=.5,color={.04,.02,0,1}}}}),
            ui.inputRegion({id='owner',rect=r,action='Owner'})}}))
        end,update=function()end}"#;
    let runtime=EngineRuntime::load_source_project(SourceProject{config,source:source.into(),..Default::default()}).unwrap();
    let snapshot=runtime.observe();
    let value=serde_json::to_value(snapshot).unwrap();
    let output=&value["ui"];
    assert_eq!(output["children"][1]["kind"],"input_region");
    assert_eq!(output["children"][0]["style"]["font_weight"],400);
    assert_eq!(output["children"][0]["style"]["text_shadow"]["offset_y"],0.5);
}

#[test]
fn shadow_paint_bounds_use_the_actual_aspect_and_keep_capture_rect() {
    for aspect in [1.0,2.0] {
        let mut node=label();node["style"]["text_shadow"]["offset_x"]=4.0.into();
        node["style"]["text_shadow"]["offset_y"]=3.0.into();
        let parsed=UiTree::from_json_for_viewport(tree(json!([node])),aspect).unwrap();
        let report=inspect_layout(&parsed,96,48);
        let leaf=&report.nodes[0];let paint=leaf.paint_rect.unwrap();
        assert_eq!(leaf.rect.x,10.0);assert_eq!(leaf.rect.y,10.0);
        assert_eq!(paint.x,10.0);assert_eq!(paint.y,7.0);
        assert_eq!(paint.width,30.0+4.0/aspect);assert_eq!(paint.height,13.0);
    }
}
