//! The native player's startup screen (docs/player-export.md#startup-screen):
//! the official Web player's logo, progress bar and error, drawn in the game's
//! window from its first frame. Interactive play opens the window and the GPU
//! before anything heavy, then loads the package, starts the game and builds
//! the renderer one step at a time, drawing the screen between steps. A
//! failure stays on screen until the window is closed. Tool runs (replay,
//! measurement, capture, headless) keep their direct start.
use crate::render::{Gpu, Renderer, Target};
use crate::{App, Package, PackageLoader, R, Settings, save};
use base64::Engine;
use resvg::usvg;
use std::{path::PathBuf, sync::Arc, thread::JoinHandle, time::{Duration, Instant}};
use unone_engine::{StartupTheme, hex_color};
#[cfg(target_os = "windows")]
use winit::platform::windows::WindowAttributesExtWindows;
use winit::{application::ApplicationHandler, event::WindowEvent, event_loop::ActiveEventLoop, window::{Window, WindowId}};

/// The Unone mark and wordmark, drawn with paths so no font is needed. The
/// Web player's index.html carries the same body.
pub(crate) const DEFAULT_LOGO_BODY: &str = r##"<path d="M10 12v20a22 22 0 0 0 44 0V12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><circle cx="32" cy="14" r="6" fill="#38bdf8"/><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M74 18v18a10 10 0 0 0 20 0V18"/><path d="M106 46V18l20 28V18"/><ellipse cx="148" cy="32" rx="10" ry="14"/><path d="M170 46V18l20 28V18"/><path d="M222 18h-20v28h20M202 32h16"/></g>"##;
const DEFAULT_LOGO_SIZE: (f64, f64) = (236., 64.);
const LABEL_FONTS: &str = "'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";
const ERROR_FONTS: &str = "Consolas, 'Cascadia Mono', 'Roboto Mono', 'DejaVu Sans Mono', Menlo, monospace";

