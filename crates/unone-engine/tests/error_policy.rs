//! Released players may recover from a UI publish over capacity and from an
//! error escaping Game.update; every tool keeps failing fast. See
//! docs/ui-slice-and-budget.md and docs/player-export.md#runtime-errors.
use serde_json::{Value, json};
use unone_engine::{EngineRuntime, HostProject, observation_digest};

// Three nodes fit the screen's budget; holding "Grow" publishes a fourth.
const GROWING_SCREEN: &str = r#"
local function screen(count)
    local children={}
    for i=1,count do children[i]={kind='panel',id='panel-'..i,rect={x=0,y=0,width=10,height=10}} end
    return {kind='screen',id='screen',node='screen',budget={max_nodes=3},children=children}
end
return {start=function(api)
    assert(api.ui.setRoot(screen(3))==true)
end,update=function(api)
    local published=api.ui.setRoot(screen(api.input.isDown('Grow') and 4 or 2))
    api.observation.set('published',published)
    api.observation.set('after_publish',true)
    local report=api.ui.inspect()
    api.observation.set('rejections',report.rejections)
    if report.last_rejection then api.observation.set('last_rejection',report.last_rejection) end
end}"#;

fn load(script: &str, policy: Option<Value>) -> Result<EngineRuntime, Box<unone_engine::Diagnostic>> {
    let mut payload = json!({"config":{"name":"error-policy","entry_script":"main.luau"},"script":script});
    if let Some(policy) = policy { payload["error_policy"] = policy; }
    HostProject::parse(&serde_json::to_vec(&payload).unwrap())?.into_runtime(42)
}

fn ui_ids(runtime: &EngineRuntime) -> Vec<String> {
    let tree = serde_json::to_value(runtime.observe().ui.as_ref().unwrap()).unwrap();
    tree["children"].as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap().to_owned()).collect()
}

#[test]
fn an_over_budget_publish_keeps_the_previous_screen_and_the_game_keeps_running() {
    let mut game = load(GROWING_SCREEN, Some(json!({"ui_capacity":"keep_previous"}))).unwrap();
    game.tick().unwrap();
    assert_eq!(ui_ids(&game), ["panel-1", "panel-2"]);
    game.set_input("Grow", true);
    let snapshot = game.tick().unwrap();
    assert_eq!(snapshot.frame, 2);
    assert_eq!(ui_ids(&game), ["panel-1", "panel-2"], "the previous valid screen stays published");
    let observed = game.semantic_observations();
    assert_eq!(observed["published"], json!(false));
    assert_eq!(observed["after_publish"], json!(true), "setRoot returned; the rest of the update ran");
    assert_eq!(observed["rejections"].as_f64(), Some(1.));
    let rejection = &observed["last_rejection"];
    assert_eq!(rejection["code"], "UI_NODE_LIMIT");
    assert_eq!(rejection["path"], "root.children[3]");
    assert_eq!(rejection["node"], "panel-4");
    assert_eq!((rejection["used"].as_f64(), rejection["limit"].as_f64()), (Some(4.), Some(3.)));
    assert_eq!(rejection["frame"].as_f64(), Some(2.), "the frame whose snapshot would have carried the tree");
    let recovered = serde_json::to_value(snapshot.recovered_errors.as_ref().unwrap()).unwrap();
    assert_eq!(recovered["ui_rejections"], 1);
    assert_eq!(recovered["last_ui_rejection"]["code"], "UI_NODE_LIMIT");
    assert_eq!(recovered["script_errors"], 0);
    // Rejections repeat while the data stays too large; the game is not stopped.
    for frame in 3..=5 { assert_eq!(game.tick().unwrap().frame, frame); }
    assert_eq!(game.recovered_errors().unwrap().ui_rejections, 4);
    game.set_input("Grow", false);
    game.tick().unwrap();
    assert_eq!(game.semantic_observations()["published"], json!(true));
    assert_eq!(ui_ids(&game), ["panel-1", "panel-2"]);
}

