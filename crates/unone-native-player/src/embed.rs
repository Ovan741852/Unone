//! A player embedded in a host app that owns the view, the run loop and touch input (the
//! iOS App shell), instead of winit's event loop, which on iOS takes over the whole app.
//! The host hands over a UIView (whose layer should be a CAMetalLayer), calls `frame` from
//! its display link, and forwards size changes, touches and app lifecycle. The same
//! Launcher and App as `ios_main` run inside: startup screen, game, saves and errors.
//!
//! C ABI for Swift (see include/unone_player.h): unone_player_start / frame / resize /
//! touch / suspend / resume / stop, and unone_player_free_string for error text.
use crate::{
    R, Settings,
    host::{HostLoop, PlayerWindow, SharedWindow},
    save,
    startup::Launcher,
};
use std::{
    cell::Cell,
    ffi::{CStr, CString, c_char, c_void},
    path::{Path, PathBuf},
    ptr::NonNull,
    sync::{Arc, Mutex},
    time::Instant,
};
use winit::{
    dpi::{PhysicalPosition, PhysicalSize},
    event::{DeviceId, Touch, TouchPhase, WindowEvent},
    raw_window_handle::{
        DisplayHandle, HandleError, HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle, UiKitDisplayHandle,
        UiKitWindowHandle, WindowHandle,
    },
    window::{WindowAttributes, WindowId},
};

/// The host's view, seen by the player as its window.
struct HostView {
    view: NonNull<c_void>,
    size: Mutex<(PhysicalSize<u32>, f64)>,
}
// The view is only used from the host's main thread; wgpu needs the handle to be Send + Sync.
unsafe impl Send for HostView {}
unsafe impl Sync for HostView {}

impl HasWindowHandle for HostView {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let raw = RawWindowHandle::UiKit(UiKitWindowHandle::new(self.view));
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}
impl HasDisplayHandle for HostView {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        Ok(unsafe { DisplayHandle::borrow_raw(RawDisplayHandle::UiKit(UiKitDisplayHandle::new())) })
    }
}
impl PlayerWindow for HostView {
    fn id(&self) -> WindowId {
        WindowId::dummy()
    }
    fn inner_size(&self) -> PhysicalSize<u32> {
        self.size.lock().unwrap().0
    }
    fn scale_factor(&self) -> f64 {
        self.size.lock().unwrap().1
    }
    fn request_redraw(&self) {} // the host's display link draws every frame
    fn set_visible(&self, _: bool) {}
    fn request_inner_size(&self, _: PhysicalSize<u32>) {} // the host lays out its view
}

/// The host's run loop as the player sees it: windows are the one view, exit is remembered.
struct HostRun<'a> {
    view: &'a Arc<HostView>,
    exited: &'a Cell<bool>,
}
impl HostLoop for HostRun<'_> {
    fn exit(&self) {
        self.exited.set(true);
    }
    fn create_window(&self, _: WindowAttributes) -> R<SharedWindow> {
        Ok(self.view.clone())
    }
}

pub struct EmbeddedPlayer {
    launcher: Launcher,
    view: Arc<HostView>,
    exited: Cell<bool>,
}

impl EmbeddedPlayer {
    /// Starts the exported game in `package` (content/, export.json, native-player.json),
    /// keeping its save and reports under `data`.
    pub fn start(view: NonNull<c_void>, size: PhysicalSize<u32>, scale: f64, package: &Path, data: &Path) -> R<Self> {
        Self::start_package(view, size, scale, package, data, None)
    }

