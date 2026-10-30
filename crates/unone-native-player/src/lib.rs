#![recursion_limit = "256"]
mod lod;
mod application;
mod keyboard;
mod mouse;
mod replay;
mod save;
mod audio;
mod particles;
mod render;
mod projected;
mod presentation_raster;
mod sprites;
mod ui;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use unone_engine::{EngineRuntime, HostProject, WorldSnapshot};
#[cfg(target_os = "windows")]
use winit::platform::windows::WindowAttributesExtWindows;
use winit::{
    application::ApplicationHandler,
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};
type R<T> = Result<T, String>;
pub(crate) fn ensure_shader_backend(snapshot: &WorldSnapshot) -> R<()> {
    if let Some(tree)=&snapshot.ui {ui::ensure_retained_images_supported(tree)?;}
    if snapshot.projected_frame.is_some(){return Err("HOST_PROJECTED_FRAME_UNSUPPORTED: encoded reference Frame requires official WebGL2 profile".into());}
    if snapshot.projected_geometry.values().any(|batch|batch.blend==unone_engine::ProjectedBlend::SourceOver) {
        return Err("PROJECTED_BLEND_UNSUPPORTED: source_over requires the official WebGL projected renderer; native sRGB hardware blending does not implement the encoded-color contract".into());
    }
    if !snapshot.shader_materials.is_empty() {
        return Err("SHADER_BACKEND_UNSUPPORTED: GLSL sprite shader materials require the official WebGL player; native wgpu does not implement this contract".into());
    }
    Ok(())
}
const NATIVE_RENDERER: &str = "wgpu-native-instanced";
const READY_CONTRACT: &str = "unone.native-ready.v1";

// Physical host keys are neutral action names; games map them to controls.
fn key_action(key: PhysicalKey) -> Option<&'static str> {
    match key {
        PhysicalKey::Code(code) => match code {
            KeyCode::ArrowLeft => Some("Left"), KeyCode::ArrowRight => Some("Right"),
            KeyCode::ArrowUp => Some("Up"), KeyCode::ArrowDown => Some("Down"),
            KeyCode::Delete => Some("Delete"), KeyCode::PageDown => Some("PageDown"),
            KeyCode::ShiftLeft => Some("ShiftLeft"), KeyCode::ShiftRight => Some("ShiftRight"),
            KeyCode::ControlLeft => Some("ControlLeft"), KeyCode::ControlRight => Some("ControlRight"),
            KeyCode::AltLeft => Some("AltLeft"), KeyCode::AltRight => Some("AltRight"),
            KeyCode::Numpad8 => Some("Numpad8"), KeyCode::Numpad2 => Some("Numpad2"),
            KeyCode::Numpad4 => Some("Numpad4"), KeyCode::Numpad6 => Some("Numpad6"),
            KeyCode::Numpad7 => Some("Numpad7"), KeyCode::Numpad9 => Some("Numpad9"),
            KeyCode::Minus => Some("Minus"), KeyCode::Equal => Some("Equal"),
            KeyCode::KeyA => Some("A"), KeyCode::KeyB => Some("B"), KeyCode::KeyC => Some("C"),
            KeyCode::KeyD => Some("D"), KeyCode::KeyE => Some("E"), KeyCode::KeyF => Some("F"),
            KeyCode::KeyG => Some("G"), KeyCode::KeyH => Some("H"), KeyCode::KeyI => Some("I"),
            KeyCode::KeyJ => Some("J"), KeyCode::KeyK => Some("K"), KeyCode::KeyL => Some("L"),
            KeyCode::KeyM => Some("M"), KeyCode::KeyN => Some("N"), KeyCode::KeyO => Some("O"),
            KeyCode::KeyP => Some("P"), KeyCode::KeyQ => Some("Q"), KeyCode::KeyR => Some("R"),
            KeyCode::KeyS => Some("S"), KeyCode::KeyT => Some("T"), KeyCode::KeyU => Some("U"),
            KeyCode::KeyV => Some("V"), KeyCode::KeyW => Some("W"), KeyCode::KeyX => Some("X"),
            KeyCode::KeyY => Some("Y"), KeyCode::KeyZ => Some("Z"),
            KeyCode::Digit0 => Some("0"), KeyCode::Digit1 => Some("1"), KeyCode::Digit2 => Some("2"),
            KeyCode::Digit3 => Some("3"), KeyCode::Digit4 => Some("4"), KeyCode::Digit5 => Some("5"),
            KeyCode::Digit6 => Some("6"), KeyCode::Digit7 => Some("7"), KeyCode::Digit8 => Some("8"),
            KeyCode::Digit9 => Some("9"), KeyCode::Space => Some("Space"), KeyCode::Enter => Some("Enter"),
            KeyCode::Escape => Some("Escape"), KeyCode::Insert => Some("Insert"),
            KeyCode::Home => Some("Home"), KeyCode::PageUp => Some("PageUp"),
            _ => None,
        },
        _ => None,
    }
}

fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}

fn ensure_gui_executable_path(path: &Path) -> R<()> {
    let length = path.to_string_lossy().encode_utf16().count();
    if length >= 260 {
        return Err(format!(
            "NATIVE_EXECUTABLE_PATH_TOO_LONG: canonical native executable path is {length} UTF-16 code units; Fix: install the native runtime in a shallow directory; --root data paths may remain long"
        ));
    }
    Ok(())
}

// Windows GUI startup only; headless and describe intentionally bypass this
// platform-specific executable-path guard.
#[cfg(target_os = "windows")]
fn check_gui_executable_path() -> R<()> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("NATIVE_EXECUTABLE_PATH_UNAVAILABLE: {error}"))?
        .canonicalize()
        .map_err(|error| format!("NATIVE_EXECUTABLE_PATH_UNAVAILABLE: {error}"))?;
    ensure_gui_executable_path(&executable)
}

