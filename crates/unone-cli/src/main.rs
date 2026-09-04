use std::{borrow::Cow, fs, path::PathBuf, process::ExitCode, sync::Arc};

use anyhow::Result;
use clap::{Parser, Subcommand};
use unone_engine::{
    BundleManager, EngineResult, EngineRuntime, InputFrame, Vec2, WorldSnapshot, api_describe,
    api_search, inspect_project,
};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

mod mcp;

#[derive(Debug, Parser)]
#[command(name = "game", version, about = "Unone AI-native game developer CLI")]
struct Cli {
    #[arg(long, default_value = ".", global = true)]
    project: PathBuf,
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    Api {
        #[command(subcommand)]
        command: ApiCommand,
    },
    Platform {
        #[command(subcommand)]
        command: PlatformCommand,
    },
    Check {
        #[arg(long, help = "Also run the official luau-analyze tool")]
        types: bool,
    },
    Run {
        #[arg(long, default_value_t = 60)]
        frames: u64,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        action: Option<String>,
        #[arg(long, conflicts_with = "action")]
        input_sequence: Option<PathBuf>,
    },
    Test,
    Observe,
    Preview {
        #[arg(long, help = "Reload the entry Luau script when its file changes")]
        watch: bool,
    },
    Bundle {
        #[command(subcommand)]
        command: BundleCommand,
    },
    /// Serve the existing Developer Protocol over MCP stdio.
    Mcp,
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    Inspect,
}

#[derive(Debug, Subcommand)]
enum ApiCommand {
    Search { meaning: String },
    Describe { name: String },
}

#[derive(Debug, Subcommand)]
enum PlatformCommand {
    Capabilities,
}