    fn start_package(
        view: NonNull<c_void>, size: PhysicalSize<u32>, scale: f64, package: &Path, data: &Path,
        installed: Option<Option<PathBuf>>,
    ) -> R<Self> {
        let base = package.canonicalize().map_err(|e| format!("EMBED_PACKAGE_MISSING: {} ({e})", package.display()))?;
        let (mut bundles, startup) = match installed {
            Some(Some(cache)) => {
                let (bundles, startup) = crate::bundle_package::BundlePackage::open(&base, cache)?;
                (Some(bundles), Some(startup))
            }
            Some(None) => (None, Some(Vec::new())),
            None => (None, None),
        };
        let mut read = move |p: &str| -> R<Vec<u8>> {
            if p.starts_with("content/") && let Some(bundles) = &mut bundles {
                return bundles.read(p);
            }
            let path = base.join(p).canonicalize().map_err(|e| format!("EMBED_ASSET_MISSING: {p} ({e})"))?;
            if !path.starts_with(&base) {
                return Err("NATIVE_PATH_ESCAPE".into());
            }
            std::fs::read(path).map_err(|e| e.to_string())
        };
        let mut settings: Settings = serde_json::from_slice(&read("native-player.json")?).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(data).map_err(|e| format!("EMBED_DATA_UNAVAILABLE: {e}"))?;
        if let Some(dir) = settings.capture_dir.take() {
            settings.capture_dir = Some(if dir.is_relative() { data.join(dir) } else { dir });
        }
        let store = save::Store::App(data.to_path_buf());
        let report = Some(data.join("report.json"));
        let mut player = Self {
            launcher: Launcher::new_with_startup(Box::new(read), settings, report, Instant::now(), store, startup),
            view: Arc::new(HostView { view, size: Mutex::new((size, scale)) }),
            exited: Cell::new(false),
        };
        player.with(|launcher, run| launcher.on_resumed(run));
        match player.exited.get() {
            true => Err(player.launcher.current_error().unwrap_or_else(|| "EMBED_START_FAILED".into())),
            false => Ok(player),
        }
    }
    fn with(&mut self, f: impl FnOnce(&mut Launcher, &HostRun)) {
        let run = HostRun { view: &self.view, exited: &self.exited };
        f(&mut self.launcher, &run);
    }
    fn event(&mut self, event: WindowEvent) {
        self.with(|launcher, run| launcher.on_window_event(run, WindowId::dummy(), event));
    }
    /// One display frame. False once the game has asked to quit or failed to start.
    pub fn frame(&mut self) -> bool {
        self.event(WindowEvent::RedrawRequested);
        self.launcher.on_about_to_wait();
        !self.exited.get()
    }
    pub fn resize(&mut self, size: PhysicalSize<u32>, scale: f64) {
        *self.view.size.lock().unwrap() = (size, scale);
        self.event(WindowEvent::Resized(size));
    }
    /// A touch in the view's physical pixels.
    pub fn touch(&mut self, id: u64, phase: TouchPhase, x: f64, y: f64) {
        self.event(WindowEvent::Touch(Touch {
            device_id: DeviceId::dummy(),
            phase,
            location: PhysicalPosition::new(x, y),
            force: None,
            id,
        }));
    }
    /// The app went to the background: the GPU surface is dropped, the game is kept.
    pub fn suspend(&mut self) {
        self.launcher.on_suspended();
    }
    pub fn resume(&mut self) {
        self.with(|launcher, run| launcher.on_resumed(run));
    }
    pub fn error(&self) -> Option<String> {
        self.launcher.current_error()
    }
}

// ---------- C ABI ----------

fn set_error(out: *mut *mut c_char, message: String) {
    if !out.is_null() {
        let text = CString::new(message.replace('\0', " ")).unwrap_or_default();
        unsafe { *out = text.into_raw() };
    }
}

fn path_arg(p: *const c_char) -> Option<PathBuf> {
    (!p.is_null()).then(|| PathBuf::from(unsafe { CStr::from_ptr(p) }.to_string_lossy().into_owned()))
}

