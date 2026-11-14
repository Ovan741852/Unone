use serde_json::json;
use unone_engine::{EngineRuntime, HostProject, InputFrame};

fn runtime(update: &str) -> EngineRuntime {
    let payload = json!({
        "config": {"name": "gamepad", "entry_script": "main.luau"},
        "script": format!("return {{start=function() end, update=function(api, dt)\n{update}\nend}}"),
    });
    HostProject::parse(payload.to_string().as_bytes()).and_then(|project| project.into_runtime(42)).unwrap()
}

fn frame(value: serde_json::Value) -> InputFrame {
    serde_json::from_value(value).unwrap()
}

#[test]
fn sticks_triggers_and_buttons_reach_luau_with_a_radial_deadzone() {
    let mut runtime = runtime(r#"
        local pad = api.input.getGamepad()
        api.observation.set("pad", pad and string.format("%d %.3f %.3f %.3f %.2f", pad.slot, pad.leftStick.x, pad.leftStick.y, pad.rightStick.x, pad.rightTrigger) or "none")
        api.observation.set("count", #api.input.getGamepads())
        api.observation.set("jump", api.input.wasPressed("Gamepad_A"))
        api.observation.set("p2", api.input.isDown("Gamepad2_B"))
    "#);
    let snapshot = runtime.tick_with_input(&frame(json!({
        "actions": {"Gamepad_A": true, "Gamepad2_A": true, "Gamepad_B": true, "Gamepad2_B": true},
        "gamepads": [
            {"slot": 2, "left_x": 0.575, "left_y": 0.0, "right_x": 0.1, "right_trigger": 0.75},
            {"slot": 3}
        ]
    }))).unwrap();
    let observations = &snapshot.observations;
    // 0.575 is past the 0.15 deadzone by 0.425 of 0.85: half travel. 0.1 rests at 0.
    assert_eq!(observations["pad"], "2 0.500 0.000 0.000 0.75", "the lowest connected slot, deadzoned");
    assert_eq!(observations["count"], 2);
    assert_eq!((observations["jump"].clone(), observations["p2"].clone()), (json!(true), json!(true)));
    let snapshot = runtime.tick_with_input(&frame(json!({"actions": {}}))).unwrap();
    assert_eq!(snapshot.observations["pad"], "none", "an absent pad is disconnected");
    assert_eq!(snapshot.observations["count"], 0);
}

#[test]
fn invalid_gamepad_frames_and_slots_fail_with_their_code() {
    let mut runtime = runtime("");
    for value in [
        json!({"gamepads": [{"slot": 5}]}),
        json!({"gamepads": [{"slot": 1}, {"slot": 1}]}),
        json!({"gamepads": [{"slot": 1, "left_x": 1.5}]}),
        json!({"gamepads": [{"slot": 1, "left_trigger": -0.1}]}),
    ] {
        let error = runtime.tick_with_input(&frame(value.clone())).unwrap_err();
        assert_eq!(error.code, "INPUT_GAMEPAD_INVALID", "{value}");
    }
    let mut runtime = self::runtime(r#"
        local ok, err = pcall(api.input.getGamepad, 9)
        api.observation.set("err", tostring(err))
    "#);
    let snapshot = runtime.tick_with_input(&frame(json!({}))).unwrap();
    assert!(snapshot.observations["err"].as_str().unwrap().contains("INPUT_GAMEPAD_SLOT_INVALID"));
}