fn safe(s: &str) -> bool {
    !s.is_empty()
        && !s.contains(':')
        && !s.contains('\\')
        && !s.starts_with('/')
        && !s.split('/').any(|p| p == ".." || p == "." || p.is_empty())
}
pub struct Package {
    files: BTreeMap<String, Vec<u8>>,
    digest: String,
}
impl Package {
    fn load(mut read: impl FnMut(&str) -> R<Vec<u8>>) -> R<Self> {
        let manifest = read("export.json")?;
        let value: Value = serde_json::from_slice(&manifest).map_err(|e| e.to_string())?;
        let mut files = BTreeMap::new();
        for file in value["files"].as_array().ok_or("NATIVE_PACKAGE_INVALID")? {
            let path = file["path"].as_str().ok_or("NATIVE_PATH_MISSING")?;
            if !safe(path) {
                return Err("NATIVE_PATH_INVALID".into());
            }
            if !path.starts_with("content/") {
                continue;
            }
            let bytes = read(path)?;
            if file["sha256"] != hash(&bytes) || file["bytes"] != bytes.len() as u64 {
                return Err(format!("NATIVE_HASH_MISMATCH: {path}"));
            }
            if files.insert(path.into(), bytes).is_some() {
                return Err("NATIVE_DUPLICATE_PATH".into());
            }
        }
        presentation_raster::validate(files.get("content/presentation.json").map(Vec::as_slice))?;
        Ok(Self {
            files,
            digest: hash(&manifest),
        })
    }
    fn get(&self, path: &str) -> R<&[u8]> {
        self.files
            .get(path)
            .map(|v| v.as_slice())
            .ok_or_else(|| format!("NATIVE_FILE_MISSING: {path}"))
    }
    #[cfg(test)]
    fn runtime(&self, seed: u64) -> R<EngineRuntime> {
        Self::start(self.host_project()?,seed,None)
    }
    fn host_project(&self) -> R<HostProject> {
        HostProject::parse(self.get("content/project.json")?).map_err(|e|e.explanation)
    }
    fn start(mut project:HostProject, seed:u64, viewport:Option<[u32;2]>)->R<EngineRuntime> {
        if let Some(size)=viewport {project.viewport_size=Some(size);}
        let runtime=project.into_runtime(seed)
            .map_err(|e| e.explanation)?;
        ensure_shader_backend(&runtime.observe())?;
        Ok(runtime)
    }
}
/// Interactive play draws a fresh seed per launch, like the official Web player,
/// so shipped games do not repeat the same api.random rolls. Tool runs (replay,
/// headless, frame- or time-limited measurement, capture) keep the fixed seed 42
/// so reports and digests stay comparable. An explicit seed always wins.
fn resolve_seed(settings: &Settings) -> u64 {
    if let Some(seed) = settings.seed {
        return seed;
    }
    let tool_run = settings.input_sequence.is_some() || settings.headless || settings.frames > 0
        || settings.measure_seconds > 0. || settings.capture_dir.is_some();
    if tool_run {
        return 42;
    }
    use std::hash::{BuildHasher, Hasher};
    // RandomState is keyed from OS randomness per process; no extra dependency.
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    hasher.finish()
}

#[cfg(test)]
mod seed_tests {
    use super::{Settings, resolve_seed};

    #[test]
    fn play_draws_a_session_seed_while_tool_runs_and_explicit_seeds_are_fixed() {
        let play = Settings::default();
        assert_ne!(resolve_seed(&play), resolve_seed(&play));
        assert_eq!(resolve_seed(&Settings { seed: Some(7), headless: true, ..Default::default() }), 7);
        for tool in [
            Settings { headless: true, ..Default::default() },
            Settings { frames: 180, ..Default::default() },
            Settings { measure_seconds: 5., ..Default::default() },
            Settings { input_sequence: Some("inputs.json".into()), ..Default::default() },
            Settings { capture_dir: Some("captures".into()), ..Default::default() },
        ] {
            assert_eq!(resolve_seed(&tool), 42);
        }
        // Exported packages no longer pin a seed, so shipped play is random.
        let exported: Settings = serde_json::from_str(r#"{"frames":0,"warmup":60,"headless":false,"fixed_tick":false}"#).unwrap();
        assert_eq!(exported.seed, None);
    }
}

#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Settings {
    spatial_backend: Option<String>,
    input_sequence: Option<PathBuf>,
    width: Option<u32>,
    height: Option<u32>,
    frames: u64,
    warmup: u64,
    /// Explicit RNG seed; see `resolve_seed` for the default.
    seed: Option<u64>,
    headless: bool,
    fixed_tick: bool,
    prewarm_ticks: u64,
    capture_dir: Option<PathBuf>,
    freeze_simulation: bool,
    disable_lod: bool,
    measure_seconds: f64,
    /// Explicit `--save` file; packaged Android settings cannot redirect saves.
    #[serde(skip)]
    save: Option<PathBuf>,
}
// Keep development observation bounded during indefinitely running players.
#[derive(Default, Serialize)]
struct SampleWindow {
    values: Vec<f64>,
    cursor: usize,
}
impl SampleWindow {
    fn push(&mut self, value: f64) {
        if self.values.len() < 16384 {
            self.values.push(value);
        } else {
            self.values[self.cursor] = value;
            self.cursor = (self.cursor + 1) % 16384;
        }
    }
}
impl std::ops::Deref for SampleWindow {
    type Target = [f64];
    fn deref(&self) -> &[f64] {
        &self.values
    }
}
#[derive(Default, Serialize)]
struct Samples {
    interval_ms: SampleWindow,
    tick_ms: SampleWindow,
    render_submit_ms: SampleWindow,
    renderer_phases: BTreeMap<&'static str, SampleWindow>,
}
fn stats(v: &[f64]) -> Value {
    if v.is_empty() {
        return Value::Null;
    }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    json!({"count":s.len(),"mean_ms":s.iter().sum::<f64>()/s.len() as f64,"p95_ms":s[((s.len() as f64*0.95).ceil() as usize-1).min(s.len()-1)],"max_ms":s.last()})
}
fn emit(v: &Value) {
    let text = serde_json::to_string(v).unwrap();
    println!("UNONE_NATIVE_REPORT {text}");
    #[cfg(target_os = "android")]
    unsafe {
        unsafe extern "C" {
            fn __android_log_write(priority: i32, tag: *const i8, text: *const i8) -> i32;
        }
        let chars: Vec<_> = text.chars().collect();
        let parts = chars.len().div_ceil(800);
        for (i, chunk) in chars.chunks(800).enumerate() {
            let piece: String = chunk.iter().collect();
            let message = if parts == 1 {
                piece
            } else {
                format!("[part {}/{}] {}", i + 1, parts, piece)
            };
            let t = std::ffi::CString::new(message).unwrap();
            __android_log_write(4, c"UnoneNativePlayer".as_ptr(), t.as_ptr());
        }
    }
}

fn readiness_declaration() -> Value {
    json!({
        "contract": READY_CONTRACT,
        "stdout_prefix": "UNONE_NATIVE_READY ",
        "emission": "once_after_first_render_ok_true",
        "requires_surface": true,
        "headless": "never_emits",
        "fields": [
            "contract",
            "package_sha256",
            "host",
            "renderer",
            "adapter",
            "resolution",
            "process_id"
        ]
    })
}

fn emit_ready(package_sha256: &str, renderer: &render::Renderer) {
    let value = json!({
        "contract": READY_CONTRACT,
        "package_sha256": package_sha256,
        "host": std::env::consts::OS,
        "renderer": NATIVE_RENDERER,
        "adapter": &renderer.adapter,
        "resolution": renderer.resolution(),
        "process_id": std::process::id()
    });
    println!("UNONE_NATIVE_READY {}", serde_json::to_string(&value).unwrap());
    let _ = std::io::stdout().flush();
}