/// Starts a player in `view` (a UIView*). Returns null and sets `*error` (free it with
/// unone_player_free_string) when the game cannot start.
#[unsafe(no_mangle)]
pub extern "C" fn unone_player_start(
    view: *mut c_void, width: u32, height: u32, scale: f64, package_dir: *const c_char, data_dir: *const c_char,
    error: *mut *mut c_char,
) -> *mut EmbeddedPlayer {
    let (Some(view), Some(package), Some(data)) = (NonNull::new(view), path_arg(package_dir), path_arg(data_dir)) else {
        set_error(error, "EMBED_ARGUMENT_MISSING: view, package_dir and data_dir are required".into());
        return std::ptr::null_mut();
    };
    match EmbeddedPlayer::start(view, PhysicalSize::new(width.max(1), height.max(1)), scale, &package, &data) {
        Ok(player) => Box::into_raw(Box::new(player)),
        Err(message) => {
            set_error(error, message);
            std::ptr::null_mut()
        }
    }
}

/// Start a verified local package and resolve the remaining assets on demand.
#[unsafe(no_mangle)]
pub extern "C" fn unone_player_start_installed(
    view: *mut c_void, width: u32, height: u32, scale: f64, package_dir: *const c_char, data_dir: *const c_char,
    bundle_cache: *const c_char, error: *mut *mut c_char,
) -> *mut EmbeddedPlayer {
    let (Some(view), Some(package), Some(data)) = (NonNull::new(view), path_arg(package_dir), path_arg(data_dir)) else {
        set_error(error, "EMBED_ARGUMENT_MISSING: view, package_dir and data_dir are required".into());
        return std::ptr::null_mut();
    };
    match EmbeddedPlayer::start_package(view, PhysicalSize::new(width.max(1), height.max(1)), scale, &package, &data, Some(path_arg(bundle_cache))) {
        Ok(player) => Box::into_raw(Box::new(player)),
        Err(message) => {
            set_error(error, message);
            std::ptr::null_mut()
        }
    }
}

