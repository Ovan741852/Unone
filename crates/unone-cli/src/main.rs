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
    WorldSnapshot, api_describe, api_search_result, describe_asset, init_asset_manifest,
    init_project, inspect_assets, inspect_assets_strict, inspect_project, inspect_systems,
    pack_project, read_asset, search_systems, set_system,
};
use winit::{
    application::ApplicationHandler,
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

mod assets;
mod export;
mod sdk;
mod mcp;
mod native_capture;
mod native_clock;
mod native_tools;
mod plugins;
mod session;
mod sync;

#[derive(Debug, Subcommand)]
enum ExportCommand {
    /// Select a compatible precompiled runtime from a portable SDK.
    Platform {
        #[arg(long)] target: String,
        #[arg(long)] output: PathBuf,
        #[arg(long)] runtime_id: Option<String>,
        #[arg(long)] development: bool,
    },
    Web {
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        runtime: Option<PathBuf>,
        /// Include development inspection APIs and the human debug panel.
        #[arg(long)]
        development: bool,
    },
}

#[derive(Debug, Subcommand)]
enum SdkCommand {
    /// Validate the SDK and list installed runtimes and target support.
    Inspect,
    /// Publisher-only: package this release CLI, host templates and runtimes.
    Pack {
        #[arg(long)] source_root: PathBuf,
        #[arg(long, required=true)] runtime: Vec<PathBuf>,
        #[arg(long)] output: PathBuf,
    },
}

#[derive(Debug, Parser)]
#[command(name = "game", version, about = "Unone AI-native game developer CLI")]
struct Cli {
    /// Portable SDK root (otherwise environment or executable-relative discovery).
    #[arg(long, global=true)]
    sdk: Option<PathBuf>,
    #[arg(long, default_value = ".", global = true)]
    project: PathBuf,
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Sdk { #[command(subcommand)] command: SdkCommand },
    /// Export one game with the separately compiled release player.
    Export {
        #[command(subcommand)]
        command: ExportCommand,
    },
    /// Deterministically sample a native particle definition at a frame.
    Particle {
        #[arg(long)]
        file: PathBuf,
        #[arg(long, default_value_t = 0)]
        frame: u64,
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
    /// Inspect/export a structural JSON Schema generated from the runtime Rust types.
    Schema {
        name: String,
        #[arg(long)]
        output: Option<PathBuf>,
    },
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
    /// Run every gate a game must pass and report one verdict.
    Verify,
    /// Record a run, or replay a recording to find what changed.
    Replay {
        #[command(subcommand)]
        command: ReplayCommand,
    },
    /// Measure where a frame's time goes.
    Perf {
        #[arg(long, default_value_t = 600)]
        frames: u64,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        input_sequence: Option<PathBuf>,
    },
    /// Draw the game's UI as text and report structural layout problems.
    Ui {
        #[command(subcommand)]
        command: UiCommand,
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
        #[arg(
            long,
            default_value_t = 8190,
            help = "Loopback companion panel/API port for this native runtime"
        )]
        tools_port: u16,
    },
    Bundle {
        #[command(subcommand)]
        command: BundleCommand,
    },
    /// Discover and call optional AI-facing plugins.
    Plugin {
        #[command(subcommand)]
        command: PluginCommand,
    },
    /// Serve the existing Developer Protocol over MCP stdio.
    Mcp,
    /// Stateful developer protocol: one JSON request and EngineResult per line on stdio.
    Session {
        #[arg(
            long,
            help = "Print the request JSON schema instead of starting a session transport"
        )]
        schema: bool,
    },
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    Inspect,
    /// Pack, verify, and activate every project bundle in the required order.
    Sync,
    /// Create a five-file headless starter with two tests and next actions in a new or truly empty directory.
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
    /// Describe one declared asset's authoring, references, active bytes, and next actions.
    Describe {
        #[arg(long, help = "Declared asset id, for example asset://characters/hero")]
        id: String,
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
enum ReplayCommand {
    /// Run the project and write every frame to a recording file.
    Record {
        #[arg(long)]
        output: PathBuf,
        #[arg(long, default_value_t = 60)]
        frames: u64,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        input_sequence: Option<PathBuf>,
    },
    /// Replay a recording against the project as it is now.
    Diff {
        #[arg(long)]
        baseline: PathBuf,
    },
}

#[derive(Debug, Subcommand)]
enum UiCommand {
    /// Run the project, then draw the published UI tree as a character grid.
    Preview {
        #[arg(long, default_value_t = 1, help = "Frames to run before drawing")]
        frames: u64,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        input_sequence: Option<PathBuf>,
        #[arg(long, default_value_t = unone_engine::DEFAULT_LAYOUT_COLS)]
        cols: usize,
        #[arg(long, default_value_t = unone_engine::DEFAULT_LAYOUT_ROWS)]
        rows: usize,
        #[arg(long, help = "Turn structural layout findings into a failing gate")]
        strict: bool,
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
    /// Search public engine APIs by meaning; `game api search ""` lists the complete public API index.
    Search {
        #[arg(
            help = "Natural-language intent; use \"\" to list the complete public engine API index"
        )]
        meaning: String,
    },
    Describe {
        name: String,
    },
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
        #[arg(value_name = "ID", help = "Bundle id from the project manifest")]
        id: Option<String>,
        #[arg(
            long,
            help = "Select every bundle in the manifest (mutually exclusive with ID)"
        )]
        all: bool,
    },
}

