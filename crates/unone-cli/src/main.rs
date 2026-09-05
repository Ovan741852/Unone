use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
};

use anyhow::Result;
use clap::{Parser, Subcommand};
use unone_engine::{
    AssetSpec, BundleManager, Camera3DData, EngineResult, EngineRuntime, InputFrame, Vec2, Vec3,
    WorldSnapshot, api_describe, api_search, init_asset_manifest, init_project, inspect_assets,
    inspect_assets_strict, inspect_project, inspect_systems, pack_project, read_asset,
    search_systems, set_system,
};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

mod assets;
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
    Asset {
        #[command(subcommand)]
        command: AssetCommand,
    },
    Api {
        #[command(subcommand)]
        command: ApiCommand,
    },
    /// Inspect, search and switch the engine systems this project runs.
    Systems {
        #[command(subcommand)]
        command: SystemsCommand,
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
    /// Create a minimal valid project scaffold without game-specific rules.
    Init {
        #[arg(long, help = "Project name written to project.unone.json")]
        name: String,
    },
}

#[derive(Debug, Subcommand)]
enum AssetCommand {
    /// Inspect static scene asset references against the game-owned manifest.
    Inspect {
        #[arg(long, help = "Turn unresolved static references into a failing gate")]
        strict: bool,
    },
    /// Read one declared asset out of the active bundle generation.
    Read {
        #[arg(long, help = "Declared asset id, for example asset://characters/hero")]
        id: String,
        #[arg(
            long,
            help = "Read one declared companion file instead of the asset source"
        )]
        file: Option<String>,
        #[arg(long, help = "Write the verified asset bytes to this path")]
        output: Option<PathBuf>,
    },
    /// Create an empty manifest or add one explicit asset declaration.
    Init {
        #[arg(long, help = "Manifest path relative to the project root")]
        output: Option<PathBuf>,
        #[arg(long, help = "Stable asset id, for example asset://characters/hero")]
        id: Option<String>,
        #[arg(long, help = "Source path relative to the project root")]
        source: Option<String>,
        #[arg(long, default_value = "texture2d")]
        kind: String,
        #[arg(long, default_value = "content")]
        bundle: String,
        #[arg(
            long,
            help = "Companion project-relative sources this asset needs, such as a Spine atlas"
        )]
        file: Vec<String>,
    },
}

#[derive(Debug, Subcommand)]
enum SystemsCommand {
    /// Report every declared engine system and whether this project runs it.
    List,
    /// Find systems by meaning, for example "物理" or "存檔".
    Search { meaning: String },
    /// Turn one system on or off in project.unone.json.
    Set {
        #[arg(long, help = "System id, for example physics2d")]
        id: String,
        #[arg(
            long,
            action = clap::ArgAction::Set,
            help = "true to enable, false to disable"
        )]
        enabled: bool,
    },
}

