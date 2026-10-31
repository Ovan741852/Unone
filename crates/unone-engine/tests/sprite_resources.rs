use serde_json::{json, Value};
use unone_engine::{AssetCatalogEntry, EngineRuntime, InputFrame, SourceProject};

fn load(source: &str) -> EngineRuntime {
    EngineRuntime::load_source_project(SourceProject {
        source: source.into(), asset_catalog: vec![AssetCatalogEntry { id: "texture://hero".into(), kind: "texture2d".into() }],
        scene: Some(unone_engine::parse_scene_fragment(r#"{"shader_materials":{"tint":{"fragment":"vec4 unoneShade(vec2 uv, vec4 color) { return color * shade; }","uniforms":{"shade":[1,1,1,1]}}}}"#).unwrap()),
        ..Default::default()
    }).unwrap()
}
fn frame(input: Value) -> InputFrame { serde_json::from_value(input).unwrap() }
fn ready(id: &str, epoch: u64) -> Value {
    json!({"resources":[{"id":id,"state":"ready","epoch":epoch,"bytes":4096}]})
}
const SCRIPT: &str = r#"
local Game = {}; local lease; local entity; local revision
local appearance = { transform = { position={x=7,y=9}, rotation=.5, scale={x=2,y=3} },
    size={x=4,y=5}, sheet={columns=2,rows=2}, frame=3, uniforms={shade={.2,.3,.4,.5}} }
function Game.start(api)
    entity=api.entity.spawn('hero'); lease=api.sprite.prepare('texture://hero','tint')
    assert(type(lease)=='userdata' and type(lease.id)=='string')
    assert(not pcall(function() lease.id='forged' end))
    assert(not pcall(api.save.set,lease))
end
function Game.update(api)
    if api.input.isDown('commit') then revision=api.sprite.commit(entity,lease,appearance) end
    if api.input.isDown('release') then api.sprite.release(lease); api.sprite.release(lease) end
    if api.input.isDown('hide') then api.entity.setSpriteVisible(entity,false) end
    if api.input.isDown('move') then api.entity.setPosition(entity,{x=11,y=12}) end
    if api.input.isDown('frame') then api.entity.setSpriteFrame(entity,2) end
    if api.input.isDown('bad') then
        local bad=table.clone(appearance); bad.uniforms={shade=4}
        assert(not pcall(api.sprite.commit,entity,lease,bad))
    end
    if api.input.isDown('fail') then error('expected update failure') end
    api.observation.set('status',api.sprite.status(lease))
    api.observation.set('commit',api.sprite.getCommit(entity))
    api.observation.set('revision',revision)
end
return Game
"#;

#[test]
fn readiness_and_submission_are_distinct_atomic_nonconsuming_transactions() {
    let mut runtime = load(SCRIPT);
    let plan = runtime.sprite_resource_plan_since(None);
    let id = plan.resources.unwrap()[0].id.clone();
    assert!(runtime.sprite_resource_plan_since(Some(plan.revision)).resources.is_none());
    let loading = runtime.tick_with_input(&frame(json!({"actions":{"commit":true}}))).unwrap();
    assert!(loading.entities["hero"].sprite.is_none());
    assert_eq!(loading.observations["commit"]["state"], "none");
    let visible = runtime.tick_with_input(&frame(json!({"actions":{"commit":true},"presentation_resources":ready(&id,1)}))).unwrap();
    let entity = &visible.entities["hero"];
    assert_eq!(entity.transform.x, 7.); assert_eq!(entity.sprite.as_ref().unwrap().frame, 3);
    assert_eq!(entity.sprite_uniforms["shade"], unone_engine::ShaderUniform::Vec4([0.2,0.3,0.4,0.5]));
    assert_eq!(visible.shader_materials["tint"].uniforms["shade"], unone_engine::ShaderUniform::Vec4([1.,1.,1.,1.]));
    assert_eq!(visible.observations["commit"]["state"], "pending");
    let revision = entity.sprite_appearance.as_ref().unwrap().revision;
    let unchanged = runtime.tick_with_input(&frame(json!({"actions":{"commit":true,"bad":true}}))).unwrap();
    assert_eq!(unchanged.entities["hero"].sprite_appearance.as_ref().unwrap().revision, revision);
    let submitted = runtime.tick_with_input(&frame(json!({"presentation_resources":{"appearances":[{"entity":"hero","revision":revision,"state":"submitted","epoch":1}]}}))).unwrap();
    assert_eq!(submitted.observations["commit"]["submittedRevision"], revision);
    let stale = runtime.tick_with_input(&frame(json!({"presentation_resources":{"resources":[{"id":id,"state":"loading","epoch":2,"bytes":0}],"appearances":[{"entity":"hero","revision":revision,"state":"submitted","epoch":1}]}}))).unwrap();
    assert_eq!(stale.observations["commit"]["state"], "pending");
    assert_eq!(stale.observations["status"]["epoch"], 2);
}

#[test]
fn failed_tick_keeps_feedback_pending_and_rolls_back_only_atomic_appearance() {
    let mut runtime = load(SCRIPT);
    let id = runtime.sprite_resource_plan()[0].id.clone();
    assert!(runtime.tick_with_input(&frame(json!({"actions":{"commit":true,"fail":true},"presentation_resources":ready(&id,1)}))).is_err());
    assert!(runtime.observe().entities["hero"].sprite.is_none());
    let retry = runtime.tick_with_input(&frame(json!({"actions":{"commit":true}}))).unwrap();
    assert_eq!(retry.observations["status"]["state"], "ready");
    assert!(retry.entities["hero"].sprite.is_some());
    assert_eq!(retry.entities["hero"].sprite_appearance.as_ref().unwrap().revision, 1);
}

#[test]
fn release_drops_caller_demand_but_visible_entity_keeps_resource_until_hidden() {
    let mut runtime = load(SCRIPT);
    let id = runtime.sprite_resource_plan()[0].id.clone();
    runtime.tick_with_input(&frame(json!({"actions":{"commit":true},"presentation_resources":ready(&id,1)}))).unwrap();
    let released = runtime.tick_with_input(&frame(json!({"actions":{"release":true}}))).unwrap();
    assert_eq!(released.observations["status"]["state"], "released");
    assert_eq!(runtime.sprite_resource_plan().len(), 1);
    runtime.tick_with_input(&frame(json!({"actions":{"hide":true}}))).unwrap();
    assert!(runtime.sprite_resource_plan().is_empty());
}

#[test]
fn feedback_is_closed_bounded_and_exact_before_admission() {
    for input in [
        json!({"presentation_resources":{"typo":[]}}),
        json!({"presentation_resources":{"resources":[{"id":"1","state":"released","epoch":1,"bytes":0}]}}),
        json!({"presentation_resources":{"resources":[{"id":"1","state":"ready","epoch":1.5,"bytes":0}]}}),
        json!({"presentation_resources":{"resources":[{"id":"1","state":"ready","epoch":9007199254740992u64,"bytes":0}]}}),
        json!({"presentation_resources":{"resources":[{"id":"1","state":"ready","epoch":1,"bytes":1073741825u64}]}}),
    ] { assert!(serde_json::from_value::<InputFrame>(input).map(|f| f.validate().is_err()).unwrap_or(true)); }
}

#[test]
fn failed_release_and_failed_reload_preserve_live_resource_and_world() {
    let mut runtime = load(SCRIPT);
    let id = runtime.sprite_resource_plan()[0].id.clone();
    runtime.tick_with_input(&frame(json!({"presentation_resources":ready(&id,1)}))).unwrap();
    assert!(runtime.tick_with_input(&frame(json!({"actions":{"release":true,"fail":true}}))).is_err());
    let next = runtime.tick_with_input(&InputFrame::default()).unwrap();
    assert_eq!(next.observations["status"]["state"], "ready");
    #[cfg(feature = "dev-tools")] {
        let before = unone_engine::observation_digest(&runtime.observe()).unwrap();
        let plan = runtime.sprite_resource_plan_since(None);
        assert!(runtime.reload_source(r#"local Game={}; function Game.start(api) end; function Game.update(api) end
            function Game.onReload(api) local lease=api.sprite.prepare('texture://hero'); error('candidate rejected') end
            return Game"#).is_err());
        assert_eq!(unone_engine::observation_digest(&runtime.observe()).unwrap(), before);
        assert_eq!(runtime.sprite_resource_plan()[0].id, id);
        assert!(runtime.sprite_resource_plan_since(Some(plan.revision)).resources.is_none());
    }
}

#[test]
fn live_pose_preserves_appearance_ack_but_legacy_uv_edit_invalidates_it() {
    let mut runtime = load(SCRIPT);
    let id = runtime.sprite_resource_plan()[0].id.clone();
    let committed = runtime.tick_with_input(&frame(json!({"actions":{"commit":true},"presentation_resources":ready(&id,1)}))).unwrap();
    let revision = committed.entities["hero"].sprite_appearance.as_ref().unwrap().revision;
    let moved = runtime.tick_with_input(&frame(json!({"actions":{"move":true},"presentation_resources":{"appearances":[{"entity":"hero","revision":revision,"state":"submitted","epoch":1}]}}))).unwrap();
    assert_eq!(moved.entities["hero"].transform.x, 11.);
    assert_eq!(moved.observations["commit"]["submittedRevision"], revision);
    let edited = runtime.tick_with_input(&frame(json!({"actions":{"frame":true}}))).unwrap();
    assert!(edited.entities["hero"].sprite_appearance.is_none());
    assert_eq!(edited.observations["commit"]["state"], "none");
}
