use serde_json::{Value, json};
use unone_engine::{UiNode, UiStyle, UiTree};

fn screen(node: Value) -> Value {
    json!({"kind":"screen", "id":"screen", "node":"test", "children":[node]})
}

fn text(style: Value) -> Value {
    json!({"kind":"text", "id":"label", "text":"Shared typography", "rect":{"x":10.0,"y":10.0,"width":40.0,"height":8.0}, "style":style})
}

#[test]
fn style_is_explicit_serialized_data_and_legacy_nodes_keep_their_shape() {
    let mut legacy = text(json!({}));
    legacy.as_object_mut().unwrap().remove("style");
    let parsed = UiTree::from_json(screen(legacy.clone())).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap()["children"][0], legacy);
    assert!(parsed.children[0].style().is_none());

    let style = json!({
        "font_family":"Arial, sans-serif", "font_size":2.4, "font_weight":600,
        "line_height":1.4, "letter_spacing":0.03, "color":[0.9,0.8,0.7,1.0],
        "text_align":"start", "vertical_align":"top", "wrap":"word", "overflow":"clip",
        "padding":{"left":1.0,"top":0.5,"right":1.0,"bottom":0.5},
        "background":[0.1,0.2,0.3,0.8], "border_color":[0.4,0.5,0.6,1.0],
        "border_width":0.1, "border_radius":0.5, "opacity":0.75
    });
    let parsed = UiTree::from_json(screen(text(style.clone()))).unwrap();
    assert_eq!(serde_json::to_value(&parsed).unwrap()["children"][0]["style"], style);
    assert_eq!(parsed.children[0].style().unwrap().font_size, Some(2.4));
    assert_eq!(parsed.usage().render_regions_upper_bound, 3);
}

#[test]
fn font_size_and_padding_do_not_change_when_box_or_viewport_changes() {
    let style = json!({"font_size":2.2,"padding":{"left":1.0}});
    let mut node = text(style);
    node.as_object_mut().unwrap().remove("rect");
    node["anchor"] = "center".into();
    node["size"] = json!({"width":40,"height":8});
    let wide = UiTree::from_json_for_viewport(screen(node.clone()), 16.0 / 9.0).unwrap();
    node["size"]["height"] = 20.into();
    let tall = UiTree::from_json_for_viewport(screen(node), 9.0 / 16.0).unwrap();
    assert_ne!(wide.children[0].rect(), tall.children[0].rect());
    assert_eq!(wide.children[0].style(), tall.children[0].style());
    let serialized = serde_json::to_value(&tall).unwrap();
    assert_eq!(serialized["children"][0]["style"]["padding"], json!({"left":1.0,"top":0.0,"right":0.0,"bottom":0.0}));
}

#[test]
fn all_text_widgets_accept_style_and_panel_has_no_text_or_input() {
    for kind in ["text", "button", "slider", "combobox"] {
        let mut node = text(json!({"font_size":2,"text_align":"end"}));
        node["kind"] = kind.into();
        if kind != "text" { node["action"] = "Select".into(); }
        assert!(UiTree::from_json(screen(node)).is_ok(), "{kind}");
    }
    let panel = json!({"kind":"panel","id":"surface","rect":{"x":0,"y":0,"width":20,"height":10},"style":{"background":[0,0,0,0.8],"border_radius":0.4}});
    let mut parsed = UiTree::from_json(screen(panel.clone())).unwrap();
    assert!(matches!(parsed.children[0], UiNode::Panel { .. }));
    assert!(parsed.children[0].text_mut().is_none());
    assert!(parsed.children[0].children().is_empty());
    for field in ["text", "action", "asset", "component"] {
        let mut invalid = panel.clone(); invalid[field] = "unexpected".into();
        assert!(UiTree::from_json(screen(invalid)).is_err(), "{field}");
    }
}