// Each step's share of the bar. Shares are not time estimates: a step moves
// the bar only when it really progresses (package files count by bytes).
const STEPS: [(&str, &str, f64); 4] = [
    ("content", "Loading game content", 40.),
    ("game", "Starting game", 25.),
    ("renderer", "Preparing renderer", 25.),
    ("present", "Preparing first frame", 10.),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StepState { Pending, Active, Done }

#[derive(Debug)]
struct Step { state: StepState, fraction: f64, detail: Option<String> }

/// What the screen says: the steps, the bar and any error.
#[derive(Debug)]
pub(crate) struct Screen {
    steps: Vec<Step>,
    failed: bool,
    failed_step: Option<usize>,
    message: Option<String>,
}

impl Screen {
    pub(crate) fn new() -> Self {
        Self { steps: STEPS.iter().map(|_| Step { state: StepState::Pending, fraction: 0., detail: None }).collect(), failed: false, failed_step: None, message: None }
    }
    /// The screen of a game that stopped after its first frame.
    pub(crate) fn stopped(message: &str) -> Self {
        let mut screen = Self::new();
        for step in &mut screen.steps { step.state = StepState::Done; step.fraction = 1.; }
        screen.failed = true;
        screen.message = Some(message.to_owned());
        screen
    }
    fn index(id: &str) -> usize {
        STEPS.iter().position(|step| step.0 == id).unwrap_or_else(|| panic!("unknown startup step {id}"))
    }
    pub(crate) fn start(&mut self, id: &str) {
        let step = &mut self.steps[Self::index(id)];
        if !self.failed && step.state == StepState::Pending { step.state = StepState::Active; }
    }
    /// Counted work inside a step; the bar never moves backwards.
    pub(crate) fn progress(&mut self, id: &str, fraction: f64, detail: Option<String>) {
        let step = &mut self.steps[Self::index(id)];
        if self.failed || step.state == StepState::Done || !fraction.is_finite() { return; }
        step.state = StepState::Active;
        step.fraction = step.fraction.max(fraction.clamp(0., 1.));
        step.detail = detail;
    }
    pub(crate) fn complete(&mut self, id: &str) {
        let step = &mut self.steps[Self::index(id)];
        if self.failed { return; }
        step.state = StepState::Done;
        step.fraction = 1.;
        step.detail = None;
    }
    fn current(&self) -> Option<usize> {
        self.steps.iter().position(|step| step.state == StepState::Active)
            .or_else(|| self.steps.iter().position(|step| step.state == StepState::Pending))
    }
    /// A startup failure names the step it stopped in.
    pub(crate) fn fail(&mut self, message: &str) {
        if !self.failed { self.failed_step = self.current(); }
        self.failed = true;
        self.message = Some(message.to_owned());
    }
    pub(crate) fn failed(&self) -> bool { self.failed }
    pub(crate) fn value(&self) -> f64 {
        let total: f64 = STEPS.iter().map(|step| step.2).sum();
        self.steps.iter().zip(STEPS).map(|(step, (_, _, weight))| weight * if step.state == StepState::Done { 1. } else { step.fraction }).sum::<f64>() / total
    }
    pub(crate) fn label(&self) -> String {
        if self.failed {
            return match self.failed_step {
                Some(index) => { let label = STEPS[index].1; format!("Startup failed while {}{}", label[..1].to_lowercase(), &label[1..]) }
                None => "The game stopped".into(),
            };
        }
        match self.current() {
            Some(index) => match &self.steps[index].detail {
                Some(detail) => format!("{} {detail}", STEPS[index].1),
                None => format!("{}…", STEPS[index].1),
            },
            None => "Ready".into(),
        }
    }
    pub(crate) fn message(&self) -> Option<&str> { self.message.as_deref() }
}

/// The project's colours and logo (presentation.json `startup`), or Unone's.
pub(crate) struct Look {
    theme: StartupTheme,
    /// A data URI the screen's SVG embeds, and the logo's natural size.
    logo: String,
    size: (f64, f64),
    project_logo: bool,
}

impl Look {
    pub(crate) fn unone() -> Self {
        Self::default_logo(unone_engine::STARTUP_DARK)
    }
    fn default_logo(theme: StartupTheme) -> Self {
        let svg = format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 236 64' width='236' height='64'>{}</svg>",
            DEFAULT_LOGO_BODY.replace("currentColor", &hex_color(theme.foreground)));
        Self { theme, logo: data_uri("image/svg+xml", svg.as_bytes()), size: DEFAULT_LOGO_SIZE, project_logo: false }
    }
    /// `file` reads a hash-verified package file by its package path.
    pub(crate) fn load(presentation: Option<&[u8]>, mut file: impl FnMut(&str) -> R<Vec<u8>>) -> R<Self> {
        let presentation: serde_json::Value = match presentation {
            Some(bytes) => serde_json::from_slice(bytes).map_err(|e| format!("NATIVE_PRESENTATION_INVALID: {e}"))?,
            None => serde_json::Value::Null,
        };
        let startup = &presentation["startup"];
        let theme = StartupTheme::for_background(startup["background"].as_str())?;
        let Some(path) = startup["logo"].as_str() else { return Ok(Self::default_logo(theme)) };
        if !crate::safe(path) { return Err(format!("STARTUP_LOGO_PATH_INVALID: {path}")); }
        let bytes = file(&format!("content/{path}"))?;
        let extension = path.rsplit_once('.').map(|(_, extension)| extension.to_ascii_lowercase()).unwrap_or_default();
        let (logo, size) = if extension == "svg" {
            // The same static-SVG rules as UI images: no scripts, styles or outside resources.
            let options = usvg::Options::default();
            crate::ui::validate_svg(&bytes, &options).map_err(|e| format!("STARTUP_LOGO_INVALID: {path}: {e}"))?;
            let tree = usvg::Tree::from_data(&bytes, &options).map_err(|e| format!("STARTUP_LOGO_INVALID: {path}: {e}"))?;
            (data_uri("image/svg+xml", &bytes), (f64::from(tree.size().width()), f64::from(tree.size().height())))
        } else if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
            let image = image::load_from_memory(&bytes).map_err(|e| format!("STARTUP_LOGO_INVALID: {path}: {e}"))?;
            let mut png = Vec::new();
            image.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| format!("STARTUP_LOGO_INVALID: {path}: {e}"))?;
            (data_uri("image/png", &png), (f64::from(image.width()), f64::from(image.height())))
        } else {
            return Err(format!("STARTUP_LOGO_FORMAT_UNSUPPORTED: {path}"));
        };
        Ok(Self { theme, logo, size, project_logo: true })
    }
}

