use unone_engine::EngineRuntime;
use serde_json::json;

fn runtime(body:&str)->EngineRuntime {
    EngineRuntime::load_source("cursor","main.luau",&format!(
        "return {{start=function(api) {body} end,update=function()end}}"),None).unwrap()
}

#[test]
fn default_cursor_keeps_old_snapshot_shape() {
    let r=runtime("");
    assert!(serde_json::to_value(r.observe()).unwrap().get("ui_cursor").is_none());
}

#[test]
fn cursor_image_is_detached_and_reset_is_explicit() {
    let r=runtime("local c={kind='image',asset='texture://point',width=17,height=19,hotspot_x=3,hotspot_y=5,filter='nearest'};api.ui.setCursor(c);c.width=200");
    let j=serde_json::to_value(r.observe()).unwrap();
    assert_eq!(j["ui_cursor"],json!({"kind":"image","asset":"texture://point","width":17,"height":19,"hotspot_x":3,"hotspot_y":5,"filter":"nearest"}));
    let r=runtime("api.ui.setCursor({kind='hidden'});api.ui.setCursor({kind='default'})");
    assert!(serde_json::to_value(r.observe()).unwrap().get("ui_cursor").is_none());
}

#[test]
fn invalid_cursor_is_rejected_before_replacing_last_valid_state() {
    let invalid=["{kind='hand'}","{kind='hidden',asset='texture://x'}",
        "{kind='image',asset='texture://x',width=0,height=9,hotspot_x=0,hotspot_y=0,filter='nearest'}",
        "{kind='image',asset='texture://x',width=17,height=9,hotspot_x=17,hotspot_y=0,filter='nearest'}",
        "{kind='image',asset='texture://x',width=17.5,height=9,hotspot_x=0,hotspot_y=0,filter='nearest'}",
        "{kind='image',asset='texture://x',width=17,height=9,hotspot_x=0,hotspot_y=0,filter='cubic'}",
        "{kind='image',asset='',width=17,height=9,hotspot_x=0,hotspot_y=0,filter='nearest'}",
        "{kind='image',asset='texture://x',width=513,height=9,hotspot_x=0,hotspot_y=0,filter='nearest'}",
        "{kind='image',asset='texture://x',width=17,height=9,hotspot_x=0,hotspot_y=0,filter='nearest',unknown=true}"];
    for value in invalid {
        let r=runtime(&format!("api.ui.setCursor({{kind='hidden'}});assert(not pcall(api.ui.setCursor,{value}))"));
        assert_eq!(serde_json::to_value(r.observe()).unwrap()["ui_cursor"],json!({"kind":"hidden"}));
    }
}
