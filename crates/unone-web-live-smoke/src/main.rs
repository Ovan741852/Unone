use std::{cell::RefCell, collections::BTreeMap};

use serde::{Deserialize, Serialize};
use unone_engine::{
    BundleSpec, BundleVerifier, Diagnostic, EngineRuntime, InputFrame, PointerInput, SceneFile,
    Vec2, WorldSnapshot,
};

thread_local! {
    static RUNTIME: RefCell<Option<EngineRuntime>> = const { RefCell::new(None) };
    static POINTER: RefCell<PointerInput> = const {
        RefCell::new(PointerInput {
            position: Vec2 { x: 0.0, y: 0.0 },
            down: false,
            screen_position: None,
        })
    };
    static INPUT_FRAME: RefCell<Option<InputFrame>> = const { RefCell::new(None) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static INPUT_BUFFER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PROJECT_NAME: RefCell<String> = const { RefCell::new(String::new()) };
    static BUNDLE_VERIFIER: RefCell<Option<BundleVerifier>> = const { RefCell::new(None) };
}

#[derive(Debug, Deserialize)]
struct HostProject {
    project: String,
    script: String,
    #[serde(default)]
    scene: Option<SceneFile>,
    /// Engine systems this project declares, exactly as project.unone.json
    /// would declare them for a file-backed project.
    #[serde(default)]
    systems: BTreeMap<String, bool>,
}

fn create_runtime(project: HostProject, seed: u64) -> Result<EngineRuntime, Box<Diagnostic>> {
    EngineRuntime::load_source_with_systems(
        project.project,
        "main.luau",
        project.script,
        project.scene,
        seed,
        project.systems,
    )
}

#[derive(Debug, Serialize)]
struct ProjectObservation<'a> {
    project: &'a str,
    world: &'a WorldSnapshot,
    observation_digest: &'a str,
    save_payload: Option<serde_json::Value>,
}

fn write_snapshot(
    project: &str,
    snapshot: &WorldSnapshot,
    save_payload: Option<serde_json::Value>,
) -> Result<(), String> {
    let observation_digest = unone_engine::observation_digest(snapshot)
        .map_err(|error| format!("snapshot digest serialization failed: {error}"))?;
    let observation = ProjectObservation {
        project,
        world: snapshot,
        observation_digest: &observation_digest,
        save_payload,
    };
    let bytes = serde_json::to_vec(&observation)
        .map_err(|error| format!("snapshot serialization failed: {error}"))?;
    OUTPUT.with(|output| *output.borrow_mut() = bytes);
    Ok(())
}

fn publish_snapshot(
    project: &str,
    snapshot: &WorldSnapshot,
    save_payload: Option<serde_json::Value>,
) -> i32 {
    match write_snapshot(project, snapshot, save_payload) {
        Ok(()) => 0,
        Err(error) => {
            write_error(error);
            -1
        }
    }
}

fn write_runtime_observation(runtime: &EngineRuntime, snapshot: &WorldSnapshot) -> i32 {
    let save_payload = runtime.save_payload();
    PROJECT_NAME.with(|project| publish_snapshot(project.borrow().as_str(), snapshot, save_payload))
}

fn write_runtime_snapshot(runtime: &EngineRuntime) -> i32 {
    let snapshot = runtime.observe();
    write_runtime_observation(runtime, &snapshot)
}

fn write_error(message: impl Into<String>) {
    let value = serde_json::json!({
        "ok": false,
        "kind": "web_error",
        "error": message.into(),
    });
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default());
}

