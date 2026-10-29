//! Same headless workload in diagnostic and production builds, no renderer claims.
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, time::Instant};
use unone_engine::{HostProject, InputFrame, observation_digest};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Scenario {
    seed: u64,
    warmup: usize,
    inputs: Vec<InputFrame>,
}

fn run(args: &[String]) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if args.len() != 3 {
        return Err("usage: execution_probe HOST_PROJECT_JSON SCENARIO_JSON".into());
    }
    let payload = fs::read(&args[1])?;
    let scenario_bytes = fs::read(&args[2])?;
    if payload.len() > 64 * 1024 * 1024 || scenario_bytes.len() > 16 * 1024 * 1024 {
        return Err("PROBE_INPUT_LIMIT: project <= 64 MiB, scenario <= 16 MiB".into());
    }
    let scenario: Scenario = serde_json::from_slice(&scenario_bytes)?;
    if scenario.inputs.is_empty() || scenario.inputs.len() + scenario.warmup > 60000 {
        return Err(
            "PROBE_SCENARIO_INVALID: require measured inputs and at most 60,000 total ticks".into(),
        );
    }
    for input in &scenario.inputs {
        input.validate().map_err(|e| e.explanation)?;
    }
    let started = Instant::now();
    let mut runtime = HostProject::parse(&payload)
        .map_err(|e| e.explanation)?
        .into_runtime(scenario.seed)
        .map_err(|e| e.explanation)?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut checkpoints = vec![json!({"tick":0,"digest":observation_digest(&runtime.observe())?})];
    let mut tick_ms = Vec::new();
    let mut failure = None;
    for index in 0..scenario.warmup + scenario.inputs.len() {
        #[cfg(feature = "preview-tools")]
        if index == scenario.warmup {
            runtime
                .preview_request(unone_engine::PreviewRequest::ProfileStart { sampling: !cfg!(feature = "phase-profile") })
                .map_err(|e| e.explanation)?;
        }
        let input = if index < scenario.warmup {
            InputFrame::default()
        } else {
            scenario.inputs[index - scenario.warmup].clone()
        };
        let began = Instant::now();
        let result = runtime.tick_with_input(&input);
        let ms = began.elapsed().as_secs_f64() * 1000.0;
        let digest = observation_digest(&runtime.observe())?; // outside measured span
        checkpoints.push(json!({"tick":index+1,"digest":digest,"failure_code":result.as_ref().err().map(|e|&e.code)}));
        if let Err(diagnostic) = result {
            failure = Some(
                json!({"tick":index+1,"phase":if index < scenario.warmup {"warmup"} else {"measurement"},"diagnostic":diagnostic}),
            );
            break;
        }
        if index >= scenario.warmup {
            tick_ms.push(ms);
        }
    }
    #[cfg(feature = "preview-tools")]
    let diagnosis = runtime
        .preview_request(unone_engine::PreviewRequest::ProfileStop {})
        .map_err(|e| e.explanation)?;
    #[cfg(not(feature = "preview-tools"))]
    let diagnosis = serde_json::Value::Null;
    Ok(
        json!({"schema":"unone.execution-probe.v1","execution":unone_engine::execution_mode(),
        "engine_version":env!("CARGO_PKG_VERSION"),"compiled_systems":unone_engine::compiled_systems(),
        "project_sha256":format!("{:x}",Sha256::digest(&payload)),"scenario_sha256":format!("{:x}",Sha256::digest(&scenario_bytes)),
        "seed":scenario.seed,"warmup":scenario.warmup,"requested_frames":scenario.inputs.len(),
        "completed_frames":tick_ms.len(),"load_ms":load_ms,"tick_ms":tick_ms,"checkpoints":checkpoints,
        "failure":failure,"diagnosis":diagnosis,
        "measurement":{"clock":"monotonic","scope":"tick_with_input including returned snapshot; digest excluded",
            "renderer":false,"gpu":false,"sampling":cfg!(feature="preview-tools"),
            "limitation":"Diagnostic timing includes probes; only unsampled production timing estimates production-mode CPU cost. Eligibility is not per-function native-codegen proof."}}),
    )
}

fn main() {
    match run(&std::env::args().collect::<Vec<_>>()) {
        Ok(report) => println!("{}", report),
        Err(error) => {
            println!(
                "{}",
                json!({"ok":false,"code":"EXECUTION_PROBE_FAILED","cause":error.to_string(),"fix":"Check payload/scenario and build features. No automatic rerun or fallback was performed."})
            );
            std::process::exit(1);
        }
    }
}
