use serde::{Deserialize, Serialize};
use unone_engine::{
    BundleSpec, BundleVerifier, Diagnostic, EngineRuntime, InputFrame, PointerInput, Vec2,
    parse_scene_fragment,
};

#[derive(Debug, Deserialize)]
struct HostProject {
    project: String,
    script: String,
    #[serde(default)]
    scene: Option<Box<serde_json::value::RawValue>>,
}

#[derive(Debug, Clone, Serialize)]
struct SafeArea {
    left_px: f64,
    top_px: f64,
    right_px: f64,
    bottom_px: f64,
}

#[derive(Debug, Clone, Serialize)]
struct SurfaceState {
    width_px: u32,
    height_px: u32,
    scale_factor: f64,
    safe_area: SafeArea,
}

#[derive(Debug, Serialize)]
struct MobileObservation {
    ok: bool,
    kind: &'static str,
    event: &'static str,
    lifecycle: &'static str,
    project: Option<String>,
    surface: Option<SurfaceState>,
    reason: Option<String>,
    world: Option<unone_engine::WorldSnapshot>,
    save_payload: Option<serde_json::Value>,
}

/// Opaque session owned by the mobile host.
///
/// The host must create, use and destroy a session on one serialized call
/// sequence. The type intentionally exposes no engine or platform handles.
#[repr(C)]
pub struct UnoneMobileSession {
    runtime: Option<EngineRuntime>,
    pending_input: InputFrame,
    paused: bool,
    surface: Option<SurfaceState>,
    project: Option<String>,
    bundle_verifier: Option<BundleVerifier>,
    output: Vec<u8>,
}

impl UnoneMobileSession {
    fn new() -> Self {
        let mut session = Self {
            runtime: None,
            pending_input: InputFrame::default(),
            paused: false,
            surface: None,
            project: None,
            bundle_verifier: None,
            output: Vec::new(),
        };
        session.write_observation("initialized", None);
        session
    }

    fn lifecycle(&self) -> &'static str {
        if self.runtime.is_none() {
            "initialized"
        } else if self.paused {
            "paused"
        } else {
            "running"
        }
    }

    fn write_observation(&mut self, event: &'static str, reason: Option<&str>) {
        let observation = MobileObservation {
            ok: true,
            kind: "mobile_observation",
            event,
            lifecycle: self.lifecycle(),
            project: self.project.clone(),
            surface: self.surface.clone(),
            reason: reason.map(str::to_string),
            world: self.runtime.as_ref().map(EngineRuntime::observe),
            save_payload: self.runtime.as_ref().and_then(EngineRuntime::save_payload),
        };
        self.output = serde_json::to_vec(&observation).unwrap_or_default();
    }

    fn write_error(&mut self, message: impl Into<String>) -> i32 {
        self.output = serde_json::to_vec(&serde_json::json!({
            "ok": false,
            "kind": "mobile_error",
            "message": message.into(),
        }))
        .unwrap_or_default();
        -1
    }

    fn write_diagnostic(&mut self, diagnostic: Diagnostic) -> i32 {
        self.output = serde_json::to_vec(&serde_json::json!({
            "ok": false,
            "kind": "mobile_error",
            "diagnostic": diagnostic,
        }))
        .unwrap_or_default();
        -1
    }

    fn validate_surface(
        width_px: u32,
        height_px: u32,
        scale_factor: f64,
        safe_left_px: f64,
        safe_top_px: f64,
        safe_right_px: f64,
        safe_bottom_px: f64,
    ) -> Result<SurfaceState, Box<Diagnostic>> {
        let safe_values = [safe_left_px, safe_top_px, safe_right_px, safe_bottom_px];
        let safe_values_valid = safe_values
            .iter()
            .all(|value| value.is_finite() && *value >= 0.0);
        let dimensions_valid = width_px > 0 && height_px > 0;
        let scale_valid = scale_factor.is_finite() && scale_factor > 0.0;
        let insets_fit = safe_left_px + safe_right_px <= f64::from(width_px)
            && safe_top_px + safe_bottom_px <= f64::from(height_px);
        if !dimensions_valid || !scale_valid || !safe_values_valid || !insets_fit {
            let mut diagnostic = Diagnostic::error(
                "MOBILE_SURFACE_INVALID",
                "mobile surface descriptor is invalid",
                "width and height must be positive, scale_factor must be finite and positive, and safe-area insets must be finite, non-negative, and fit inside the surface.",
            );
            diagnostic.facts = serde_json::json!({
                "width_px": width_px,
                "height_px": height_px,
                "scale_factor": scale_factor,
                "safe_area": {
                    "left_px": safe_left_px,
                    "top_px": safe_top_px,
                    "right_px": safe_right_px,
                    "bottom_px": safe_bottom_px,
                },
            });
            return Err(Box::new(diagnostic));
        }
        Ok(SurfaceState {
            width_px,
            height_px,
            scale_factor,
            safe_area: SafeArea {
                left_px: safe_left_px,
                top_px: safe_top_px,
                right_px: safe_right_px,
                bottom_px: safe_bottom_px,
            },
        })
    }
}