fn write_diagnostic(diagnostic: &unone_engine::Diagnostic) {
    let value = serde_json::json!({
        "ok": false,
        "kind": "web_error",
        "diagnostic": diagnostic,
    });
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default());
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_init() -> i32 {
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_alloc(length: usize) -> *mut u8 {
    INPUT_BUFFER.with(|buffer| {
        let mut buffer = buffer.borrow_mut();
        buffer.resize(length, 0);
        buffer.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 JSON bytes for the
/// duration of this call. The payload must contain `id`, `sha256` and
/// `size_bytes` fields describing the expected bundle content.
pub unsafe extern "C" fn unone_web_bundle_begin(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("bundle spec pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let spec: BundleSpec = match serde_json::from_slice(bytes) {
        Ok(spec) => spec,
        Err(error) => {
            write_error(format!("bundle spec is invalid JSON: {error}"));
            return -1;
        }
    };
    let bundle_id = spec.id.clone();
    BUNDLE_VERIFIER.with(|verifier| *verifier.borrow_mut() = Some(BundleVerifier::new(&spec)));
    let value = serde_json::json!({
        "ok": true,
        "kind": "bundle_verification",
        "status": "started",
        "bundle_id": bundle_id,
    });
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default());
    0
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable bytes for the duration of this
/// call. A null pointer is only valid when `length` is zero.
pub unsafe extern "C" fn unone_web_bundle_write(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() && length != 0 {
        write_error("bundle chunk pointer is null for non-empty chunk");
        return -1;
    }
    let bytes = if length == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(pointer, length) }
    };
    BUNDLE_VERIFIER.with(|verifier| {
        let mut binding = verifier.borrow_mut();
        let Some(verifier) = binding.as_mut() else {
            write_error("bundle verifier has not started");
            return -1;
        };
        verifier.update(bytes);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_bundle_finish() -> i32 {
    let verifier = BUNDLE_VERIFIER.with(|verifier| verifier.borrow_mut().take());
    let Some(verifier) = verifier else {
        write_error("bundle verifier has not started");
        return -1;
    };
    match verifier.finish() {
        Ok(result) => {
            let value = serde_json::json!({
                "ok": true,
                "kind": "bundle_verification",
                "status": "verified",
                "value": result,
            });
            OUTPUT.with(|output| {
                *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default()
            });
            0
        }
        Err(diagnostic) => {
            write_diagnostic(&diagnostic);
            -1
        }
    }
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable bytes for the duration of this
/// call. The bytes must contain a valid UTF-8 JSON host project payload.
pub unsafe extern "C" fn unone_web_load_project(
    pointer: *const u8,
    length: usize,
    seed: u64,
) -> i32 {
    if pointer.is_null() {
        write_error("project payload pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let payload: HostProject = match serde_json::from_slice(bytes) {
        Ok(payload) => payload,
        Err(error) => {
            write_error(format!("project payload is invalid JSON: {error}"));
            return -1;
        }
    };
    let project_name = payload.project.clone();
    match create_runtime(payload, seed) {
        Ok(runtime_value) => {
            INPUT_FRAME.with(|input| *input.borrow_mut() = None);
            let snapshot = runtime_value.observe();
            let save_payload = runtime_value.save_payload();
            RUNTIME.with(|runtime| *runtime.borrow_mut() = Some(runtime_value));
            PROJECT_NAME.with(|project| *project.borrow_mut() = project_name.clone());
            publish_snapshot(&project_name, &snapshot, save_payload)
        }
        Err(diagnostic) => {
            write_diagnostic(&diagnostic);
            -1
        }
    }
}

/// Inject a host-loaded JSON save payload before the next tick.
///
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 JSON bytes for the
/// duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_web_set_save_payload(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("save payload pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let payload: serde_json::Value = match serde_json::from_slice(bytes) {
        Ok(payload) => payload,
        Err(error) => {
            write_error(format!("save payload is invalid JSON: {error}"));
            return -1;
        }
    };
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("web runtime is not initialized");
            return -1;
        };
        runtime.set_save_payload(Some(payload));
        write_runtime_snapshot(runtime)
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 bytes for the duration of
/// this call.
pub unsafe extern "C" fn unone_web_reload_script(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("script payload pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let source = match std::str::from_utf8(bytes) {
        Ok(source) => source,
        Err(error) => {
            write_error(format!("script payload is not valid UTF-8: {error}"));
            return -1;
        }
    };
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("web runtime is not loaded");
            return -1;
        };
        match runtime.reload_source(source) {
            Ok(()) => write_runtime_snapshot(runtime),
            Err(diagnostic) => {
                write_diagnostic(&diagnostic);
                -1
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_pointer(x: f64, y: f64, down: i32) {
    POINTER.with(|pointer| {
        let mut pointer = pointer.borrow_mut();
        pointer.position = Vec2 { x, y };
        pointer.screen_position = Some(Vec2 { x, y });
        pointer.down = down != 0;
    });
}

/// Set the complete host-normalized input frame for the next tick.
///
/// This is the generic Web host path. The older scalar pointer setters remain
/// available for the focused pointer smoke and are used when no frame payload
/// has been supplied.
#[unsafe(no_mangle)]
/// # Safety
///
/// `pointer` must reference `length` readable UTF-8 JSON bytes for the
/// duration of this call. The payload must be an `InputFrame`.
pub unsafe extern "C" fn unone_web_set_input_frame(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() {
        write_error("input frame pointer is null");
        return -1;
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let frame: InputFrame = match serde_json::from_slice(bytes) {
        Ok(frame) => frame,
        Err(error) => {
            write_error(format!("input frame is invalid JSON: {error}"));
            return -1;
        }
    };
    INPUT_FRAME.with(|input| *input.borrow_mut() = Some(frame));
    0
}

/// Tell the engine the shape of the canvas it is drawing into.
///
/// Anchored UI nodes resolve against this, so a phone-shaped viewport keeps the
/// same corners and proportions a 16:9 one has.
#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_viewport_aspect(aspect: f64) -> i32 {
    RUNTIME.with(|runtime| match runtime.borrow_mut().as_mut() {
        Some(runtime) => match runtime.set_viewport_aspect(aspect) {
            Ok(()) => 0,
            Err(diagnostic) => {
                write_diagnostic(&diagnostic);
                -1
            }
        },
        None => {
            write_error("no project is loaded");
            -1
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_set_screen_pointer(x: f64, y: f64) -> i32 {
    if !x.is_finite() || !y.is_finite() {
        write_error("screen pointer coordinates must be finite");
        return -1;
    }
    POINTER.with(|pointer| {
        pointer.borrow_mut().screen_position = Some(Vec2 { x, y });
    });
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_tick() -> i32 {
    if unone_web_init() != 0 {
        return -1;
    }
    let pointer = POINTER.with(|pointer| pointer.borrow().clone());
    RUNTIME.with(|runtime| {
        let mut runtime = runtime.borrow_mut();
        let Some(runtime) = runtime.as_mut() else {
            write_error("web runtime is not initialized");
            return -1;
        };
        let frame = INPUT_FRAME
            .with(|input| input.borrow_mut().take())
            .unwrap_or_else(|| InputFrame {
                actions: BTreeMap::new(),
                pointer: Some(pointer),
            });
        match runtime.tick_with_input(&frame) {
            Ok(snapshot) => write_runtime_observation(runtime, &snapshot),
            Err(diagnostic) => {
                write_error(format!("{}: {}", diagnostic.code, diagnostic.explanation));
                -1
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_observation_ptr() -> *const u8 {
    OUTPUT.with(|output| output.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_observation_len() -> usize {
    OUTPUT.with(|output| output.borrow().len())
}

fn main() {}

#[cfg(test)]
mod tests {
    use super::{
        EngineRuntime, InputFrame, OUTPUT, SceneFile, unone_web_bundle_begin,
        unone_web_bundle_finish, unone_web_bundle_write, unone_web_load_project,
        unone_web_reload_script, unone_web_set_input_frame, unone_web_set_pointer,
        unone_web_set_save_payload, unone_web_set_screen_pointer, unone_web_tick,
    };
    use serde_json::json;

    const PROJECT_SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type ObservationValue = nil | boolean | number | string | {[string]: ObservationValue} | {ObservationValue}
type ObservationApi = { set: (key: string, value: ObservationValue) -> () }
type InputApi = { getPointerPosition: () -> Vec2, getScreenPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi, observation: ObservationApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, _dt: number)
    if api.input.isPointerDown() then
        api.entity.setPosition("web_probe", api.input.getPointerPosition())
    end
    api.observation.set("screen_pointer", api.input.getScreenPointerPosition() :: any)
end
return Game
"#;

    const RELOAD_SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, dt: number)
    local position = api.entity.getPosition("web_probe")
    position.x += dt
    api.entity.setPosition("web_probe", position)
end
return Game
"#;

    const SAVE_SCRIPT: &str = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    local payload = api.save.get()
    if payload ~= nil then
        api.observation.set("loaded_node", payload.node)
    end
end
return Game
"#;

    const INPUT_FRAME_SCRIPT: &str = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.observation.set("shoot_down", api.input.isDown("Shoot"))
end
return Game
"#;

    fn project_payload() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "project": "NativeAbiTest",
            "script": PROJECT_SCRIPT,
            "scene": {"entities": [{
                "id": "web_probe",
                "transform": {"x": 0.0, "y": 0.0}
            }]}
        }))
        .unwrap()
    }

    fn save_project_payload() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "project": "WebSaveAbiTest",
            "script": SAVE_SCRIPT,
        }))
        .unwrap()
    }

    fn output() -> serde_json::Value {
        OUTPUT.with(|output| serde_json::from_slice(output.borrow().as_slice()).unwrap())
    }

    fn observation_digest(value: &serde_json::Value) -> String {
        let digest = value["observation_digest"]
            .as_str()
            .expect("snapshot envelope should expose observation_digest");
        let hex = digest
            .strip_prefix("sha256:")
            .expect("observation_digest should use the sha256: prefix");
        assert_eq!(hex.len(), 64, "observation digest should be 32-byte hex");
        assert!(
            hex.chars()
                .all(|character| character.is_ascii_digit() || ('a'..='f').contains(&character)),
            "observation digest should use lowercase hex"
        );
        digest.to_string()
    }

    fn cli_runtime() -> EngineRuntime {
        let scene = serde_json::from_value::<SceneFile>(json!({
            "entities": [{
                "id": "web_probe",
                "transform": {"x": 0.0, "y": 0.0}
            }]
        }))
        .unwrap();
        EngineRuntime::load_source_with_seed(
            "NativeAbiTest",
            "main.luau",
            PROJECT_SCRIPT,
            Some(scene),
            42,
        )
        .unwrap()
    }

    #[test]
    fn c_abi_load_tick_and_reload_preserve_runtime_contract() {
        let bundle = b"bundle-content";
        let bundle_spec = serde_json::to_vec(&json!({
            "id": "test-bundle",
            "version": "1",
            "source": "memory",
            "sha256": "17cc744c34dd53bc69277fd7b622b0e1c99d9157e0714d1afffc8264893b2ea3",
            "size_bytes": bundle.len(),
            "dependencies": []
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_web_bundle_begin(bundle_spec.as_ptr(), bundle_spec.len()) },
            0
        );
        assert_eq!(unsafe { unone_web_bundle_write(bundle.as_ptr(), 6) }, 0);
        assert_eq!(
            unsafe { unone_web_bundle_write(bundle[6..].as_ptr(), bundle.len() - 6) },
            0
        );
        assert_eq!(unone_web_bundle_finish(), 0);
        assert_eq!(output()["status"], json!("verified"));

        let payload = project_payload();
        let loaded = unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) };
        assert_eq!(loaded, 0);
        let loaded_snapshot = output();
        assert_eq!(loaded_snapshot["world"]["frame"], json!(0));
        assert_eq!(loaded_snapshot["world"]["observations"], json!({}));
        let load_digest = observation_digest(&loaded_snapshot);

        unone_web_set_pointer(3.0, 4.0, 1);
        assert_eq!(unone_web_set_screen_pointer(20.0, 15.0), 0);
        assert_eq!(unone_web_tick(), 0);
        let tick_snapshot = output();
        assert_eq!(tick_snapshot["world"]["frame"], json!(1));
        assert_eq!(
            tick_snapshot["world"]["observations"]["screen_pointer"],
            json!({"x": 20, "y": 15})
        );
        let tick_digest = observation_digest(&tick_snapshot);
        assert_ne!(
            tick_digest, load_digest,
            "changed state should change digest"
        );

        // The CLI `run --input-sequence` report is produced by this same
        // public engine runtime; compare its report instead of calculating an
        // expected hash here.
        let cli_frame = serde_json::from_value::<InputFrame>(json!({
            "actions": {},
            "pointer": {
                "position": {"x": 3.0, "y": 4.0},
                "down": true,
                "screen_position": {"x": 20.0, "y": 15.0}
            }
        }))
        .unwrap();
        let cli_report = cli_runtime()
            .run_with_input_sequence(1, 42, &[cli_frame])
            .value
            .unwrap();
        assert_eq!(cli_report.world.frame, 1);
        assert_eq!(tick_digest, cli_report.observation_digest);

        let position = tick_snapshot["world"]["entities"]["web_probe"]["transform"].clone();
        assert_eq!(position, json!({"x": 3.0, "y": 4.0}));

        let reloaded =
            unsafe { unone_web_reload_script(RELOAD_SCRIPT.as_ptr(), RELOAD_SCRIPT.len()) };
        assert_eq!(reloaded, 0);
        let reloaded_snapshot = output();
        assert_eq!(reloaded_snapshot["world"]["frame"], json!(1));
        assert_eq!(
            reloaded_snapshot["world"]["observations"],
            tick_snapshot["world"]["observations"]
        );
        assert_eq!(observation_digest(&reloaded_snapshot), tick_digest);

        unone_web_set_pointer(3.0, 4.0, 0);
        assert_eq!(unone_web_tick(), 0);
        let post_reload_snapshot = output();
        assert_eq!(post_reload_snapshot["project"], json!("NativeAbiTest"));
        assert_eq!(post_reload_snapshot["world"]["frame"], json!(2));
        assert_ne!(
            observation_digest(&post_reload_snapshot),
            tick_digest,
            "post-reload state change should change digest"
        );
        assert!(
            post_reload_snapshot["world"]["entities"]["web_probe"]["transform"]["x"]
                .as_f64()
                .unwrap()
                > 3.0
        );
    }

    #[test]
    fn c_abi_reload_failure_preserves_semantic_diagnostic_and_previous_runtime() {
        let payload = project_payload();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let invalid_source = b"return {";
        assert_eq!(
            unsafe { unone_web_reload_script(invalid_source.as_ptr(), invalid_source.len()) },
            -1
        );
        let failure = output();
        assert_eq!(failure["ok"], json!(false));
        assert_eq!(failure["kind"], json!("web_error"));
        assert!(failure.get("observation_digest").is_none());
        assert!(failure["diagnostic"]["code"].as_str().is_some());
        assert!(failure["diagnostic"]["explanation"].as_str().is_some());

        unone_web_set_pointer(7.0, 8.0, 1);
        assert_eq!(unone_web_tick(), 0);
        let recovered = output();
        assert_eq!(recovered["world"]["frame"], json!(1));
        observation_digest(&recovered);
        assert_eq!(
            recovered["world"]["entities"]["web_probe"]["transform"],
            json!({"x": 7.0, "y": 8.0})
        );
    }

    #[test]
    fn c_abi_save_payload_reaches_luau_and_snapshot() {
        let payload = save_project_payload();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let save = serde_json::to_vec(&json!({"version": 1, "node": "brave"})).unwrap();
        assert_eq!(
            unsafe { unone_web_set_save_payload(save.as_ptr(), save.len()) },
            0
        );
        assert_eq!(unone_web_tick(), 0);
        let value = output();
        assert_eq!(value["project"], json!("WebSaveAbiTest"));
        assert_eq!(
            value["world"]["observations"]["loaded_node"],
            json!("brave")
        );
        assert_eq!(
            value["save_payload"],
            json!({"version": 1, "node": "brave"})
        );
    }

    #[test]
    fn c_abi_complete_input_frame_replaces_scalar_pointer_for_one_tick() {
        let payload = serde_json::to_vec(&json!({
            "project": "WebInputFrameTest",
            "script": INPUT_FRAME_SCRIPT,
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_web_load_project(payload.as_ptr(), payload.len(), 42) },
            0
        );
        let frame = serde_json::to_vec(&json!({
            "actions": {"Shoot": true},
            "pointer": {"position": {"x": 1, "y": 2}, "down": false}
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_web_set_input_frame(frame.as_ptr(), frame.len()) },
            0
        );
        assert_eq!(unone_web_tick(), 0);
        assert_eq!(output()["world"]["observations"]["shoot_down"], json!(true));

        assert_eq!(unone_web_tick(), 0);
        assert_eq!(
            output()["world"]["observations"]["shoot_down"],
            json!(false)
        );
    }
}