/// True after the first game frame has been submitted to the display surface.
#[unsafe(no_mangle)]
pub extern "C" fn unone_player_game_presented(player: *const EmbeddedPlayer) -> bool {
    unsafe { player.as_ref() }.and_then(|p| p.launcher.game()).is_some_and(|app| app.ready_emitted)
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_player_frame(player: *mut EmbeddedPlayer) -> bool {
    unsafe { player.as_mut() }.is_some_and(|p| p.frame())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_player_set_host_data(player: *mut EmbeddedPlayer, channel: *const c_char, json: *const c_char) -> bool {
    let Some(app) = (unsafe { player.as_mut() }).and_then(|p| p.launcher.game_mut()) else { return false };
    if channel.is_null() || json.is_null() { return false; }
    let (Ok(key), Ok(value)) = (unsafe { CStr::from_ptr(channel) }.to_str(), unsafe { CStr::from_ptr(json) }.to_str()) else { return false };
    app.set_host_data(key, value)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_player_observation(player: *const EmbeddedPlayer, key: *const c_char) -> *mut c_char {
    let Some(app) = (unsafe { player.as_ref() }).and_then(|p| p.launcher.game()) else { return std::ptr::null_mut() };
    if key.is_null() { return std::ptr::null_mut(); }
    let value = unsafe { CStr::from_ptr(key) }.to_str().ok().and_then(|name| app.snapshot.observations.get(name));
    value.and_then(|v| CString::new(v.to_string()).ok()).map_or(std::ptr::null_mut(), CString::into_raw)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_player_tick(player: *const EmbeddedPlayer) -> u64 {
    (unsafe { player.as_ref() }).and_then(|p| p.launcher.game()).map_or(0, |app| app.snapshot.frame as u64)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_player_gamepad(player: *mut EmbeddedPlayer, slot: u8, connected: bool, buttons: u16,
    lx: i16, ly: i16, rx: i16, ry: i16, lt: u8, rt: u8) {
    if let Some(app) = (unsafe { player.as_mut() }).and_then(|p| p.launcher.game_mut()) {
        app.embedded_pads.update(slot, connected, crate::gamepad::XInputGamepad {
            buttons, thumb_lx: lx, thumb_ly: ly, thumb_rx: rx, thumb_ry: ry, left_trigger: lt, right_trigger: rt,
        });
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_player_resize(player: *mut EmbeddedPlayer, width: u32, height: u32, scale: f64) {
    if let Some(p) = unsafe { player.as_mut() } {
        p.resize(PhysicalSize::new(width.max(1), height.max(1)), scale);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_player_set_viewport(
    player: *mut EmbeddedPlayer, width: u32, height: u32, scale: f64,
    left: f64, top: f64, right: f64, bottom: f64,
) -> bool {
    let Some(player) = (unsafe { player.as_mut() }) else { return false };
    let size = PhysicalSize::new(width, height);
    let Some(safe) = crate::host::safe_area_percent(size, [left, top, right, bottom]) else { return false };
    if !scale.is_finite() || scale <= 0. { return false; }
    if player.view.inner_size() != size || player.view.scale_factor() != scale {
        player.resize(size, scale);
    }
    player.launcher.set_host_viewport(size, safe)
}

/// phase: 0 began, 1 moved, 2 ended, 3 cancelled. x, y in the view's physical pixels.
#[unsafe(no_mangle)]
pub extern "C" fn unone_player_touch(player: *mut EmbeddedPlayer, id: u64, phase: u32, x: f64, y: f64) {
    let phase = match phase {
        0 => TouchPhase::Started,
        1 => TouchPhase::Moved,
        2 => TouchPhase::Ended,
        _ => TouchPhase::Cancelled,
    };
    if let Some(p) = unsafe { player.as_mut() } {
        p.touch(id, phase, x, y);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_player_suspend(player: *mut EmbeddedPlayer) {
    if let Some(p) = unsafe { player.as_mut() } {
        p.suspend();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_player_resume(player: *mut EmbeddedPlayer) {
    if let Some(p) = unsafe { player.as_mut() } {
        p.resume();
    }
}

/// The error that stopped the game, if any (free with unone_player_free_string), else null.
#[unsafe(no_mangle)]
pub extern "C" fn unone_player_error(player: *mut EmbeddedPlayer) -> *mut c_char {
    let mut out = std::ptr::null_mut();
    if let Some(error) = unsafe { player.as_ref() }.and_then(|p| p.error()) {
        set_error(&mut out, error);
    }
    out
}

/// Ends the player and releases its GPU resources; the pointer is invalid afterwards.
#[unsafe(no_mangle)]
pub extern "C" fn unone_player_stop(player: *mut EmbeddedPlayer) {
    if !player.is_null() {
        drop(unsafe { Box::from_raw(player) });
    }
}

/// Plan an immutable export update without accessing the player or touching the filesystem.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unone_player_plan_update(
    next: *const c_char, installed: *const c_char, error: *mut *mut c_char,
) -> *mut c_char {
    let plan = || -> R<serde_json::Value> {
        if next.is_null() || installed.is_null() { return Err("missing export inventory".into()); }
        let next = unsafe { CStr::from_ptr(next) }.to_str().map_err(|e| e.to_string())?;
        let installed = unsafe { CStr::from_ptr(installed) }.to_bytes();
        let inventories: Vec<&serde_json::value::RawValue> =
            serde_json::from_slice(installed).map_err(|e| e.to_string())?;
        let inventories: Vec<_> = inventories.iter().map(|value| value.get()).collect();
        unone_engine::export_update::plan(next, &inventories).map_err(|e| e.to_string())
    };
    match plan() {
        Ok(value) => CString::new(value.to_string()).expect("JSON escapes NUL").into_raw(),
        Err(message) => {
            set_error(error, message);
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_player_free_string(text: *mut c_char) {
    if !text.is_null() {
        drop(unsafe { CString::from_raw(text) });
    }
}