#[derive(Debug, Subcommand)]
enum PluginCommand {
    /// List plugins visible to this project and engine package.
    List,
    /// Inspect one plugin manifest and its AI-facing tools.
    Inspect {
        #[arg(long, help = "Plugin id, for example org.unone.blender")]
        id: String,
    },
    /// Run a plugin's deterministic self-test.
    Test {
        #[arg(long, help = "Plugin id, for example org.unone.blender")]
        id: String,
    },
    /// Call one plugin tool with a JSON object from a file.
    Call {
        #[arg(long, help = "Plugin id")]
        id: String,
        #[arg(long, help = "Tool name declared by the plugin")]
        tool: String,
        #[arg(long, help = "JSON input file; omitted input is {}")]
        input: Option<PathBuf>,
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

fn print_sdk_result(result: Result<serde_json::Value>, json:bool)->Result<ExitCode>{
    match result {
        Ok(value)=>print_result(EngineResult::success(value),json),
        Err(error)=>print_result(EngineResult::<serde_json::Value>::failure(unone_engine::Diagnostic::error("SDK_OPERATION_FAILED","SDK operation failed",format!("{error:#}"))),json),
    }
}

fn run() -> Result<ExitCode> {
    let cli = Cli::parse();
    match cli.command {
        Command::Sdk { command } => {
            let result=match command {
                SdkCommand::Inspect=>sdk::inspect(cli.sdk.as_deref()),
                SdkCommand::Pack{source_root,runtime,output}=>sdk::pack(&source_root,&runtime,&output),
            };
            print_sdk_result(result,cli.json)
        }
        Command::Export {command:ExportCommand::Platform{target,output,runtime_id,development}} => {
            print_sdk_result(sdk::export(&cli.project,&output,cli.sdk.as_deref(),&target,runtime_id.as_deref(),development),cli.json)
        }

        Command::Export {
            command:
                ExportCommand::Web {
                    output,
                    runtime,
                    development,
                },
        } => {
            let result = if let Some(root)=cli.sdk.as_deref() {
                sdk::template_root(Some(root)).and_then(|templates| export::web_with_templates(&cli.project,&output,runtime.as_deref(),development,&templates))
            } else { export::web(&cli.project, &output, runtime.as_deref(), development) };
            match result {
                Ok(value) => print_result(EngineResult::success(value), cli.json),
                Err(error) => print_result(
                    EngineResult::<serde_json::Value>::failure(unone_engine::Diagnostic::error(
                        "EXPORT_FAILED",
                        "Web export failed",
                        format!(
                            "{error:#}. Build the player with scripts/build-web-live.ps1 -Player, correct the reported input, and retry game export web with an empty output directory."
                        ),
                    )),
                    cli.json,
                ),
            }
        }
        Command::Particle { file, frame, seed } => {
            let definition: unone_engine::ParticleDefinition =
                serde_json::from_slice(&fs::read(file)?)?;
            let samples = definition
                .sample(seed, frame, Vec3::default())
                .map_err(|e| anyhow::anyhow!(e))?;
            print_result(EngineResult::success(samples), cli.json)
        }
        Command::Schema { name, output } => {
            let Some(schema) = unone_engine::contract_schema(&name) else {
                return print_result(
                    EngineResult::<serde_json::Value>::failure(unone_engine::Diagnostic::error(
                        "SCHEMA_UNKNOWN",
                        "Unknown schema",
                        format!("Choose one of: {}", unone_engine::SCHEMA_NAMES.join(", ")),
                    )),
                    cli.json,
                );
            };
            if let Some(path) = output {
                fs::write(
                    &path,
                    format!("{}\n", serde_json::to_string_pretty(&schema)?),
                )?;
                print_result(
                    EngineResult::success(serde_json::json!({"schema":name,"output":path})),
                    cli.json,
                )
            } else {
                print_result(EngineResult::success(schema), cli.json)
            }
        }
        Command::Project { command } => match command {
            ProjectCommand::Inspect => print_result(inspect_project(&cli.project), cli.json),
            ProjectCommand::Sync => print_result(sync::sync_project(&cli.project), cli.json),
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
            AssetCommand::Describe { id } => {
                print_result(describe_asset(&cli.project, &id), cli.json)
            }
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
                        encoding: None,
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
        Command::Verify => print_result(unone_engine::verify(&cli.project), cli.json),
        Command::Replay { command } => match command {
            ReplayCommand::Record {
                output,
                frames,
                seed,
                input_sequence,
            } => {
                let sequence = match input_sequence {
                    Some(path) => match read_input_frames(&path) {
                        Ok(sequence) => sequence,
                        Err(diagnostic) => {
                            return print_result(
                                EngineResult::<serde_json::Value>::failure(*diagnostic),
                                cli.json,
                            );
                        }
                    },
                    None => Vec::new(),
                };
                let result = unone_engine::record_run(&cli.project, frames, seed, &sequence);
                let Some(recording) = result.value.as_ref() else {
                    return print_result(result, cli.json);
                };
                let text = match serde_json::to_string(recording) {
                    Ok(text) => text,
                    Err(error) => {
                        return print_result(
                            EngineResult::<serde_json::Value>::failure(
                                unone_engine::Diagnostic::error(
                                    "RECORDING_WRITE_FAILED",
                                    "無法序列化錄製檔",
                                    error.to_string(),
                                ),
                            ),
                            cli.json,
                        );
                    }
                };
                if let Some(parent) = output.parent()
                    && !parent.as_os_str().is_empty()
                    && let Err(error) = fs::create_dir_all(parent)
                {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(
                            unone_engine::Diagnostic::error(
                                "RECORDING_WRITE_FAILED",
                                "無法建立錄製檔目錄",
                                format!("{}：{}", parent.display(), error),
                            ),
                        ),
                        cli.json,
                    );
                }
                if let Err(error) = fs::write(&output, text) {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(
                            unone_engine::Diagnostic::error(
                                "RECORDING_WRITE_FAILED",
                                "無法寫入錄製檔",
                                format!("{}：{}", output.display(), error),
                            ),
                        ),
                        cli.json,
                    );
                }
                let mut summary = EngineResult::success(serde_json::json!({
                    "output": output.display().to_string(),
                    "frames": recording.frames,
                    "seed": recording.seed,
                    "observation_digest": recording.observation_digest,
                }));
                summary
                    .effects
                    .push(format!("recording written to {}", output.display()));
                print_result(summary, cli.json)
            }
            ReplayCommand::Diff { baseline } => {
                let recording = match unone_engine::read_recording(&baseline) {
                    Ok(recording) => recording,
                    Err(diagnostic) => {
                        return print_result(
                            EngineResult::<serde_json::Value>::failure(*diagnostic),
                            cli.json,
                        );
                    }
                };
                let result = unone_engine::diff_run(&cli.project, &recording);
                if cli.json {
                    return print_result(result, true);
                }
                if let Some(report) = result.value.as_ref() {
                    println!("{}", unone_engine::diff_markdown(report));
                }
                for diagnostic in &result.diagnostics {
                    eprintln!("{}: {}", diagnostic.code, diagnostic.explanation);
                }
                Ok(if result.ok {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(1)
                })
            }
        },
        Command::Perf {
            frames,
            seed,
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
            // A profile should measure what a host actually pays, including
            // handing the observation across the boundary. Only this command
            // asks for it, so `run` and `test` stay free of it.
            runtime.measure_serialization(true);
            let run = match input_sequence {
                Some(path) => {
                    let sequence = match fs::read_to_string(&path)
                        .map_err(|error| format!("{}：{}", path.display(), error))
                        .and_then(|text| {
                            serde_json::from_str::<Vec<InputFrame>>(&text)
                                .map_err(|error| format!("{}：{}", path.display(), error))
                        }) {
                        Ok(sequence) => sequence,
                        Err(error) => {
                            return print_result(
                                EngineResult::<serde_json::Value>::failure(
                                    unone_engine::Diagnostic::error(
                                        "INPUT_SEQUENCE_INVALID",
                                        "無法讀取 input sequence",
                                        error,
                                    ),
                                ),
                                cli.json,
                            );
                        }
                    };
                    runtime.run_with_input_sequence(frames, seed, &sequence)
                }
                None => runtime.run(frames, seed),
            };
            let Some(report) = run.value.as_ref() else {
                return print_result(run, cli.json);
            };
            if cli.json {
                let mut result = EngineResult::success(report.performance.clone());
                result.diagnostics = run.diagnostics;
                return print_result(result, true);
            }
            println!(
                "{}",
                unone_engine::performance_markdown(&report.performance)
            );
            Ok(ExitCode::SUCCESS)
        }
        Command::Ui { command } => match command {
            UiCommand::Preview {
                frames,
                seed,
                input_sequence,
                cols,
                rows,
                strict,
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
                let run = match input_sequence {
                    Some(path) => {
                        let sequence = match fs::read_to_string(&path)
                            .map_err(|error| format!("{}：{}", path.display(), error))
                            .and_then(|text| {
                                serde_json::from_str::<Vec<InputFrame>>(&text)
                                    .map_err(|error| format!("{}：{}", path.display(), error))
                            }) {
                            Ok(sequence) => sequence,
                            Err(error) => {
                                return print_result(
                                    EngineResult::<serde_json::Value>::failure(
                                        unone_engine::Diagnostic::error(
                                            "INPUT_SEQUENCE_INVALID",
                                            "無法讀取 input sequence",
                                            error,
                                        ),
                                    ),
                                    cli.json,
                                );
                            }
                        };
                        runtime.run_with_input_sequence(frames, seed, &sequence)
                    }
                    None => runtime.run(frames, seed),
                };
                if !run.ok {
                    return print_result(run, cli.json);
                }
                let Some(tree) = runtime.observe().ui else {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(
                            unone_engine::Diagnostic::error(
                                "UI_TREE_NOT_PUBLISHED",
                                "遊戲還沒有發布 UI tree",
                                format!(
                                    "跑了 {frames} frame 之後 observation 沒有 ui；遊戲要先呼叫 api.ui.setRoot。"
                                ),
                            ),
                        ),
                        cli.json,
                    );
                };
                let report = unone_engine::inspect_layout(&tree, cols, rows);
                let findings = report.findings.clone();
                let markdown = unone_engine::layout_markdown(&report);
                let mut result = EngineResult::success(report);
                for finding in &findings {
                    let mut diagnostic = if strict {
                        unone_engine::Diagnostic::error(
                            finding.code.clone(),
                            "UI layout 有結構問題",
                            finding.detail.clone(),
                        )
                    } else {
                        unone_engine::Diagnostic::warning(
                            finding.code.clone(),
                            "UI layout 有結構問題",
                            finding.detail.clone(),
                        )
                    };
                    diagnostic.facts = serde_json::json!({"nodes": finding.nodes});
                    diagnostic
                        .suggested_actions
                        .push(unone_engine::ActionSuggestion {
                            action: "resolve_layout_finding".to_string(),
                            description: finding.resolution.clone(),
                            command: Some("game ui preview --strict".to_string()),
                        });
                    result.diagnostics.push(diagnostic);
                }
                if strict && !findings.is_empty() {
                    result.ok = false;
                }
                if cli.json {
                    return print_result(result, true);
                }
                println!("{markdown}");
                Ok(if result.ok {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::from(1)
                })
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
                print_result(api_search_result(&cli.project, &meaning), cli.json)
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
                        EngineResult::<serde_json::Value>::failure(
                            unone_engine::Diagnostic::error(
                                "API_TYPINGS_WRITE_FAILED",
                                "無法建立型別契約輸出目錄",
                                format!("{}：{}", parent.display(), error),
                            ),
                        ),
                        cli.json,
                    );
                }
                if let Err(error) = fs::write(&path, types) {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(
                            unone_engine::Diagnostic::error(
                                "API_TYPINGS_WRITE_FAILED",
                                "無法寫入型別契約",
                                format!("{}：{}", path.display(), error),
                            ),
                        ),
                        cli.json,
                    );
                }
                let mut result = EngineResult::success(serde_json::json!({
                    "output": path.display().to_string(),
                    "bytes": types.len(),
                }));
                result.effects.push(format!(
                    "engine type contract written to {}",
                    path.display()
                ));
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
        Command::Preview { watch, tools_port } => preview(&cli.project, watch, tools_port),
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
                BundleCommand::Install { id, all } => {
                    print_result(manager.install_selected(id.as_deref(), all), cli.json)
                }
            }
        }
        Command::Plugin { command } => match command {
            PluginCommand::List => print_result(plugins::list(&cli.project), cli.json),
            PluginCommand::Inspect { id } => {
                print_result(plugins::inspect(&cli.project, &id), cli.json)
            }
            PluginCommand::Test { id } => print_result(plugins::test(&cli.project, &id), cli.json),
            PluginCommand::Call { id, tool, input } => {
                let input = match input {
                    Some(path) => match fs::read_to_string(&path)
                        .map_err(|error| format!("{}：{}", path.display(), error))
                        .and_then(|text| {
                            serde_json::from_str::<serde_json::Value>(&text)
                                .map_err(|error| format!("{}：{}", path.display(), error))
                        }) {
                        Ok(value) => value,
                        Err(error) => {
                            return print_result(
                                EngineResult::<serde_json::Value>::failure(
                                    unone_engine::Diagnostic::error(
                                        "PLUGIN_INPUT_INVALID",
                                        "插件 input 不是有效 JSON",
                                        error,
                                    ),
                                ),
                                cli.json,
                            );
                        }
                    },
                    None => serde_json::json!({}),
                };
                print_result(plugins::call(&cli.project, &id, &tool, input), cli.json)
            }
        },
        Command::Mcp => mcp::serve(&cli.project),
        Command::Session { schema } => session::serve(&cli.project, schema),
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