/// # Safety
///
/// `pointer` must be null only for an empty payload or point to `length`
/// readable bytes for the duration of this call.
unsafe fn bytes_from_ptr(pointer: *const u8, length: usize) -> Result<Vec<u8>, String> {
    if pointer.is_null() && length != 0 {
        return Err("payload pointer is null for non-empty payload".to_string());
    }
    if length == 0 {
        return Ok(Vec::new());
    }
    // SAFETY: Each caller documents that the host keeps this range readable
    // for the duration of the FFI call.
    Ok(unsafe { std::slice::from_raw_parts(pointer, length).to_vec() })
}

/// # Safety
///
/// The pointer and length must satisfy `bytes_from_ptr`'s contract.
unsafe fn str_from_ptr(pointer: *const u8, length: usize) -> Result<String, String> {
    let bytes = unsafe { bytes_from_ptr(pointer, length) }?;
    std::str::from_utf8(&bytes)
        .map(str::to_owned)
        .map_err(|error| format!("payload is not valid UTF-8: {error}"))
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_mobile_init() -> *mut UnoneMobileSession {
    Box::into_raw(Box::new(UnoneMobileSession::new()))
}

/// # Safety
///
/// `session` must be a pointer returned by `unone_mobile_init` that has not
/// already been released. No other FFI call may use it after this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_shutdown(session: *mut UnoneMobileSession) {
    if !session.is_null() {
        // SAFETY: The caller guarantees ownership of this allocation.
        drop(unsafe { Box::from_raw(session) });
    }
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
/// `pointer` must reference `length` readable UTF-8 JSON bytes for this call.
/// The JSON payload contains `project`, `script`, and optional `scene` fields.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_load_project(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
    seed: u64,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let bytes = match unsafe { bytes_from_ptr(pointer, length) } {
        Ok(bytes) => bytes,
        Err(error) => return session.write_error(error),
    };
    let payload: HostProject = match serde_json::from_slice(&bytes) {
        Ok(payload) => payload,
        Err(error) => {
            return session.write_error(format!("project payload is invalid JSON: {error}"));
        }
    };
    let scene = match payload
        .scene
        .as_deref()
        .map(|raw| parse_scene_fragment(raw.get()))
        .transpose()
    {
        Ok(scene) => scene,
        Err(diagnostic) => return session.write_diagnostic(*diagnostic),
    };
    let project_name = payload.project.clone();
    let runtime = match EngineRuntime::load_source_with_seed(
        payload.project,
        "main.luau",
        payload.script,
        scene,
        seed,
    ) {
        Ok(runtime) => runtime,
        Err(diagnostic) => return session.write_diagnostic(*diagnostic),
    };
    session.runtime = Some(runtime);
    session.project = Some(project_name);
    session.pending_input = InputFrame::default();
    session.paused = false;
    session.write_observation("project_loaded", None);
    0
}

/// Inject a host-loaded JSON save payload. The game decides whether the
/// version and schema are valid when it reads `api.save.get()` during update.
///
/// # Safety
///
/// `session` must be live. `pointer` must reference `length` readable UTF-8
/// JSON bytes for the duration of this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_set_save_payload(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let bytes = match unsafe { bytes_from_ptr(pointer, length) } {
        Ok(bytes) => bytes,
        Err(error) => return session.write_error(error),
    };
    let payload: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(payload) => payload,
        Err(error) => return session.write_error(format!("save payload is invalid JSON: {error}")),
    };
    let Some(runtime) = session.runtime.as_mut() else {
        return session.write_error("cannot load save before a project is loaded");
    };
    runtime.set_save_payload(Some(payload));
    session.write_observation("save_loaded", Some("host_injected_payload"));
    0
}

