use std::{cell::RefCell, collections::BTreeMap};

use serde::{Deserialize, Serialize};
use unone_engine::{
    BundleSpec, BundleVerifier, EngineRuntime, InputFrame, PointerInput, SceneFile, Vec2,
    WorldSnapshot,
};

thread_local! {
    static RUNTIME: RefCell<Option<EngineRuntime>> = const { RefCell::new(None) };
    static POINTER: RefCell<PointerInput> = const {
        RefCell::new(PointerInput { position: Vec2 { x: 0.0, y: 0.0 }, down: false })
    };
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
}

fn create_runtime(project: HostProject, seed: u64) -> Result<EngineRuntime, String> {
    EngineRuntime::load_source_with_seed(
        project.project,
        "main.luau",
        project.script,
        project.scene,
        seed,
    )
    .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))
}

#[derive(Debug, Serialize)]
struct ProjectObservation<'a> {
    project: &'a str,
    world: &'a WorldSnapshot,
    save_payload: Option<serde_json::Value>,
}

fn write_snapshot(
    project: &str,
    snapshot: &WorldSnapshot,
    save_payload: Option<serde_json::Value>,
) {
    let observation = ProjectObservation {
        project,
        world: snapshot,
        save_payload,
    };
    let bytes = serde_json::to_vec(&observation).unwrap_or_else(|error| {
        serde_json::to_vec(&serde_json::json!({
            "error": format!("snapshot serialization failed: {error}"),
        }))
        .unwrap_or_default()
    });
    OUTPUT.with(|output| *output.borrow_mut() = bytes);
}

fn write_runtime_snapshot(runtime: &EngineRuntime) {
    let snapshot = runtime.observe();
    let save_payload = runtime.save_payload();
    PROJECT_NAME.with(|project| write_snapshot(project.borrow().as_str(), &snapshot, save_payload));
}

fn write_error(message: impl Into<String>) {
    let value = serde_json::json!({"error": message.into()});
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default());
}

fn write_diagnostic(diagnostic: &unone_engine::Diagnostic) {
    let value = serde_json::json!({"ok": false, "diagnostic": diagnostic});
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
            let snapshot = runtime_value.observe();
            let save_payload = runtime_value.save_payload();
            RUNTIME.with(|runtime| *runtime.borrow_mut() = Some(runtime_value));
            PROJECT_NAME.with(|project| *project.borrow_mut() = project_name.clone());
            write_snapshot(&project_name, &snapshot, save_payload);
            0
        }
        Err(error) => {
            write_error(error);
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
        write_runtime_snapshot(runtime);
        0
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
            Ok(()) => {
                write_runtime_snapshot(runtime);
                0
            }
            Err(diagnostic) => {
                write_error(format!("{}: {}", diagnostic.code, diagnostic.explanation));
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
        pointer.down = down != 0;
    });
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
        let frame = InputFrame {
            actions: BTreeMap::new(),
            pointer: Some(pointer),
        };
        match runtime.tick_with_input(&frame) {
            Ok(_) => {
                write_runtime_snapshot(runtime);
                0
            }
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
        OUTPUT, unone_web_bundle_begin, unone_web_bundle_finish, unone_web_bundle_write,
        unone_web_load_project, unone_web_reload_script, unone_web_set_pointer,
        unone_web_set_save_payload, unone_web_tick,
    };
    use serde_json::json;

    const PROJECT_SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, _dt: number)
    if api.input.isPointerDown() then
        api.entity.setPosition("web_probe", api.input.getPointerPosition())
    end
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

        unone_web_set_pointer(3.0, 4.0, 1);
        assert_eq!(unone_web_tick(), 0);
        let position = output()["world"]["entities"]["web_probe"]["transform"].clone();
        assert_eq!(position, json!({"x": 3.0, "y": 4.0}));

        let reloaded =
            unsafe { unone_web_reload_script(RELOAD_SCRIPT.as_ptr(), RELOAD_SCRIPT.len()) };
        assert_eq!(reloaded, 0);
        unone_web_set_pointer(3.0, 4.0, 0);
        assert_eq!(unone_web_tick(), 0);
        assert_eq!(output()["project"], json!("NativeAbiTest"));
        assert_eq!(output()["world"]["frame"], json!(2));
        assert!(
            output()["world"]["entities"]["web_probe"]["transform"]["x"]
                .as_f64()
                .unwrap()
                > 3.0
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
}
