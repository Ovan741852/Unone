//! Record a run, then find the first frame and the exact field where a later
//! run stops matching it.
//!
//! A changed observation digest says "something is different" and nothing else.
//! That is the least useful form of a regression report: it names no frame, no
//! field and no value, so the author is left bisecting by hand. The engine has
//! every frame in its hands, so it can answer the actual question.
//!
//! Only recorded facts are compared. Wall-clock timings are deliberately absent
//! from snapshots, so a slower machine never shows up as a difference.

use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult},
    project::InputFrame,
    runtime::EngineRuntime,
    world::WorldSnapshot,
};

/// How many differing fields to report before summarising the rest.
const MAX_REPORTED_DIFFERENCES: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordedFrame {
    pub frame: u64,
    pub digest: String,
    pub observation: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recording {
    pub schema_version: u32,
    pub project: String,
    pub seed: u64,
    pub frames: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub input_sequence: Vec<InputFrame>,
    pub observation_digest: String,
    pub recorded: Vec<RecordedFrame>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldDifference {
    /// Dotted path into the observation, for example `entities.player.transform.x`.
    pub path: String,
    pub baseline: serde_json::Value,
    pub current: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffReport {
    pub project: String,
    pub seed: u64,
    pub frames: u64,
    pub identical: bool,
    /// First frame whose observation differs, if any.
    pub first_divergent_frame: Option<u64>,
    pub baseline_digest: String,
    pub current_digest: String,
    pub differences: Vec<FieldDifference>,
    pub omitted_differences: usize,
}

/// Run the project and keep every frame's observation.
pub fn record(
    project_root: impl AsRef<Path>,
    frames: u64,
    seed: u64,
    input_sequence: &[InputFrame],
) -> EngineResult<Recording> {
    let mut runtime = match EngineRuntime::load_with_seed(project_root, seed) {
        Ok(runtime) => runtime,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let mut recorded = Vec::with_capacity(frames as usize);
    for index in 0..frames {
        let frame = input_sequence.get(index as usize).cloned().unwrap_or_default();
        let snapshot = match runtime.tick_with_input(&frame) {
            Ok(snapshot) => snapshot,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        recorded.push(recorded_frame(index, &snapshot));
    }
    let digest = recorded
        .last()
        .map(|frame| frame.digest.clone())
        .unwrap_or_default();
    let mut result = EngineResult::success(Recording {
        schema_version: 1,
        project: runtime.project_name().to_string(),
        seed,
        frames,
        input_sequence: input_sequence.to_vec(),
        observation_digest: digest,
        recorded,
    });
    result
        .effects
        .push(format!("recorded {frames} frames at seed {seed}"));
    result
}

fn recorded_frame(index: u64, snapshot: &WorldSnapshot) -> RecordedFrame {
    let observation = serde_json::to_value(snapshot).unwrap_or(serde_json::Value::Null);
    let bytes = serde_json::to_vec(&observation).unwrap_or_default();
    RecordedFrame {
        frame: index,
        digest: format!("sha256:{}", crate::bundle::digest_bytes(&bytes)),
        observation,
    }
}

/// Replay a recording against the project as it is now.
pub fn diff(project_root: impl AsRef<Path>, baseline: &Recording) -> EngineResult<DiffReport> {
    if baseline.schema_version != 1 {
        return EngineResult::failure(Diagnostic::error(
            "RECORDING_VERSION_UNSUPPORTED",
            "Recording version is unsupported",
            format!(
                "Only schema_version 1 is supported; received {}.",
                baseline.schema_version
            ),
        ));
    }
    let mut runtime = match EngineRuntime::load_with_seed(project_root, baseline.seed) {
        Ok(runtime) => runtime,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };

    let mut first_divergent = None;
    let mut differences = Vec::new();
    let mut omitted = 0;
    let mut current_digest = String::new();

    for index in 0..baseline.frames {
        let frame = baseline
            .input_sequence
            .get(index as usize)
            .cloned()
            .unwrap_or_default();
        let snapshot = match runtime.tick_with_input(&frame) {
            Ok(snapshot) => snapshot,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let current = recorded_frame(index, &snapshot);
        current_digest = current.digest.clone();
        let Some(recorded) = baseline.recorded.get(index as usize) else {
            break;
        };
        if first_divergent.is_none() && recorded.digest != current.digest {
            first_divergent = Some(index);
            // Only the first divergent frame is worth a field diff: every later
            // frame inherits the difference and would bury the cause in noise.
            collect_differences(
                "",
                &recorded.observation,
                &current.observation,
                &mut differences,
                &mut omitted,
            );
        }
    }

    let identical = first_divergent.is_none() && baseline.observation_digest == current_digest;
    let report = DiffReport {
        project: runtime.project_name().to_string(),
        seed: baseline.seed,
        frames: baseline.frames,
        identical,
        first_divergent_frame: first_divergent,
        baseline_digest: baseline.observation_digest.clone(),
        current_digest,
        differences,
        omitted_differences: omitted,
    };
    if identical {
        return EngineResult::success(report);
    }
    let mut diagnostic = Diagnostic::error(
        "REPLAY_DIVERGED",
        "Replay output differs from recording",
        match report.first_divergent_frame {
            Some(frame) => format!(
                "The first divergence occurs at frame {frame}; differences contains field-level changes using observation paths."
            ),
            None => "Every frame matches, but the final digest differs; the recording may have a different frame count."
                .to_string(),
        },
    );
    diagnostic.facts = serde_json::json!({
        "first_divergent_frame": report.first_divergent_frame,
        "difference_count": report.differences.len() + report.omitted_differences,
    });
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "inspect_divergent_frame".to_string(),
        description: "Re-run through that frame and inspect the observation.".to_string(),
        command: report
            .first_divergent_frame
            .map(|frame| format!("game run --frames {} --seed {}", frame + 1, report.seed)),
    });
    let mut result = EngineResult::success(report);
    result.ok = false;
    result.diagnostics.push(diagnostic);
    result
}

/// Walk two JSON values together and record every leaf that differs.
fn collect_differences(
    path: &str,
    baseline: &serde_json::Value,
    current: &serde_json::Value,
    differences: &mut Vec<FieldDifference>,
    omitted: &mut usize,
) {
    if baseline == current {
        return;
    }
    match (baseline, current) {
        (serde_json::Value::Object(left), serde_json::Value::Object(right)) => {
            let mut keys: Vec<&String> = left.keys().chain(right.keys()).collect();
            keys.sort_unstable();
            keys.dedup();
            for key in keys {
                let child = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                collect_differences(
                    &child,
                    left.get(key).unwrap_or(&serde_json::Value::Null),
                    right.get(key).unwrap_or(&serde_json::Value::Null),
                    differences,
                    omitted,
                );
            }
        }
        (serde_json::Value::Array(left), serde_json::Value::Array(right))
            if left.len() == right.len() =>
        {
            for (index, (left, right)) in left.iter().zip(right).enumerate() {
                collect_differences(&format!("{path}[{index}]"), left, right, differences, omitted);
            }
        }
        _ => {
            if differences.len() >= MAX_REPORTED_DIFFERENCES {
                *omitted += 1;
                return;
            }
            differences.push(FieldDifference {
                path: if path.is_empty() {
                    "<root>".to_string()
                } else {
                    path.to_string()
                },
                baseline: baseline.clone(),
                current: current.clone(),
            });
        }
    }
}

/// Read a recording written by `record`.
pub fn read_recording(path: &Path) -> Result<Recording, Box<Diagnostic>> {
    let text = fs::read_to_string(path).map_err(|error| {
        Box::new(Diagnostic::error(
            "RECORDING_READ_FAILED",
            "Failed to read recording",
            format!("{}: {}", path.display(), error),
        ))
    })?;
    serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "RECORDING_INVALID",
            "Recording is not valid JSON",
            format!("{}: {}", path.display(), error),
        ))
    })
}