/// Begin verifying one host-fetched bundle. The host owns downloading and
/// staging; this adapter owns the shared size and SHA-256 rule.
///
/// # Safety
///
/// `session` must be live. `pointer` must reference `length` readable UTF-8
/// JSON bytes describing an engine `BundleSpec`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_bundle_begin(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let bytes = match unsafe { bytes_from_ptr(pointer, length) } {
        Ok(bytes) => bytes,
        Err(error) => return session.write_error(error),
    };
    let spec: BundleSpec = match serde_json::from_slice(&bytes) {
        Ok(spec) => spec,
        Err(error) => {
            return session.write_error(format!("bundle spec is invalid JSON: {error}"));
        }
    };
    let bundle_id = spec.id.clone();
    session.bundle_verifier = Some(BundleVerifier::new(&spec));
    session.output = serde_json::to_vec(&serde_json::json!({
        "ok": true,
        "kind": "bundle_verification",
        "status": "started",
        "bundle_id": bundle_id,
    }))
    .unwrap_or_default();
    0
}

/// Feed one bounded bundle chunk to the shared verifier.
///
/// # Safety
///
/// `session` must be live. `pointer` must reference `length` readable bytes;
/// a null pointer is valid only when `length` is zero.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_bundle_write(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let bytes = match unsafe { bytes_from_ptr(pointer, length) } {
        Ok(bytes) => bytes,
        Err(error) => return session.write_error(error),
    };
    let Some(verifier) = session.bundle_verifier.as_mut() else {
        return session.write_error("bundle verifier has not started");
    };
    verifier.update(&bytes);
    0
}

/// Finish bundle verification. The host must commit the staged bytes only
/// after this returns success; a failure does not alter any active generation.
///
/// # Safety
///
/// `session` must be live.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_bundle_finish(session: *mut UnoneMobileSession) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let Some(verifier) = session.bundle_verifier.take() else {
        return session.write_error("bundle verifier has not started");
    };
    match verifier.finish() {
        Ok(result) => {
            session.output = serde_json::to_vec(&serde_json::json!({
                "ok": true,
                "kind": "bundle_verification",
                "status": "verified",
                "value": result,
            }))
            .unwrap_or_default();
            0
        }
        Err(diagnostic) => session.write_diagnostic(*diagnostic),
    }
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
/// `pointer` must reference `length` readable UTF-8 JSON bytes containing an
/// engine `InputFrame`. The frame is consumed by the next tick.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_set_input_frame(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let bytes = match unsafe { bytes_from_ptr(pointer, length) } {
        Ok(bytes) => bytes,
        Err(error) => return session.write_error(error),
    };
    let frame: InputFrame = match serde_json::from_slice(&bytes) {
        Ok(frame) => frame,
        Err(error) => return session.write_error(format!("input frame is invalid JSON: {error}")),
    };
    session.pending_input = frame;
    session.write_observation("input_frame_set", None);
    0
}

/// Set a pointer without JSON parsing for the high-frequency touch path.
#[unsafe(no_mangle)]
///
/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
pub unsafe extern "C" fn unone_mobile_set_pointer(
    session: *mut UnoneMobileSession,
    x: f64,
    y: f64,
    down: i32,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    if !x.is_finite() || !y.is_finite() {
        return session.write_error("pointer coordinates must be finite");
    }
    session.pending_input.pointer = Some(PointerInput {
        position: Vec2 { x, y },
        down: down != 0,
        screen_position: Some(Vec2 { x, y }),
    });
    0
}

/// Set the host-normalized logical UI pointer position while preserving the
/// current world pointer and button state.
///
/// Hosts should call `unone_mobile_set_pointer` first when they need to set a
/// complete pointer frame, then use this function for a distinct UI-space
/// coordinate.
///
/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_set_screen_pointer(
    session: *mut UnoneMobileSession,
    x: f64,
    y: f64,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    if !x.is_finite() || !y.is_finite() {
        return session.write_error("screen pointer coordinates must be finite");
    }
    let pointer = session.pending_input.pointer.get_or_insert(PointerInput {
        position: Vec2::default(),
        down: false,
        screen_position: None,
    });
    pointer.screen_position = Some(Vec2 { x, y });
    0
}

