use serde_json::{Value, json};
use unone_engine::{EngineRuntime, HostProject};
const SCRIPT: &str = r#"
  local layout
  local function publish(api)
    local v=api.ui.getViewport()
    local full=layout.resolve(v).rect("content")
    local safe=layout.resolve(v,v.safeBounds).rect("content")
    local relative=api.ui.fitSafeArea({x=25,y=10,width=50,height=20})
    api.ui.setRoot({kind="screen",id="safe",node="safe",children={
      {kind="input_region",id="hit",action="Play",rect=safe}
    }})
    api.observation.set("viewport",{v=v,full=full,safe=safe,relative=relative})
  end
  return {start=function(api)
    layout=api.ui.components.createResponsiveLayout({variants={{name="base",minAspect=0,
      layout={id="content",kind="slot"},values={}}}})
    publish(api)
  end, update=publish}
"#;
fn boot(insets: Option<Value>) -> Result<EngineRuntime, Box<unone_engine::Diagnostic>> {
    let mut payload = json!({"config":{"name":"safe","entry_script":"main.luau","runtime_packages":{"@unone/ui":"0.6.0"}},"script":SCRIPT,"viewport_size":[1200,600]});
    if let Some(i) = insets {
        payload["viewport_safe_area"] = i;
    }
    HostProject::parse(&serde_json::to_vec(&payload).unwrap())?.into_runtime(3)
}
#[test]
fn first_frame_layout_uses_host_safe_bounds_and_default_is_full() {
    let stage = json!({"x":0,"y":0,"width":100,"height":100});
    let world = boot(None).unwrap().semantic_observations();
    assert_eq!(world["viewport"]["safe"], stage);
    assert_eq!(world["viewport"]["v"]["safeRect"], stage);
    let world = boot(Some(json!([10, 3, 20, 7])))
        .unwrap()
        .semantic_observations();
    let seen = &world["viewport"];
    assert_eq!(seen["full"], stage);
    assert_eq!(
        seen["v"]["safeInsets"],
        json!({"left":10,"top":3,"right":20,"bottom":7})
    );
    assert_eq!(
        seen["v"]["safeBounds"],
        json!({"left":10,"top":3,"width":70,"height":90})
    );
    assert_eq!(seen["safe"], json!({"x":10,"y":7,"width":70,"height":90}));
    assert_eq!(seen["v"]["safeRect"], seen["safe"]);
    assert_eq!(
        seen["relative"],
        json!({"x":27.5,"y":16,"width":35,"height":18})
    );
}
#[test]
fn changed_insets_bump_only_ui_viewport_revision_and_invalid_insets_are_atomic() {
    let mut runtime = boot(None).unwrap();
    let read = |runtime: &mut EngineRuntime| {
        runtime.tick().unwrap();
        runtime.semantic_observations()["viewport"]["v"].clone()
    };
    let before = read(&mut runtime);
    runtime.set_viewport_safe_area(9.0, 0.0, 1.0, 4.0).unwrap();
    let changed = read(&mut runtime);
    assert_eq!(
        changed["revision"].as_u64(),
        Some(before["revision"].as_u64().unwrap() + 1)
    );
    runtime.set_viewport_safe_area(9.0, 0.0, 1.0, 4.0).unwrap();
    runtime.set_viewport_size(1200, 600).unwrap();
    assert_eq!(read(&mut runtime), changed);
    for [l, t, r, b] in [
        [f64::NAN, 0.0, 0.0, 0.0],
        [-0.5, 0.0, 0.0, 0.0],
        [0.0, 90.0, 0.0, 10.0],
        [90.0, 0.0, 11.0, 0.0],
    ] {
        assert_eq!(
            runtime.set_viewport_safe_area(l, t, r, b).unwrap_err().code,
            "VIEWPORT_SAFE_AREA_INVALID"
        );
        assert_eq!(read(&mut runtime), changed);
    }
    runtime.set_viewport_safe_area(0.0, 0.0, 0.0, 0.0).unwrap();
    assert_eq!(read(&mut runtime)["safeRect"], before["safeRect"]);
    assert!(boot(Some(json!([101, 0, 0, 0]))).is_err());
}