struct App {
    input_replay: Option<replay::InputSequence>,
    save: save::SaveFile,
    replay_pending_presentation: bool,
    host_input: unone_engine::InputFrame,
    keyboard_input: keyboard::ActionQueue,
    mouse_right_input: mouse::ScreenButtonQueue,
    mouse_middle_input: mouse::ScreenButtonQueue,
    pointer_edges: std::collections::VecDeque<unone_engine::PointerInput>,
    world_pointer_owner: Option<u64>,
    ui_input: ui::PointerRouter,
    cursor: [f64; 2],
    package: Package,
    runtime: EngineRuntime,
    snapshot: WorldSnapshot,
    settings: Settings,
    report: Option<PathBuf>,
    window: Option<Arc<Window>>,
    renderer: Option<render::Renderer>,
    ready_emitted: bool,
    audio: audio::NativeAudio,
    last: Option<Instant>,
    units: u128,
    dropped: u64,
    drawn: u64,
    samples: Samples,
    boot: Instant,
    boot_ms: f64,
    error: Option<String>,
    paused: bool,
    capture_start: Option<Instant>,
    measured_ms: f64,
    measured_initial_frame: Option<u64>,
    captures: Vec<(String, f64)>,
    presentation_warnings: std::collections::BTreeSet<String>,
    quit_request_presented: bool,
}
impl App {
    /// Both GUI and headless replay use the kernel's normalized input entry point.
    fn advance_tick(&mut self) -> R<()> {
        let input = if let Some(replay) = &self.input_replay {
            replay.frame()
        } else {
            self.ui_input.reconcile(self.snapshot.ui.as_ref());
            if let Some(error) = self.ui_input.take_error() { return Err(error); }
            if let Some((action, down)) = self.ui_input.next_edge() {
                self.host_input.actions.insert(action, down);
            }
            let mut input = self.host_input.clone();
            // Independent held sources with the same action name combine by OR.
            for action in self.keyboard_input.tick_actions() {
                input.actions.insert(action.into(), true);
            }
            input.ui_sliders = self.ui_input.drain_sliders();
            let primary_edge = self.pointer_edges.pop_front();
            let (right_down,middle_down,secondary_screen)=mouse::tick_secondary(primary_edge.is_some(),&mut self.mouse_right_input,&mut self.mouse_middle_input);
            if right_down { input.actions.insert("MouseRight".into(), true); }
            if middle_down {input.actions.insert("MouseMiddle".into(),true);}
            if let Some(pointer) = primary_edge {
                input.pointer = Some(pointer);
            } else if let Some([x, y]) = secondary_screen {
                // Secondary buttons expose coordinates without changing the
                // primary (left mouse/touch) pointer's down/pressed semantics.
                let down = input.pointer.as_ref().is_some_and(|pointer| pointer.down);
                input.pointer = Some(self.pointer_at(x, y, down));
            }
            input
        };
        self.snapshot = self.runtime.tick_with_input(&input).map_err(|error| error.explanation)?;
        if let Some(replay) = &mut self.input_replay { replay.applied(); }
        self.save.persist(&self.runtime)
    }

