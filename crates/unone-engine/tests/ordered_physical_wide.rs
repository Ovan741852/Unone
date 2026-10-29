use serde_json::{json, Value};
use unone_engine::{EngineRuntime, InputFrame};

const MAX_SAFE: u64 = 9_007_199_254_740_991;
const SOURCE: &str = r#"
local Game={}
function Game.start(api) api.observation.set('outside',api.input.getPhysicalBatch()==nil) end
function Game.update(api)
    local b=api.input.getPhysicalBatch()
    if not b then return end
    api.observation.set('epoch',b.epoch)
    api.observation.set('events',b.events)
    if #b.events==0 then return end
    local e=b.events[1]
    api.observation.set('exact',{e.received_us,e.pointer_id,e.point.viewport.revision})
    e.received_us=0;e.point.viewport.revision=0
    local next=api.input.getPhysicalBatch().events[1]
    api.observation.set('detached',next.received_us~=0 and next.point.viewport.revision~=0)
end
return Game
"#;

fn runtime() -> EngineRuntime {
    EngineRuntime::load_source("wide-physical", "main.luau", SOURCE, None).unwrap()
}

fn batch(wide: u64) -> Value {
    json!({"profile":"ordered_physical_v1","epoch":wide,"after_sequence":0,"through_sequence":1,
        "events":[{"sequence":1,"received_us":wide,"origin":"fixture","route":"game",
            "kind":"pointer","pointer_id":wide,"pointer_type":"mouse","phase":"move","button":-1,"buttons":0,
            "point":{"x":1494,"y":47,"inside":true,"viewport":{"revision":wide,"width":1591,"height":1188,
                "rect_left":0,"rect_top":0,"css_width":1591,"css_height":1188,"device_pixel_ratio":1}},
            "modifiers":{"shift":false,"control":false,"alt":false,"meta":false}}]})
}

fn frame(batch: Value) -> InputFrame {
    serde_json::from_value(json!({"physical":batch})).unwrap()
}

#[test]
fn physical_safe_integer_metadata_crosses_i32_and_u32_without_fault_or_rounding() {
    for wide in [2_147_483_647, 2_147_483_648, 2_148_050_399, 4_294_967_295, MAX_SAFE] {
        let mut r=runtime();
        assert_eq!(r.semantic_observations()["outside"],true);
        let tick=r.tick_with_input(&frame(batch(wide)));
        assert!(tick.is_ok(),"wide {wide}: {tick:?}");
        let observed=r.semantic_observations();
        assert_eq!(observed["epoch"].as_f64(),Some(wide as f64));
        assert_eq!(observed["detached"],true);
        for value in observed["exact"].as_array().unwrap() {
            assert_eq!(value.as_f64(),Some(wide as f64));
        }
        let report=r.physical_input_report();
        assert_eq!(report["receipt"]["epoch"],wide);
        assert_eq!(report["last_receive"],wide);
        assert_eq!(report["terminal"],Value::Null);
    }
}

#[test]
fn physical_outside_safe_range_is_rejected_before_execution_and_recovery_is_possible() {
    for path in ["epoch","time","pointer","viewport"] {
        let mut value=batch(10);
        match path {
            "epoch"=>value["epoch"]=json!(MAX_SAFE+1),
            "time"=>value["events"][0]["received_us"]=json!(MAX_SAFE+1),
            "pointer"=>value["events"][0]["pointer_id"]=json!(MAX_SAFE+1),
            _=>value["events"][0]["point"]["viewport"]["revision"]=json!(MAX_SAFE+1),
        }
        let mut r=runtime();
        assert!(r.tick_with_input(&frame(value)).is_err(),"accepted {path}");
        assert_eq!(r.observe().frame,0);
        assert_eq!(r.physical_input_report()["terminal"],Value::Null);
        r.tick_with_input(&frame(batch(10))).unwrap();
    }
}

#[test]
fn wide_physical_epoch_keeps_empty_array_identity_and_existing_time_order() {
    let mut value=batch(MAX_SAFE);value["events"]=json!([]);value["through_sequence"]=json!(0);
    let mut r=runtime();r.tick_with_input(&frame(value)).unwrap();
    assert_eq!(r.semantic_observations()["events"],json!([]));
    r.tick_with_input(&frame(batch(MAX_SAFE))).unwrap();
    let mut late=batch(MAX_SAFE);late["after_sequence"]=json!(1);late["through_sequence"]=json!(2);
    late["events"][0]["sequence"]=json!(2);late["events"][0]["received_us"]=json!(MAX_SAFE-1);
    assert!(r.tick_with_input(&frame(late)).is_err());
    assert_eq!(r.physical_input_report()["last_receive"],MAX_SAFE);
    assert_eq!(r.physical_input_report()["terminal"],Value::Null);
}

#[test]
fn wide_physical_records_replay_with_exact_original_input_and_detached_observations() {
    let dir=tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("main.luau"),SOURCE).unwrap();
    std::fs::write(dir.path().join("project.unone.json"),
        json!({"name":"wide-physical-replay","entry_script":"main.luau"}).to_string()).unwrap();
    let run=unone_engine::record_run(dir.path(),1,42,&[frame(batch(MAX_SAFE))]);
    assert!(run.ok,"{:?}",run.diagnostics);
    let recording=run.value.unwrap();
    assert!(unone_engine::diff_run(dir.path(),&recording).value.unwrap().identical);
}