#[derive(Debug, Subcommand)]
enum ApiCommand {
    Search { meaning: String },
    Describe { name: String },
    /// Print the engine's canonical Luau type contract, or write it to a file.
    Typings {
        #[arg(long, help = "Write the type contract to this path instead of stdout")]
        output: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
enum PlatformCommand {
    Capabilities,
}

#[derive(Debug, Subcommand)]
enum BundleCommand {
    /// Generate the minimal project/script/scene manifest and configure the project.
    Pack {
        #[arg(long, help = "Manifest path relative to the project root")]
        output: Option<PathBuf>,
    },
    Inspect,
    Install {
        id: String,
    },
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
            ProjectCommand::Init { name } => {
                print_result(init_project(&cli.project, &name), cli.json)
            }
        },
        Command::Asset { command } => match command {
            AssetCommand::Inspect { strict } => print_result(
                if strict {
                    inspect_assets_strict(&cli.project)
                } else {
                    inspect_assets(&cli.project)
                },
                cli.json,
            ),
            AssetCommand::Read { id, file, output } => print_result(
                read_asset(&cli.project, &id, file.as_deref(), output.as_deref()),
                cli.json,
            ),
            AssetCommand::Init {
                output,
                id,
                source,
                kind,
                bundle,
                file,
            } => {
                let new_asset = match (id, source) {
                    (None, None) => None,
                    (Some(id), Some(source)) => Some(AssetSpec {
                        id,
                        source,
                        kind,
                        bundle,
                        files: file,
                    }),
                    (None, Some(_)) => {
                        return print_result(
                            EngineResult::<serde_json::Value>::failure(
                                unone_engine::Diagnostic::error(
                                    "ASSET_INIT_ARGUMENT_INVALID",
                                    "asset init 的 source 缺少 id",
                                    "--source 只能和 --id 一起使用；不帶 id 時只建立空 manifest。",
                                ),
                            ),
                            cli.json,
                        );
                    }
                    (Some(_), None) => {
                        return print_result(
                            EngineResult::<serde_json::Value>::failure(
                                unone_engine::Diagnostic::error(
                                    "ASSET_INIT_ARGUMENT_INVALID",
                                    "asset init 的 id 缺少 source",
                                    "新增 asset declaration 時必須同時提供 --id 與 --source。",
                                ),
                            ),
                            cli.json,
                        );
                    }
                };
                print_result(
                    init_asset_manifest(&cli.project, output.as_deref(), new_asset),
                    cli.json,
                )
            }
        },
        Command::Systems { command } => match command {
            SystemsCommand::List => print_result(inspect_systems(&cli.project), cli.json),
            SystemsCommand::Search { meaning } => {
                let matches = search_systems(&meaning);
                let mut result = EngineResult::success(unone_engine::SystemSearchReport {
                    query: meaning,
                    matches,
                });
                if result
                    .value
                    .as_ref()
                    .is_some_and(|report| report.matches.is_empty())
                {
                    result.diagnostics.push(unone_engine::Diagnostic::warning(
                        "SYSTEM_SEARCH_EMPTY",
                        "沒有符合的 system",
                        "改用其他用途關鍵字，或先執行 game systems list 看完整清單。",
                    ));
                }
                print_result(result, cli.json)
            }
            SystemsCommand::Set { id, enabled } => {
                print_result(set_system(&cli.project, &id, enabled), cli.json)
            }
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
            ApiCommand::Typings { output } => {
                let types = unone_engine::api_typings();
                let Some(path) = output else {
                    if cli.json {
                        return print_result(
                            EngineResult::success(serde_json::json!({"typings": types})),
                            true,
                        );
                    }
                    println!("{types}");
                    return Ok(ExitCode::SUCCESS);
                };
                if let Some(parent) = path.parent()
                    && !parent.as_os_str().is_empty()
                    && let Err(error) = fs::create_dir_all(parent)
                {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(unone_engine::Diagnostic::error(
                            "API_TYPINGS_WRITE_FAILED",
                            "無法建立型別契約輸出目錄",
                            format!("{}：{}", parent.display(), error),
                        )),
                        cli.json,
                    );
                }
                if let Err(error) = fs::write(&path, types) {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(unone_engine::Diagnostic::error(
                            "API_TYPINGS_WRITE_FAILED",
                            "無法寫入型別契約",
                            format!("{}：{}", path.display(), error),
                        )),
                        cli.json,
                    );
                }
                let mut result = EngineResult::success(serde_json::json!({
                    "output": path.display().to_string(),
                    "bytes": types.len(),
                }));
                result
                    .effects
                    .push(format!("engine type contract written to {}", path.display()));
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
            if let BundleCommand::Pack { output } = command {
                return print_result(pack_project(&cli.project, output.as_deref()), cli.json);
            }
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
                BundleCommand::Pack { .. } => unreachable!("bundle pack was handled above"),
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
    report_host_assets(project);
    let event_loop = EventLoop::new()?;
    let mut app = PreviewApp::new(runtime, watch);
    event_loop.run_app(&mut app)?;
    Ok(ExitCode::SUCCESS)
}

/// Resolve and decode the project's declared textures before the window opens.
///
/// The preview does not draw these textures yet; reporting the verified digest
/// and decoded size is what lets a native run be compared with the Web host for
/// the same asset id, instead of comparing screenshots.
fn report_host_assets(project: &Path) {
    let assets = assets::load_textures(project);
    for texture in assets.textures.values() {
        eprintln!(
            "unone preview: asset resolved {} sha256={} bytes={} decoded={}x{}",
            texture.id, texture.sha256, texture.size_bytes, texture.width, texture.height
        );
    }
    for note in &assets.notes {
        eprintln!("unone preview: asset unresolved {note}");
    }
    if !assets.textures.is_empty() {
        eprintln!(
            "unone preview: {} texture(s) decoded; this preview still draws flat rectangles",
            assets.textures.len()
        );
    }
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
        let mut vertices = Vec::with_capacity(snapshot.entities.len() * 6);
        if let Some(camera3d) = &snapshot.camera3d {
            self.build_3d_vertices(snapshot, camera3d, &mut vertices);
        } else {
            let zoom = snapshot.camera.zoom as f32;
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

    fn build_3d_vertices(
        &self,
        snapshot: &WorldSnapshot,
        camera: &Camera3DData,
        vertices: &mut Vec<Vertex>,
    ) {
        let mut faces = Vec::new();
        for entity in snapshot.entities.values() {
            let Some(transform) = &entity.transform3d else {
                continue;
            };
            if entity.mesh3d.as_ref().is_some_and(|mesh| !mesh.visible) {
                continue;
            }
            let half = [
                transform.scale.x * 0.5,
                transform.scale.y * 0.5,
                transform.scale.z * 0.5,
            ];
            let local = [
                Vec3 {
                    x: -half[0],
                    y: -half[1],
                    z: -half[2],
                },
                Vec3 {
                    x: half[0],
                    y: -half[1],
                    z: -half[2],
                },
                Vec3 {
                    x: half[0],
                    y: half[1],
                    z: -half[2],
                },
                Vec3 {
                    x: -half[0],
                    y: half[1],
                    z: -half[2],
                },
                Vec3 {
                    x: -half[0],
                    y: -half[1],
                    z: half[2],
                },
                Vec3 {
                    x: half[0],
                    y: -half[1],
                    z: half[2],
                },
                Vec3 {
                    x: half[0],
                    y: half[1],
                    z: half[2],
                },
                Vec3 {
                    x: -half[0],
                    y: half[1],
                    z: half[2],
                },
            ];
            let corners: Vec<Vec3> = local
                .into_iter()
                .map(|point| add(transform.position, rotate_euler(point, transform.rotation)))
                .collect();
            let face_indices = [
                [0, 1, 2, 3],
                [4, 7, 6, 5],
                [0, 4, 5, 1],
                [3, 2, 6, 7],
                [1, 5, 6, 2],
                [0, 3, 7, 4],
            ];
            let color = if entity.id.contains("track") {
                [0.18, 0.2, 0.24]
            } else if entity.id.contains("rival") {
                [0.18, 0.45, 0.9]
            } else {
                [0.9, 0.18, 0.12]
            };
            for indices in face_indices {
                let a = corners[indices[0]];
                let b = corners[indices[1]];
                let c = corners[indices[2]];
                let d = corners[indices[3]];
                let depth = (depth_from_camera(camera, a)
                    + depth_from_camera(camera, b)
                    + depth_from_camera(camera, c)
                    + depth_from_camera(camera, d))
                    * 0.25;
                faces.push((depth, [a, b, c], color));
                faces.push((depth, [a, c, d], color));
            }
        }
        faces.sort_by(|left, right| {
            right
                .0
                .partial_cmp(&left.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (_, triangle, color) in faces {
            let Some(a) = self.project_3d(camera, triangle[0]) else {
                continue;
            };
            let Some(b) = self.project_3d(camera, triangle[1]) else {
                continue;
            };
            let Some(c) = self.project_3d(camera, triangle[2]) else {
                continue;
            };
            vertices.extend([
                Vertex { position: a, color },
                Vertex { position: b, color },
                Vertex { position: c, color },
            ]);
        }
    }

    fn project_3d(&self, camera: &Camera3DData, point: Vec3) -> Option<[f32; 2]> {
        let forward = normalize(sub(camera.target, camera.position))?;
        let right = normalize(cross(
            forward,
            Vec3 {
                x: 0.0,
                y: 1.0,
                z: 0.0,
            },
        ))?;
        let up = cross(right, forward);
        let relative = sub(point, camera.position);
        let depth = dot(relative, forward);
        if depth <= 0.05 {
            return None;
        }
        let f = 1.0 / (camera.fov_degrees.to_radians() * 0.5).tan();
        let aspect = f64::from(self.config.width.max(1)) / f64::from(self.config.height.max(1));
        Some([
            (dot(relative, right) * f / aspect / depth) as f32,
            (dot(relative, up) * f / depth) as f32,
        ])
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

fn add(left: Vec3, right: Vec3) -> Vec3 {
    Vec3 {
        x: left.x + right.x,
        y: left.y + right.y,
        z: left.z + right.z,
    }
}

fn sub(left: Vec3, right: Vec3) -> Vec3 {
    Vec3 {
        x: left.x - right.x,
        y: left.y - right.y,
        z: left.z - right.z,
    }
}

fn dot(left: Vec3, right: Vec3) -> f64 {
    left.x * right.x + left.y * right.y + left.z * right.z
}

fn cross(left: Vec3, right: Vec3) -> Vec3 {
    Vec3 {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    }
}

fn normalize(value: Vec3) -> Option<Vec3> {
    let length = dot(value, value).sqrt();
    if length <= f64::EPSILON {
        None
    } else {
        Some(Vec3 {
            x: value.x / length,
            y: value.y / length,
            z: value.z / length,
        })
    }
}

fn rotate_euler(point: Vec3, rotation: Vec3) -> Vec3 {
    let (sin_x, cos_x) = rotation.x.sin_cos();
    let (sin_y, cos_y) = rotation.y.sin_cos();
    let (sin_z, cos_z) = rotation.z.sin_cos();
    let around_x = Vec3 {
        x: point.x,
        y: point.y * cos_x - point.z * sin_x,
        z: point.y * sin_x + point.z * cos_x,
    };
    let around_y = Vec3 {
        x: around_x.x * cos_y + around_x.z * sin_y,
        y: around_x.y,
        z: -around_x.x * sin_y + around_x.z * cos_y,
    };
    Vec3 {
        x: around_y.x * cos_z - around_y.y * sin_z,
        y: around_y.x * sin_z + around_y.y * cos_z,
        z: around_y.z,
    }
}

fn depth_from_camera(camera: &Camera3DData, point: Vec3) -> f64 {
    let Some(forward) = normalize(sub(camera.target, camera.position)) else {
        return 0.0;
    };
    dot(sub(point, camera.position), forward)
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
