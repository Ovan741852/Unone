#![recursion_limit = "256"]
mod lod;
mod particles;
mod render;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use unone_engine::{EngineRuntime, HostProject, WorldSnapshot};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};
type R<T> = Result<T, String>;
fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
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
    fn runtime(&self, seed: u64) -> R<EngineRuntime> {
        HostProject::parse(self.get("content/project.json")?)
            .map_err(|e| e.explanation)?
            .into_runtime(seed)
            .map_err(|e| e.explanation)
    }
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct Settings {
    frames: u64,
    warmup: u64,
    seed: u64,
    headless: bool,
    fixed_tick: bool,
    prewarm_ticks: u64,
    capture_dir: Option<PathBuf>,
    freeze_simulation: bool,
    disable_lod: bool,
    measure_seconds: f64,
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
struct App {
    package: Package,
    runtime: EngineRuntime,
    snapshot: WorldSnapshot,
    settings: Settings,
    report: Option<PathBuf>,
    window: Option<Arc<Window>>,
    renderer: Option<render::Renderer>,
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
}
impl App {
    fn new(
        package: Package,
        settings: Settings,
        report: Option<PathBuf>,
        boot: Instant,
    ) -> R<Self> {
        if !settings.measure_seconds.is_finite() || settings.measure_seconds < 0. {
            return Err("INVALID_MEASUREMENT_DURATION".into());
        }
        let mut runtime = package.runtime(settings.seed)?;
        for _ in 0..settings.prewarm_ticks {
            runtime.tick().map_err(|e| e.explanation)?;
        }
        let snapshot = runtime.observe();
        Ok(Self {
            package,
            runtime,
            snapshot,
            settings,
            report,
            window: None,
            renderer: None,
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
        let mut value = json!({"host":std::env::consts::OS,"renderer":if self.settings.headless{"none"}else{"wgpu-native-instanced"},"native_codegen_compiled":cfg!(feature="native-codegen"),"profile":if cfg!(debug_assertions){"debug"}else{"release"},"adapter":r.map(|r|&r.adapter),"resolution":r.map(|r|r.resolution()),"simulation_hz_measured":self.measured_initial_frame.map(|f|(self.snapshot.frame-f) as f64*1000./self.measured_ms.max(0.001)),"measured_seconds":self.measured_ms/1000.,"package_sha256":self.package.digest,"boot_ms":self.boot_ms,"frame":self.snapshot.frame,"observation_digest":unone_engine::observation_digest(&self.snapshot).ok(),"battle":self.snapshot.observations.get("battle"),"fx":self.snapshot.observations.get("fx"),"particle_count":self.snapshot.particles.len(),"camera3d":self.snapshot.camera3d,"drawn":self.drawn,"dropped_ticks":self.dropped,"submitted_instances_last_frame":r.map(|r|r.submitted),"draw_calls_last_frame":r.map(|r|r.draws),"upload_bytes_last_frame":r.map(|r|r.uploaded),"mesh_triangles_last_frame":r.map(|r|r.triangles),"lod_instances_last_frame":r.map(|r|r.lod_counts),"presentation_batches":r.map(|r|&r.presentation_batches),"instance_prepare_ms_last_frame":r.map(|r|r.lod_ms),"interval":stats(&self.samples.interval_ms),"tick":stats(&self.samples.tick_ms),"render_submit":stats(&self.samples.render_submit_ms),"renderer_cpu_phases":self.samples.renderer_phases.iter().map(|(k,v)|(*k,stats(v))).collect::<BTreeMap<_,_>>(),"fps":if self.samples.interval_ms.is_empty(){0.}else{1000.*self.samples.interval_ms.len() as f64/self.samples.interval_ms.iter().sum::<f64>()},"error":self.error,"measurement":{"timing_window_capacity":16384,"seed":self.settings.seed,"warmup_presentations":self.settings.warmup,"prewarm_ticks":self.settings.prewarm_ticks,"fixed_tick":self.settings.fixed_tick,"gpu_time_available":false,"submitted_is_not_visible_count":true,"render_submit_includes_driver_wait":true,"digest_outside_timing":true,"capture_enabled":self.settings.capture_dir.is_some(),"freeze_simulation":self.settings.freeze_simulation,"lod_enabled":!self.settings.disable_lod}});
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
            let window = Arc::new(
                event_loop
                    .create_window(
                        Window::default_attributes()
                            .with_title("Unone Native Player")
                            .with_inner_size(winit::dpi::LogicalSize::new(1280, 720)),
                    )
                    .map_err(|e| e.to_string())?,
            );
            let mut renderer =
                pollster::block_on(render::Renderer::new(window.clone(), &self.package))?;
            renderer.lod_enabled = !self.settings.disable_lod;
            Ok((window, renderer))
        })();
        match result {
            Ok((w, r)) => {
                self.window = Some(w);
                self.renderer = Some(r);
                self.boot_ms = self.boot.elapsed().as_secs_f64() * 1000.;
            }
            Err(e) => self.fail(e, event_loop),
        }
    }
    fn suspended(&mut self, _: &ActiveEventLoop) {
        self.renderer = None;
        self.window = None;
        self.last = None;
        self.units = 0;
        self.paused = true;
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
                if let Some(r) = &mut self.renderer {
                    r.resize(s.width, s.height);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let action = match event.physical_key {
                    PhysicalKey::Code(KeyCode::Escape) => {
                        if event.state == ElementState::Pressed {
                            self.finish();
                            event_loop.exit();
                        }
                        None
                    }
                    PhysicalKey::Code(KeyCode::ArrowLeft) => Some("Left"),
                    PhysicalKey::Code(KeyCode::ArrowRight) => Some("Right"),
                    _ => None,
                };
                if let Some(a) = action {
                    self.runtime
                        .set_input(a, event.state == ElementState::Pressed);
                }
            }
            WindowEvent::RedrawRequested => {
                if self.paused {
                    return;
                }
                let now = Instant::now();
                let elapsed = self.last.replace(now).map_or(Duration::ZERO, |v| now - v);
                self.units += elapsed.as_nanos() * 60;
                let due = self.units / 1_000_000_000;
                self.units %= 1_000_000_000;
                let steps = if self.settings.freeze_simulation {
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
                    match self.runtime.tick() {
                        Ok(s) => self.snapshot = s,
                        Err(e) => {
                            self.fail(e.explanation, event_loop);
                            return;
                        }
                    }
                    if measuring {
                        self.samples.tick_ms.push(t.elapsed().as_secs_f64() * 1000.);
                    }
                }
                if self.snapshot.ui.is_some()
                    || !self.snapshot.audio_events.is_empty()
                    || !self.snapshot.audio_loops.is_empty()
                    || !self.snapshot.effects.is_empty()
                {
                    self.fail("NATIVE_PRESENTATION_UNSUPPORTED: this player currently supports mesh3d/instances3d and PNG; UI/audio/effects require a renderer adapter".into(),event_loop);
                    return;
                }
                let start = Instant::now();
                let rendered = self.renderer.as_mut().unwrap().render(&self.snapshot);
                match rendered {
                    Ok(true) => {
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
        println!(
            "{}",
            json!({"compiled_systems":unone_engine::compiled_systems(),"renderer":"wgpu-native-instanced","decoders":["unone-mesh-json","png-rgb-rgba"],"presentation":["mesh3d","instances3d","particle"],"dev_tools":false,"preview_tools":false,"native_codegen_compiled":cfg!(feature="native-codegen"),"profile":if cfg!(debug_assertions){"debug"}else{"release"}})
        );
        return Ok(());
    }
    let boot = Instant::now();
    let mut root = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .unwrap()
        .to_path_buf();
    let mut settings = Settings {
        seed: 42,
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
            | "--report" | "--prewarm-ticks" => {
                let key = &args[i];
                i += 1;
                let v = args.get(i).ok_or("NATIVE_ARGUMENT_VALUE_REQUIRED")?;
                match key.as_str() {
                    "--root" => root = v.into(),
                    "--report" => report = Some(PathBuf::from(v)),
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
                    _ => settings.seed = v.parse().map_err(|_| "INVALID_SEED")?,
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
    let mut app = App::new(package, settings, report, boot)?;
    if app.settings.headless {
        app.boot_ms = boot.elapsed().as_secs_f64() * 1000.;
        for i in 0..app.settings.frames + app.settings.warmup {
            let t = Instant::now();
            app.snapshot = app.runtime.tick().map_err(|e| e.explanation)?;
            if i >= app.settings.warmup {
                app.samples.tick_ms.push(t.elapsed().as_secs_f64() * 1000.);
            }
        }
        app.finish();
        return Ok(());
    }
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
        let mut app = App::new(package, settings, report, boot)?;
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
    fn timing_window_is_bounded_and_retains_recent_samples() {
        let mut samples = super::SampleWindow::default();
        for n in 0..20000 {
            samples.push(n as f64);
        }
        assert_eq!(samples.len(), 16384);
        assert_eq!(samples.iter().copied().min_by(f64::total_cmp), Some(3616.));
        assert_eq!(samples.iter().copied().max_by(f64::total_cmp), Some(19999.));
    }
}