fn data_uri(kind: &str, bytes: &[u8]) -> String {
    format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// System fonts for the label and errors. They load on their own thread so
/// the first frames (logo and bar) need not wait for them.
pub(crate) enum Fonts {
    Loading(JoinHandle<usvg::fontdb::Database>),
    Ready(Arc<usvg::fontdb::Database>),
}

impl Fonts {
    pub(crate) fn load() -> Self {
        Self::Loading(std::thread::spawn(|| {
            crate::memory_diagnostic::checkpoint("startup.fonts.before_system_scan", None);
            let mut fonts = usvg::fontdb::Database::new();
            fonts.load_system_fonts();
            crate::memory_diagnostic::checkpoint("startup.fonts.after_system_scan", None);
            fonts
        }))
    }
    /// The fonts once loaded; `wait` blocks until they are (an error must be readable).
    fn get(&mut self, wait: bool) -> Option<Arc<usvg::fontdb::Database>> {
        if let Self::Loading(handle) = self && !wait && !handle.is_finished() {
            return None;
        }
        if let Self::Loading(_) = self {
            let Self::Loading(handle) = std::mem::replace(self, Self::Ready(Arc::new(usvg::fontdb::Database::new()))) else { unreachable!() };
            // A loader thread that panicked leaves no system fonts: the screen still draws, without text.
            *self = Self::Ready(Arc::new(handle.join().unwrap_or_else(|_| usvg::fontdb::Database::new())));
        }
        match self { Self::Ready(fonts) => Some(fonts.clone()), Self::Loading(_) => None }
    }
}

/// The screen as SVG markup over a `width` x `height` pixel window.
fn markup(screen: &Screen, look: &Look, width: u32, height: u32, scale: f64, fonts: Option<&usvg::Options<'_>>) -> R<String> {
    let theme = look.theme;
    let (view_width, view_height) = (f64::from(width) / scale, f64::from(height) / scale);
    // The Web page's layout, in CSS pixels: a centred column of logo, bar, label and error.
    let panel = (view_width - 32.).min(640.).max(1.);
    let (logo_width, logo_height) = {
        let (natural_width, natural_height) = look.size;
        let max_height = (view_height * 0.3).min(240.);
        if look.project_logo {
            let fit = (320f64.min(panel * 0.8) / natural_width).min(max_height / natural_height).min(1.);
            (natural_width * fit, natural_height * fit)
        } else {
            let width = 240f64.min(panel * 0.7);
            let height = (width * natural_height / natural_width).min(max_height);
            (height * natural_width / natural_height, height)
        }
    };
    let bar_width = 320f64.min(panel);
    let mut error_lines = Vec::new();
    if let (Some(message), Some(options)) = (screen.message(), fonts) {
        let mut measure = |text: &str| crate::ui::measure_text(options, text, ERROR_FONTS, 13., 400, 0.);
        error_lines = crate::ui::wrap_lines(message, panel - 31., true, &mut measure)?;
        let fits = ((view_height * 0.4 - 24.) / 19.5).floor().max(1.) as usize;
        if error_lines.len() > fits {
            error_lines.truncate(fits);
            if let Some(last) = error_lines.last_mut() { last.push('…'); }
        }
    }
    let error_height = if error_lines.is_empty() { 0. } else { 24. + 19.5 * error_lines.len() as f64 };
    let total = logo_height + 18. + 4. + 18. + 18.2 + if error_height > 0. { 18. + error_height } else { 0. };
    let mut y = ((view_height - total) / 2.).max(16.);
    let centre = view_width / 2.;
    let (fg, accent, error) = (hex_color(theme.foreground), hex_color(theme.accent), hex_color(theme.error));
    let mut svg = format!("<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='{width}' height='{height}'><rect width='{width}' height='{height}' fill='{}'/><g transform='scale({scale})'>", hex_color(theme.background));
    svg += &format!("<image x='{}' y='{y}' width='{logo_width}' height='{logo_height}' preserveAspectRatio='xMidYMid meet' xlink:href='{}'/>", centre - logo_width / 2., look.logo);
    y += logo_height + 18.;
    let bar_x = centre - bar_width / 2.;
    svg += &format!("<rect x='{bar_x}' y='{y}' width='{bar_width}' height='4' rx='2' fill='{fg}' fill-opacity='0.2'/>");
    let filled = bar_width * screen.value();
    if filled > 0. {
        svg += &format!("<rect x='{bar_x}' y='{y}' width='{filled}' height='4' rx='2' fill='{}'/>", if screen.failed() { &error } else { &accent });
    }
    y += 4. + 18.;
    if fonts.is_some() {
        let (fill, opacity) = if screen.failed() { (&error, 1.) } else { (&fg, 0.75) };
        svg += &format!("<text x='{centre}' y='{}' text-anchor='middle' font-family=\"{LABEL_FONTS}\" font-size='13' fill='{fill}' fill-opacity='{opacity}'>{}</text>", y + 13., crate::ui::escape(&screen.label()));
    }
    y += 18.2;
    if !error_lines.is_empty() {
        y += 18.;
        let left = centre - panel / 2.;
        svg += &format!("<rect x='{left}' y='{y}' width='{panel}' height='{error_height}' rx='6' fill='{fg}' fill-opacity='0.08'/><rect x='{left}' y='{y}' width='3' height='{error_height}' fill='{error}'/>");
        for (line, text) in error_lines.iter().enumerate() {
            svg += &format!("<text x='{}' y='{}' xml:space='preserve' font-family=\"{ERROR_FONTS}\" font-size='13' fill='{fg}'>{}</text>", left + 17., y + 12. + 19.5 * line as f64 + 14., crate::ui::escape(text));
        }
    }
    svg += "</g></svg>";
    Ok(svg)
}

/// Rasterizes the screen and draws it as one full-window texture.
#[derive(Default)]
pub(crate) struct Painter {
    gpu: Option<PainterGpu>,
}
struct PainterGpu {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    texture: Option<(wgpu::Texture, wgpu::BindGroup, [u32; 2])>,
}

const SHADER: &str = "
@group(0) @binding(0) var screen_texture: texture_2d<f32>;
@group(0) @binding(1) var screen_sampler: sampler;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
    let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var out: Out;
    out.position = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}
