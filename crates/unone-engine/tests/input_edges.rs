use serde_json::{Value, json};
use unone_engine::{EngineRuntime, InputFrame};

const SOURCE: &str = r#"
local Game={}
local history={}
local function read(api)
    local values={}
    for _,action in ipairs({'A','B','Missing','Fail'}) do
        values[action]={down=api.input.isDown(action),pressed=api.input.wasPressed(action),released=api.input.wasReleased(action)}
        assert(values[action].pressed==api.input.wasPressed(action))
        assert(values[action].released==api.input.wasReleased(action))
    end
    return values
end
function Game.start(api) api.observation.set('start',read(api)) end
function Game.onReload(api)
    api.observation.set('reload',read(api))
    if api.input.isDown('ReloadFail') then error('reload failed') end
end
function Game.update(api)
    local current=read(api)
    api.observation.set('edges',current)
    table.insert(history,current)
    api.observation.set('history',history)
    if api.input.isDown('Fail') then error('tick failed') end
end
Game.replay={id='input-edges',version='1',inspect=function(_,api) return read(api) end}
return Game
"#;

fn runtime() -> EngineRuntime {
    EngineRuntime::load_source("input-edges", "main.luau", SOURCE, None).unwrap()
}

fn frame(actions: Value) -> InputFrame {
    serde_json::from_value(json!({"actions":actions})).unwrap()
}

fn state(down: bool, pressed: bool, released: bool) -> Value {
    json!({"down":down,"pressed":pressed,"released":released})
}

fn edge(runtime: &EngineRuntime, action: &str) -> Value {
    runtime.semantic_observations()["edges"][action].clone()
}

#[test]
fn edges_are_repeated_readable_press_hold_release_and_repress_snapshots() {
    let mut runtime=runtime();
    for action in ["A","B","Missing","Fail"] {
        assert_eq!(runtime.semantic_observations()["start"][action],state(false,false,false));
    }
    runtime.tick_with_input(&frame(json!({"A":true}))).unwrap();
    assert_eq!(edge(&runtime,"A"),state(true,true,false));
    assert_eq!(edge(&runtime,"Missing"),state(false,false,false));
    runtime.tick_with_input(&frame(json!({"A":true,"B":true}))).unwrap();
    assert_eq!(edge(&runtime,"A"),state(true,false,false));
    assert_eq!(edge(&runtime,"B"),state(true,true,false));
    // A missing from a complete host frame is released, as is explicit false.
    runtime.tick_with_input(&frame(json!({"B":false}))).unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,true));
    assert_eq!(edge(&runtime,"B"),state(false,false,true));
    runtime.tick_with_input(&InputFrame::default()).unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,false));
    runtime.tick_with_input(&frame(json!({"A":true}))).unwrap();
    assert_eq!(edge(&runtime,"A"),state(true,true,false));
    assert_eq!(runtime.observe().frame,5);
}

#[test]
fn incremental_native_host_writes_use_final_held_state_at_the_tick_boundary() {
    let mut runtime=runtime();
    runtime.set_input("A",true);
    runtime.set_input("A",false);
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,false));
    runtime.set_input("A",false);
    runtime.set_input("A",true);
    runtime.set_input("B",true);
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(true,true,false));
    assert_eq!(edge(&runtime,"B"),state(true,true,false));
    // Incremental set_input retains other held actions, preserving isDown.
    runtime.set_input("A",false);
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,true));
    assert_eq!(edge(&runtime,"B"),state(true,false,false));
    // Two host toggles ending at the previous held value introduce no edge.
    runtime.set_input("B",false);
    runtime.set_input("B",true);
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"B"),state(true,false,false));
}

#[test]
fn headless_input_sequence_has_the_same_edges_and_releases_missing_frames() {
    let mut runtime=runtime();
    let sequence=[frame(json!({"A":true})),frame(json!({"A":true}))];
    let report=runtime.run_with_input_sequence(4,0,&sequence);
    assert!(report.ok,"{report:?}");
    let history=&runtime.semantic_observations()["history"];
    assert_eq!(history[0]["A"],state(true,true,false));
    assert_eq!(history[1]["A"],state(true,false,false));
    assert_eq!(history[2]["A"],state(false,false,true));
    assert_eq!(history[3]["A"],state(false,false,false));
}

#[cfg(feature="dev-tools")]
fn inspect(runtime: &EngineRuntime) -> Value {
    runtime.replay_adapter_call("inspect",json!({})).unwrap()
}

#[test]
#[cfg(feature="dev-tools")]
fn failed_ticks_restore_published_edges_and_preserve_the_retry_baseline() {
    let mut runtime=runtime();
    runtime.set_input("A",true);
    runtime.set_input("Fail",true);
    assert!(runtime.tick().unwrap_err().explanation.contains("tick failed"));
    assert_eq!(runtime.observe().frame,0);
    assert_eq!(inspect(&runtime)["A"],state(true,false,false));
    runtime.set_input("Fail",false);
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(true,true,false));
    // Erroring while held must restore the previously published press snapshot.
    runtime.set_input("Fail",true);
    assert!(runtime.tick().is_err());
    assert_eq!(runtime.observe().frame,1);
    assert_eq!(inspect(&runtime)["A"],state(true,true,false));
    runtime.set_input("A",false);
    assert!(runtime.tick().is_err());
    assert_eq!(inspect(&runtime)["A"],state(false,true,false));
    runtime.set_input("Fail",false);
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,true));
    assert_eq!(edge(&runtime,"Fail"),state(false,false,false));
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,false));
}

#[test]
#[cfg(feature="dev-tools")]
fn reload_and_replay_reads_do_not_publish_or_consume_pending_host_edges() {
    let mut runtime=runtime();
    runtime.set_input("A",true);
    runtime.reload_source(SOURCE.replace("id='input-edges'","id='input-edges-reloaded'")).unwrap();
    assert_eq!(runtime.replay_adapter_identity().unwrap()["id"],"input-edges-reloaded");
    assert_eq!(runtime.semantic_observations()["reload"]["A"],state(true,false,false));
    assert_eq!(inspect(&runtime)["A"],state(true,false,false));
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(true,true,false));
    assert_eq!(inspect(&runtime)["A"],state(true,true,false));
    assert_eq!(inspect(&runtime)["A"],state(true,true,false));
    runtime.set_input("A",false);
    runtime.reload_source(SOURCE).unwrap();
    assert_eq!(runtime.replay_adapter_identity().unwrap()["id"],"input-edges");
    assert_eq!(runtime.semantic_observations()["reload"]["A"],state(false,true,false));
    runtime.set_input("ReloadFail",true);
    assert!(runtime.reload_source(SOURCE.replace("id='input-edges'","id='rejected-candidate'")).unwrap_err().explanation.contains("reload failed"));
    assert_eq!(runtime.replay_adapter_identity().unwrap()["id"],"input-edges");
    assert_eq!(inspect(&runtime)["A"],state(false,true,false));
    runtime.tick().unwrap();
    assert_eq!(edge(&runtime,"A"),state(false,false,true));
    runtime.reload_source(SOURCE).unwrap_err();
    assert_eq!(inspect(&runtime)["A"],state(false,false,true));
    assert_eq!(runtime.observe().frame,2);
}
