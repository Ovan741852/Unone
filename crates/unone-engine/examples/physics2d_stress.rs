//! Dense 2D circle-solver workload: 45x45 overlapping dynamic bodies.
//! Prints tick timings and the final observation digest; any solver change must
//! keep the digest byte-identical.
use serde_json::json;
use std::time::Instant;
use unone_engine::{HostProject, observation_digest};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let parse = |index: usize, default: usize| -> Result<usize, Box<dyn std::error::Error>> {
        Ok(args.get(index).map_or(Ok(default), |value| value.parse())?)
    };
    let (warmup, ticks) = (parse(1, 30)?, parse(2, 300)?);
    if ticks == 0 {
        return Err("usage: physics2d_stress [WARMUP=30] [TICKS=300], TICKS > 0".into());
    }
    let entities = (0..45 * 45)
        .map(|i| {
            json!({
                "id": format!("circle_{i}"),
                "transform": {"x": -20.25 + (i / 45) as f64 * 0.9, "y": -20.25 + (i % 45) as f64 * 0.9},
                "rigidbody": {"body_type": "dynamic", "radius": 0.5, "mass": 1.0,
                    "velocity": {"x": 0, "y": 0}, "restitution": 0.6},
            })
        })
        .collect::<Vec<_>>();
    let project = json!({
        "config": {"name": "Physics2DStress", "entry_script": "main.luau", "systems": {"physics2d": true}},
        "script": "return {start=function(api) end, update=function(api, dt) end}",
        "scene": {"camera": {}, "physics": {"gravity": {"x": 0, "y": -9.8}}, "entities": entities},
    });
    let mut runtime = HostProject::parse(&serde_json::to_vec(&project)?)
        .map_err(|e| e.explanation)?
        .into_runtime(42)
        .map_err(|e| e.explanation)?;
    let mut tick_ms = Vec::with_capacity(ticks);
    for index in 0..warmup + ticks {
        let began = Instant::now();
        runtime.tick().map_err(|e| e.explanation)?;
        if index >= warmup {
            tick_ms.push(began.elapsed().as_secs_f64() * 1000.0);
        }
    }
    tick_ms.sort_by(f64::total_cmp);
    let report = json!({
        "bodies": 45 * 45,
        "warmup": warmup,
        "ticks": ticks,
        "median_ms": tick_ms[ticks / 2],
        "p95_ms": tick_ms[ticks * 95 / 100],
        "mean_ms": tick_ms.iter().sum::<f64>() / ticks as f64,
        "observation_digest": observation_digest(&runtime.observe())?,
    });
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
