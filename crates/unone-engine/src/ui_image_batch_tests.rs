use super::{UiImageQuad, UiRect, UiTree};
use serde_json::{Value, json};

fn quad(asset: &str) -> Value {
    json!({"asset":asset,"rect":{"x":10,"y":10,"width":20,"height":20}})
}

fn batch() -> Value {
    json!({"kind":"image_batch","id":"art","rect":{"x":0,"y":0,"width":100,"height":100},
        "quads":[quad("texture://red"),quad("texture://blue")]})
}

fn screen(node: Value) -> Value {
    json!({"kind":"screen","id":"s","node":"s","children":[node]})
}

#[test]
fn pixel_snap_is_an_optional_nonnullable_boolean_on_image_batch_instances_only() {
    let original=screen(batch());
    let mut value=original.clone();
    value["children"][0]["pixel_snap"]=json!(false);
    assert_eq!(serde_json::to_value(UiTree::from_json(value).unwrap()).unwrap(),serde_json::to_value(UiTree::from_json(original.clone()).unwrap()).unwrap());
    let mut value=original.clone();value["children"][0]["pixel_snap"]=json!(true);
    assert_eq!(serde_json::to_value(UiTree::from_json(value).unwrap()).unwrap()["children"][0]["pixel_snap"],true);
    for bad in [json!(0),json!("true"),json!({}),Value::Null] {
        let mut value=original.clone();value["children"][0]["pixel_snap"]=bad;
        assert!(UiTree::from_json(value).is_err());
    }
    let mut value=original.clone();value["children"][0]["pixelSnap"]=json!(true);
    assert!(UiTree::from_json(value).unwrap_err().contains("unknown field"));
    let value=screen(json!({"kind":"panel","id":"panel","rect":{"x":0,"y":0,"width":10,"height":10},"pixel_snap":false}));
    assert!(UiTree::from_json(value).unwrap_err().contains("UI_IMAGE_BATCH_KIND"));
}

#[cfg(feature="dev-tools")]
#[test]
fn pixel_snap_schema_declares_optional_boolean_without_null() {
    let schema=crate::contract_schema("ui").unwrap();
    let node=&schema["$defs"]["RawUiNode"];
    assert_eq!(node["properties"]["pixel_snap"]["type"],"boolean");
    assert_eq!(node["properties"]["pixel_snap"]["default"],false);
    assert!(!node["required"].as_array().unwrap().iter().any(|field|field=="pixel_snap"));
}

#[test]
fn image_batch_rejects_anchor_before_it_can_drift_from_absolute_quads() {
    let mut node = batch();
    node.as_object_mut().unwrap().remove("rect");
    node["anchor"] = json!("center");
    node["size"] = json!({"width": 100, "height": 100});
    for aspect in [16.0 / 9.0, 9.0 / 16.0] {
        assert!(UiTree::from_json_for_viewport(screen(node.clone()), aspect)
            .unwrap_err().contains("UI_IMAGE_BATCH_PLACEMENT"));
    }
}

#[test]
fn image_batch_roundtrip_order_and_usage() {
    let mut value = screen(batch());
    value["children"][0]["quads"][1]["opacity"] = json!(0.5);
    value["children"][0]["quads"][1]["source"] = json!({"x":1,"y":2,"width":3,"height":4});
    let tree = UiTree::from_json(value).unwrap();
    let usage = tree.usage();
    assert_eq!((usage.logical_nodes, usage.leaf_nodes, usage.render_regions_upper_bound), (3, 1, 2));
    assert_eq!(usage.subtrees, vec![("art".into(), 3)]);
    let serialized = serde_json::to_value(&tree).unwrap();
    assert_eq!(serialized["children"][0]["quads"][0]["asset"], "texture://red");
    assert_eq!(serialized["children"][0]["quads"][1]["asset"], "texture://blue");
    assert!(serialized["children"][0]["quads"][0].get("opacity").is_none());
    assert_eq!(UiTree::from_json(serialized).unwrap(), tree);
}

#[test]
fn image_batch_preserves_existing_node_and_string_budgets() {
    let mut value = screen(batch());
    value["budget"] = json!({"max_nodes":3});
    assert!(UiTree::from_json(value.clone()).is_ok());
    value["budget"]["max_nodes"] = json!(2);
    assert!(UiTree::from_json(value).unwrap_err().contains("UI_NODE_LIMIT"));
    let mut many = batch();
    many["quads"] = json!(vec![quad("texture://red"); 1024]);
    let mut value = screen(many);
    value["budget"] = json!({"max_nodes":1024});
    assert!(UiTree::from_json(value).unwrap_err().contains("used=1025"));
    let mut long = batch();
    let asset = "texture://".to_string() + &"a".repeat(super::ui_contract().max_string_bytes / 2);
    long["quads"] = json!([quad(&asset),quad(&asset)]);
    assert!(UiTree::from_json(screen(long)).unwrap_err().contains("UI_STRING_LIMIT"));
}