#[test]
fn the_strict_default_still_fails_on_an_over_budget_publish() {
    for policy in [None, Some(json!({})), Some(json!({"script_errors":"continue","ui_capacity":"fail"}))] {
        let mut game = load(GROWING_SCREEN, policy.clone()).unwrap();
        game.tick().unwrap();
        game.set_input("Grow", true);
        let result = game.tick();
        if policy.as_ref().is_some_and(|p| p["script_errors"] == "continue") {
            // The raise escapes Game.update, so a continuing policy skips the
            // rest of that update instead: nothing after setRoot ran.
            let snapshot = result.unwrap();
            let recovered = snapshot.recovered_errors.unwrap();
            assert_eq!((recovered.ui_rejections, recovered.script_errors), (0, 1));
            assert!(recovered.last_script_error.unwrap().message.contains("UI_NODE_LIMIT"));
            continue;
        }
        let error = result.unwrap_err();
        assert_eq!(error.code, "LUAU_RUNTIME_ERROR", "{policy:?}");
        assert!(error.explanation.contains("UI_NODE_LIMIT: path=root.children[3], node=\"panel-4\", used=4, limit=3"), "{}", error.explanation);
        assert!(!error.explanation.contains("anchor+size"), "placement guidance is for malformed trees only");
    }
}

#[test]
fn a_strict_game_that_catches_the_rejection_reads_it_and_snapshots_stay_unchanged() {
    let script = GROWING_SCREEN.replace("local published=api.ui.setRoot(", "local ok,published=pcall(api.ui.setRoot,")
        .replace("api.observation.set('published',published)", "api.observation.set('published',ok and published)");
    let mut caught = load(&script, None).unwrap();
    let mut plain = load(&script, None).unwrap();
    caught.set_input("Grow", true);
    let snapshot = caught.tick().unwrap();
    assert_eq!(caught.semantic_observations()["last_rejection"]["code"], "UI_NODE_LIMIT");
    assert_eq!(caught.semantic_observations()["published"], json!(false));
    assert!(snapshot.recovered_errors.is_none(), "strict runs never publish a recovery report");
    assert_eq!(ui_ids(&caught), ["panel-1", "panel-2", "panel-3"]);
    plain.tick().unwrap();
    assert!(observation_digest(&plain.observe()).is_ok());
}

const FLAKY_UPDATE: &str = r#"
local frame=0
return {start=function(api) end,update=function(api)
    frame+=1
    api.observation.set('reached',frame)
    if api.input.isDown('Fail') then error('boom at '..frame) end
    api.observation.set('completed',frame)
end}"#;

#[test]
fn a_continuing_policy_skips_failed_updates_until_too_many_fail_in_a_row() {
    let mut game = load(FLAKY_UPDATE, Some(json!({"script_errors":"continue","max_consecutive_script_errors":3}))).unwrap();
    game.tick().unwrap();
    game.set_input("Fail", true);
    let snapshot = game.tick().unwrap();
    assert_eq!(snapshot.frame, 2, "the failed update's frame still completes");
    assert_eq!(snapshot.observations["reached"].as_f64(), Some(2.));
    assert_eq!(snapshot.observations["completed"].as_f64(), Some(1.), "the rest of the failed update was skipped");
    let recovered = snapshot.recovered_errors.unwrap();
    assert_eq!((recovered.script_errors, recovered.consecutive_script_errors), (1, 1));
    let last = recovered.last_script_error.unwrap();
    assert_eq!((last.frame, last.code.as_str()), (2, "LUAU_RUNTIME_ERROR"));
    assert!(last.message.contains("boom at 2"), "{}", last.message);
    game.set_input("Fail", false);
    let snapshot = game.tick().unwrap();
    assert_eq!(snapshot.observations["completed"].as_f64(), Some(3.));
    assert_eq!(snapshot.recovered_errors.as_ref().unwrap().consecutive_script_errors, 0, "a returning update resets the run");
    game.set_input("Fail", true);
    game.tick().unwrap();
    game.tick().unwrap();
    let error = game.tick().unwrap_err();
    assert_eq!(error.code, "SCRIPT_ERROR_LIMIT");
    assert!(error.explanation.contains("3 consecutive ticks") && error.explanation.contains("boom at 6"), "{}", error.explanation);
    assert_eq!(error.facts["consecutive_script_errors"], 3);
    assert_eq!(error.facts["script_errors"], 4);
    assert_eq!(error.facts["last_error"]["code"], "LUAU_RUNTIME_ERROR");
}

#[test]
fn the_strict_default_fails_the_tick_on_an_update_error() {
    let mut game = load(FLAKY_UPDATE, None).unwrap();
    game.set_input("Fail", true);
    let error = game.tick().unwrap_err();
    assert_eq!(error.code, "LUAU_RUNTIME_ERROR");
    assert!(error.explanation.contains("boom at 1"));
    assert!(game.recovered_errors().is_none());
}

