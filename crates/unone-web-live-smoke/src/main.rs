use std::{cell::RefCell, collections::BTreeMap};

use unone_engine::{EngineRuntime, InputFrame, PointerInput, SceneFile, Vec2, WorldSnapshot};

thread_local! {
    static RUNTIME: RefCell<Option<EngineRuntime>> = const { RefCell::new(None) };
    static POINTER: RefCell<PointerInput> = const {
        RefCell::new(PointerInput { position: Vec2 { x: 0.0, y: 0.0 }, down: false })
    };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

const SOURCE: &str = r#"
--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi, log: (message: string) -> () }
local Game = {}
function Game.start(api: EngineApi)
    api.log("web_live_runtime_ready")
end
function Game.update(api: EngineApi, _dt: number)
    if api.input.isPointerDown() then
        api.entity.setPosition("web_probe", api.input.getPointerPosition())
    end
end
return Game
"#;

const SCENE: &str = r#"
{
  "entities": [{
    "id": "web_probe",
    "name": "Web Probe",
    "transform": {"x": 0.0, "y": 0.0},
    "sprite": {"asset": "asset://placeholder/web-probe", "size": {"x": 1.0, "y": 1.0}}
  }]
}
"#;

fn create_runtime() -> Result<EngineRuntime, String> {
    let scene: SceneFile = serde_json::from_str(SCENE).map_err(|error| error.to_string())?;
    EngineRuntime::load_source_with_seed("WebLiveSmoke", "main.luau", SOURCE, Some(scene), 42)
        .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))
}

fn write_snapshot(snapshot: &WorldSnapshot) {
    let bytes = serde_json::to_vec(snapshot).unwrap_or_else(|error| {
        serde_json::to_vec(&serde_json::json!({
            "error": format!("snapshot serialization failed: {error}"),
        }))
        .unwrap_or_default()
    });
    OUTPUT.with(|output| *output.borrow_mut() = bytes);
}

fn write_error(message: impl Into<String>) {
    let value = serde_json::json!({"error": message.into()});
    OUTPUT.with(|output| *output.borrow_mut() = serde_json::to_vec(&value).unwrap_or_default());
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_init() -> i32 {
    RUNTIME.with(|runtime| {
        if runtime.borrow().is_some() {
            return 0;
        }
        match create_runtime() {
            Ok(runtime_value) => {
                let snapshot = runtime_value.observe();
                *runtime.borrow_mut() = Some(runtime_value);
                write_snapshot(&snapshot);
                0
            }
            Err(error) => {
                write_error(error);
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
                write_snapshot(&snapshot);
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

fn main() {
    let _ = unone_web_init();
}