@fragment fn fs(input: Out) -> @location(0) vec4f { return textureSample(screen_texture, screen_sampler, input.uv); }
";

impl PainterGpu {
    fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("startup screen"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("startup screen"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("startup screen"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &[Some(&layout)], immediate_size: 0 })),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), buffers: &[], compilation_options: Default::default() },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState { format, blend: None, write_mask: wgpu::ColorWrites::ALL })],
                compilation_options: Default::default(),
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor::default());
        Self { pipeline, layout, sampler, texture: None }
    }
}

impl Painter {
    /// Forget GPU objects of a device that is gone (Android suspend).
    pub(crate) fn reset(&mut self) { self.gpu = None; }
    pub(crate) fn draw(&mut self, target: Target<'_>, scale: f64, screen: &Screen, look: &Look, fonts: &mut Fonts) -> R<()> {
        use crate::memory_diagnostic::checkpoint;
        let first = self.gpu.is_none();
        if first {
            checkpoint("startup.painter.before_create", Some(target.device));
        }
        let [width, height] = [target.config.width.max(1), target.config.height.max(1)];
        let options = fonts.get(screen.failed()).map(|fonts| {
            let mut options = usvg::Options::default();
            options.fontdb = fonts;
            options.image_href_resolver.resolve_string = Box::new(|_, _| None);
            options
        });
        let svg = markup(screen, look, width, height, scale.max(0.25), options.as_ref())?;
        let options = options.unwrap_or_else(|| { let mut options = usvg::Options::default(); options.image_href_resolver.resolve_string = Box::new(|_, _| None); options });
        let tree = usvg::Tree::from_str(&svg, &options).map_err(|e| format!("NATIVE_STARTUP_SCREEN_FAILED: {e}"))?;
        let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height).ok_or("NATIVE_STARTUP_SCREEN_FAILED: window size")?;
        resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
        if first {
            checkpoint("startup.painter.after_cpu_raster", Some(target.device));
        }
        let gpu = self.gpu.get_or_insert_with(|| PainterGpu::new(target.device, target.config.format));
        if gpu.texture.as_ref().is_none_or(|texture| texture.2 != [width, height]) {
            let texture = target.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("startup screen"),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            let group = target.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("startup screen"),
                layout: &gpu.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&texture.create_view(&Default::default())) },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&gpu.sampler) },
                ],
            });
            gpu.texture = Some((texture, group, [width, height]));
        }
        let (texture, group, _) = gpu.texture.as_ref().unwrap();
        // The background rectangle makes every pixel opaque, so premultiplied
        // and straight alpha are the same here.
        target.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            pixmap.data(),
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(width * 4), rows_per_image: Some(height) },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        if first {
            checkpoint("startup.painter.after_texture_upload", Some(target.device));
        }
        let output = match target.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Lost | wgpu::CurrentSurfaceTexture::Outdated => { target.surface.configure(target.device, target.config); return Ok(()); }
            _ => return Err("NATIVE_SURFACE_INVALID".into()),
        };
        let view = output.texture.create_view(&Default::default());
        let mut encoder = target.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("startup screen"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&gpu.pipeline);
            pass.set_bind_group(0, group, &[]);
            pass.draw(0..3, 0..1);
        }
        target.queue.submit([encoder.finish()]);
        target.queue.present(output);
        if first {
            checkpoint("startup.painter.after_present", Some(target.device));
        }
        Ok(())
    }
}