#[test]
fn errors_in_game_start_stay_fatal_under_any_policy() {
    let error = load("return {start=function(api) error('broken start') end,update=function(api) end}",
        Some(json!({"ui_capacity":"keep_previous","script_errors":"continue"}))).err().unwrap();
    assert!(error.explanation.contains("broken start"), "{}", error.explanation);
}

#[test]
fn an_invalid_policy_is_a_host_payload_error() {
    for policy in [json!({"max_consecutive_script_errors":0}), json!({"max_consecutive_script_errors":3601})] {
        let error = load(FLAKY_UPDATE, Some(policy)).err().unwrap();
        assert_eq!(error.code, "HOST_PROJECT_INVALID");
        assert!(error.explanation.contains("ERROR_POLICY_INVALID"), "{}", error.explanation);
    }
    for policy in [json!({"ui_capacity":"truncate"}), json!({"retry":true})] {
        let payload = json!({"config":{"name":"x","entry_script":"main.luau"},"script":FLAKY_UPDATE,"error_policy":policy});
        assert_eq!(HostProject::parse(&serde_json::to_vec(&payload).unwrap()).err().unwrap().code, "HOST_PROJECT_INVALID");
    }
}

#[test]
fn a_host_can_change_the_policy_and_the_consecutive_run_starts_over() {
    let mut game = load(FLAKY_UPDATE, None).unwrap();
    assert!(game.error_policy().is_strict());
    game.set_error_policy(unone_engine::ErrorPolicy { max_consecutive_script_errors: 2, ..unone_engine::ErrorPolicy::release() }).unwrap();
    game.set_input("Fail", true);
    game.tick().unwrap();
    game.set_error_policy(unone_engine::ErrorPolicy { max_consecutive_script_errors: 2, ..unone_engine::ErrorPolicy::release() }).unwrap();
    game.tick().unwrap();
    assert_eq!(game.tick().unwrap_err().code, "SCRIPT_ERROR_LIMIT");
    assert!(game.set_error_policy(unone_engine::ErrorPolicy { max_consecutive_script_errors: 0, ..unone_engine::ErrorPolicy::strict() }).is_err());
}

#[test]
fn a_virtual_window_that_would_overflow_keeps_the_published_window() {
    // A 10-unit viewport with 5-unit rows starts with items 1..3: the scroll
    // view plus three (wrapper + panel) items is 7 nodes, exactly the budget.
    let script = r#"
local items={}
for i=1,20 do items[i]={id='item-'..i} end
return {start=function(api)
    api.ui.setRoot({kind='screen',id='screen',node='screen',budget={max_nodes=7},children={
        api.ui.virtualList({id='list',viewport={left=0,top=0,width=50,height=10},rowHeight=5,items=items,key='id',
            renderItem=function(item) return {{kind='panel',id='row-'..item.id,rect={x=0,y=0,width=10,height=5}}} end})}})
end,update=function(api) end}"#;
    let window = |game: &EngineRuntime| {
        let tree = serde_json::to_value(game.observe().ui.as_ref().unwrap()).unwrap();
        let items = tree["children"][0]["scroll"]["virtual_items"].clone();
        (items["revision"].clone(), items["first"].as_u64().unwrap(), items["last"].as_u64().unwrap())
    };
    let mut lenient = load(script, Some(json!({"ui_capacity":"keep_previous"}))).unwrap();
    let (revision, first, last) = window(&lenient);
    assert_eq!((first, last), (1, 3));
    lenient.ui_request(json!({"id":"list","revision":revision,"first":1,"last":5})).unwrap();
    assert_eq!(window(&lenient).1..=window(&lenient).2, 1..=3, "the rejected window was rolled back");
    assert_eq!(lenient.recovered_errors().unwrap().ui_rejections, 1);
    lenient.ui_request(json!({"id":"list","revision":revision,"first":2,"last":4})).unwrap();
    assert_eq!(window(&lenient).1..=window(&lenient).2, 2..=4, "a window within budget still moves");
    lenient.tick().unwrap();
    let mut strict = load(script, None).unwrap();
    let error = strict.ui_request(json!({"id":"list","revision":revision,"first":1,"last":5})).unwrap_err();
    assert!(error.contains("UI_NODE_LIMIT"), "{error}");
    assert_eq!(window(&strict).1..=window(&strict).2, 1..=3);
}