/// Set one semantic action without JSON parsing. The action is consumed by
/// the next tick, so hosts should send both press and release state changes.
///
/// # Safety
///
/// `session` must be live. `pointer` must reference `length` readable UTF-8
/// bytes for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_set_action(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
    is_down: i32,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let action = match unsafe { str_from_ptr(pointer, length) } {
        Ok(action) if !action.is_empty() => action,
        Ok(_) => return session.write_error("action name must not be empty"),
        Err(error) => return session.write_error(error),
    };
    session.pending_input.actions.insert(action, is_down != 0);
    0
}

/// Update the host-owned surface descriptor. This does not recreate the
/// engine runtime or alter simulation state.
///
/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_resize(
    session: *mut UnoneMobileSession,
    width_px: u32,
    height_px: u32,
    scale_factor: f64,
    safe_left_px: f64,
    safe_top_px: f64,
    safe_right_px: f64,
    safe_bottom_px: f64,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let surface = match UnoneMobileSession::validate_surface(
        width_px,
        height_px,
        scale_factor,
        safe_left_px,
        safe_top_px,
        safe_right_px,
        safe_bottom_px,
    ) {
        Ok(surface) => surface,
        Err(diagnostic) => return session.write_diagnostic(*diagnostic),
    };
    session.surface = Some(surface);
    session.write_observation("surface_resized", None);
    0
}

/// Notify the adapter that the platform surface is gone. The runtime session
/// stays alive and can be paired with a later resize call.
///
/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_surface_lost(session: *mut UnoneMobileSession) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    session.surface = None;
    session.write_observation("surface_lost", Some("renderer_surface_recreated_by_host"));
    0
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_pause(session: *mut UnoneMobileSession) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    if session.runtime.is_none() {
        return session.write_error("cannot pause before a project is loaded");
    }
    session.paused = true;
    session.write_observation("paused", Some("host_lifecycle_pause"));
    0
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_resume(session: *mut UnoneMobileSession) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    if session.runtime.is_none() {
        return session.write_error("cannot resume before a project is loaded");
    }
    session.paused = false;
    session.write_observation(
        "resumed",
        Some("host_lifecycle_resume_no_wall_clock_catch_up"),
    );
    0
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_tick(session: *mut UnoneMobileSession) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    if session.runtime.is_none() {
        return session.write_error("cannot tick before a project is loaded");
    }
    if session.paused {
        session.write_observation("tick_skipped", Some("paused"));
        return 0;
    }
    let frame = std::mem::take(&mut session.pending_input);
    let result = session
        .runtime
        .as_mut()
        .expect("runtime checked above")
        .tick_with_input(&frame);
    match result {
        Ok(_) => {
            session.write_observation("tick", None);
            0
        }
        Err(diagnostic) => session.write_diagnostic(*diagnostic),
    }
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
/// `pointer` must reference `length` readable UTF-8 Luau bytes for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_reload_script(
    session: *mut UnoneMobileSession,
    pointer: *const u8,
    length: usize,
) -> i32 {
    let Some(session) = (unsafe { session.as_mut() }) else {
        return -1;
    };
    let source = match unsafe { str_from_ptr(pointer, length) } {
        Ok(source) => source,
        Err(error) => return session.write_error(error),
    };
    let Some(runtime) = session.runtime.as_mut() else {
        return session.write_error("cannot reload before a project is loaded");
    };
    match runtime.reload_source(source) {
        Ok(()) => {
            session.write_observation("script_reloaded", None);
            0
        }
        Err(diagnostic) => session.write_diagnostic(*diagnostic),
    }
}

/// Return the latest semantic JSON observation. The pointer remains valid
/// until the next mutating call on this session.
///
/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_observation_ptr(
    session: *const UnoneMobileSession,
) -> *const u8 {
    let Some(session) = (unsafe { session.as_ref() }) else {
        return std::ptr::null();
    };
    session.output.as_ptr()
}

/// # Safety
///
/// `session` must be a live pointer returned by `unone_mobile_init`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_mobile_observation_len(session: *const UnoneMobileSession) -> usize {
    let Some(session) = (unsafe { session.as_ref() }) else {
        return 0;
    };
    session.output.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    const SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { isDown: (action: string) -> boolean, getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, dt: number)
    local position = api.entity.getPosition("player")
    if api.input.isPointerDown() then
        position = api.input.getPointerPosition()
    elseif api.input.isDown("Right") then
        position.x += dt
    end
    api.entity.setPosition("player", position)
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

    const SCREEN_POINTER_SCRIPT: &str = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.observation.set("screen_pointer", api.input.getScreenPointerPosition() :: any)