#[test]
fn image_batch_rejects_non_art_fields_and_unknown_quad_payloads() {
    for (key, value) in [("text", json!("hidden")), ("action", json!("Click")),
        ("asset", json!("texture://other")), ("fit", json!("cover")),
        ("style", json!({"opacity":0.5})), ("children", json!([])), ("alt", json!("caption"))] {
        let mut node = batch();
        node[key] = value;
        assert!(UiTree::from_json(screen(node)).is_err(), "accepted field {key}");
    }
    for key in ["id", "text", "action", "fit", "children", "unknown"] {
        let mut node = batch();
        node["quads"][0][key] = json!("invalid");
        assert!(UiTree::from_json(screen(node)).unwrap_err().contains("unknown field"), "{key}");
    }
    let mut image = batch(); image["kind"] = json!("image");
    assert!(UiTree::from_json(screen(image)).unwrap_err().contains("UI_IMAGE_BATCH_KIND"));
    let mut empty = batch(); empty["quads"] = json!([]);
    assert!(UiTree::from_json(screen(empty)).unwrap_err().contains("UI_IMAGE_BATCH_EMPTY"));
}

#[test]
fn image_batch_validates_every_quad_geometry_source_and_opacity() {
    for (field, value) in [("asset", json!("")), ("asset", json!("https://example.invalid/a.png")),
        ("opacity", json!(-0.1)), ("opacity", json!(1.1)),
        ("rect", json!({"x":99,"y":10,"width":2,"height":20})),
        ("source", json!({"x":-1,"y":0,"width":1,"height":1})),
        ("source", json!({"x":0,"y":0,"width":0,"height":1}))] {
        let mut node = batch(); node["quads"][1][field] = value;
        assert!(UiTree::from_json(screen(node)).is_err(), "accepted {field}");
    }
    let mut node = batch();
    node["rect"] = json!({"x":0,"y":0,"width":20,"height":20});
    assert!(UiTree::from_json(screen(node)).unwrap_err().contains("UI_IMAGE_BATCH_BOUNDS"));
    let quad = UiImageQuad { asset:"texture://a".into(), rect:UiRect{x:0.,y:0.,width:1.,height:1.},source:None,opacity:Some(f64::NAN) };
    assert!(quad.validate(UiRect{x:0.,y:0.,width:100.,height:100.}).unwrap_err().contains("OPACITY"));
}

#[test]
fn image_batch_stage_only_including_nested_scroll_components() {
    let component = |child| json!({"kind":"component","id":"owner","component":"art",
        "rect":{"x":0,"y":0,"width":100,"height":100},"children":[child]});
    assert!(UiTree::from_json(screen(component(batch()))).is_ok());
    let scroll = json!({"kind":"scroll_view","id":"scroll","rect":{"x":0,"y":0,"width":100,"height":100},
        "scroll":{"axis":"vertical"},
        "children":[component(batch())]});
    assert!(UiTree::from_json(screen(scroll)).unwrap_err().contains("UI_IMAGE_BATCH_SPACE"));
}

#[test]
fn image_batch_layout_composite_keeps_external_control_checks() {
    let mut node = batch(); node["quads"] = json!(vec![quad("texture://red"); 100]);
    let mut value = screen(node);
    let report = crate::layout::inspect(&UiTree::from_json(value.clone()).unwrap(), 32, 16);
    assert_eq!(report.nodes.len(), 1);
    assert!(report.findings.is_empty());
    value["children"].as_array_mut().unwrap().push(json!({"kind":"button","id":"play","text":"Play","action":"Play",
        "rect":{"x":10,"y":10,"width":20,"height":20}}));
    let report = crate::layout::inspect(&UiTree::from_json(value.clone()).unwrap(), 32, 16);
    assert_eq!(report.findings.len(), 1);
    value["children"][0]["background_for"] = json!({"screen":true});
    let report = crate::layout::inspect(&UiTree::from_json(value).unwrap(), 32, 16);
    assert!(report.findings.is_empty());
    assert_eq!(report.allowed_overlaps.len(), 1);
}

#[test]
fn image_batch_external_policy_requires_earlier_art_and_real_overlap() {
    let mut value = screen(batch());
    value["children"].as_array_mut().unwrap().push(json!({"kind":"panel","id":"front",
        "rect":{"x":10,"y":10,"width":20,"height":20}}));
    let mut report = crate::layout::inspect(&UiTree::from_json(value).unwrap(), 32, 16);
    let policy = json!({"version":1,"screens":{"s":[{"behind":"art","front":"front","reason":"intentional art"}]}});
    crate::layout::apply_overlap_policy(&mut report, &policy).unwrap();
    assert!(report.readable);
    let reverse = json!({"version":1,"screens":{"s":[{"behind":"front","front":"art","reason":"unsafe order"}]}});
    assert!(crate::layout::apply_overlap_policy(&mut report, &reverse).unwrap_err().contains("UNSAFE"));
}

#[test]
fn image_batch_decoded_source_bounds_are_explicit() {
    let mut q:UiImageQuad = serde_json::from_value(quad("texture://a")).unwrap();
    assert_eq!(q.source_for_size(5.,8.).unwrap(), UiRect{x:0.,y:0.,width:5.,height:8.});
    q.source = Some(UiRect{x:4.,y:0.,width:2.,height:1.});
    assert!(q.source_for_size(5.,8.).unwrap_err().contains("UI_IMAGE_BATCH_SOURCE_BOUNDS"));
    assert!(q.source_for_size(f64::INFINITY,8.).is_err());
}
