//! Stateful, host-independent developer operations. Hosts own scheduling and transport.
//! Runtime edits are transient; authoring files and active bundles are never rewritten.
use std::{
    collections::VecDeque,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Diagnostic, EngineResult, EngineRuntime, InputFrame, Transform2DData, Vec2};
use crate::{systems::SystemSettings, ui::UiTree, world::World};

const JOURNAL_CAPACITY: usize = 1024;
const RECORDING_CAPACITY: usize = 4096;
const MAX_CHANGES: usize = 128;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_RECORDING_BYTES: usize = 16 * 1024 * 1024;
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Selector {
    Entity { id: String },
    Ui { id: String },
    Scene,
    Effect { handle: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Change {
    SpawnParticle {
        effect: String,
        position: crate::Vec3,
        seed: u64,
    },
    StopParticle {
        handle: String,
    },
    SetParticleDefinition {
        effect: String,
        definition: crate::ParticleDefinition,
    },
    SetTransform3d {
        transform: crate::Transform3DData,
    },
    SetCamera3d {
        camera: crate::Camera3DData,
    },
    SetPosition {
        position: Vec2,
    },
    SetTransform2d {
        transform: Transform2DData,
    },
    SetVelocity {
        velocity: Vec2,
    },
    SetVisible {
        visible: bool,
    },
    PlayAnimation {
        animation: String,
        asset: Option<String>,
        looping: Option<bool>,
        speed: Option<f64>,
    },
    StopAnimation,
    SetText {
        text: String,
    },
    SetRect {
        rect: crate::UiRect,
    },
    SetCamera {
        position: Vec2,
        zoom: f64,
    },
    SpawnEffect {
        asset: String,
        position: Vec2,
        scale: Option<f64>,
        rotation: Option<f64>,
    },
    StopEffect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct EnactOperation {
    pub selector: Selector,
    pub change: Change,
}

fn error(code: &str, detail: impl Into<String>) -> Box<Diagnostic> {
    Box::new(Diagnostic::error(
        code,
        "Developer operation rejected",
        detail,
    ))
}

/// Runs only against candidate Rust state. No Lua callback, I/O or host side effect.
pub(crate) fn apply_operations(
    world: &mut World,
    ui: &mut Option<UiTree>,
    systems: &SystemSettings,
    operations: &[EnactOperation],
) -> Result<Vec<Value>, Box<Diagnostic>> {
    if operations.is_empty() || operations.len() > 64 {
        return Err(error(
            "ENACT_INVALID",
            "operations must contain 1..64 entries",
        ));
    }
    let mut results = Vec::new();
    for (index, operation) in operations.iter().enumerate() {
        let needed = match operation.change {
            Change::SpawnParticle { .. }
            | Change::StopParticle { .. }
            | Change::SetParticleDefinition { .. } => Some("particle"),
            Change::SetCamera3d { .. } => Some("camera3d"),
            Change::PlayAnimation { .. } | Change::StopAnimation => Some("spine"),
            Change::SpawnEffect { .. } | Change::StopEffect => Some("effekseer"),
            Change::SetText { .. } | Change::SetRect { .. } => Some("ui"),
            Change::SetVelocity { .. } => Some("physics2d"),
            Change::SetCamera { .. } => Some("camera2d"),
            _ => None,
        };
        if let Some(system) = needed
            && !systems.is_enabled(system)
        {
            return Err(error(
                "SYSTEM_DISABLED",
                format!("Operation {index} requires {system}"),
            ));
        }
        let result: Result<Value, String> = (|| {
            match (&operation.selector, &operation.change) {
                (
                    Selector::Scene,
                    Change::SpawnParticle {
                        effect,
                        position,
                        seed,
                    },
                ) => {
                    return world
                        .particles
                        .play(effect, *position, *seed, world.frame)
                        .map(|handle| json!({"handle":handle}));
                }
                (Selector::Scene, Change::StopParticle { handle }) => {
                    if !world.particles.stop(handle) {
                        return Err(format!("Particle instance {handle} not found"));
                    }
                }
                (Selector::Scene, Change::SetParticleDefinition { effect, definition }) => {
                    definition.validate()?;
                    if effect.trim().is_empty() {
                        return Err("Particle ID must not be blank".into());
                    }
                    world
                        .particles
                        .definitions
                        .insert(effect.clone(), definition.clone());
                }
                (Selector::Entity { id }, Change::SetTransform3d { transform }) => {
                    world.set_transform3d(id, transform.clone())?
                }
                (Selector::Scene, Change::SetCamera3d { camera }) => {
                    world.set_camera3d(camera.clone())?
                }
                (Selector::Entity { id }, Change::SetPosition { position }) => {
                    world.set_position(id, *position)?
                }
                (Selector::Entity { id }, Change::SetTransform2d { transform }) => {
                    world.set_transform2d(id, transform.clone())?
                }
                (Selector::Entity { id }, Change::SetVelocity { velocity }) => {
                    world.set_velocity(id, *velocity)?
                }
                (Selector::Entity { id }, Change::SetVisible { visible }) => {
                    world.set_sprite_visible(id, *visible)?
                }
                (
                    Selector::Entity { id },
                    Change::PlayAnimation {
                        animation,
                        asset,
                        looping,
                        speed,
                    },
                ) => world.play_animation(id, animation, asset.clone(), *looping, *speed)?,
                (Selector::Entity { id }, Change::StopAnimation) => world.stop_animation(id)?,
                (Selector::Scene, Change::SetCamera { position, zoom }) => {
                    world.set_camera_position(*position)?;
                    world.set_camera_zoom(*zoom)?;
                }
                (
                    Selector::Scene,
                    Change::SpawnEffect {
                        asset,
                        position,
                        scale,
                        rotation,
                    },
                ) => {
                    return world
                        .spawn_effect(asset, *position, *scale, *rotation)
                        .map(|handle| json!({"handle": handle}));
                }
                (Selector::Effect { handle }, Change::StopEffect) => {
                    if !world.stop_effect(handle)? {
                        return Err(format!("Effect '{handle}' does not exist"));
                    }
                }
                (
                    Selector::Ui { id },
                    change @ (Change::SetText { .. } | Change::SetRect { .. }),
                ) => {
                    let tree = ui.as_mut().ok_or("No UI tree is published")?;
                    let node = tree
                        .children
                        .iter_mut()
                        .find_map(|node| node.find_mut(id))
                        .ok_or_else(|| format!("UI node '{id}' does not exist"))?;
                    match (node, change) {
                        (node, Change::SetText { text: value }) => {
                            let text = node.text_mut().ok_or_else(|| {
                                format!("UI node '{id}' does not expose editable text")
                            })?;
                            *text = value.clone();
                        }
                        (node, Change::SetRect { rect: value }) => *node.rect_mut() = *value,
                        _ => unreachable!("UI change arm is guarded above"),
                    }
                    *tree = UiTree::from_json(
                        serde_json::to_value(&*tree).map_err(|e| e.to_string())?,
                    )?;
                }
                _ => return Err("Selector kind does not support this operation".into()),
            }
            Ok(json!({}))
        })();
        results.push(result.map_err(|detail| {
            let mut diagnostic = error("ENACT_INVALID", format!("Operation {index}: {detail}"));
            diagnostic.facts = json!({"operation_index": index, "selector": operation.selector});
            diagnostic
        })?);
    }
    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum DeveloperRequest {
    Open {
        #[serde(default = "default_seed")]
        seed: u64,
    },
    Close {
        session: String,
    },
    Snapshot {
        session: String,
        #[serde(default)]
        selector: Option<Selector>,
        #[serde(default)]
        paths: Vec<String>,
    },
    Journal {
        session: String,
        #[serde(default)]
        after: u64,
        #[serde(default = "default_limit")]
        limit: usize,
    },
    /// Incremental polling, never advances the runtime. Hosts can poll at their desired cadence.
    Watch {
        session: String,
        after: u64,
        #[serde(default = "default_limit")]
        limit: usize,
        #[serde(default)]
        selector: Option<Selector>,
        #[serde(default)]
        paths: Vec<String>,
    },
    Step {
        session: String,
        expected_revision: u64,
        #[serde(default = "default_frames")]
        frames: u64,
        #[serde(default)]
        input: InputFrame,
    },
    /// Apply a temporary debug patch to Rust-owned runtime state. This is not a
    /// gameplay command: no Lua callback runs, and the game may overwrite it next tick.
    Enact {
        session: String,
        expected_revision: u64,
        #[serde(default)]
        dry_run: bool,
        operations: Vec<EnactOperation>,
    },
    Perf {
        session: String,
    },
    /// Read a bounded evidence pack after a failed tick, without rerunning it.
    Diagnose {
        session: String,
        #[serde(default = "default_limit")]
        limit: usize,
    },
    Recording {
        session: String,
    },
    Replay {
        #[cfg_attr(feature = "dev-tools", schemars(with = "Recording"))]
        recording: Value,
    },
}

fn default_seed() -> u64 {
    42
}

fn default_limit() -> usize {
    100
}
fn default_frames() -> u64 {
    1
}

#[derive(Debug, Clone, Serialize)]
struct JournalEntry {
    sequence: u64,
    revision: u64,
    frame: u64,
    kind: String,
    data: Value,
}

/// A runtime and its bounded observation history. All mutations are serialized by its host.
/// Wrapping an existing runtime lets a host expose its real game, rather than a second simulation.
pub struct DeveloperSession {
    runtime: EngineRuntime,
    id: String,
    revision: u64,
    sequence: u64,
    journal: VecDeque<JournalEntry>,
    recording: Vec<Value>,
    recording_bytes: usize,
    recorded_ticks: u64,
    initial_digest: String,
    seed: u64,
    faulted: bool,
    failure_evidence: Option<Value>,
    snapshot: Value,
}

impl DeveloperSession {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn new(mut runtime: EngineRuntime, seed: u64) -> Self {
        let snapshot = serde_json::to_value(runtime.observe()).expect("snapshot serializes");
        let initial_digest =
            crate::observation_digest(&runtime.observe()).expect("snapshot serializes");
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let id = format!("{nonce:x}-{}", NEXT_SESSION.fetch_add(1, Ordering::Relaxed));
        let traces = runtime.take_developer_trace();
        let mut session = Self {
            runtime,
            id,
            revision: 0,
            sequence: 0,
            journal: VecDeque::new(),
            recording: Vec::new(),
            recording_bytes: 0,
            recorded_ticks: 0,
            initial_digest,
            seed,
            faulted: false,
            failure_evidence: None,
            snapshot,
        };
        session.push("session_opened", json!({"seed": seed}));
        for event in traces {
            session.push("trace", event);
        }
        session
    }

    fn push(&mut self, kind: &str, data: Value) {
        let bytes = serde_json::to_vec(&data).expect("journal serializes").len();
        let data = if bytes > 16 * 1024 {
            json!({"truncated": true, "original_bytes": bytes, "omitted_changes": 1,
                "reason": "Journal entry exceeds 16 KiB; inspect the current snapshot or export the recording"})
        } else {
            data
        };
        self.sequence += 1;
        if self.journal.len() == JOURNAL_CAPACITY {
            self.journal.pop_front();
        }
        self.journal.push_back(JournalEntry {
            sequence: self.sequence,
            revision: self.revision,
            frame: self.snapshot["frame"].as_u64().unwrap_or(0),
            kind: kind.into(),
            data,
        });
    }

    fn metadata(&self) -> Value {
        json!({"session": self.id, "revision": self.revision, "cursor": self.sequence,
            "frame": self.snapshot["frame"], "faulted": self.faulted,
            "script_generation": self.runtime.developer_generation(),
            "script_digest": self.runtime.developer_script_digest(),
            "engine_version": env!("CARGO_PKG_VERSION"),
            "execution": crate::execution_mode(),
            "scope": "runtime", "host": "headless", "seed": self.seed,
            "mutation_policy": "temporary_debug_state_patch", "gameplay_authority": "luau_and_input",
            "supported_dimensions": ["3d", "2d"]})
    }

    fn check_revision(&self, revision: u64) -> Result<(), Box<Diagnostic>> {
        if self.faulted {
            return Err(error(
                "SESSION_FAULTED",
                "A script failed; inspect the snapshot/journal and open a new session before mutating",
            ));
        }
        if revision != self.revision {
            let mut diagnostic = error(
                "REVISION_CONFLICT",
                format!("Expected {revision}; current revision is {}", self.revision),
            );
            diagnostic.facts = json!({"session": self.id, "expected_revision": revision, "actual_revision": self.revision});
            return Err(diagnostic);
        }
        if self.recording.len() >= RECORDING_CAPACITY {
            return Err(error(
                "RECORDING_FULL",
                "Export the recording and open a new session; no unrecorded mutation was applied",
            ));
        }
        Ok(())
    }

    fn capture(&mut self, kind: &str, before: &Value, extra: Value) {
        self.revision += 1;
        self.snapshot = serde_json::to_value(self.runtime.observe()).expect("snapshot serializes");
        let (mut changes, omitted) = differences(before, &self.snapshot);
        if kind == "tick" {
            changes
                .retain(|change| change["path"] != "/frame" && change["path"] != "/time_seconds");
        }
        if kind != "tick" || !changes.is_empty() || omitted > 0 {
            self.push(
                kind,
                json!({"changes": changes, "omitted_changes": omitted, "detail": extra}),
            );
        }
        for event in self.runtime.take_developer_trace() {
            self.push("trace", event);
        }
        // Contacts and one-shot audio events must remain visible even if successive snapshots match.
        for field in ["contacts", "ground_contacts", "audio_events"] {
            if self
                .snapshot
                .get(field)
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
            {
                self.push(field, self.snapshot[field].clone());
            }
        }
    }

    fn reserve_recording(
        &self,
        request: &impl Serialize,
        tick_count: u64,
    ) -> Result<(), Box<Diagnostic>> {
        if self.recorded_ticks + tick_count > 60_000 {
            return Err(error(
                "RECORDING_FULL",
                "Export the recording and open a new session; recording is limited to 60,000 ticks",
            ));
        }
        let size = serde_json::to_vec(request)
            .map_err(|detail| error("DEVELOPER_REQUEST_INVALID", detail.to_string()))?
            .len();
        if size > MAX_REQUEST_BYTES {
            return Err(error(
                "DEVELOPER_REQUEST_TOO_LARGE",
                "Input/operations must fit within 64 KiB",
            ));
        }
        if self.recording_bytes + size + tick_count as usize * 96 + 1024 > MAX_RECORDING_BYTES {
            return Err(error(
                "RECORDING_FULL",
                "Export the recording and open a new session; recording is limited to 16 MiB",
            ));
        }
        Ok(())
    }

    fn record(&mut self, command: Value) {
        self.recorded_ticks += command["frames"].as_u64().unwrap_or(0);
        self.recording_bytes += serde_json::to_vec(&command)
            .expect("recording serializes")
            .len();
        self.recording.push(command);
    }

    fn snapshot_report(
        &self,
        selector: Option<&Selector>,
        paths: &[String],
    ) -> Result<Value, Box<Diagnostic>> {
        validate_paths(paths)?;
        let value = select(&self.snapshot, selector)?;
        let mut report = self.metadata();
        report["snapshot"] = if paths.is_empty() {
            value
        } else {
            let mut fields = serde_json::Map::new();
            for path in paths {
                let selected = value.pointer(path).ok_or_else(|| {
                    error(
                        "SELECTOR_NOT_FOUND",
                        format!("JSON pointer '{path}' does not exist in the selection"),
                    )
                })?;
                fields.insert(path.clone(), selected.clone());
            }
            Value::Object(fields)
        };
        report["observation_digest"] =
            json!(crate::observation_digest(&self.runtime.observe()).expect("snapshot serializes"));
        Ok(report)
    }

    fn journal_report(&self, after: u64, limit: usize) -> Result<Value, Box<Diagnostic>> {
        if after > self.sequence {
            return Err(error("CURSOR_INVALID", "Cursor is ahead of this session"));
        }
        if !(1..=256).contains(&limit) {
            return Err(error("LIMIT_INVALID", "limit must be 1..256"));
        }
        let oldest = self
            .journal
            .front()
            .map_or(self.sequence + 1, |entry| entry.sequence);
        let entries: Vec<_> = self
            .journal
            .iter()
            .filter(|entry| entry.sequence > after)
            .take(limit)
            .collect();
        let next = entries.last().map_or(after, |entry| entry.sequence);
        let mut report = self.metadata();
        report["entries"] = json!(entries);
        report["next_cursor"] = json!(next);
        report["has_more"] = json!(next < self.sequence);
        report["oldest_cursor"] = json!(oldest);
        report["lost_events"] = json!(after < oldest.saturating_sub(1));
        report["dropped_count"] = json!(oldest.saturating_sub(after.saturating_add(1)));
        Ok(report)
    }

    pub fn execute(&mut self, request: DeveloperRequest) -> EngineResult<Value> {
        match self.execute_inner(request) {
            Ok(value) => EngineResult::success(value),
            Err(diagnostic) => EngineResult::failure(*diagnostic),
        }
    }

    fn execute_inner(&mut self, request: DeveloperRequest) -> Result<Value, Box<Diagnostic>> {
        let session = match &request {
            DeveloperRequest::Open { .. } | DeveloperRequest::Replay { .. } => {
                return Err(error(
                    "SESSION_EXISTS",
                    "Use the protocol dispatcher to open or replay a session",
                ));
            }
            DeveloperRequest::Close { session }
            | DeveloperRequest::Snapshot { session, .. }
            | DeveloperRequest::Journal { session, .. }
            | DeveloperRequest::Watch { session, .. }
            | DeveloperRequest::Step { session, .. }
            | DeveloperRequest::Enact { session, .. }
            | DeveloperRequest::Perf { session }
            | DeveloperRequest::Diagnose { session, .. }
            | DeveloperRequest::Recording { session } => session,
        };
        if session != &self.id {
            return Err(error(
                "SESSION_MISMATCH",
                "Use the session id returned by open; cursors and revisions belong to that session",
            ));
        }
        match request {
            DeveloperRequest::Snapshot {
                selector, paths, ..
            } => self.snapshot_report(selector.as_ref(), &paths),
            DeveloperRequest::Journal { after, limit, .. } => self.journal_report(after, limit),
            DeveloperRequest::Watch {
                after,
                limit,
                selector,
                paths,
                ..
            } => {
                let mut report = self.journal_report(after, limit)?;
                report["current"] = match self.snapshot_report(selector.as_ref(), &paths) {
                    Ok(mut current) => {
                        current["selection_exists"] = json!(true);
                        current
                    }
                    Err(diagnostic) if diagnostic.code == "SELECTOR_NOT_FOUND" => {
                        let mut current = self.metadata();
                        current["snapshot"] = Value::Null;
                        current["selection_exists"] = json!(false);
                        current
                    }
                    Err(diagnostic) => return Err(diagnostic),
                };
                report["mode"] = json!("poll");
                // Filter state deltas by selected source paths. Semantic events remain explicit.
                // Array indices are not stable identities; retain the full parent delta for UI/effects.
                let prefix = match selector.as_ref() {
                    Some(Selector::Ui { .. }) => "/ui/children".into(),
                    Some(Selector::Effect { .. }) => "/effects".into(),
                    _ => selector_prefix(&self.snapshot, selector.as_ref())?,
                };
                let prefixes: Vec<String> = if paths.is_empty() {
                    vec![prefix.clone()]
                } else {
                    paths.iter().map(|path| format!("{prefix}{path}")).collect()
                };
                if let Some(entries) = report["entries"].as_array_mut() {
                    for entry in entries.iter_mut() {
                        if let Some(changes) = entry
                            .get_mut("data")
                            .and_then(|data| data.get_mut("changes"))
                            .and_then(Value::as_array_mut)
                        {
                            changes.retain(|change| {
                                prefixes.iter().any(|prefix| {
                                    paths_overlap(prefix, change["path"].as_str().unwrap_or(""))
                                })
                            });
                        }
                    }
                    entries.retain(|entry| {
                        entry["data"].get("changes").is_none()
                            || entry["data"]["changes"]
                                .as_array()
                                .is_some_and(|changes| !changes.is_empty())
                            || entry["data"]["omitted_changes"].as_u64().unwrap_or(0) > 0
                            || entry["kind"] != "tick"
                    });
                }
                Ok(report)
            }
            DeveloperRequest::Step {
                expected_revision,
                frames,
                input,
                ..
            } => {
                self.check_revision(expected_revision)?;
                if !(1..=600).contains(&frames) {
                    return Err(error(
                        "STEP_INVALID",
                        "frames must be 1..600; input repeats each tick, use separate steps for press/release",
                    ));
                }
                if input.physical.is_some(){
                    if frames!=1{return Err(error("INPUT_PHYSICAL_STEP_SINGLE_TICK","One ordered physical batch belongs to exactly one tick; submit distinct batches in separate steps"));}
                    input.validate()?;
                }
                self.reserve_recording(&input, frames)?;
                if let Some(pointer) = &input.pointer {
                    crate::world::validate_vec2(pointer.position, "Pointer position")?;
                    if let Some(screen) = pointer.screen_position {
                        crate::world::validate_vec2(screen, "Pointer screen position")?;
                    }
                }
                let mut digests = Vec::new();
                let mut failure = None;
                for _ in 0..frames {
                    let before = self.snapshot.clone();
                    match self.runtime.tick_with_input(&input) {
                        Ok(_) => self.capture("tick", &before, json!({})),
                        Err(diagnostic) => {
                            self.faulted = true;
                            let attempted_frame = before["frame"].as_u64().unwrap_or(0) + 1;
                            self.capture(
                                "runtime_failed",
                                &before,
                                json!({"diagnostic": diagnostic}),
                            );
                            let (changes, omitted) = differences(&before, &self.snapshot);
                            let evidence = json!({"diagnostic":diagnostic,
                                "attempted_frame":attempted_frame,"completed_frame":before["frame"],
                                "command_index":self.recording.len(),"tick_index":digests.len(),
                                "input":input,"partial_changes":changes,"omitted_changes":omitted,
                                "after_digest":crate::observation_digest(&self.runtime.observe()).ok()});
                            // Keep a separate bounded failure record even if journal traces rotate.
                            self.failure_evidence = Some(
                                if serde_json::to_vec(&evidence)
                                    .expect("evidence serializes")
                                    .len()
                                    <= 64 * 1024
                                {
                                    evidence
                                } else {
                                    json!({"truncated":true,"code":diagnostic.code,"attempted_frame":attempted_frame,
                                    "command_index":self.recording.len(),"tick_index":digests.len(),
                                    "reason":"Failure evidence exceeds 64 KiB; export recording and inspect snapshot separately"})
                                },
                            );
                            failure = Some(*diagnostic);
                        }
                    }
                    digests.push(
                        crate::observation_digest(&self.runtime.observe())
                            .expect("snapshot serializes"),
                    );
                    if failure.is_some() {
                        break;
                    }
                }
                self.record(json!({"command": "step", "frames": frames, "input": input,
                    "digests": digests, "failure": failure.as_ref().map(|diagnostic| json!({"code": diagnostic.code}))}));
                let mut report = self.snapshot_report(None, &[])?;
                report["completed_frames"] = json!(digests.len() - usize::from(failure.is_some()));
                if let Some(mut diagnostic) = failure {
                    report["runtime_facts"] = diagnostic.facts;
                    diagnostic.facts = report;
                    return Err(Box::new(diagnostic));
                }
                Ok(report)
            }
            DeveloperRequest::Enact {
                expected_revision,
                dry_run,
                operations,
                ..
            } => {
                self.check_revision(expected_revision)?;
                self.reserve_recording(&operations, 0)?;
                let before = self.snapshot.clone();
                let (candidate, results) = self.runtime.enact_developer(&operations, dry_run)?;
                let candidate = serde_json::to_value(candidate).expect("snapshot serializes");
                let (changes, omitted) = differences(&before, &candidate);
                if !dry_run {
                    self.capture(
                        "enacted",
                        &before,
                        json!({"operations": operations, "results": results}),
                    );
                    self.record(json!({"command": "enact", "operations": operations,
                        "digest": crate::observation_digest(&self.runtime.observe()).expect("snapshot serializes")}));
                }
                let mut report = self.metadata();
                report["dry_run"] = json!(dry_run);
                report["changes"] = json!(changes);
                report["omitted_changes"] = json!(omitted);
                report["results"] = json!(results);
                Ok(report)
            }
            DeveloperRequest::Perf { .. } => {
                let mut report = self.metadata();
                report["performance"] = json!(self.runtime.developer_performance());
                report["jobs"] = json!(self.runtime.jobs_report());
                report["measurement_scope"] = json!(
                    "runtime script/physics/observe; excludes rendering, transport and developer diff overhead"
                );
                Ok(report)
            }
            DeveloperRequest::Diagnose { limit, .. } => {
                if !(1..=256).contains(&limit) {
                    return Err(error("LIMIT_INVALID", "limit must be 1..256"));
                }
                let mut report = self.metadata();
                report["schema_version"] = json!(1);
                report["failure"] = json!(self.failure_evidence);
                report["journal"] =
                    self.journal_report(self.sequence.saturating_sub(limit as u64), limit)?;
                report["recording"] = json!({"commands":self.recording.len(),"requested_ticks":self.recorded_ticks,
                    "export_request":{"command":"recording","session":self.id},"automatic_replay":false,
                    "limitation":"Recording is not a source/asset archive. Replay is an explicit independent runtime."});
                report["next_requests"] = json!([
                    {"command":"snapshot","session":self.id,"paths":["/observations"]},
                    {"command":"perf","session":self.id},
                    {"command":"recording","session":self.id}
                ]);
                report["capabilities"] = json!({"read_only":true,"tick_stepping":true,"post_failure_inspection":true,
                    "line_breakpoints":false,"all_luau_locals":false,"attach_external_preview":false,
                    "automatic_fix":false,"paired_production_validation_required":true});
                Ok(report)
            }
            DeveloperRequest::Recording { .. } => {
                let mut value=json!({"schema_version": 1, "seed": self.seed,
                "initial_digest": self.initial_digest, "commands": self.recording,
                "script_digest": self.runtime.developer_script_digest(), "engine_version": env!("CARGO_PKG_VERSION"),
                "scope": "runtime commands; replay against the same project sources and engine version"});
                if self.recording.iter().any(|command|command["input"].get("physical").is_some()){
                    value["physical_input_profile"]=json!(crate::physical_input::PROFILE);
                }
                Ok(value)
            }
            DeveloperRequest::Close { .. } => Ok(json!({"session": self.id, "closed": true})),
            DeveloperRequest::Open { .. } | DeveloperRequest::Replay { .. } => unreachable!(),
        }
    }
}

/// Shared CLI/MCP transport dispatcher; a connection owns at most one persistent runtime.
#[derive(Default)]
pub struct DeveloperProtocol {
    session: Option<DeveloperSession>,
}

impl DeveloperProtocol {
    pub fn execute(&mut self, project: &Path, request: DeveloperRequest) -> EngineResult<Value> {
        if let DeveloperRequest::Replay { recording } = request {
            return match replay(project, recording) {
                Ok(value) => EngineResult::success(value),
                Err(diagnostic) => EngineResult::failure(*diagnostic),
            };
        }
        if let DeveloperRequest::Open { seed } = request {
            if self.session.is_some() {
                return EngineResult::failure(*error(
                    "SESSION_EXISTS",
                    "Close the current session before opening another",
                ));
            }
            return match EngineRuntime::load_with_seed(project, seed) {
                Ok(runtime) => {
                    let session = DeveloperSession::new(runtime, seed);
                    let report = session
                        .snapshot_report(None, &[])
                        .expect("full snapshot selects");
                    self.session = Some(session);
                    EngineResult::success(report)
                }
                Err(diagnostic) => EngineResult::failure(*diagnostic),
            };
        }
        let Some(session) = self.session.as_mut() else {
            return EngineResult::failure(*error(
                "SESSION_REQUIRED",
                "Open a developer session first",
            ));
        };
        let close = matches!(request, DeveloperRequest::Close { .. });
        let result = session.execute(request);
        if close && result.ok {
            self.session = None;
        }
        result
    }

    pub fn execute_json(&mut self, project: &Path, request: Value) -> EngineResult<Value> {
        match serde_json::from_value(request) {
            Ok(request) => self.execute(project, request),
            Err(detail) => {
                EngineResult::failure(*error("DEVELOPER_REQUEST_INVALID", detail.to_string()))
            }
        }
    }
}

#[derive(Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct Recording {
    schema_version: u32,
    seed: u64,
    initial_digest: String,
    commands: Vec<RecordedCommand>,
    scope: String,
    script_digest: String,
    engine_version: String,
    #[serde(default,deserialize_with="crate::physical_input::present")]
    physical_input_profile:Option<String>,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
struct RecordedFailure {
    code: String,
}

#[derive(Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum RecordedCommand {
    Step {
        frames: u64,
        input: InputFrame,
        digests: Vec<String>,
        failure: Option<RecordedFailure>,
    },
    Enact {
        operations: Vec<EnactOperation>,
        digest: String,
    },
}

fn replay(project: &Path, value: Value) -> Result<Value, Box<Diagnostic>> {
    if serde_json::to_vec(&value).expect("JSON serializes").len() > MAX_RECORDING_BYTES + 4096 {
        return Err(error("RECORDING_INVALID", "Recording exceeds 16 MiB"));
    }
    let recording: Recording = serde_json::from_value(value)
        .map_err(|detail| error("RECORDING_INVALID", detail.to_string()))?;
    let physical=recording.commands.iter().any(|command|matches!(command,RecordedCommand::Step{input,..} if input.physical.is_some()));
    if physical.then_some(crate::physical_input::PROFILE)!=recording.physical_input_profile.as_deref(){
        return Err(error("INPUT_PHYSICAL_RECORDING_PROFILE","Physical replay requires matching explicit profile"));
    }
    if recording.schema_version != 1
        || recording.commands.len() > RECORDING_CAPACITY
        || recording.scope.is_empty()
    {
        return Err(error(
            "RECORDING_INVALID",
            "Unsupported schema or recording bounds",
        ));
    }
    let mut tick_budget = 0;
    for (index, command) in recording.commands.iter().enumerate() {
        match command {
            RecordedCommand::Step {
                frames,
                digests,
                failure,
                input,
                ..
            } => {
                if input.physical.is_some(){input.validate()?;if *frames!=1{return Err(error("INPUT_PHYSICAL_STEP_SINGLE_TICK","Physical batch cannot repeat across ticks"));}}
                if !(1..=600).contains(frames)
                    || digests.is_empty()
                    || digests.len() as u64 > *frames
                    || (failure.is_none() && digests.len() as u64 != *frames)
                {
                    return Err(error(
                        "RECORDING_INVALID",
                        "Invalid step frame/digest count",
                    ));
                }
                tick_budget += frames;
                if failure.is_some() && index + 1 != recording.commands.len() {
                    return Err(error(
                        "RECORDING_INVALID",
                        "No commands may follow a failed tick",
                    ));
                }
            }
            RecordedCommand::Enact { operations, .. }
                if operations.is_empty() || operations.len() > 64 =>
            {
                return Err(error("RECORDING_INVALID", "Invalid enact operation count"));
            }
            _ => (),
        }
    }
    if tick_budget > 60_000 {
        return Err(error(
            "RECORDING_INVALID",
            "Replay is limited to 60,000 ticks",
        ));
    }
    let runtime = EngineRuntime::load_with_seed(project, recording.seed)?;
    let mut session = DeveloperSession::new(runtime, recording.seed);
    let source_changed = recording.script_digest != session.runtime.developer_script_digest();
    let engine_changed = recording.engine_version != env!("CARGO_PKG_VERSION");
    if session.initial_digest != recording.initial_digest {
        return Err(error(
            "REPLAY_DIVERGED",
            "Initial state differs; use the recorded project sources and engine version",
        ));
    }
    for (index, command) in recording.commands.into_iter().enumerate() {
        match command {
            RecordedCommand::Enact { operations, digest } => {
                if let Err(failure) = session.runtime.enact_developer(&operations, false) {
                    let mut diagnostic = error(
                        "REPLAY_DIVERGED",
                        "A recorded Enact batch is no longer accepted",
                    );
                    diagnostic.facts = json!({"command_index": index, "actual_failure": failure});
                    return Err(diagnostic);
                }
                let actual = crate::observation_digest(&session.runtime.observe())
                    .expect("snapshot serializes");
                if actual != digest {
                    return Err(replay_divergence(index, None, &digest, &actual));
                }
            }
            RecordedCommand::Step {
                input,
                digests,
                failure,
                ..
            } => {
                for (tick, expected) in digests.iter().enumerate() {
                    let result = session.runtime.tick_with_input(&input);
                    let actual = crate::observation_digest(&session.runtime.observe())
                        .expect("snapshot serializes");
                    let expected_failure = if tick + 1 == digests.len() {
                        failure.as_ref().map(|diagnostic| diagnostic.code.as_str())
                    } else {
                        None
                    };
                    let actual_failure = result
                        .as_ref()
                        .err()
                        .map(|diagnostic| diagnostic.code.as_str());
                    if actual != *expected || expected_failure != actual_failure {
                        let mut diagnostic =
                            replay_divergence(index, Some(tick), expected, &actual);
                        diagnostic.facts["expected_failure"] = json!(expected_failure);
                        diagnostic.facts["actual_failure"] = json!(actual_failure);
                        return Err(diagnostic);
                    }
                }
                if failure.is_some() {
                    session.faulted = true;
                }
            }
        }
        session.runtime.take_developer_trace();
    }
    Ok(
        json!({"identical": true, "reproduced_failure": session.faulted,
        "script_changed": source_changed, "engine_version_changed": engine_changed,
        "world": session.runtime.observe(), "performance": session.runtime.developer_performance(),
        "measurement_scope": "runtime only; timing is excluded from replay equality"}),
    )
}

fn replay_divergence(
    command: usize,
    tick: Option<usize>,
    expected: &str,
    actual: &str,
) -> Box<Diagnostic> {
    let mut diagnostic = error(
        "REPLAY_DIVERGED",
        "The first differing command/tick is reported in facts (zero-based)",
    );
    diagnostic.facts = json!({"command_index": command, "tick_index": tick, "expected_digest": expected, "actual_digest": actual});
    diagnostic
}

/// Generated from the exact request type used by both CLI and MCP.
pub fn developer_request_schema() -> Value {
    crate::contract_schema("developer").expect("developer schema is registered")
}

fn escape(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn validate_paths(paths: &[String]) -> Result<(), Box<Diagnostic>> {
    if paths.len() > 64 {
        return Err(error(
            "SELECTOR_INVALID",
            "At most 64 JSON pointers may be requested",
        ));
    }
    for path in paths {
        if !path.is_empty() && !path.starts_with('/') {
            return Err(error(
                "SELECTOR_INVALID",
                "A JSON pointer is empty or starts with '/'",
            ));
        }
        let mut chars = path.chars();
        while let Some(character) = chars.next() {
            if character == '~' && !matches!(chars.next(), Some('0' | '1')) {
                return Err(error(
                    "SELECTOR_INVALID",
                    "JSON pointer escapes must be ~0 or ~1",
                ));
            }
        }
    }
    Ok(())
}
fn paths_overlap(a: &str, b: &str) -> bool {
    a == b
        || a.is_empty()
        || b.is_empty()
        || a.starts_with(&format!("{b}/"))
        || b.starts_with(&format!("{a}/"))
}
fn selector_prefix(
    snapshot: &Value,
    selector: Option<&Selector>,
) -> Result<String, Box<Diagnostic>> {
    let prefix = match selector {
        None | Some(Selector::Scene) => String::new(),
        Some(Selector::Entity { id }) => format!("/entities/{}", escape(id)),
        Some(Selector::Ui { id }) => {
            find_ui_pointer(&snapshot["ui"], id, "/ui").ok_or_else(|| {
                error(
                    "SELECTOR_NOT_FOUND",
                    format!("UI node '{id}' does not exist"),
                )
            })?
        }
        Some(Selector::Effect { handle }) => {
            let index = snapshot["effects"]
                .as_array()
                .and_then(|items| items.iter().position(|item| item["handle"] == *handle))
                .ok_or_else(|| {
                    error(
                        "SELECTOR_NOT_FOUND",
                        format!("Effect '{handle}' does not exist"),
                    )
                })?;
            format!("/effects/{index}")
        }
    };
    Ok(prefix)
}

fn find_ui_pointer(value: &Value, id: &str, path: &str) -> Option<String> {
    let children = value.get("children")?.as_array()?;
    for (index, child) in children.iter().enumerate() {
        let child_path = format!("{path}/children/{index}");
        if child.get("id").and_then(Value::as_str) == Some(id) {
            return Some(child_path);
        }
        if let Some(found) = find_ui_pointer(child, id, &child_path) {
            return Some(found);
        }
    }
    None
}

fn select(snapshot: &Value, selector: Option<&Selector>) -> Result<Value, Box<Diagnostic>> {
    let prefix = selector_prefix(snapshot, selector)?;
    snapshot.pointer(&prefix).cloned().ok_or_else(|| {
        error(
            "SELECTOR_NOT_FOUND",
            format!("Selection '{prefix}' does not exist"),
        )
    })
}

// Stable JSON pointers; present flags distinguish a missing field from a JSON null.
fn differences(before: &Value, after: &Value) -> (Vec<Value>, usize) {
    fn walk(
        path: &str,
        before: Option<&Value>,
        after: Option<&Value>,
        out: &mut Vec<Value>,
        omitted: &mut usize,
    ) {
        if before == after {
            return;
        }
        if let (Some(Value::Object(left)), Some(Value::Object(right))) = (before, after) {
            let keys: std::collections::BTreeSet<_> = left.keys().chain(right.keys()).collect();
            for key in keys {
                walk(
                    &format!("{path}/{}", escape(key)),
                    left.get(key),
                    right.get(key),
                    out,
                    omitted,
                );
            }
        } else if out.len() < MAX_CHANGES {
            out.push(json!({"path": path, "before": before, "after": after,
                "before_present": before.is_some(), "after_present": after.is_some()}));
        } else {
            *omitted += 1;
        }
    }
    let mut out = Vec::new();
    let mut omitted = 0;
    walk("", Some(before), Some(after), &mut out, &mut omitted);
    (out, omitted)
}

#[cfg(test)]
#[path = "developer_tests.rs"]
mod tests;
