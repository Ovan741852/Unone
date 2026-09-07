use std::{process::ExitCode, slice};

use serde_json::{Value, json};
use unone_mobile_ffi::{
    UnoneMobileSession, unone_mobile_init, unone_mobile_load_project, unone_mobile_observation_len,
    unone_mobile_observation_ptr, unone_mobile_pause, unone_mobile_reload_script,
    unone_mobile_resize, unone_mobile_resume, unone_mobile_set_input_frame, unone_mobile_shutdown,
    unone_mobile_surface_lost, unone_mobile_tick,
};

const SCRIPT: &str = r#"
local Game = {}
function Game.start(api)
    api.observation.set("android_smoke", "ready")
end
function Game.update(api, _dt)
    if api.input.isDown("advance") then
        api.observation.set("android_smoke", "advanced")
    end
end
return Game
"#;

const RELOADED_SCRIPT: &str = r#"
local Game = {}
function Game.start(api)
    api.observation.set("android_smoke", "reloaded")
end
function Game.update(api, _dt)
    if api.input.isDown("advance") then
        api.observation.set("android_smoke", "reloaded_advanced")
    end
end
return Game
"#;

fn main() -> ExitCode {
    match run() {
        Ok(summary) => {
            println!("{}", serde_json::to_string_pretty(&summary).unwrap());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("unone-mobile-android-smoke: {error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<Value, String> {
    let session = unone_mobile_init();
    if session.is_null() {
        return Err("mobile init returned null".to_string());
    }

    let result = run_session(session);
    // SAFETY: the session was returned by init and is released exactly once
    // after all calls using it have completed.
    unsafe { unone_mobile_shutdown(session) };
    result
}

fn run_session(session: *mut UnoneMobileSession) -> Result<Value, String> {
    let payload = serde_json::to_vec(&json!({
        "config": {"name": "AndroidSmoke"},
        "script": SCRIPT,
        "scene": null,
    }))
    .map_err(|error| error.to_string())?;
    call("load_project", unsafe {
        unone_mobile_load_project(session, payload.as_ptr(), payload.len(), 42)
    })?;
    call("resize", unsafe {
        unone_mobile_resize(session, 1280, 720, 2.0, 0.0, 24.0, 0.0, 0.0)
    })?;

    let initial = observation(session)?;
    let initial_frame = frame(&initial)?;
    let input = serde_json::to_vec(&json!({"actions":{"advance":true}}))
        .map_err(|error| error.to_string())?;
    call("set_input_frame", unsafe {
        unone_mobile_set_input_frame(session, input.as_ptr(), input.len())
    })?;
    call("tick", unsafe { unone_mobile_tick(session) })?;
    let advanced = observation(session)?;
    if advanced["world"]["observations"]["android_smoke"] != "advanced" {
        return Err(format!("semantic input did not reach Luau: {advanced}"));
    }
    let advanced_frame = frame(&advanced)?;

    call("pause", unsafe { unone_mobile_pause(session) })?;
    call("paused_tick", unsafe { unone_mobile_tick(session) })?;
    let paused = observation(session)?;
    if frame(&paused)? != advanced_frame || paused["event"] != "tick_skipped" {
        return Err(format!("paused tick advanced unexpectedly: {paused}"));
    }

    call("surface_lost", unsafe {
        unone_mobile_surface_lost(session)
    })?;
    call("resize_after_surface_loss", unsafe {
        unone_mobile_resize(session, 720, 1280, 2.0, 0.0, 0.0, 0.0, 24.0)
    })?;
    call("resume", unsafe { unone_mobile_resume(session) })?;
    call("resumed_tick", unsafe { unone_mobile_tick(session) })?;
    let resumed = observation(session)?;
    if frame(&resumed)? != advanced_frame + 1 {
        return Err(format!(
            "resume did not advance exactly one fixed tick: {resumed}"
        ));
    }

    call("reload_script", unsafe {
        unone_mobile_reload_script(session, RELOADED_SCRIPT.as_ptr(), RELOADED_SCRIPT.len())
    })?;
    let reload_event = observation(session)?;
    if reload_event["event"] != "script_reloaded" {
        return Err(format!(
            "script reload did not report its lifecycle event: {reload_event}"
        ));
    }
    let reload_input = serde_json::to_vec(&json!({"actions":{"advance":true}}))
        .map_err(|error| error.to_string())?;
    call("set_input_after_reload", unsafe {
        unone_mobile_set_input_frame(session, reload_input.as_ptr(), reload_input.len())
    })?;
    call("tick_after_reload", unsafe { unone_mobile_tick(session) })?;
    let reloaded = observation(session)?;
    if reloaded["world"]["observations"]["android_smoke"] != "reloaded_advanced" {
        return Err(format!("new script did not run after reload: {reloaded}"));
    }

    Ok(json!({
        "ok": true,
        "project": "AndroidSmoke",
        "initial_frame": initial_frame,
        "advanced_frame": advanced_frame,
        "resumed_frame": frame(&resumed)?,
        "paused_event": paused["event"],
        "reloaded_event": reload_event["event"],
        "semantic_state": reloaded["world"]["observations"]["android_smoke"],
    }))
}

fn call(name: &str, result: i32) -> Result<(), String> {
    if result == 0 {
        Ok(())
    } else {
        Err(format!("{name} returned {result}"))
    }
}

fn observation(session: *const UnoneMobileSession) -> Result<Value, String> {
    // SAFETY: the session is live and the returned pointer is valid until the
    // next mutating call, which does not occur during this read.
    let (pointer, length) = unsafe {
        (
            unone_mobile_observation_ptr(session),
            unone_mobile_observation_len(session),
        )
    };
    if pointer.is_null() {
        return Err("observation pointer is null".to_string());
    }
    // SAFETY: the FFI contract guarantees a readable observation byte range.
    serde_json::from_slice(unsafe { slice::from_raw_parts(pointer, length) })
        .map_err(|error| format!("invalid observation JSON: {error}"))
}

fn frame(observation: &Value) -> Result<u64, String> {
    observation["world"]["frame"]
        .as_u64()
        .ok_or_else(|| format!("observation has no world.frame: {observation}"))
}
