use serde_json::json;
use unone_engine::{ApplicationState, EscapeBehavior, HostProject, observation_digest, parse_input_frame};

fn runtime(script: &str) -> unone_engine::EngineRuntime {
    HostProject::parse(&serde_json::to_vec(&json!({
        "config":{"name":"application-test","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false}},
        "script":script,"scene":{"entities":[]}
    })).unwrap()).unwrap().into_runtime(42).unwrap()
}

#[test]
fn defaults_are_legacy_quit_and_published_in_the_canonical_snapshot() {
    let game=runtime("return {start=function()end, update=function()end}");
    assert_eq!(game.observe().application, ApplicationState::default());
    assert_eq!(serde_json::to_value(&game.observe()).unwrap()["application"],
               json!({"escape_behavior":"quit","quit_requested":false}));
}

#[test]
fn invalid_behavior_does_not_mutate_valid_application_state() {
    let game=runtime(r#"return {start=function(api)
 api.application.setEscapeBehavior('action')
 assert(not pcall(api.application.setEscapeBehavior,'Action'))
 assert(not pcall(api.application.setEscapeBehavior,'pause'))
 assert(not pcall(api.application.setEscapeBehavior,{}))
end,update=function()end}"#);
    assert_eq!(game.observe().application.escape_behavior,EscapeBehavior::Action);
    assert!(!game.observe().application.quit_requested);
}

#[test]
fn neutral_escape_is_game_input_and_confirmed_quit_is_a_monotonic_headless_latch() {
    let mut game=runtime(r#"return {start=function(api)
 api.application.setEscapeBehavior('action')
end,update=function(api)
 if api.input.wasPressed('Escape') then api.observation.set('pause_requested',true) end
 if api.input.wasPressed('Confirm') then api.application.requestQuit();api.application.requestQuit() end
 if api.input.wasPressed('Legacy') then api.application.setEscapeBehavior('quit') end
end}"#);
    let input=|actions| parse_input_frame(&serde_json::to_vec(&json!({"actions":actions})).unwrap()).unwrap();
    let escaped=game.tick_with_input(&input(json!({"Escape":true}))).unwrap();
    assert_eq!(escaped.observations["pause_requested"],true);
    assert!(!escaped.application.quit_requested);
    let confirmed=game.tick_with_input(&input(json!({"Confirm":true}))).unwrap();
    assert!(confirmed.application.quit_requested);
    let later=game.tick_with_input(&input(json!({"Legacy":true}))).unwrap();
    assert!(later.application.quit_requested);
    assert_eq!(later.application.escape_behavior,EscapeBehavior::Quit);
    assert!(later.frame>confirmed.frame); // Kernel/headless does not claim a host presentation or exit.
}

#[test]
fn application_control_state_changes_the_observation_digest_and_is_discoverable() {
    let quit=runtime("return {start=function()end, update=function()end}");
    let action=runtime("return {start=function(api)api.application.setEscapeBehavior('action')end, update=function()end}");
    let requested=runtime("return {start=function(api)api.application.requestQuit()end, update=function()end}");
    assert_ne!(observation_digest(&quit.observe()).unwrap(),observation_digest(&action.observe()).unwrap());
    assert_ne!(observation_digest(&quit.observe()).unwrap(),observation_digest(&requested.observe()).unwrap());
    #[cfg(feature="dev-tools")]
    for name in ["application.setEscapeBehavior","application.requestQuit"] {
        assert!(unone_engine::api_describe(name).is_some());
    }
}