end
return Game
"#;

    fn payload() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "project": "MobileContract",
            "script": SCRIPT,
            "scene": {"entities": [{"id": "player", "transform": {"x": 0.0, "y": 0.0}}]}
        }))
        .unwrap()
    }

    fn payload_with_script(script: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "project": "MobileSaveContract",
            "script": script,
        }))
        .unwrap()
    }

    fn output(session: *const UnoneMobileSession) -> Value {
        let pointer = unsafe { unone_mobile_observation_ptr(session) };
        let length = unsafe { unone_mobile_observation_len(session) };
        let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
        serde_json::from_slice(bytes).unwrap()
    }

    #[test]
    fn c_abi_scene_fragment_uses_shared_diagnostic_context() {
        let session = unone_mobile_init();
        let project = serde_json::to_vec(&json!({
            "project": "MobileInvalidScene",
            "script": SCRIPT,
            "scene": {"entities": [], "typo": true}
        }))
        .unwrap();

        assert_eq!(
            unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
            -1
        );
        let diagnostic = output(session)["diagnostic"].clone();
        assert_eq!(diagnostic["code"], json!("SCENE_INVALID"));
        assert_eq!(
            diagnostic["facts"]["source_kind"],
            json!("host_payload_scene")
        );
        assert_eq!(
            diagnostic["facts"]["location_scope"],
            json!("scene_fragment")
        );
        assert_eq!(diagnostic["facts"]["pointer_base"], json!("/scene"));
        assert!(diagnostic["facts"]["line"].is_number());
        assert!(diagnostic["facts"]["column"].is_number());
        assert!(diagnostic["source"].is_null());
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn c_abi_rejects_negative_scene_fixture_matrix() {
        let fixtures = [
            (
                "root-typo",
                r#"{"entities":[],"typo":true}"#,
                "SCENE_INVALID",
                None,
            ),
            (
                "deep-vector-typo",
                r#"{"entities":[{"id":"player","transform":{"x":0,"y":0,"z":0}}]}"#,
                "SCENE_INVALID",
                None,
            ),
            (
                "blank-id",
                r#"{"entities":[{"id":"  \t"}]}"#,
                "SCENE_ENTITY_ID_INVALID",
                Some("/entities/0/id"),
            ),
            (
                "duplicate-id",
                r#"{"entities":[{"id":"player"},{"id":"player"}]}"#,
                "SCENE_ENTITY_ID_DUPLICATE",
                Some("/entities/1/id"),
            ),
            (
                "invalid-geometry",
                r#"{"entities":[{"id":"player","sprite":{"asset":"asset://player","size":{"x":0,"y":1}}}]}"#,
                "SCENE_SPRITE_INVALID",
                None,
            ),
        ];

        for (name, scene, code, json_pointer) in fixtures {
            let session = unone_mobile_init();
            let valid_project = payload();
            assert_eq!(
                unsafe {
                    unone_mobile_load_project(
                        session,
                        valid_project.as_ptr(),
                        valid_project.len(),
                        42,
                    )
                },
                0,
                "valid fixture setup"
            );
            let before_entities = output(session)["world"]["entities"].clone();
            let scene: Value = serde_json::from_str(scene).unwrap();
            let project = serde_json::to_vec(&json!({
                "project": format!("MobileInvalidScene-{name}"),
                "script": SCRIPT,
                "scene": scene,
            }))
            .unwrap();
            assert_eq!(
                unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
                -1,
                "fixture {name}"
            );
            let diagnostic = output(session)["diagnostic"].clone();
            assert_eq!(diagnostic["code"], json!(code), "fixture {name}");
            assert_eq!(
                diagnostic["facts"]["source_kind"],
                json!("host_payload_scene"),
                "fixture {name}"
            );
            assert_eq!(
                diagnostic["facts"]["location_scope"],
                json!("scene_fragment"),
                "fixture {name}"
            );
            assert_eq!(diagnostic["facts"]["pointer_base"], json!("/scene"));
            assert!(diagnostic["source"].is_null(), "fixture {name}");
            if code == "SCENE_INVALID" {
                assert!(diagnostic["facts"]["line"].is_number(), "fixture {name}");
                assert!(diagnostic["facts"]["column"].is_number(), "fixture {name}");
            } else {
                assert!(diagnostic["facts"]["line"].is_null(), "fixture {name}");
                assert!(diagnostic["facts"]["column"].is_null(), "fixture {name}");
            }
            match json_pointer {
                Some(pointer) => assert_eq!(diagnostic["facts"]["json_pointer"], json!(pointer)),
                None => assert!(diagnostic["facts"]["json_pointer"].is_null()),
            }
            assert_eq!(unsafe { unone_mobile_tick(session) }, 0, "fixture {name}");
            let after_failed_load = output(session);
            assert_eq!(
                after_failed_load["world"]["entities"], before_entities,
                "failed scene load replaced the mobile runtime: {name}"
            );
            unsafe { unone_mobile_shutdown(session) };
        }
    }

    #[test]
    fn lifecycle_surface_and_pause_resume_preserve_session() {
        let session = unone_mobile_init();
        assert_eq!(
            unsafe { unone_mobile_resize(session, 1920, 1080, 3.0, 0.0, 80.0, 0.0, 0.0) },
            0
        );
        let project = payload();
        assert_eq!(
            unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
            0
        );

        let action = b"Right";
        assert_eq!(
            unsafe { unone_mobile_set_action(session, action.as_ptr(), action.len(), 1) },
            0
        );
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        assert_eq!(output(session)["world"]["frame"], json!(1));
        assert_eq!(unsafe { unone_mobile_set_pointer(session, 7.0, 8.0, 1) }, 0);
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        let pointer_tick = output(session);
        assert_eq!(pointer_tick["world"]["frame"], json!(2));
        assert_eq!(
            pointer_tick["world"]["entities"]["player"]["transform"],
            json!({"x": 7.0, "y": 8.0})
        );

        assert_eq!(unsafe { unone_mobile_pause(session) }, 0);
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        let paused = output(session);
        assert_eq!(paused["event"], json!("tick_skipped"));
        assert_eq!(paused["reason"], json!("paused"));
        assert_eq!(paused["world"]["frame"], json!(2));

        assert_eq!(unsafe { unone_mobile_surface_lost(session) }, 0);
        assert_eq!(output(session)["surface"], Value::Null);
        assert_eq!(
            unsafe { unone_mobile_resize(session, 1080, 1920, 3.0, 50.0, 0.0, 50.0, 90.0) },
            0
        );
        assert_eq!(unsafe { unone_mobile_resume(session) }, 0);
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        let resumed = output(session);
        assert_eq!(resumed["lifecycle"], json!("running"));
        assert_eq!(resumed["world"]["frame"], json!(3));
        assert_eq!(resumed["surface"]["safe_area"]["bottom_px"], json!(90.0));

        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn invalid_surface_returns_semantic_diagnostic() {
        let session = unone_mobile_init();
        assert_eq!(
            unsafe { unone_mobile_resize(session, 100, 100, 0.0, 0.0, 0.0, 0.0, 0.0) },
            -1
        );
        let value = output(session);
        assert_eq!(value["diagnostic"]["code"], json!("MOBILE_SURFACE_INVALID"));
        assert_eq!(value["diagnostic"]["severity"], json!("ERROR"));
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn script_reload_preserves_world_and_failed_reload_is_explained() {
        let session = unone_mobile_init();
        let project = payload();
        assert_eq!(
            unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
            0
        );
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        let bad = b"return broken syntax";
        assert_eq!(
            unsafe { unone_mobile_reload_script(session, bad.as_ptr(), bad.len()) },
            -1
        );
        let error = output(session);
        assert_eq!(error["diagnostic"]["code"], json!("LUAU_RUNTIME_ERROR"));
        assert_eq!(error["diagnostic"]["source"]["file"], json!("main.luau"));
        let good = SCRIPT.replace("position.x += dt", "position.x += dt * 2");
        assert_eq!(
            unsafe { unone_mobile_reload_script(session, good.as_ptr(), good.len()) },
            0
        );
        assert_eq!(output(session)["event"], json!("script_reloaded"));
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn semantic_input_frame_replaces_actions_for_one_tick() {
        let session = unone_mobile_init();
        let project = payload();
        assert_eq!(
            unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
            0
        );
        let frame = serde_json::to_vec(&json!({"actions": {"Right": true}})).unwrap();
        assert_eq!(
            unsafe { unone_mobile_set_input_frame(session, frame.as_ptr(), frame.len()) },
            0
        );
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        assert_eq!(output(session)["world"]["frame"], json!(1));
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        let next = output(session);
        assert_eq!(next["world"]["frame"], json!(2));
        assert!(
            (next["world"]["entities"]["player"]["transform"]["x"]
                .as_f64()
                .unwrap()
                - 1.0 / 60.0)
                .abs()
                < 0.000_001
        );
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn save_payload_bridge_injects_json_before_tick() {
        let session = unone_mobile_init();
        let project = payload_with_script(SAVE_SCRIPT);
        assert_eq!(
            unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
            0
        );
        let save = serde_json::to_vec(&json!({"version": 1, "node": "brave"})).unwrap();
        assert_eq!(
            unsafe { unone_mobile_set_save_payload(session, save.as_ptr(), save.len()) },
            0
        );
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        let value = output(session);
        assert_eq!(value["event"], json!("tick"));
        assert_eq!(
            value["world"]["observations"]["loaded_node"],
            json!("brave")
        );
        assert_eq!(
            value["save_payload"],
            json!({"version": 1, "node": "brave"})
        );
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn bundle_verifier_uses_shared_integrity_contract() {
        let session = unone_mobile_init();
        let content = b"bundle-content";
        let spec = serde_json::to_vec(&json!({
            "id": "mobile-bundle",
            "version": "1",
            "source": "remote/mobile.bundle",
            "sha256": "17cc744c34dd53bc69277fd7b622b0e1c99d9157e0714d1afffc8264893b2ea3",
            "size_bytes": content.len(),
            "dependencies": []
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_mobile_bundle_begin(session, spec.as_ptr(), spec.len()) },
            0
        );
        assert_eq!(
            unsafe { unone_mobile_bundle_write(session, content.as_ptr(), 6) },
            0
        );
        assert_eq!(
            unsafe { unone_mobile_bundle_write(session, content[6..].as_ptr(), content.len() - 6) },
            0
        );
        assert_eq!(unsafe { unone_mobile_bundle_finish(session) }, 0);
        let value = output(session);
        assert_eq!(value["status"], json!("verified"));
        assert_eq!(value["value"]["bundle_id"], json!("mobile-bundle"));
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn failed_bundle_verification_is_semantic_and_consumes_verifier() {
        let session = unone_mobile_init();
        let spec = serde_json::to_vec(&json!({
            "id": "tampered-bundle",
            "version": "1",
            "source": "remote/tampered.bundle",
            "sha256": "17cc744c34dd53bc69277fd7b622b0e1c99d9157e0714d1afffc8264893b2ea3",
            "size_bytes": 14,
            "dependencies": []
        }))
        .unwrap();
        assert_eq!(
            unsafe { unone_mobile_bundle_begin(session, spec.as_ptr(), spec.len()) },
            0
        );
        let tampered = b"tampered-bytes";
        assert_eq!(
            unsafe { unone_mobile_bundle_write(session, tampered.as_ptr(), tampered.len()) },
            0
        );
        assert_eq!(unsafe { unone_mobile_bundle_finish(session) }, -1);
        let value = output(session);
        assert_eq!(value["diagnostic"]["code"], json!("BUNDLE_VERIFY_FAILED"));
        assert_eq!(unsafe { unone_mobile_bundle_finish(session) }, -1);
        assert_eq!(
            output(session)["message"],
            json!("bundle verifier has not started")
        );
        unsafe { unone_mobile_shutdown(session) };
    }

    #[test]
    fn screen_pointer_bridge_keeps_ui_space_separate_from_world_space() {
        let session = unone_mobile_init();
        let project = payload_with_script(SCREEN_POINTER_SCRIPT);
        assert_eq!(
            unsafe { unone_mobile_load_project(session, project.as_ptr(), project.len(), 42) },
            0
        );
        assert_eq!(unsafe { unone_mobile_set_pointer(session, 3.0, 4.0, 1) }, 0);
        assert_eq!(
            unsafe { unone_mobile_set_screen_pointer(session, 20.0, 15.0) },
            0
        );
        assert_eq!(unsafe { unone_mobile_tick(session) }, 0);
        assert_eq!(
            output(session)["world"]["observations"]["screen_pointer"],
            json!({"x": 20, "y": 15})
        );
        unsafe { unone_mobile_shutdown(session) };
    }
}