/// Read a per-frame input sequence file.
fn read_input_frames(path: &Path) -> Result<Vec<InputFrame>, Box<unone_engine::Diagnostic>> {
    fs::read_to_string(path)
        .map_err(|error| format!("{}：{}", path.display(), error))
        .and_then(|text| {
            serde_json::from_str::<Vec<InputFrame>>(&text)
                .map_err(|error| format!("{}：{}", path.display(), error))
        })
        .map_err(|error| {
            Box::new(unone_engine::Diagnostic::error(
                "INPUT_SEQUENCE_INVALID",
                "無法讀取 input sequence",
                error,
            ))
        })
}

fn preview(project: &PathBuf, watch: bool, tools_port: u16) -> Result<ExitCode> {
    let runtime = EngineRuntime::load(project)
        .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.explanation))?;
    report_host_assets(project);
    let event_loop = EventLoop::new()?;
    let tools = native_tools::NativeTools::start(tools_port, event_loop.create_proxy())?;
    let mut app = PreviewApp::new(runtime, watch, tools);
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
    clock: native_clock::NativeClock,
    last_redraw: Option<std::time::Instant>,
    tools: native_tools::NativeTools,
    runtime: Option<EngineRuntime>,
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    watch: bool,
}

impl PreviewApp {
    fn new(runtime: EngineRuntime, watch: bool, tools: native_tools::NativeTools) -> Self {
        Self {
            tools,
            clock: Default::default(),
            last_redraw: None,
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
                let now = std::time::Instant::now();
                let elapsed = self
                    .last_redraw
                    .replace(now)
                    .map_or(std::time::Duration::ZERO, |last| {
                        now.saturating_duration_since(last)
                    });
                let steps = self.clock.advance(elapsed, self.tools.state.paused);
                self.tools.state.dropped_steps = self.clock.dropped_steps;
                let mut snapshot = None;
                for _ in 0..steps {
                    match self.tools.state.tick(runtime) {
                        Ok(value) => snapshot = Some(value),
                        Err(err) => {
                            eprintln!("unone preview: {}: {}", err.code, err.explanation);
                            event_loop.exit();
                            return;
                        }
                    }
                }
                let snapshot = snapshot.unwrap_or_else(|| runtime.observe());
                let render_started = std::time::Instant::now();
                if let Some(renderer) = &mut self.renderer
                    && let Err(err) = renderer.render(&snapshot)
                {
                    eprintln!("unone preview: render failed: {err}");
                    event_loop.exit();
                }
                self.tools.state.render_ms = Some(render_started.elapsed().as_secs_f64() * 1000.0);
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(runtime) = &mut self.runtime {
            let renderer = &mut self.renderer;
            self.tools.drain(runtime, |snapshot, request| {
                renderer.as_mut()
                    .ok_or_else(|| "CAPTURE_UNAVAILABLE: native renderer is not ready".to_string())?
                    .capture(snapshot, request)
            });
        }
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

    /// World units the camera shows, given what the scene declared.
    fn visible_extent(&self, snapshot: &WorldSnapshot) -> (f64, f64) {
        let zoom = if snapshot.camera.zoom > 0.0 {
            snapshot.camera.zoom
        } else {
            1.0
        };
        let height = snapshot.camera.view_height / zoom;
        let aspect = f64::from(self.config.width.max(1)) / f64::from(self.config.height.max(1));
        (height * aspect, height)
    }

    fn screen_to_world(&self, x: f64, y: f64, snapshot: &WorldSnapshot) -> Vec2 {
        let (visible_width, visible_height) = self.visible_extent(snapshot);
        let view_x = x / f64::from(self.config.width.max(1)) - 0.5;
        let view_y = 0.5 - y / f64::from(self.config.height.max(1));
        Vec2 {
            x: snapshot.camera.position.x + view_x * visible_width,
            y: snapshot.camera.position.y + view_y * visible_height,
        }
    }

    fn vertices(&self, snapshot: &WorldSnapshot) -> Vec<Vertex> {
        let mut vertices = Vec::with_capacity(snapshot.entities.len() * 6);
        if let Some(camera3d) = &snapshot.camera3d {
            self.build_3d_vertices(snapshot, camera3d, &mut vertices);
        } else {
            let (visible_width, visible_height) = self.visible_extent(snapshot);
            for entity in snapshot.entities.values() {
                if entity.sprite.as_ref().is_some_and(|sprite| !sprite.visible) {
                    continue;
                }
                // Centred on the entity and never clamped, so an entity outside
                // the camera's declared view is visibly outside it.
                let size = entity
                    .sprite
                    .as_ref()
                    .map(|sprite| (sprite.size.x, sprite.size.y))
                    .unwrap_or((1.0, 1.0));
                let width = (size.0 / visible_width * 2.0) as f32;
                let height = (size.1 / visible_height * 2.0) as f32;
                let x = ((entity.transform.x - snapshot.camera.position.x) / visible_width * 2.0)
                    as f32
                    - width / 2.0;
                let y = ((entity.transform.y - snapshot.camera.position.y) / visible_height * 2.0)
                    as f32
                    - height / 2.0;
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
        vertices
    }

    fn render(&mut self, snapshot: &WorldSnapshot) -> Result<(), String> {
        let vertices = self.vertices(snapshot);
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
        self.draw_pass(&mut encoder, &view, vertices.len() as u32);
        self.queue.submit(Some(encoder.finish()));
        self.queue.present(output);
        Ok(())
    }

    fn draw_pass(&self, encoder: &mut wgpu::CommandEncoder, view: &wgpu::TextureView, vertex_count: u32) {
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
            pass.draw(0..vertex_count, 0..1);
        }
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

#[cfg(test)]
mod tests {
    use super::{BundleCommand, Cli, Command};
    use clap::Parser;

    fn install_selection(args: &[&str]) -> (Option<String>, bool) {
        let mut argv = vec!["game"];
        argv.extend_from_slice(args);
        let cli = Cli::try_parse_from(argv).expect("bundle install arguments should parse");
        match cli.command {
            Command::Bundle {
                command: BundleCommand::Install { id, all },
            } => (id, all),
            _ => panic!("expected bundle install command"),
        }
    }

    #[test]
    fn bundle_install_cli_preserves_all_selection_shapes_for_core() {
        assert_eq!(
            install_selection(&["bundle", "install", "content"]),
            (Some("content".to_string()), false)
        );
        assert_eq!(
            install_selection(&["bundle", "install", "content", "--all"]),
            (Some("content".to_string()), true)
        );
        assert_eq!(
            install_selection(&["bundle", "install", "--all"]),
            (None, true)
        );
        assert_eq!(install_selection(&["bundle", "install"]), (None, false));
    }
}