/// Render a diff the way an author reads it before deciding what to fix.
pub fn to_markdown(report: &DiffReport) -> String {
    let mut out = String::new();
    if report.identical {
        out.push_str(&format!(
            "## Replay matches: {} frames at seed {}\n\nDigest {}\n",
            report.frames, report.seed, report.current_digest
        ));
        return out;
    }
    match report.first_divergent_frame {
        Some(frame) => out.push_str(&format!(
            "## Replay diverged at frame {frame} of {}\n\n",
            report.frames
        )),
        None => out.push_str("## Replay produced a different final digest\n\n"),
    }
    out.push_str(&format!(
        "- baseline digest {}\n- current digest  {}\n\n",
        report.baseline_digest, report.current_digest
    ));
    if report.differences.is_empty() {
        out.push_str("No field-level differences were recorded.\n");
        return out;
    }
    out.push_str("| field | baseline | current |\n|---|---|---|\n");
    for difference in &report.differences {
        out.push_str(&format!(
            "| {} | {} | {} |\n",
            difference.path, difference.baseline, difference.current
        ));
    }
    if report.omitted_differences > 0 {
        out.push_str(&format!(
            "\n{} further differences were omitted.\n",
            report.omitted_differences
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{diff, record};

    const SCRIPT: &str = r#"--!strict
local Game = {}
local total = 0
function Game.start(_api) end
function Game.update(api, _dt)
    total += SPEED
    api.observation.set("total", total)
end
return Game
"#;

    fn write_project(dir: &std::path::Path, speed: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            r#"{"name": "DiffFixture", "entry_script": "scripts/main.luau"}"#,
        )
        .unwrap();
        fs::write(
            dir.join("scripts/main.luau"),
            SCRIPT.replace("SPEED", speed),
        )
        .unwrap();
    }

    #[test]
    fn an_unchanged_project_replays_identically() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), "1");
        let recording = record(dir.path(), 5, 42, &[]).value.unwrap();
        let result = diff(dir.path(), &recording);
        assert!(result.ok, "{:?}", result.diagnostics);
        assert!(result.value.unwrap().identical);
    }

    /// The point of the tool: name the frame and the field, not just "different".
    #[test]
    fn a_changed_project_names_the_first_frame_and_the_field() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), "1");
        let recording = record(dir.path(), 5, 42, &[]).value.unwrap();

        write_project(dir.path(), "2");
        let result = diff(dir.path(), &recording);
        assert!(!result.ok);
        let report = result.value.unwrap();
        assert!(!report.identical);
        assert_eq!(report.first_divergent_frame, Some(0));
        let total = report
            .differences
            .iter()
            .find(|difference| difference.path == "observations.total")
            .expect("the differing observation is named");
        assert_eq!(total.baseline, 1.0);
        assert_eq!(total.current, 2.0);
    }
}
