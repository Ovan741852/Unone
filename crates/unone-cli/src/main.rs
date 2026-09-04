use std::{path::PathBuf, process::ExitCode};

use anyhow::Result;
use clap::{Parser, Subcommand};
use unone_engine::{EngineResult, EngineRuntime};

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
    Check,
    Run {
        #[arg(long, default_value_t = 60)]
        frames: u64,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        action: Option<String>,
    },
    Test,
    Observe,
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
        Command::Check => print_result(EngineRuntime::check(&cli.project), cli.json),
        Command::Run {
            frames,
            seed,
            action,
        } => {
            let mut runtime = match EngineRuntime::load(&cli.project) {
                Ok(runtime) => runtime,
                Err(diagnostic) => {
                    return print_result(
                        EngineResult::<serde_json::Value>::failure(diagnostic),
                        cli.json,
                    );
                }
            };
            if let Some(action) = action {
                runtime.set_input(action, true);
            }
            print_result(runtime.run(frames, seed), cli.json)
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
                        EngineResult::<serde_json::Value>::failure(diagnostic),
                        cli.json,
                    );
                }
            };
            print_result(EngineResult::success(runtime.observe()), cli.json)
        }
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
