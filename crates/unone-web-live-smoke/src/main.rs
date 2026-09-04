use std::{cell::RefCell, collections::BTreeMap};

use serde::{Deserialize, Serialize};
use unone_engine::{EngineRuntime, InputFrame, PointerInput, SceneFile, Vec2, WorldSnapshot};

thread_local! {
    static RUNTIME: RefCell<Option<EngineRuntime>> = const { RefCell::new(None) };
    static POINTER: RefCell<PointerInput> = const {
        RefCell::new(PointerInput { position: Vec2 { x: 0.0, y: 0.0 }, down: false })
    };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static INPUT_BUFFER: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PROJECT_NAME: RefCell<String> = const { RefCell::new(String::new()) };
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
}

fn write_snapshot(project: &str, snapshot: &WorldSnapshot) {
    let observation = ProjectObservation {
        project,
        world: snapshot,
    };
    let bytes = serde_json::to_vec(&observation).unwrap_or_else(|error| {
        serde_json::to_vec(&serde_json::json!({
            "error": format!("snapshot serialization failed: {error}"),
        }))
        .unwrap_or_default()
    });
    OUTPUT.with(|output| *output.borrow_mut() = bytes);
}

fn write_runtime_snapshot(snapshot: &WorldSnapshot) {
    PROJECT_NAME.with(|project| write_snapshot(project.borrow().as_str(), snapshot));
}

fn write_error(message: impl Into<String>) {
    let value = serde_json::json!({"error": message.into()});
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
            RUNTIME.with(|runtime| *runtime.borrow_mut() = Some(runtime_value));
            PROJECT_NAME.with(|project| *project.borrow_mut() = project_name.clone());
            write_snapshot(&project_name, &snapshot);
            0
        }
        Err(error) => {
            write_error(error);
            -1
        }
    }
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
                write_runtime_snapshot(&runtime.observe());
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
            Ok(snapshot) => {
                write_runtime_snapshot(&snapshot);
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
        OUTPUT, unone_web_load_project, unone_web_reload_script, unone_web_set_pointer,
        unone_web_tick,
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

    fn output() -> serde_json::Value {
        OUTPUT.with(|output| serde_json::from_slice(output.borrow().as_slice()).unwrap())
    }

    #[test]
    fn c_abi_load_tick_and_reload_preserve_runtime_contract() {
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
}