#[derive(Debug, Subcommand)]
enum BundleCommand {
    Inspect,
    Install { id: String },
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(err) => {
            eprintln!("unone: {err:#}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<ExitCode> {
    let cli = Cli::parse();
    match cli.command {
        Command::Project { command } => match command {
            ProjectCommand::Inspect => print_result(inspect_project(&cli.project), cli.json),
        },
        Command::Api { command } => match command {
            ApiCommand::Search { meaning } => {
                let matches = api_search(&meaning);
                let mut result = EngineResult::success(unone_engine::ApiSearchReport {
                    query: meaning,
                    matches,
                });
                if result
                    .value
                    .as_ref()
                    .map(|report| report.matches.is_empty())
                    .unwrap_or(false)
                {
                    result.diagnostics.push(unone_engine::Diagnostic::warning(
                        "API_SEARCH_EMPTY",
                        "沒有找到符合語意的 Engine API",
                        "搜尋只涵蓋目前公開的最小 API；請改用更具體的動詞或先查看 project inspect。",
                    ));
                }
                print_result(result, cli.json)
            }
            ApiCommand::Describe { name } => match api_describe(&name) {
                Some(descriptor) => print_result(EngineResult::success(descriptor), cli.json),
                None => print_result(
                    EngineResult::<serde_json::Value>::failure(unone_engine::Diagnostic::error(
                        "API_NOT_FOUND",
                        "找不到指定的 Engine API",
                        format!(
                            "目前公開 API 沒有 '{}'；先執行 game api search <meaning> 查看可用能力。",
                            name
                        ),
                    )),
                    cli.json,
                ),
            },
        },
        Command::Platform { command } => match command {
            PlatformCommand::Capabilities => {
                print_result(unone_engine::platform_capabilities(), cli.json)
            }
        },
        Command::Check { types } => {
            let result = if types {
                EngineRuntime::check_with_types(&cli.project)
            } else {
                EngineRuntime::check(&cli.project)
            };
            print_result(result, cli.json)
        }
        Command::Run {
            frames,
            seed,
            action,
            input_sequence,
        } => {
            let mut runtime = match EngineRuntime::load_with_seed(&cli.project, seed) {
                Ok(runtime) => runtime,
                Err(diagnostic) => {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(*diagnostic),
                        cli.json,
                    );
                }
            };
            if let Some(path) = input_sequence {
                let text = match fs::read_to_string(&path) {
                    Ok(text) => text,
                    Err(error) => {
                        return print_result(
                            EngineResult::<serde_json::Value>::failure(
                                unone_engine::Diagnostic::error(
                                    "INPUT_SEQUENCE_READ_FAILED",
                                    "無法讀取 input sequence",
                                    format!("{}：{}", path.display(), error),
                                ),
                            ),
                            cli.json,
                        );
                    }
                };
                let sequence: Vec<InputFrame> = match serde_json::from_str(&text) {
                    Ok(sequence) => sequence,
                    Err(error) => {
                        return print_result(
                            EngineResult::<serde_json::Value>::failure(
                                unone_engine::Diagnostic::error(
                                    "INPUT_SEQUENCE_INVALID",
                                    "input sequence 不是有效的 JSON input frame 陣列",
                                    format!("{}：{}", path.display(), error),
                                ),
                            ),
                            cli.json,
                        );
                    }
                };
                print_result(
                    runtime.run_with_input_sequence(frames, seed, &sequence),
                    cli.json,
                )
            } else {
                if let Some(action) = action {
                    runtime.set_input(action, true);
                }
                print_result(runtime.run(frames, seed), cli.json)
            }
        }
        Command::Test => {
            let result = EngineRuntime::run_tests(&cli.project);
            let passed = result.ok
                && result
                    .value
                    .as_ref()
                    .map(|report| report.passed)
                    .unwrap_or(false);
            let code = print_result(result, cli.json)?;
            Ok(if passed { code } else { ExitCode::from(1) })
        }
        Command::Observe => {
            let runtime = match EngineRuntime::load(&cli.project) {
                Ok(runtime) => runtime,
                Err(diagnostic) => {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(*diagnostic),
                        cli.json,
                    );
                }
            };
            print_result(EngineResult::success(runtime.observe()), cli.json)
        }
        Command::Preview { watch } => preview(&cli.project, watch),
        Command::Bundle { command } => {
            let manager = match BundleManager::from_project(&cli.project) {
                Ok(manager) => manager,
                Err(diagnostic) => {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(*diagnostic),
                        cli.json,
                    );
                }
            };
            match command {
                BundleCommand::Inspect => print_result(manager.inspect(), cli.json),
                BundleCommand::Install { id } => print_result(manager.install(&id), cli.json),
            }
        }
        Command::Mcp => mcp::serve(&cli.project),
    }
}