#[test]
fn invalid_styles_are_rejected_instead_of_clamped_or_ignored() {
    for style in [
        json!({"font_size":0}), json!({"font_size":101}), json!({"font_weight":99}),
        json!({"font_weight":901}), json!({"font_weight":600.5}), json!({"font_family":" "}),
        json!({"font_family":"https://example.test/font.woff"}), json!({"font_family":"Arial; color:red"}),
        json!({"line_height":0.4}), json!({"line_height":4.1}), json!({"letter_spacing":-10.1}),
        json!({"color":[1,1,1]}), json!({"color":[1,1,1,2]}),
        json!({"background":[-0.1,0,0,1]}), json!({"border_color":[0,0,0,1.1]}),
        json!({"padding":{"left":-1}}), json!({"padding":{"right":101}}),
        json!({"border_width":-1}), json!({"border_radius":-1}), json!({"opacity":1.1}),
        json!({"text_align":"left"}), json!({"vertical_align":"center"}),
        json!({"wrap":"word","overflow":"ellipsis"}),
        json!({"fontSize":2}), json!({"padding":{"horizontal":2}}),
    ] {
        assert!(UiTree::from_json(screen(text(style.clone()))).is_err(), "accepted {style}");
    }
    assert!(UiStyle { font_size: Some(f64::NAN), ..Default::default() }.validate().is_err());
    assert!(UiStyle { color: Some([0.0, 0.0, 0.0, f64::INFINITY]), ..Default::default() }.validate().is_err());
    assert!(UiTree::from_json(screen(text(json!({"overflow":"ellipsis"})))).is_ok());
}

#[test]
fn inapplicable_style_fields_and_implicit_inheritance_are_rejected() {
    for kind in ["panel", "image"] {
        let mut node = json!({"kind":kind,"id":"box","rect":{"x":0,"y":0,"width":10,"height":10},"style":{"font_size":2}});
        if kind == "image" { node["asset"] = "asset://image".into(); }
        let error = UiTree::from_json(screen(node)).unwrap_err();
        assert!(error.contains("UI_STYLE_INVALID") && error.contains("has no text"), "{error}");
    }
    let error = UiTree::from_json(screen(json!({"kind":"component","id":"group","component":"toolbar","rect":{"x":0,"y":0,"width":10,"height":10},"children":[],"style":{"opacity":0.5}}))).unwrap_err();
    assert!(error.contains("styles do not inherit"), "{error}");

    for kind in ["text", "button", "slider", "combobox", "image"] {
        let mut node = json!({"kind":kind,"id":"styled_leaf","rect":{"x":0,"y":0,"width":10,"height":10},"style":{"opacity":0.8},"children":[]});
        if kind == "image" { node["asset"] = "asset://image".into(); }
        else if kind != "text" { node["action"] = "Select".into(); }
        let error = UiTree::from_json(screen(node)).unwrap_err();
        assert!(error.contains("optional style"), "{kind} diagnostic must keep valid styling discoverable: {error}");
    }
}

#[test]
fn layout_diagnostics_use_explicit_font_size_without_resizing_the_ui() {
    let mut node = text(json!({"font_size":2}));
    let first = UiTree::from_json(screen(node.clone())).unwrap();
    node["rect"]["height"] = 24.into();
    let second = UiTree::from_json(screen(node)).unwrap();
    let a = unone_engine::inspect_layout(&first, 80, 45);
    let b = unone_engine::inspect_layout(&second, 80, 45);
    assert_eq!(a.nodes[0].text_fit, b.nodes[0].text_fit);
    assert_eq!(first.children[0].style().unwrap().font_size, Some(2.0));
}

#[test]
fn viewport_query_reports_the_same_host_aspect_used_by_anchors() {
    let payload = json!({
        "config":{"name":"ui-contract","entry_script":"main.luau","systems":{"ui":true}},
        "scene":{"entities":[]},
        "script":r#"local G={}
local function draw(api)
    local viewport = api.ui.getViewport()
    api.observation.set("aspect", viewport.aspect)
    api.ui.setRoot({kind="screen",id="responsive",node="layout",children={
        {kind="text",id="label",text="Responsive",anchor="bottom_right",size={width=20,height=6},style={font_size=2,padding={left=0.5},text_align="start"}},
        {kind="panel",id="surface",anchor="top_left",size={width=20,height=10},style={background={0.1,0.2,0.3,0.8}}}
    }})
end
G.start=draw
G.update=function(api,dt) draw(api) end
return G"#
    });
    let mut runtime = unone_engine::HostProject::parse(&serde_json::to_vec(&payload).unwrap())
        .unwrap().into_runtime(1).unwrap();
    assert_eq!(runtime.semantic_observations()["aspect"], json!(16.0 / 9.0));
    let wide = runtime.observe().ui.unwrap();
    runtime.set_viewport_aspect(9.0 / 16.0).unwrap();
    runtime.tick().unwrap();
    assert_eq!(runtime.semantic_observations()["aspect"], json!(9.0 / 16.0));
    let narrow = runtime.observe().ui.unwrap();
    assert!(wide.children[0].rect().width < narrow.children[0].rect().width);
    assert_eq!(wide.children[0].style(), narrow.children[0].style());
    assert_eq!(narrow.children[0].style().unwrap().font_size, Some(2.0));
}