/// The error screen of a game that stopped after its first frame.
pub(crate) struct Stopped {
    screen: Screen,
    look: Look,
    fonts: Fonts,
    painter: Painter,
}

impl Stopped {
    pub(crate) fn new(package: &Package, message: &str) -> Self {
        let presentation = package.files.get("content/presentation.json").map(Vec::as_slice);
        let look = Look::load(presentation, |path| package.get(path).map(<[u8]>::to_vec)).unwrap_or_else(|_| Look::unone());
        Self { screen: Screen::stopped(message), look, fonts: Fonts::load(), painter: Painter::default() }
    }
    pub(crate) fn draw(&mut self, renderer: &Renderer, scale: f64) -> R<()> {
        self.painter.draw(renderer.target(), scale, &self.screen, &self.look, &mut self.fonts)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage { Content, Game, Renderer, Present, Running, Failed }

type Reader = Box<dyn FnMut(&str) -> R<Vec<u8>>>;

/// Interactive play's event loop handler until the game draws its first frame;
/// then it hands every event to the game's App.
pub(crate) struct Launcher {
    loader: Option<PackageLoader<Reader>>,
    launch: Option<(Settings, Option<PathBuf>, Instant, save::Store)>,
    size: [u32; 2],
    disable_lod: bool,
    look: Look,
    fonts: Fonts,
    screen: Screen,
    stage: Stage,
    window: Option<Arc<Window>>,
    gpu: Option<Gpu>,
    painter: Painter,
    package: Option<Package>,
    app: Option<App>,
    renderer: Option<Renderer>,
    error: Option<String>,
}

impl Launcher {
    /// Reads only what the first frame needs: the manifest, the presentation,
    /// the logo and the design size. A failure here shows on the screen too.
    pub(crate) fn new(read: Reader, mut settings: Settings, report: Option<PathBuf>, boot: Instant, store: save::Store) -> Self {
        let fonts = Fonts::load();
        let mut screen = Screen::new();
        screen.start("content");
        let opened = (|| -> R<(PackageLoader<Reader>, Look)> {
            let mut loader = PackageLoader::open(read)?;
            let presentation = loader.file("content/presentation.json")?;
            if let Some(project) = loader.file("content/project.json")? {
                #[derive(serde::Deserialize, Default)]
                struct Head { #[serde(default)] config: Config }
                #[derive(serde::Deserialize, Default)]
                struct Config { #[serde(default)] display: Option<unone_engine::DisplayConfig> }
                let head: Head = serde_json::from_slice(&project).unwrap_or_default();
                if settings.width.is_none() && settings.height.is_none() && let Some(display) = head.config.display {
                    settings.width = Some(display.width.get());
                    settings.height = Some(display.height.get());
                }
            }
            let look = Look::load(presentation.as_deref(), |path| loader.file(path)?.ok_or_else(|| format!("NATIVE_FILE_MISSING: {path}")))?;
            Ok((loader, look))
        })();
        let size = [settings.width.unwrap_or(1280), settings.height.unwrap_or(720)];
        let disable_lod = settings.disable_lod;
        let (loader, look, stage, error) = match opened {
            Ok((loader, look)) => (Some(loader), look, Stage::Content, None),
            Err(error) => { screen.fail(&error); (None, Look::unone(), Stage::Failed, Some(error)) }
        };
        Self { loader, launch: Some((settings, report, boot, store)), size, disable_lod, look, fonts, screen, stage, window: None, gpu: None,
            painter: Painter::default(), package: None, app: None, renderer: None, error }
    }
    /// The startup error, or the game's, once the event loop has ended.
    pub(crate) fn error(self) -> Option<String> {
        self.error.or_else(|| self.app.and_then(|app| app.error))
    }
    fn draw(&mut self) {
        let Some(window) = &self.window else { return };
        if self.gpu.is_none() && self.renderer.is_none() {
            // A renderer that failed to build took the context with it; open another for the error.
            match pollster::block_on(Gpu::new(window.clone())) { Ok(gpu) => { self.gpu = Some(gpu); self.painter.reset(); } Err(_) => return }
        }
        let target = match (&self.renderer, &self.gpu) { (Some(renderer), _) => renderer.target(), (None, Some(gpu)) => gpu.target(), _ => return };
        if let Err(error) = self.painter.draw(target, window.scale_factor(), &self.screen, &self.look, &mut self.fonts) {
            eprintln!("{error}");
        }
    }
    fn fail(&mut self, error: String) {
        self.screen.fail(&error);
        self.error = Some(error);
        self.stage = Stage::Failed;
        self.draw();
    }
    /// One step of startup; the screen was drawn just before it.
    fn work(&mut self) -> R<()> {
        match self.stage {
            Stage::Content => {
                let loader = self.loader.as_mut().ok_or("NATIVE_STARTUP_STATE")?;
                let done = loader.advance(Duration::from_millis(30))?;
                let (bytes, total_bytes, files, total_files) = loader.progress();
                self.screen.progress("content", bytes as f64 / total_bytes.max(1) as f64, Some(format!("{files}/{total_files}")));
                if done {
                    self.package = Some(self.loader.take().unwrap().finish()?);
                    crate::memory_diagnostic::checkpoint("startup.package_loaded", self.gpu.as_ref().map(|gpu| gpu.target().device));
                    self.screen.complete("content");
                    self.screen.start("game");
                    self.stage = Stage::Game;
                }
            }
            Stage::Game => {
                let (settings, report, boot, store) = self.launch.take().ok_or("NATIVE_STARTUP_STATE")?;
                self.app = Some(App::new(self.package.take().ok_or("NATIVE_STARTUP_STATE")?, settings, report, boot, store)?);
                crate::memory_diagnostic::checkpoint("startup.app_created", self.gpu.as_ref().map(|gpu| gpu.target().device));
                self.screen.complete("game");
                self.screen.start("renderer");
                self.stage = Stage::Renderer;
            }
            Stage::Renderer => {
                let gpu = self.gpu.take().ok_or("NATIVE_STARTUP_STATE")?;
                let mut renderer = Renderer::with_gpu(gpu, &self.app.as_ref().ok_or("NATIVE_STARTUP_STATE")?.package)?;
                renderer.lod_enabled = !self.disable_lod;
                self.renderer = Some(renderer);
                self.screen.complete("renderer");
                self.screen.start("present");
                self.stage = Stage::Present;
            }
            Stage::Present => {
                let window = self.window.clone().ok_or("NATIVE_STARTUP_STATE")?;
                let renderer = self.renderer.take().ok_or("NATIVE_STARTUP_STATE")?;
                self.app.as_mut().ok_or("NATIVE_STARTUP_STATE")?.adopt(window, renderer)?;
                self.stage = Stage::Running;
            }
            Stage::Running | Stage::Failed => {}
        }
        Ok(())
    }
}

impl ApplicationHandler for Launcher {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.stage == Stage::Running {
            if let Some(app) = &mut self.app { app.resumed(event_loop); }
            return;
        }
        if self.window.is_none() {
            // Hidden until the startup screen's first frame, so the window never
            // shows blank while the GPU starts.
            let mut attributes = Window::default_attributes()
                .with_title("Unone Native Player")
                .with_visible(false)
                .with_inner_size(winit::dpi::PhysicalSize::new(self.size[0], self.size[1]));
            #[cfg(target_os = "windows")]
            { attributes = attributes.with_drag_and_drop(false); }
            match event_loop.create_window(attributes) {
                Ok(window) => self.window = Some(Arc::new(window)),
                Err(error) => { self.error = Some(error.to_string()); event_loop.exit(); return; }
            }
        }
        if self.gpu.is_none() && self.renderer.is_none() && let Some(window) = &self.window {
            match pollster::block_on(Gpu::new(window.clone())) {
                Ok(gpu) => { self.gpu = Some(gpu); self.painter.reset(); }
                Err(error) => { self.error = Some(error); event_loop.exit(); return; }
            }
        }
        self.draw();
        if let Some(window) = &self.window {
            window.set_visible(true);
            window.request_redraw();
        }
    }
    fn suspended(&mut self, event_loop: &ActiveEventLoop) {
        if self.stage == Stage::Running {
            if let Some(app) = &mut self.app { app.suspended(event_loop); }
            return;
        }
        // The surface is gone until the next resume; a built renderer is rebuilt then.
        if self.stage == Stage::Present { self.renderer = None; self.stage = Stage::Renderer; self.screen = Screen::new(); for id in ["content", "game"] { self.screen.complete(id); } self.screen.start("renderer"); }
        self.gpu = None;
        self.painter.reset();
        self.window = None;
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        if self.stage == Stage::Running {
            if let Some(app) = &mut self.app { app.window_event(event_loop, id, event); }
            return;
        }
        if self.window.as_ref().is_none_or(|window| window.id() != id) { return; }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = &mut self.gpu { gpu.resize(size.width, size.height); }
                if let Some(renderer) = &mut self.renderer { renderer.resize(size.width, size.height); }
                if let Some(window) = &self.window { window.request_redraw(); }
            }
            WindowEvent::RedrawRequested => {
                self.draw();
                if self.stage == Stage::Failed { return; }
                match self.work() {
                    Err(error) => self.fail(error),
                    Ok(()) => if let Some(window) = &self.window { window.request_redraw(); },
                }
            }
            _ => {}
        }
    }
    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.stage == Stage::Running && let Some(app) = &mut self.app { app.about_to_wait(event_loop); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_move_the_bar_forward_and_failures_name_their_step() {
        let mut screen = Screen::new();
        assert_eq!(screen.label(), "Loading game content…");
        screen.start("content");
        screen.progress("content", 0.5, Some("3/6".into()));
        assert_eq!(screen.label(), "Loading game content 3/6");
        assert!((screen.value() - 0.2).abs() < 1e-9);
        screen.progress("content", 0.25, None);
        assert!((screen.value() - 0.2).abs() < 1e-9, "a lower count never moves the bar back");
        screen.complete("content");
        screen.start("game");
        assert_eq!(screen.label(), "Starting game…");
        screen.fail("SCRIPT_FAILED: boom");
        assert_eq!(screen.label(), "Startup failed while starting game");
        assert_eq!(screen.message(), Some("SCRIPT_FAILED: boom"));
        screen.complete("game");
        assert!((screen.value() - 0.4).abs() < 1e-9, "nothing after a failure moves the bar");
        let stopped = Screen::stopped("TICK_FAILED: boom");
        assert_eq!((stopped.label().as_str(), stopped.value()), ("The game stopped", 1.));
    }

    #[test]
    fn the_unone_logo_matches_the_web_player_and_needs_no_font() {
        let page = include_str!("../../../web/player/index.html");
        assert!(page.contains(DEFAULT_LOGO_BODY), "web/player/index.html and the native player draw the same Unone logo");
        assert!(!DEFAULT_LOGO_BODY.contains("<text"));
    }

    #[test]
    fn a_project_look_reads_its_theme_and_checks_its_logo() {
        let presentation = |startup: serde_json::Value| serde_json::to_vec(&serde_json::json!({ "startup": startup })).unwrap();
        let look = Look::load(None, |_| Err("no files".into())).unwrap();
        assert_eq!(look.theme, unone_engine::STARTUP_DARK);
        assert!(!look.project_logo);
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(40, 20, image::Rgba([200, 30, 30, 255])).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let look = Look::load(Some(&presentation(serde_json::json!({"logo": "brand/logo.png", "background": "#f4efe4"}))), |path| {
            assert_eq!(path, "content/brand/logo.png");
            Ok(png.clone())
        }).unwrap();
        assert!(look.project_logo && look.logo.starts_with("data:image/png;base64,"));
        assert_eq!(look.size, (40., 20.));
        assert!(look.theme.is_light());
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="30"><rect width="120" height="30"/></svg>"#;
        let look = Look::load(Some(&presentation(serde_json::json!({"logo": "logo.svg"}))), |_| Ok(svg.to_vec())).unwrap();
        assert_eq!(look.size, (120., 30.));
        for (startup, file, code) in [
            (serde_json::json!({"logo": "../logo.png"}), Vec::new(), "STARTUP_LOGO_PATH_INVALID"),
            (serde_json::json!({"logo": "logo.png"}), b"not a png".to_vec(), "STARTUP_LOGO_INVALID"),
            (serde_json::json!({"logo": "logo.svg"}), br#"<svg xmlns="http://www.w3.org/2000/svg"><style>rect{}</style></svg>"#.to_vec(), "STARTUP_LOGO_INVALID"),
            (serde_json::json!({"logo": "logo.gif"}), b"GIF89a".to_vec(), "STARTUP_LOGO_FORMAT_UNSUPPORTED"),
            (serde_json::json!({"background": "teal"}), Vec::new(), "STARTUP_BACKGROUND_INVALID"),
        ] {
            let error = Look::load(Some(&presentation(startup.clone())), |_| Ok(file.clone())).err().unwrap();
            assert!(error.contains(code), "{startup}: {error}");
        }
    }

    #[test]
    fn the_screen_rasterizes_its_logo_bar_label_and_error() {
        let mut fonts = Fonts::load();
        let fonts = fonts.get(true).unwrap();
        let mut options = usvg::Options::default();
        options.fontdb = fonts;
        let look = Look::unone();
        let mut screen = Screen::new();
        screen.start("content");
        screen.progress("content", 0.5, None);
        let pixels = |screen: &Screen| {
            let svg = markup(screen, &look, 640, 360, 1., Some(&options)).unwrap();
            let tree = usvg::Tree::from_str(&svg, &options).unwrap();
            let mut pixmap = resvg::tiny_skia::Pixmap::new(640, 360).unwrap();
            resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
            pixmap
        };
        let at = |pixmap: &resvg::tiny_skia::Pixmap, x: u32, y: u32| { let p = pixmap.pixel(x, y).unwrap(); [p.red(), p.green(), p.blue()] };
        let loading = pixels(&screen);
        assert_eq!(at(&loading, 5, 5), unone_engine::STARTUP_DARK.background);
        // The logo is 240 wide and centred; the 320-wide bar below it is a fifth
        // full (half of the 40% content step), in the accent colour.
        let logo_height = 240. * 64. / 236.;
        let bar_top = (360. - (logo_height + 18. + 4. + 18. + 18.2)) / 2. + logo_height + 18.;
        let bar_y = (bar_top + 2.) as u32;
        assert_eq!(at(&loading, 200, bar_y), unone_engine::STARTUP_DARK.accent);
        assert_ne!(at(&loading, 400, bar_y), unone_engine::STARTUP_DARK.accent);
        // The mark's left stroke runs down logo x = 10 from y = 12 to 32.
        let scale = 240. / 236.;
        assert_eq!(at(&loading, (200. + 10. * scale) as u32, (bar_top - 18. - logo_height + 22. * scale) as u32), unone_engine::STARTUP_DARK.foreground, "the logo is drawn");
        let label_row = (bar_y + 14..bar_y + 34).any(|y| (250..390).any(|x| at(&loading, x, y) != unone_engine::STARTUP_DARK.background));
        assert!(label_row, "the label is drawn with a system font");
        screen.fail("NATIVE_HASH_MISMATCH: content/project.json");
        let failed = pixels(&screen);
        assert!((0..360).any(|y| at(&failed, 17, y) == unone_engine::STARTUP_DARK.error), "the error box has its red edge");
        assert!((0..360).any(|y| (100..300).any(|x| at(&failed, x, y) == unone_engine::STARTUP_DARK.error)), "the failed bar and label turn red");
    }
}