    fn reset_input(&mut self) {
        self.ui_input.reset();
        self.keyboard_input.reset();
        self.mouse_right_input.reset();
        self.mouse_middle_input.reset();
        self.host_input = Default::default();
        self.pointer_edges.clear();
        self.world_pointer_owner = None;
    }
    // Same Camera2D mapping as the Web host; gameplay owns any 3D raycast policy.
    fn pointer_at(&self, x: f64, y: f64, down: bool) -> unone_engine::PointerInput {
        let c = &self.snapshot.camera;
        let size = self.window.as_ref().unwrap().inner_size();
        let h = c.view_height / c.zoom;
        unone_engine::PointerInput {
            position: unone_engine::Vec2 {
                x: c.position.x
                    + (x - 50.) / 100. * h * size.width as f64 / size.height.max(1) as f64,
                y: c.position.y + (y - 50.) / 100. * h,
            },
            down,
            screen_position: Some(unone_engine::Vec2 { x, y }),
        }
    }
    fn world_pointer(&mut self, x: f64, y: f64, down: bool, edge: bool) {
        let p = self.pointer_at(x, y, down);
        self.host_input.pointer = Some(p.clone());
        if edge {
            self.pointer_edges.push_back(p);
        }
    }
    fn new(
        package: Package,
        mut settings: Settings,
        report: Option<PathBuf>,
        boot: Instant,
        store: save::Store,
    ) -> R<Self> {
        if !settings.measure_seconds.is_finite() || settings.measure_seconds < 0. {
            return Err("INVALID_MEASUREMENT_DURATION".into());
        }
        let seed = resolve_seed(&settings);
        settings.seed = Some(seed);
        let presentation: Value = package.files.get("content/presentation.json")
            .map(|bytes| serde_json::from_slice(bytes)).transpose()
            .map_err(|e| e.to_string())?.unwrap_or_else(|| json!({}));
        let spatial_backend = settings.spatial_backend.as_deref()
            .or_else(|| presentation.get("spatial_backend").and_then(Value::as_str)).unwrap_or("cpu");
        replay::validate_spatial_backend(settings.input_sequence.is_some(),spatial_backend)?;
        let input_replay = if let Some(path) = &settings.input_sequence {
            replay::validate_options(settings.fixed_tick, settings.warmup, settings.prewarm_ticks,
                settings.freeze_simulation, settings.frames, settings.measure_seconds)?;
            Some(replay::InputSequence::load(path)?)
        } else { None };
        let mut project = package.host_project()?;
        let mut save = save::SaveFile::open(&settings, store, &project)?;
        project.restored_save = save.take_restored();
        let mut runtime = Package::start(project,seed,Some([settings.width.unwrap_or(1280),settings.height.unwrap_or(720)]))?;
        match spatial_backend {
            "cpu" => {},
            "gpu" => runtime.set_spatial_executor(Box::new(unone_spatial_gpu::SpatialGpuExecutor::new()?))?,
            "auto" => {
                if let Ok(executor) = unone_spatial_gpu::SpatialGpuExecutor::new() {
                    runtime.set_spatial_executor(Box::new(executor))?;
                }
            },
            _ => return Err("SPATIAL_BACKEND_INVALID: expected cpu, gpu or auto".into()),
        }
        let mut snapshot = runtime.observe();
        for _ in 0..settings.prewarm_ticks {
            if snapshot.application.quit_requested { break; }
            snapshot = runtime.tick().map_err(|e| e.explanation)?;
        }
        // Game.start may already have replaced the restored payload.
        save.persist(&runtime)?;
        let audio = audio::NativeAudio::new(&package);
        Ok(Self {
            input_replay,
            save,
            replay_pending_presentation: false,
            package,
            ui_input: Default::default(),
            cursor: [0., 0.],
            host_input: Default::default(),
            keyboard_input: Default::default(),
            mouse_right_input: Default::default(),
            mouse_middle_input:Default::default(),
            pointer_edges: Default::default(),
            world_pointer_owner: None,
            runtime,
            snapshot,
            settings,
            report,
            window: None,
            renderer: None,
            ready_emitted: false,
            audio,
            last: None,
            units: 0,
            dropped: 0,
            drawn: 0,
            samples: Default::default(),
            boot,
            boot_ms: 0.,
            error: None,
            paused: false,
            capture_start: None,
            measured_ms: 0.,
            measured_initial_frame: None,
            captures: Vec::new(),
            presentation_warnings: Default::default(),
            quit_request_presented: false,
        })
    }
    fn capture_frame(&mut self) -> R<()> {
        let Some(dir) = &self.settings.capture_dir else {
            return Ok(());
        };
        let now = Instant::now();
        let start = *self.capture_start.get_or_insert(now);
        let time = now.duration_since(start).as_secs_f64();
        if self.captures.last().is_some_and(|(_, t)| time - *t < 0.1) {
            return Ok(());
        }
        if self.captures.is_empty() {
            std::fs::create_dir(dir).map_err(|e| format!("CAPTURE_DIRECTORY: {e}"))?;
        }
        let name = format!("frame-{:06}.png", self.captures.len());
        self.renderer
            .as_mut()
            .ok_or("CAPTURE_REQUIRES_RENDERER")?
            .capture(&dir.join(&name))?;
        self.captures.push((name, time));
        Ok(())
    }
    fn finish(&mut self) {
        if let Some(dir) = self
            .settings
            .capture_dir
            .as_ref()
            .filter(|_| !self.captures.is_empty())
        {
            let result=std::fs::write(dir.join("frames.json"),serde_json::to_vec_pretty(&json!({"frames":self.captures,"timing":"wall clock seconds from first capture; includes readback/PNG overhead"})).unwrap());
            if let Err(e) = result {
                self.error = Some(format!("CAPTURE_MANIFEST: {e}"));
            }
        }

        if let (Some(r), Some(path)) = (&mut self.renderer, &self.report) {
            if let Err(e) = r.capture(&path.with_extension("png")) {
                self.error = Some(e);
            }
        }
        let r = self.renderer.as_ref();
        let mut value = json!({"host":std::env::consts::OS,"renderer":if self.settings.headless{"none"}else{"wgpu-native-instanced"},"native_codegen_compiled":cfg!(feature="native-codegen"),"profile":if cfg!(debug_assertions){"debug"}else{"release"},"adapter":r.map(|r|&r.adapter),"resolution":r.map(|r|r.resolution()),"bloom_enabled":r.map(|r|r.bloom_enabled()),"simulation_hz_measured":self.measured_initial_frame.map(|f|(self.snapshot.frame-f) as f64*1000./self.measured_ms.max(0.001)),"measured_seconds":self.measured_ms/1000.,"package_sha256":self.package.digest,"boot_ms":self.boot_ms,"frame":self.snapshot.frame,"observation_digest":unone_engine::observation_digest(&self.snapshot).ok(),"battle":self.snapshot.observations.get("battle"),"fx":self.snapshot.observations.get("fx"),"particle_count":self.snapshot.particles.len(),"camera3d":self.snapshot.camera3d,"observations":self.snapshot.observations,"heightfield_revisions":self.snapshot.heightfields.iter().map(|(id,field)|(id,field.revision())).collect::<BTreeMap<_,_>>(),"drawn":self.drawn,"dropped_ticks":self.dropped,"submitted_instances_last_frame":r.map(|r|r.submitted),"draw_calls_last_frame":r.map(|r|r.draws),"upload_bytes_last_frame":r.map(|r|r.uploaded),"mesh_triangles_last_frame":r.map(|r|r.triangles),"lod_instances_last_frame":r.map(|r|r.lod_counts),"presentation_batches":r.map(|r|r.presentation_report(&self.snapshot)),"projected_buffer_bytes_last_frame":r.map(|r|r.projected_buffer_bytes()),"instance_prepare_ms_last_frame":r.map(|r|r.lod_ms),"presentation_warnings":self.presentation_warnings,"interval":stats(&self.samples.interval_ms),"tick":stats(&self.samples.tick_ms),"render_submit":stats(&self.samples.render_submit_ms),"renderer_cpu_phases":self.samples.renderer_phases.iter().map(|(k,v)|(*k,stats(v))).collect::<BTreeMap<_,_>>(),"fps":if self.samples.interval_ms.is_empty(){0.}else{1000.*self.samples.interval_ms.len() as f64/self.samples.interval_ms.iter().sum::<f64>()},"error":self.error,"measurement":{"timing_window_capacity":16384,"seed":self.settings.seed,"warmup_presentations":self.settings.warmup,"prewarm_ticks":self.settings.prewarm_ticks,"fixed_tick":self.settings.fixed_tick,"gpu_time_available":false,"submitted_is_not_visible_count":true,"render_submit_includes_driver_wait":true,"digest_outside_timing":true,"capture_enabled":self.settings.capture_dir.is_some(),"freeze_simulation":self.settings.freeze_simulation,"lod_enabled":!self.settings.disable_lod}});
        value["audio"] = self.audio.report();
        value["application"] = json!(self.snapshot.application);
        value["quit_request_presented"] = json!(self.quit_request_presented);
        value["spatial"] = self.runtime.spatial_report();
        value["save"] = self.save.report();
        if let Some(replay) = &self.input_replay {
            value["input_replay"] = replay.report();
            value["input_replay"]["successful_presentations"] = json!(self.drawn);
            value["input_replay"]["gpu_readiness_emitted"] = json!(self.ready_emitted);
        }
        if let Some(path) = &self.report {
            if let Err(e) = std::fs::write(path, serde_json::to_vec_pretty(&value).unwrap()) {
                self.error = Some(format!("NATIVE_REPORT_WRITE_FAILED: {e}"));
                value["error"] = json!(self.error);
            }
        }
        emit(&value);
    }
    fn fail(&mut self, e: String, event_loop: &ActiveEventLoop) {
        self.error = Some(e);
        self.finish();
        event_loop.exit();
    }
}
impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            self.paused = false;
            self.last = None;
            return;
        }
        let result = (|| -> R<_> {
            let mut attributes = Window::default_attributes()
                .with_title("Unone Native Player")
                .with_inner_size(winit::dpi::PhysicalSize::new(
                    self.settings.width.unwrap_or(1280), self.settings.height.unwrap_or(720)));
            // The native player has no file-import contract. Keep Windows OLE
            // drag/drop registration disabled; this does not affect rendering.
            #[cfg(target_os = "windows")]
            {
                attributes = attributes.with_drag_and_drop(false);
                if self.input_replay.is_some() {
                    attributes = attributes.with_active(false);
                }
            }
            let window = Arc::new(
                event_loop
                    .create_window(attributes)
                    .map_err(|e| e.to_string())?,
            );
            let mut renderer =
                pollster::block_on(render::Renderer::new(window.clone(), &self.package))?;
            renderer.lod_enabled = !self.settings.disable_lod;
            Ok((window, renderer))
        })();
        match result {
            Ok((w, r)) => {
                let size = w.inner_size();
                if let Err(e) = replay::update_runtime_viewport(&mut self.runtime,self.input_replay.is_some(),size.width,size.height)
                {
                    self.fail(e, event_loop);
                    return;
                }
                self.snapshot = self.runtime.observe();
                self.window = Some(w);
                self.renderer = Some(r);
                self.audio.resume();
                self.boot_ms = self.boot.elapsed().as_secs_f64() * 1000.;
            }
            Err(e) => self.fail(e, event_loop),
        }
    }
    fn suspended(&mut self, _: &ActiveEventLoop) {
        self.reset_input();
        self.renderer = None;
        self.window = None;
        self.last = None;
        self.units = 0;
        self.paused = true;
        self.audio.pause();
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        if self.window.as_ref().is_none_or(|w| w.id() != id) {
            return;
        }
        match event {
            WindowEvent::CloseRequested => {
                self.finish();
                event_loop.exit();
            }
            WindowEvent::Resized(s) => {
                if let Err(e) = replay::update_runtime_viewport(&mut self.runtime,self.input_replay.is_some(),s.width,s.height) {
                    self.fail(e, event_loop);
                    return;
                }
                if let Some(r) = &mut self.renderer {
                    r.resize(s.width, s.height);
                }
            }
            WindowEvent::KeyboardInput { event, .. } if self.input_replay.is_none() => {
                let pressed = event.state == ElementState::Pressed;
                if application::escape_quits(&self.snapshot.application, event.physical_key, pressed) {
                    self.finish();
                    event_loop.exit();
                    return;
                }
                let action = key_action(event.physical_key);
                if let Some(a) = action {
                    // Always accept a release, including an Escape held while
                    // the game switches back to the legacy quit policy.
                    if a != "Escape" || self.snapshot.application.escape_behavior == unone_engine::EscapeBehavior::Action || !pressed {
                        self.keyboard_input.event(a, pressed);
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } if self.input_replay.is_none() => {
                let size = self.window.as_ref().unwrap().inner_size();
                self.cursor = [
                    position.x / size.width.max(1) as f64 * 100.,
                    100. - position.y / size.height.max(1) as f64 * 100.,
                ];
                if !self.ui_input.move_pointer(0, self.cursor[0], self.cursor[1])
                    && self.world_pointer_owner.is_none_or(|id| id == 0) {
                    self.world_pointer(
                        self.cursor[0],
                        self.cursor[1],
                        self.world_pointer_owner == Some(0),
                        false,
                    );
                }
            }
            WindowEvent::MouseInput {
                state,
                button: winit::event::MouseButton::Left,
                ..
            } if self.input_replay.is_none() => {
                if state == ElementState::Pressed {
                    if !self.ui_input.down(
                        self.snapshot.ui.as_ref(),
                        0,
                        self.cursor[0],
                        self.cursor[1],
                    ) && self.world_pointer_owner.is_none()
                    {
                        self.world_pointer_owner = Some(0);
                        self.world_pointer(self.cursor[0], self.cursor[1], true, true);
                    }
                } else if !self.ui_input.up_at(0, self.cursor[0], self.cursor[1]) && self.world_pointer_owner == Some(0) {
                    self.world_pointer_owner = None;
                    self.world_pointer(self.cursor[0], self.cursor[1], false, true);
                }
            }
            WindowEvent::MouseInput {
                state,
                button: winit::event::MouseButton::Right,
                ..
            } if self.input_replay.is_none() => {
                // Do not send secondary clicks through the primary UI router.
                self.mouse_right_input.event(state == ElementState::Pressed, self.cursor);
            }
            WindowEvent::MouseInput {state,button:winit::event::MouseButton::Middle,..} if self.input_replay.is_none()=>{
                self.mouse_middle_input.event(state==ElementState::Pressed,self.cursor);
            }
            WindowEvent::Touch(touch) if self.input_replay.is_none() => {
                let size = self.window.as_ref().unwrap().inner_size();
                let x = touch.location.x / size.width.max(1) as f64 * 100.;
                let y = 100. - touch.location.y / size.height.max(1) as f64 * 100.;
                let id = touch.id.wrapping_add(1);
                match touch.phase {
                    winit::event::TouchPhase::Started => {
                        if !self.ui_input.down(self.snapshot.ui.as_ref(), id, x, y)
                            && self.world_pointer_owner.is_none()
                        {
                            self.world_pointer_owner = Some(id);
                            self.world_pointer(x, y, true, true);
                        }
                    }
                    winit::event::TouchPhase::Ended | winit::event::TouchPhase::Cancelled => {
                        let captured = if touch.phase == winit::event::TouchPhase::Cancelled {
                            self.ui_input.cancel(id)
                        } else { self.ui_input.up_at(id, x, y) };
                        if !captured && self.world_pointer_owner == Some(id) {
                            self.world_pointer_owner = None;
                            self.world_pointer(x, y, false, true);
                        }
                    }
                    winit::event::TouchPhase::Moved => {
                        if !self.ui_input.move_pointer(id, x, y) && self.world_pointer_owner == Some(id) {
                            self.world_pointer(x, y, true, false);
                        }
                    }
                }
            }
            WindowEvent::Focused(false) => self.reset_input(),
            WindowEvent::RedrawRequested => {
                if self.paused {
                    return;
                }
                let now = Instant::now();
                let elapsed = self.last.replace(now).map_or(Duration::ZERO, |v| now - v);
                self.units += elapsed.as_nanos() * 60;
                let due = self.units / 1_000_000_000;
                self.units %= 1_000_000_000;
                let steps = if self.settings.freeze_simulation || self.snapshot.application.quit_requested {
                    0
                } else if self.input_replay.is_some() && self.replay_pending_presentation {
                    // Retry a lost/timeout surface without consuming another input.
                    0
                } else if self.settings.fixed_tick {
                    1
                } else {
                    self.dropped += due.saturating_sub(5) as u64;
                    due.min(5) as usize
                };
                let measuring = self.drawn >= self.settings.warmup;
                if measuring {
                    self.measured_initial_frame
                        .get_or_insert(self.snapshot.frame);
                }
                for _ in 0..steps {
                    let t = Instant::now();
                    if let Err(error) = self.advance_tick() {
                        self.fail(error, event_loop);
                        return;
                    }
                    self.replay_pending_presentation = self.input_replay.is_some();
                    if measuring {
                        self.samples.tick_ms.push(t.elapsed().as_secs_f64() * 1000.);
                    }
                    if self.snapshot.application.quit_requested { break; }
                }
                self.audio.sync(&self.snapshot);
                for effect in &self.snapshot.effects {
                    self.presentation_warnings.insert(format!(
                        "NATIVE_PRESENTATION_UNSUPPORTED: Effekseer effect '{}' is not rendered by this host",
                        effect.asset
                    ));
                }
                for entity in self.snapshot.entities.values() {
                    if let Some(animation) = &entity.animation {
                        self.presentation_warnings.insert(format!(
                            "NATIVE_PRESENTATION_UNSUPPORTED: Spine animation '{}' on '{}' is not rendered by this host",
                            animation.animation, entity.id
                        ));
                    }
                }
                let start = Instant::now();
                let rendered = self.renderer.as_mut().unwrap().render(&self.snapshot);
                match rendered {
                    Ok(true) => {
                        self.replay_pending_presentation = false;
                        if !self.ready_emitted {
                            emit_ready(&self.package.digest, self.renderer.as_ref().unwrap());
                            self.ready_emitted = true;
                        }
                        self.drawn += 1;
                        if let Err(e) = self.capture_frame() {
                            self.fail(e, event_loop);
                            return;
                        }
                        if measuring {
                            for (name, ms) in self.renderer.as_ref().unwrap().cpu_phases() {
                                self.samples
                                    .renderer_phases
                                    .entry(name)
                                    .or_default()
                                    .push(ms);
                            }
                            self.measured_ms += elapsed.as_secs_f64() * 1000.;
                            self.samples.interval_ms.push(elapsed.as_secs_f64() * 1000.);
                            self.samples
                                .render_submit_ms
                                .push(start.elapsed().as_secs_f64() * 1000.);
                        }
                        if application::finish_requested(&self.snapshot.application, true, self.settings.headless) {
                            self.quit_request_presented = true;
                            self.finish();
                            event_loop.exit();
                            return;
                        }
                    }
                    Ok(false) => {}
                    Err(e) => {
                        self.fail(e, event_loop);
                        return;
                    }
                }
                if (self.settings.frames > 0
                    && self.drawn >= self.settings.frames + self.settings.warmup)
                    || (self.settings.measure_seconds > 0.
                        && self.measured_ms >= self.settings.measure_seconds * 1000.)
                {
                    self.finish();
                    event_loop.exit();
                }
            }
            _ => {}
        }
    }
    fn about_to_wait(&mut self, _: &ActiveEventLoop) {
        if !self.paused {
            if let Some(w) = &self.window {
                w.request_redraw();
            }
        }
    }
}
pub fn desktop() -> R<()> {
    if std::env::args().nth(1).as_deref() == Some("--describe") {
        let mut descriptor =
            json!({"compiled_systems":unone_engine::compiled_systems(),"runtime_packages":unone_engine::compiled_runtime_packages(&unone_engine::SystemSettings::default()),"renderer":NATIVE_RENDERER,"readiness":readiness_declaration(),"decoders":["unone-mesh-json","png-rgb-rgba","jpeg-rgba","webp-rgba","svg-static","audio-rodio"],"presentation":["mesh3d","instances3d","heightfield","sprite2d","particle","ui","bloom"],"bloom":{"implementation":"quarter-resolution threshold + separable blur + composite","configured_by":"player.presentation.json:bloom","static_until_relaunch":true},"ui":{"backend":"cpu-raster-wgpu-overlay","retained_image_batch":{"supported":false,"error":"UI_HOST_CAPABILITY_UNSUPPORTED","required_host":"official-web"},"image_batch_pixel_snap":{"supported":false,"error":"UI_HOST_CAPABILITY_UNSUPPORTED","required_host":"official-web"},"nodes":["text","button","image","panel","slider","combobox","component"],"images":["png","svg-static"],"input":"mouse/touch semantic down-up; rectangular reverse-order hit testing","font":"system fallback or packaged presentation.ui.fonts TTF/OTF family/weight aliases; legacy font_source supported","styles":"typed leaf typography and box styles; vertical design units; explicit font size never shrinks","limitations":["UI redraws/uploads the full surface when the tree changes","File drag/drop is not a supported input contract; Windows OLE registration is disabled","Spine skeletal animation and Effekseer effects still require their native runtimes","Physical Android/iOS GPU coverage is device-specific; BlueStacks release evidence is tracked separately","Windows GUI launch rejects a canonical executable path of 260 or more UTF-16 code units; install the runtime shallow, while long --root data paths remain supported"]},"audio":{"implementation":"rodio/cpal native output","status":"host-adapter"},"dev_tools":false,"preview_tools":false,"native_codegen_compiled":cfg!(feature="native-codegen"),"profile":if cfg!(debug_assertions){"debug"}else{"release"}})
        ;
        descriptor["input_replay"] = replay::declaration();
        descriptor["save"] = save::declaration();
        descriptor["input_replay"]["ordered_physical"]=json!({"live":"unsupported","normalized_core_replay":true,"text_ime":false});
        descriptor["projected_geometry"]=json!({"format":unone_engine::PROJECTED_FORMAT,"vertex_stride":40,"depth":"0..W","uv":"official mesh,bottom-left","color_mode":["linear","encoded"],"filter":["nearest","linear"],"sampling_space":["linear","encoded"],"address_mode":["clamp","repeat"],"alpha_cutoff":"0..1(default0.05);strict less-than discards","material_defaults":{"color_mode":"linear","filter":"nearest","sampling_space":"linear","address_mode":"clamp","alpha_cutoff":0.05},"blend":"opaque/cutout only; no blendlist","projection":"clip-space passthrough;no camera,culling,lighting or fog","world3d_visibility":true,"viewport":"physical pixels with revision"});
        descriptor["presentation"].as_array_mut().unwrap().push(json!("projected_geometry"));
        descriptor["projected_geometry"]["alpha_compare"]=json!(["greater_equal","greater"]);
        descriptor["projected_geometry"]["material_defaults"]["alpha_compare"]=json!("greater_equal");
        descriptor["projected_geometry"]["material_defaults"]["blend"]=json!("opaque");
        descriptor["projected_geometry"]["source_over"]=json!({"supported":false,"error":"PROJECTED_BLEND_UNSUPPORTED","phase":"before_GPU_prepare","reason":"native sRGB hardware blending does not implement encoded-color source-over parity"});
        descriptor["raster"]=json!({"sample_count":1,"antialias":{"omitted":"fixed_single_sample","false":"accepted_single_sample","true":"unsupported_preflight"},"static_until_relaunch":true});
        descriptor["raster"]["projected_raster"]=json!({"omitted":"native_host_raster","explicit":"unsupported_package_admission","before_runtime_or_gpu":true});
        descriptor["raster"]["projected_material_profile"]=json!({"omitted":"legacy_unchanged","explicit":"unsupported_package_admission","snapshot":"unsupported_before_GPU_prepare"});
        descriptor["spatial"] = json!({"api_version":1,"backends":["cpu","wgpu"],"default":"cpu","configured_by":"player.presentation.json:spatial_backend or --spatial-backend cpu|gpu|auto"});
        println!("{descriptor}");
        return Ok(());
    }
    let boot = Instant::now();
    let mut root = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .unwrap()
        .to_path_buf();
    let mut settings = Settings {
        warmup: 60,
        ..Default::default()
    };
    let mut report = None;
    let args: Vec<_> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--disable-lod" => settings.disable_lod = true,
            "--freeze-simulation" => settings.freeze_simulation = true,
            "--headless" => settings.headless = true,
            "--fixed-tick" => settings.fixed_tick = true,
            "--seconds" | "--capture-dir" | "--root" | "--frames" | "--warmup" | "--seed"
            | "--report" | "--prewarm-ticks" | "--width" | "--height" | "--input-sequence" | "--spatial-backend"
            | "--save" => {
                let key = &args[i];
                i += 1;
                let v = args.get(i).ok_or("NATIVE_ARGUMENT_VALUE_REQUIRED")?;
                match key.as_str() {
                    "--spatial-backend" => settings.spatial_backend = Some(v.clone()),
                    "--root" => root = v.into(),
                    "--report" => report = Some(PathBuf::from(v)),
                    "--save" => settings.save = Some(PathBuf::from(v)),
                    "--input-sequence" => settings.input_sequence = Some(PathBuf::from(v)),
                    "--width" | "--height" => {
                        let pixels: u32 = v.parse().map_err(|_| "INVALID_WINDOW_SIZE")?;
                        if !(180..=7680).contains(&pixels) { return Err("INVALID_WINDOW_SIZE: use 180..7680 pixels".into()); }
                        if key == "--width" { settings.width = Some(pixels); }
                        else { settings.height = Some(pixels); }
                    }
                    "--seconds" => {
                        settings.measure_seconds =
                            v.parse().map_err(|_| "INVALID_MEASUREMENT_DURATION")?
                    }
                    "--capture-dir" => settings.capture_dir = Some(PathBuf::from(v)),
                    "--prewarm-ticks" => {
                        settings.prewarm_ticks = v.parse().map_err(|_| "INVALID_PREWARM")?
                    }
                    "--frames" => settings.frames = v.parse().map_err(|_| "INVALID_FRAMES")?,
                    "--warmup" => settings.warmup = v.parse().map_err(|_| "INVALID_WARMUP")?,
                    _ => settings.seed = Some(v.parse().map_err(|_| "INVALID_SEED")?),
                }
            }
            _ => return Err(format!("NATIVE_ARGUMENT_UNKNOWN: {}", args[i])),
        }
        i += 1;
    }
    if settings.headless && settings.measure_seconds > 0. {
        return Err("HEADLESS_REQUIRES_FRAME_LIMIT: use --frames instead of --seconds".into());
    }
    if settings.capture_dir.is_some() && settings.frames == 0 && settings.measure_seconds == 0. {
        return Err("CAPTURE_REQUIRES_LIMIT: set --frames or --seconds".into());
    }
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let package = Package::load(|p| {
        let path = base.join(p).canonicalize().map_err(|e| e.to_string())?;
        if !path.starts_with(&base) {
            return Err("NATIVE_PATH_ESCAPE".into());
        }
        std::fs::read(path).map_err(|e| e.to_string())
    })?;
    let mut app = App::new(package, settings, report, boot, save::Store::desktop())?;
    if app.settings.headless {
        app.boot_ms = boot.elapsed().as_secs_f64() * 1000.;
        for i in 0..app.settings.frames + app.settings.warmup {
            let t = Instant::now();
            app.advance_tick()?;
            if i >= app.settings.warmup {
                app.samples.tick_ms.push(t.elapsed().as_secs_f64() * 1000.);
            }
        }
        app.finish();
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    check_gui_executable_path()?;
    let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
    event_loop.run_app(&mut app).map_err(|e| e.to_string())?;
    if let Some(e) = app.error {
        return Err(e);
    }
    Ok(())
}
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
fn android_main(android: winit::platform::android::activity::AndroidApp) {
    use std::io::Read;
    use winit::platform::android::EventLoopBuilderExtAndroid;
    let boot = Instant::now();
    let result = (|| -> R<()> {
        let assets = android.asset_manager();
        let mut read = |p: &str| {
            let path = std::ffi::CString::new(format!("player/{p}")).map_err(|e| e.to_string())?;
            let mut asset = assets
                .open(&path)
                .ok_or_else(|| format!("ANDROID_ASSET_MISSING: {p}"))?;
            let mut bytes = vec![];
            asset.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            Ok(bytes)
        };
        let settings: Settings =
            serde_json::from_slice(&read("native-player.json")?).map_err(|e| e.to_string())?;
        let package = Package::load(&mut read)?;
        let report_dir = android
            .external_data_path()
            .or_else(|| android.internal_data_path())
            .ok_or("ANDROID_REPORT_DIRECTORY_UNAVAILABLE")?;
        std::fs::create_dir_all(&report_dir).map_err(|e| e.to_string())?;
        let report = Some(report_dir.join("benchmark.json"));
        // App-private storage: uninstalling the app removes the save with it.
        let store = match android.internal_data_path() {
            Some(dir) => save::Store::App(dir),
            None => save::Store::Unavailable("the activity has no internal data path".into()),
        };
        let mut app = App::new(package, settings, report, boot, store)?;
        let event_loop = EventLoop::builder()
            .with_android_app(android)
            .build()
            .map_err(|e| e.to_string())?;
        event_loop.run_app(&mut app).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = result {
        emit(&json!({"error":e,"host":"android"}));
    }
}

#[cfg(test)]
mod telemetry_tests {
    #[test]
    fn physical_keys_have_game_neutral_names() {
        use winit::keyboard::{KeyCode, PhysicalKey};
        for (key, name) in [(KeyCode::KeyW,"W"), (KeyCode::KeyQ,"Q"),
            (KeyCode::KeyT,"T"), (KeyCode::KeyG,"G"), (KeyCode::ArrowUp,"Up"),
            (KeyCode::ArrowDown,"Down"), (KeyCode::ArrowLeft,"Left"),
            (KeyCode::Space,"Space"), (KeyCode::Digit1,"1"), (KeyCode::Escape,"Escape"),
            (KeyCode::Insert,"Insert"), (KeyCode::Home,"Home"), (KeyCode::PageUp,"PageUp")] {
            assert_eq!(super::key_action(PhysicalKey::Code(key)), Some(name));
        }
        assert_eq!(super::key_action(PhysicalKey::Code(KeyCode::F12)), None);
    }

    #[test]
    fn gui_executable_path_limit_counts_utf16_code_units() {
        let path = std::path::PathBuf::from(format!("C:/{}", "😀".repeat(130)));
        let error = super::ensure_gui_executable_path(&path).unwrap_err();
        assert!(error.contains("NATIVE_EXECUTABLE_PATH_TOO_LONG"));
        assert!(error.contains("--root data paths may remain long"));
    }

    #[test]
    fn gui_executable_path_accepts_a_shallow_runtime() {
        super::ensure_gui_executable_path(std::path::Path::new(
            r"C:\Unone\runtime\unone-native-player.exe",
        ))
        .unwrap();
    }

    #[test]
    fn readiness_declaration_freezes_host_contract() {
        let declaration = super::readiness_declaration();
        assert_eq!(declaration["contract"], super::READY_CONTRACT);
        assert_eq!(declaration["stdout_prefix"], "UNONE_NATIVE_READY ");
        assert_eq!(declaration["emission"], "once_after_first_render_ok_true");
        assert_eq!(declaration["requires_surface"], true);
        assert_eq!(declaration["headless"], "never_emits");
        assert_eq!(
            declaration["fields"],
            serde_json::json!([
                "contract",
                "package_sha256",
                "host",
                "renderer",
                "adapter",
                "resolution",
                "process_id"
            ])
        );
    }

    #[test]
    fn native_runtime_rejects_shader_resources_instead_of_silently_ignoring_them() {
        let make = |scene| super::Package {
            files: std::collections::BTreeMap::from([("content/project.json".into(), serde_json::to_vec(&serde_json::json!({
                "config":{"name":"native-shader-gate","entry_script":"main.luau"},
                "script":"return {start=function(api) end,update=function(api,dt) end}",
                "scene":scene
            })).unwrap())]),
            digest: "fixture".into(),
        };
        assert!(make(serde_json::json!({"entities":[]})).runtime(42).is_ok());
        let error = make(serde_json::json!({"entities":[],"shader_materials":{"tint":{
            "fragment":"vec4 unoneShade(vec2 uv,vec4 color){return color;}"
        }}})).runtime(42).err().expect("native shader gate");
        assert!(error.contains("SHADER_BACKEND_UNSUPPORTED"));
    }

    #[test]
    fn native_source_over_is_rejected_before_any_gpu_or_texture_preparation() {
        let runtime=unone_engine::EngineRuntime::load_source("blend","main.luau",
            "return {start=function()end,update=function()end}",None).unwrap();
        let mut snapshot=runtime.observe();
        let vertices:Vec<u8>=[0f32,0.,0.5,1.,0.,0.,1.,1.,1.,1.].into_iter().flat_map(f32::to_le_bytes).collect::<Vec<_>>().repeat(3);
        let indices=[0u32,1,2].into_iter().flat_map(u32::to_le_bytes).collect();
        let batch=unone_engine::ProjectedBatch::new("missing-on-purpose".into(),vertices,indices,0,false,false).unwrap();
        snapshot.projected_geometry.insert("alpha".into(),batch.clone());
        assert!(super::ensure_shader_backend(&snapshot).is_ok(),"opaque retains existing admission");
        snapshot.projected_geometry.insert("alpha".into(),batch.with_blend(unone_engine::ProjectedBlend::SourceOver).unwrap());
        assert!(super::ensure_shader_backend(&snapshot).unwrap_err().starts_with("PROJECTED_BLEND_UNSUPPORTED:"));
    }

    #[test]
    fn native_retained_ui_is_rejected_before_any_gpu_or_asset_preparation() {
        let source=r#"return {start=function(api)
            api.ui.imageBatch.define('shared',{bounds={x=0,y=0,width=10,height=10},quads={{asset='texture://missing',rect={x=0,y=0,width=10,height=10}}}})
            api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='component',id='nested',component='group',rect={x=0,y=0,width=10,height=10},children={{kind='image_batch',id='art',rect={x=0,y=0,width=10,height=10},content='shared'}}}}})
            end,update=function()end}"#;
        let runtime=unone_engine::EngineRuntime::load_source("retained-ui","main.luau",source,None).unwrap();
        let mut snapshot=runtime.observe();
        assert!(super::ensure_shader_backend(&snapshot).unwrap_err().starts_with("UI_HOST_CAPABILITY_UNSUPPORTED: retained image_batch"));
        snapshot.ui=None;
        assert!(super::ensure_shader_backend(&snapshot).is_ok(),"unused definitions require no host rendering");
    }

    #[test]
    fn native_pixel_snapped_ui_is_rejected_before_any_gpu_or_asset_preparation() {
        for snap in [false,true] {
            let source=r#"return {start=function(api)
                api.ui.setRoot({kind='screen',id='s',node='s',children={{kind='component',id='nested',component='group',rect={x=0,y=0,width=10,height=10},children={{kind='image_batch',id='art',rect={x=0,y=0,width=10,height=10},pixel_snap=SNAP,quads={{asset='texture://missing',rect={x=0,y=0,width=10,height=10}}}}}}}})
                end,update=function()end}"#.replace("SNAP",if snap {"true"}else{"false"});
            let runtime=unone_engine::EngineRuntime::load_source("snapped-ui","main.luau",source,None).unwrap();
            let result=super::ensure_shader_backend(&runtime.observe());
            if snap {assert!(result.unwrap_err().starts_with("UI_HOST_CAPABILITY_UNSUPPORTED: image_batch pixel_snap"));}
            else {assert!(result.is_ok(),"unsnapped inline batches retain existing admission");}
        }
    }

    #[test]
    fn timing_window_is_bounded_and_retains_recent_samples() {
        let mut samples = super::SampleWindow::default();
        for n in 0..20000 {
            samples.push(n as f64);
        }
        assert_eq!(samples.len(), 16384);
        assert_eq!(samples.iter().copied().min_by(f64::total_cmp), Some(3616.));
        assert_eq!(samples.iter().copied().max_by(f64::total_cmp), Some(19999.));
    }

    #[test]
    fn replay_auto_backend_is_rejected_before_loading_script_or_input_file() {
        // Neither file exists: the stable backend gate must run before either
        // input decoding or Game.start can have observable side effects.
        let make=|presentation| super::Package {digest:"fixture".into(),files:std::collections::BTreeMap::from([
            ("content/presentation.json".into(),serde_json::to_vec(&presentation).unwrap())])};
        for (configured,override_backend) in [("auto",None),("cpu",Some("auto".to_owned()))] {
            let settings=super::Settings {input_sequence:Some("absent-input-sequence.json".into()),
                spatial_backend:override_backend,fixed_tick:true,frames:1,..Default::default()};
            let error=super::App::new(make(serde_json::json!({"spatial_backend":configured})),settings,None,std::time::Instant::now(),
                super::save::Store::Unavailable("replay never resolves storage".into())).err().unwrap();
            assert!(error.contains("NATIVE_INPUT_SEQUENCE_SPATIAL_BACKEND"),"{error}");
        }
    }

    #[test]
    fn native_save_is_written_restored_on_the_next_boot_and_untouched_by_replay() {
        let dir=std::env::temp_dir().join(format!("unone-native-save-boot-{}",std::process::id()));
        let _=std::fs::remove_dir_all(&dir);
        let package=||super::Package {digest:"fixture".into(),files:std::collections::BTreeMap::from([("content/project.json".into(),serde_json::to_vec(&serde_json::json!({
            "config":{"name":"native-save","entry_script":"main.luau","systems":{"physics2d":false,"physics3d":false}},
            "scene":{"entities":[]},
            "script":r#"
local base,ticks=0,0
return {start=function(api)
    local saved=api.save.get()
    base=saved and saved.count or 0
    api.observation.set('restored',base)
end,update=function(api)
    ticks+=1
    -- From the third tick on, an identical payload is set again every tick.
    api.save.set({count=base+math.min(ticks,2)})
end}"#})).unwrap())])};
        let boot=|settings:super::Settings,store|{
            let mut app=super::App::new(package(),settings,None,std::time::Instant::now(),store).unwrap();
            for _ in 0..5 {app.advance_tick().unwrap();}
            (app.snapshot.observations["restored"].clone(),app.save.report())
        };
        let file=dir.join("nested/save.json");
        let explicit=||super::Settings {headless:true,frames:5,save:Some(file.clone()),..Default::default()};
        let no_store=||super::save::Store::Unavailable("--save is explicit".into());
        let (restored,report)=boot(explicit(),no_store());
        assert_eq!((restored,&report["restored"],&report["writes"]),(serde_json::json!(0),&serde_json::json!(false),&serde_json::json!(2)),"{report}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(),r#"{"count":2}"#);
        assert!(!dir.join("nested/save.json.tmp").exists());
        let (restored,report)=boot(explicit(),no_store());
        assert_eq!((restored,&report["restored"],&report["writes"]),(serde_json::json!(2),&serde_json::json!(true),&serde_json::json!(2)),"{report}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(),r#"{"count":4}"#);

        // Replay must ignore a save at the platform location ordinary play uses.
        let default_file=dir.join("Unone/native-save/save.json");
        std::fs::create_dir_all(default_file.parent().unwrap()).unwrap();
        std::fs::copy(&file,&default_file).unwrap();
        let inputs=dir.join("inputs.json");
        std::fs::write(&inputs,"[]").unwrap();
        let replay=super::Settings {input_sequence:Some(inputs),fixed_tick:true,frames:5,..Default::default()};
        let (restored,report)=boot(replay,super::save::Store::PerProject(dir.join("Unone")));
        assert_eq!((restored,&report["enabled"],&report["disabled_reason"]),(serde_json::json!(0),&serde_json::json!(false),&serde_json::json!("input_replay")),"{report}");
        assert_eq!(std::fs::read_to_string(&default_file).unwrap(),r#"{"count":4}"#);
        // Ordinary play restores that same file.
        let (restored,report)=boot(Default::default(),super::save::Store::PerProject(dir.join("Unone")));
        assert_eq!((restored,&report["source"]),(serde_json::json!(4),&serde_json::json!("platform_default")),"{report}");
        assert_eq!(std::fs::read_to_string(&default_file).unwrap(),r#"{"count":6}"#);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