fn print_result<T: serde::Serialize>(result: EngineResult<T>, json: bool) -> Result<ExitCode> {
    if json {
        println!("{}", serde_json::to_string_pretty(&result)?);
    } else if result.ok {
        if let Some(value) = result.value {
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        for diagnostic in result.diagnostics {
            eprintln!(
                "[{:?}] {}: {}",
                diagnostic.severity, diagnostic.code, diagnostic.summary
            );
        }
    } else {
        for diagnostic in &result.diagnostics {
            eprintln!(
                "[{:?}] {}: {}\n{}",
                diagnostic.severity, diagnostic.code, diagnostic.summary, diagnostic.explanation
            );
        }
    }
    Ok(if result.ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn preview(project: &PathBuf, watch: bool) -> Result<ExitCode> {
    let runtime = EngineRuntime::load(project)
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.explanation))?;
    let event_loop = EventLoop::new()?;
    let mut app = PreviewApp::new(runtime, watch);
    event_loop.run_app(&mut app)?;
    Ok(ExitCode::SUCCESS)
}

struct PreviewApp {
    runtime: Option<EngineRuntime>,
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    watch: bool,
}

impl PreviewApp {
    fn new(runtime: EngineRuntime, watch: bool) -> Self {
        Self {
            runtime: Some(runtime),
            window: None,
            renderer: None,
            watch,
        }
    }
}

impl ApplicationHandler for PreviewApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attributes = Window::default_attributes()
            .with_title("Unone native preview")
            .with_inner_size(winit::dpi::LogicalSize::new(960.0, 540.0));
        let window = Arc::new(
            event_loop
                .create_window(attributes)
                .expect("create preview window"),
        );
        let renderer = match pollster::block_on(Renderer::new(Arc::clone(&window))) {
            Ok(renderer) => renderer,
            Err(err) => {
                eprintln!("unone preview: renderer init failed: {err}");
                event_loop.exit();
                return;
            }
        };
        self.window = Some(window);
        self.renderer = Some(renderer);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        let Some(window) = &self.window else { return };
        if window.id() != window_id {
            return;
        }
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(renderer) = &mut self.renderer {
                    renderer.resize(size.width, size.height);
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let Some(runtime) = &mut self.runtime else {
                    return;
                };
                let Some(renderer) = &self.renderer else {
                    return;
                };
                let pointer = renderer.screen_to_world(position.x, position.y, &runtime.observe());
                runtime.set_pointer_position(pointer);
            }
            WindowEvent::MouseInput {
                state,
                button: MouseButton::Left,
                ..
            } => {
                if let Some(runtime) = &mut self.runtime {
                    runtime.set_pointer_down(state == ElementState::Pressed);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let Some(runtime) = &mut self.runtime else {
                    return;
                };
                let action = match event.physical_key {
                    PhysicalKey::Code(KeyCode::ArrowLeft) | PhysicalKey::Code(KeyCode::KeyA) => {
                        Some("Left")
                    }
                    PhysicalKey::Code(KeyCode::ArrowRight) | PhysicalKey::Code(KeyCode::KeyD) => {
                        Some("Right")
                    }
                    PhysicalKey::Code(KeyCode::Escape) if event.state == ElementState::Pressed => {
                        event_loop.exit();
                        None
                    }
                    _ => None,
                };
                if let Some(action) = action {
                    runtime.set_input(action, event.state == ElementState::Pressed);
                }
            }
            WindowEvent::RedrawRequested => {
                let Some(runtime) = &mut self.runtime else {
                    return;
                };
                let snapshot = match runtime.tick() {
                    Ok(snapshot) => snapshot,
                    Err(err) => {
                        eprintln!("unone preview: {}: {}", err.code, err.explanation);
                        event_loop.exit();
                        return;
                    }
                };
                if let Some(renderer) = &mut self.renderer
                    && let Err(err) = renderer.render(&snapshot)
                {
                    eprintln!("unone preview: render failed: {err}");
                    event_loop.exit();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if self.watch
            && let Some(runtime) = &mut self.runtime
        {
            match runtime.reload_if_changed() {
                Ok(true) => eprintln!("unone preview: script reloaded"),
                Ok(false) => {}
                Err(err) => eprintln!(
                    "unone preview: reload rejected [{}] {}\n{}",
                    err.code, err.summary, err.explanation
                ),
            }
        }
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    position: [f32; 2],
    color: [f32; 3],
}

impl Vertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 2] =
        wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x3];

    fn layout<'a>() -> wgpu::VertexBufferLayout<'a> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    vertex_capacity: usize,
}

impl Renderer {
    async fn new(window: Arc<Window>) -> Result<Self, String> {
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window.clone())
            .map_err(|err| err.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .map_err(|err| err.to_string())?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("unone-preview-device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|err| err.to_string())?;
        let size = window.inner_size();
        let capabilities = surface.get_capabilities(&adapter);
        let format = capabilities
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
            .or_else(|| capabilities.formats.first().copied())
            .ok_or_else(|| "GPU surface reported no supported texture formats".to_string())?;
        let present_mode = capabilities
            .present_modes
            .first()
            .copied()
            .ok_or_else(|| "GPU surface reported no supported present modes".to_string())?;
        let alpha_mode = capabilities
            .alpha_modes
            .first()
            .copied()
            .ok_or_else(|| "GPU surface reported no supported alpha modes".to_string())?;
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("unone-preview-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(SHADER)),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("unone-preview-pipeline"),
            layout: Some(
                &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("unone-preview-layout"),
                    bind_group_layouts: &[],
                    immediate_size: 0,
                }),
            ),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[Some(Vertex::layout())],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("unone-preview-vertices"),
            size: (std::mem::size_of::<Vertex>() * 6) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Ok(Self {
            surface,
            device,
            queue,
            config,
            pipeline,
            vertex_buffer,
            vertex_capacity: 6,
        })
    }

    fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }

    fn screen_to_world(&self, x: f64, y: f64, snapshot: &WorldSnapshot) -> Vec2 {
        let clip_x = (x / f64::from(self.config.width)) * 2.0 - 1.0;
        let clip_y = 1.0 - (y / f64::from(self.config.height)) * 2.0;
        let zoom = snapshot.camera.zoom;
        Vec2 {
            x: snapshot.camera.position.x + (clip_x + 0.8) / (0.2 * zoom),
            y: snapshot.camera.position.y + (clip_y + 0.1) / (0.2 * zoom),
        }
    }

    fn render(&mut self, snapshot: &WorldSnapshot) -> Result<(), String> {
        let zoom = snapshot.camera.zoom as f32;
        let mut vertices = Vec::with_capacity(snapshot.entities.len() * 6);
        for entity in snapshot.entities.values() {
            if entity.sprite.as_ref().is_some_and(|sprite| !sprite.visible) {
                continue;
            }
            let x = (-0.8
                + (entity.transform.x as f32 - snapshot.camera.position.x as f32) * 0.2 * zoom)
                .clamp(-0.95, 0.75);
            let y = (-0.1
                + (entity.transform.y as f32 - snapshot.camera.position.y as f32) * 0.2 * zoom)
                .clamp(-0.9, 0.7);
            let (width, height) = entity
                .sprite
                .as_ref()
                .map(|sprite| {
                    (
                        (sprite.size.x as f32 * 0.2 * zoom).max(0.01),
                        (sprite.size.y as f32 * 0.2 * zoom).max(0.01),
                    )
                })
                .unwrap_or((0.2, 0.2));
            let color = match entity.rigidbody.as_ref().map(|body| body.body_type) {
                Some(unone_engine::RigidBodyType::Dynamic) => [0.9, 0.2, 0.15],
                Some(unone_engine::RigidBodyType::Static) => [0.3, 0.65, 0.9],
                None => [0.9, 0.75, 0.2],
            };
            vertices.extend([
                Vertex {
                    position: [x, y],
                    color,
                },
                Vertex {
                    position: [x + width, y],
                    color,
                },
                Vertex {
                    position: [x + width, y + height],
                    color,
                },
                Vertex {
                    position: [x, y],
                    color,
                },
                Vertex {
                    position: [x + width, y + height],
                    color,
                },
                Vertex {
                    position: [x, y + height],
                    color,
                },
            ]);
        }
        self.ensure_vertex_buffer(vertices.len());
        if !vertices.is_empty() {
            self.queue
                .write_buffer(&self.vertex_buffer, 0, bytemuck::cast_slice(&vertices));
        }
        let output = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture)
            | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("surface validation failed".to_string());
            }
        };
        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("unone-preview-encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("unone-preview-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.04,
                            g: 0.05,
                            b: 0.08,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.draw(0..vertices.len() as u32, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        self.queue.present(output);
        Ok(())
    }

    fn ensure_vertex_buffer(&mut self, required_vertices: usize) {
        if required_vertices <= self.vertex_capacity {
            return;
        }
        self.vertex_capacity = required_vertices.next_power_of_two();
        self.vertex_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("unone-preview-vertices"),
            size: (std::mem::size_of::<Vertex>() * self.vertex_capacity) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
    }
}

const SHADER: &str = r#"
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(@location(0) position: vec2<f32>, @location(1) color: vec3<f32>) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(position, 0.0, 1.0);
    out.color = color;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(input.color, 1.0);
}
"#;
