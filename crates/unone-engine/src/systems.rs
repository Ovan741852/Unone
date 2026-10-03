//! Declared engine systems and the project switches that turn them off.
//!
//! A game only pays for what it declares. The engine owns the list of systems,
//! their defaults and what disabling one actually changes; the game owns the
//! decision. Nothing here guesses: an unknown system id is an error, and a
//! system with no implementation cannot be enabled just because a plan asks
//! for it.

#[cfg(feature = "dev-tools")]
use crate::{EngineResult, ProjectPaths};
use std::collections::BTreeMap;
#[cfg(feature = "dev-tools")]
use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    diagnostics::{ActionSuggestion, Diagnostic},
    project::ProjectConfig,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemStatus {
    /// Implemented in the engine and usable now.
    Available,
    /// The engine side exists, but the runtime that draws it lives in a host
    /// that has not implemented it yet.
    HostRequired,
    /// The contract exists, but no host renders or executes it yet.
    NotImplemented,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemDescriptor {
    pub id: String,
    pub summary: String,
    pub status: SystemStatus,
    pub default_enabled: bool,
    /// Whether a game may turn this system off at all.
    pub optional: bool,
    /// Cargo feature controlling this system, or null for required core.
    pub build_feature: Option<String>,
    /// Whether this particular binary contains the capability.
    pub compiled: bool,
    /// Luau API surface this system owns.
    pub luau_api: Vec<String>,
    /// Observation/snapshot fields this system produces.
    pub observation: Vec<String>,
    /// What a game gives up by disabling it.
    pub when_disabled: String,
    /// Why a game would choose to disable it.
    pub disable_when: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemState {
    #[serde(flatten)]
    pub descriptor: SystemDescriptor,
    pub enabled: bool,
    /// `default` or `project`.
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemReport {
    pub project: String,
    pub systems: Vec<SystemState>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemSearchReport {
    pub query: String,
    pub matches: Vec<SystemDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemSetReport {
    pub project: String,
    pub id: String,
    pub enabled: bool,
    pub previously_enabled: bool,
    pub changed: bool,
    pub config: String,
}

/// Effective on/off state for every declared system.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct SystemSettings {
    #[serde(flatten)]
    enabled: BTreeMap<String, bool>,
}

impl Default for SystemSettings {
    fn default() -> Self {
        Self {
            enabled: descriptors()
                .into_iter()
                .map(|descriptor| (descriptor.id, descriptor.default_enabled))
                .collect(),
        }
    }
}

impl SystemSettings {
    /// Resolve declared switches against the engine defaults.
    ///
    /// An unknown id, or a switch that contradicts what the engine can
    /// actually do, fails here instead of silently doing nothing at runtime.
    pub fn resolve(declared: &BTreeMap<String, bool>) -> Result<Self, Box<Diagnostic>> {
        let mut settings = Self::default();
        for (id, enabled) in declared {
            let Some(descriptor) = describe(id).filter(|descriptor| descriptor.id == *id) else {
                let mut diagnostic = Diagnostic::error(
                    "SYSTEM_UNKNOWN",
                    "project.unone.json declares an unavailable system",
                    format!(
                        "The engine does not provide system '{id}'; a typo must not silently disable a system."
                    ),
                );
                diagnostic.facts = serde_json::json!({
                    "system": id,
                    "available": descriptors()
                        .into_iter()
                        .map(|descriptor| descriptor.id)
                        .collect::<Vec<_>>(),
                });
                diagnostic.suggested_actions.push(ActionSuggestion {
                    action: "list_systems".to_string(),
                    description: "List the systems declared by the engine and their defaults."
                        .to_string(),
                    command: Some("game systems list --json".to_string()),
                });
                return Err(Box::new(diagnostic));
            };
            if !*enabled && !descriptor.optional {
                return Err(Box::new(Diagnostic::error(
                    "SYSTEM_NOT_OPTIONAL",
                    "This system cannot be disabled",
                    format!(
                        "system '{id}' is required by the runtime: {}",
                        descriptor.when_disabled
                    ),
                )));
            }
            if *enabled && descriptor.status == SystemStatus::NotImplemented {
                let mut diagnostic = Diagnostic::error(
                    "SYSTEM_NOT_IMPLEMENTED",
                    "This system is not implemented",
                    format!(
                        "system '{id}' has a contract but no engine or host implementation; enabling it produces no behavior, so the configuration is invalid."
                    ),
                );
                diagnostic.facts = serde_json::json!({"system": id, "status": descriptor.status});
                return Err(Box::new(diagnostic));
            }
            settings.enabled.insert(id.clone(), *enabled);
        }
        Ok(settings)
    }

    /// Resolve the systems a loaded project asks for.
    pub fn from_config(config: &ProjectConfig) -> Result<Self, Box<Diagnostic>> {
        Self::resolve(&config.systems)
    }

    pub fn validate_compiled(&self) -> Result<(), Box<Diagnostic>> {
        for id in self.enabled_ids() {
            if !is_compiled(&id) {
                let mut diagnostic = Diagnostic::error(
                    "SYSTEM_NOT_COMPILED",
                    "Project requires an excluded runtime capability",
                    format!(
                        "System '{id}' is enabled but absent from this binary. Rebuild the player for this project, or explicitly disable it in project.unone.json."
                    ),
                );
                diagnostic.facts =
                    serde_json::json!({"system": id, "compiled_systems": compiled_systems()});
                diagnostic.suggested_actions.push(ActionSuggestion { action: "rebuild_player".into(), description: "Build the project's selected runtime capabilities.".into(), command: Some("powershell -File scripts/build-web-live.ps1 -Player -Project <project-directory>".into()) });
                return Err(Box::new(diagnostic));
            }
        }
        Ok(())
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.enabled.get(id).copied().unwrap_or(false)
    }

    pub fn enabled_ids(&self) -> Vec<String> {
        self.enabled
            .iter()
            .filter(|(_, enabled)| **enabled)
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn disabled_ids(&self) -> Vec<String> {
        self.enabled
            .iter()
            .filter(|(_, enabled)| !**enabled)
            .map(|(id, _)| id.clone())
            .collect()
    }
}

pub fn describe(id: &str) -> Option<SystemDescriptor> {
    descriptors()
        .into_iter()
        .find(|descriptor| descriptor.id.eq_ignore_ascii_case(id.trim()))
}

/// Find systems by meaning, the same way `api search` finds capabilities.
pub fn search(query: &str) -> Vec<SystemDescriptor> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return descriptors();
    }
    let terms: Vec<String> = normalized.split_whitespace().map(str::to_string).collect();
    descriptors()
        .into_iter()
        .filter(|descriptor| {
            let searchable = format!(
                "{} {} {} {} {} {}",
                descriptor.id,
                descriptor.summary,
                descriptor.when_disabled,
                descriptor.disable_when,
                descriptor.luau_api.join(" "),
                descriptor.observation.join(" ")
            )
            .to_ascii_lowercase();
            terms.iter().any(|term| searchable.contains(term.as_str()))
        })
        .collect()
}

/// Report the systems a project actually runs with.
#[cfg(feature = "dev-tools")]
pub fn inspect(project_root: impl AsRef<Path>) -> EngineResult<SystemReport> {
    let (config, _) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let settings = match SystemSettings::from_config(&config) {
        Ok(settings) => settings,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let systems = descriptors()
        .into_iter()
        .map(|descriptor| {
            let declared = config.systems.contains_key(&descriptor.id);
            SystemState {
                enabled: settings.is_enabled(&descriptor.id),
                source: if declared { "project" } else { "default" }.to_string(),
                descriptor,
            }
        })
        .collect();
    EngineResult::success(SystemReport {
        project: config.name,
        systems,
    })
}

/// Turn one system on or off in the game's own project config.
#[cfg(feature = "dev-tools")]
pub fn set(
    project_root: impl AsRef<Path>,
    id: &str,
    enabled: bool,
) -> EngineResult<SystemSetReport> {
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let previous = match SystemSettings::from_config(&config) {
        Ok(settings) => settings,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let mut declared = config.systems.clone();
    declared.insert(id.trim().to_string(), enabled);
    if let Err(diagnostic) = SystemSettings::resolve(&declared) {
        return EngineResult::failure(*diagnostic);
    }
    let previously_enabled = previous.is_enabled(id.trim());

    let text = match fs::read_to_string(&paths.config) {
        Ok(text) => text,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_READ_FAILED",
                "Could not read the project configuration",
                format!("{}: {}", paths.config.display(), error),
            ));
        }
    };
    let mut document: serde_json::Value = match serde_json::from_str(&text) {
        Ok(document) => document,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "Project configuration is not valid JSON",
                format!("{}: {}", paths.config.display(), error),
            ));
        }
    };
    let Some(object) = document.as_object_mut() else {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_INVALID",
            "Project configuration must be a JSON object",
            "systems may only be written in the top-level object of project.unone.json.",
        ));
    };
    let systems = object
        .entry("systems")
        .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
    let Some(systems) = systems.as_object_mut() else {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_INVALID",
            "systems must be a JSON object",
            "systems maps each system id to true or false.",
        ));
    };
    systems.insert(id.trim().to_string(), serde_json::Value::Bool(enabled));

    let mut serialized = match serde_json::to_string_pretty(&document) {
        Ok(text) => text,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_WRITE_FAILED",
                "Could not serialize the project configuration",
                error.to_string(),
            ));
        }
    };
    serialized.push('\n');
    if let Err(error) = fs::write(&paths.config, serialized) {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_WRITE_FAILED",
            "Could not write the project configuration",
            format!("{}: {}", paths.config.display(), error),
        ));
    }

    let mut result = EngineResult::success(SystemSetReport {
        project: config.name,
        id: id.trim().to_string(),
        enabled,
        previously_enabled,
        changed: previously_enabled != enabled,
        config: paths.config.display().to_string(),
    });
    result.effects.push(format!(
        "system '{}' set to {} in project.unone.json",
        id.trim(),
        enabled
    ));
    result
}

#[allow(
    clippy::too_many_arguments,
    reason = "one call site per declared system"
)]
fn descriptor(
    id: &str,
    summary: &str,
    status: SystemStatus,
    default_enabled: bool,
    optional: bool,
    luau_api: Vec<&str>,
    observation: Vec<&str>,
    when_disabled: &str,
    disable_when: &str,
) -> SystemDescriptor {
    SystemDescriptor {
        build_feature: build_feature(id).map(str::to_string),
        compiled: is_compiled(id),
        id: id.to_string(),
        summary: summary.to_string(),
        status,
        default_enabled,
        optional,
        luau_api: luau_api.into_iter().map(str::to_string).collect(),
        observation: observation.into_iter().map(str::to_string).collect(),
        when_disabled: when_disabled.to_string(),
        disable_when: disable_when.to_string(),
    }
}

fn descriptors() -> Vec<SystemDescriptor> {
    vec![
        descriptor(
            "jobs",
            "Isolated game-owned Luau buffer jobs; native background threads, Web inline backend.",
            SystemStatus::Available,
            false,
            true,
            vec![
                "api.jobs.register",
                "api.jobs.submit",
                "api.jobs.take",
                "api.jobs.cancel",
                "api.jobs.reset",
            ],
            vec!["world.jobs"],
            "When disabled, api.jobs reports SYSTEM_DISABLED; no worker pool starts.",
            "Enable for independent coarse batches; Web v1 is synchronous, not a Web Worker or arbitrary WASM module executor.",
        ),
        descriptor(
            "world",
            "ECS world state for entities, transforms, and sprites.",
            SystemStatus::Available,
            true,
            false,
            vec!["api.entity.*"],
            vec!["world.entities"],
            "Without the world there is no observable game state, so this system cannot be disabled.",
            "Not applicable.",
        ),
        descriptor(
            "input",
            "Host input boundary for semantic actions and world/screen pointers.",
            SystemStatus::Available,
            true,
            false,
            vec!["api.input.isDown", "api.input.pointer"],
            vec!["world.pointer"],
            "Deterministic tests cannot be replayed without input, so this system cannot be disabled.",
            "Not applicable.",
        ),
        descriptor(
            "observation",
            "Semantic projection and observation digest for the typed ViewModel.",
            SystemStatus::Available,
            true,
            false,
            vec!["api.observation.set"],
            vec!["observation", "observation_digest"],
            "Semantic assertions cannot run without observations, so this system cannot be disabled.",
            "Not applicable.",
        ),
        descriptor(
            "physics3d",
            "Opt-in fixed-step Rapier 3D rigid bodies, sphere/box/capsule/convex/static triangle mesh, sensors, collision groups, CCD, sleeping, ray/shape queries and sorted contact lifecycle. Lua owns commands and gameplay reactions. Legacy moving-sphere sweep remains available.",
            SystemStatus::Available,
            false,
            true,
            vec![
                "api.physics3d.sweepSphere",
                "api.physics3d.addBody",
                "api.physics3d.raycast",
                "api.physics3d.castShape",
                "api.physics3d.overlap",
                "api.physics3d.contacts",
            ],
            vec!["physics3d"],
            "api.physics3d reports SYSTEM_DISABLED.",
            "Games without 3D projectile queries.",
        ),
        descriptor(
            "physics2d",
            "Fixed-step integration for 2D rigid bodies: gravity, linear damping, ground bounce and friction, and circle collisions with per-frame contact points. There is no angular velocity, non-circular collider, sensor, or raycast.",
            SystemStatus::Available,
            true,
            true,
            vec!["api.physics.applyImpulse", "api.entity.despawn"],
            vec![
                "world.entities[].rigidbody",
                "world.contacts",
                "world.ground_contacts",
            ],
            "When disabled, the engine advances no rigid bodies and publishes no contacts; RigidBody2D keeps its scene initial values and api.physics reports SYSTEM_DISABLED.",
            "Games without physics simulation, such as board, idle, AVG, and slot games; disabling this removes per-frame integration cost and unnecessary digest changes.",
        ),
        descriptor(
            "camera2d",
            "Compatibility backing for the unified Camera's orthographic projection.",
            SystemStatus::Available,
            true,
            true,
            vec!["api.camera.setPosition", "api.camera.setZoom"],
            vec!["world.camera"],
            "When disabled, api.camera reports SYSTEM_DISABLED; the snapshot still emits a default camera so the host has a fixed view.",
            "Legacy projects that intentionally keep only the orthographic Camera projection.",
        ),
        descriptor(
            "camera3d",
            "Compatibility backing for the unified Camera's perspective projection and Mesh3D/Transform3D observation.",
            SystemStatus::Available,
            true,
            true,
            vec!["api.camera3d.setPosition", "api.camera3d.setTarget"],
            vec!["world.camera3d", "world.entities[].mesh3d"],
            "When disabled, api.camera3d reports SYSTEM_DISABLED; api.entity 3D transforms are currently unaffected by this switch.",
            "Pure orthographic games; new projects should use api.camera.setProjection instead of creating a second camera namespace.",
        ),
        descriptor(
            "random",
            "Seeded, replayable game randomness.",
            SystemStatus::Available,
            true,
            true,
            vec!["api.random.nextFloat", "api.random.nextInt"],
            vec![],
            "When disabled, api.random reports SYSTEM_DISABLED.",
            "Fully deterministic games or level verification that permits no random source.",
        ),
        descriptor(
            "ui",
            "Deterministic UI tree transport for engine verification (screen/text/button/image/component with rects, asset ids and actions).",
            SystemStatus::Available,
            true,
            true,
            vec!["api.ui.setRoot", "api.ui.inspect", "api.ui.scrollView", "api.ui.virtualList", "api.ui.virtualGrid"],
            vec!["ui"],
            "When disabled, api.ui reports SYSTEM_DISABLED and the host receives no UI tree.",
            "Headless simulations or games whose host builds the UI independently.",
        ),
        descriptor(
            "save",
            "Transport for the game's versioned JSON save payload and migrations.",
            SystemStatus::Available,
            true,
            true,
            vec!["api.save.set", "api.save.get"],
            vec!["save_payload"],
            "When disabled, api.save reports SYSTEM_DISABLED.",
            "Level verification or demos without saved state.",
        ),
        descriptor(
            "audio",
            "Sound effects and BGM: the game publishes semantic audio events and loop state; the host decodes and mixes them.",
            SystemStatus::HostRequired,
            true,
            true,
            vec![
                "api.audio.play",
                "api.audio.loop",
                "api.audio.stop",
                "api.audio.stopAll",
            ],
            vec!["world.audio_events", "world.audio_loops"],
            "When disabled, api.audio reports SYSTEM_DISABLED and the snapshot contains no audio events or loops.",
            "Silent games or verification projects that only compare visuals. Classification rules (exclusive/fade) are decided by the engine and included in the digest; Web and native player hosts produce the sound when their device report is available.",
        ),
        descriptor(
            "spine",
            "Spine skeletal animation: the game publishes semantic animation state; the host runs the Spine runtime.",
            SystemStatus::HostRequired,
            false,
            true,
            vec!["api.animation.play", "api.animation.stop"],
            vec!["world.entities[].animation"],
            "When disabled, api.animation reports SYSTEM_DISABLED; animation declared by the scene still appears in the snapshot.",
            "Games without skeletal animation; this system is disabled by default. Currently only the web/presentation Web host plays it with spine-webgl; native preview and Android still require a Spine host adapter. The engine only owns transport and determinism.",
        ),
        descriptor(
            "particle",
            "Seeded fixed-frame 3D native particles, sampled by core and presented by the host.",
            SystemStatus::Available,
            true,
            true,
            vec!["api.particle.play", "api.particle.stop"],
            vec!["world.particles"],
            "Particle calls fail when disabled.",
            "Disable if the game has no native particle effects.",
        ),
        descriptor(
            "effekseer",
            "Effekseer effects: the game publishes semantic effect events; the host runs the Effekseer runtime.",
            SystemStatus::HostRequired,
            false,
            true,
            vec!["api.effect.spawn", "api.effect.stop"],
            vec!["world.effects"],
            "When disabled, api.effect reports SYSTEM_DISABLED and the snapshot contains no effects.",
            "Games without particle effects; this system is disabled by default. Currently only the web/presentation Web host plays it with Effekseer for WebGL; native preview and Android still require an Effekseer host adapter. The engine only owns transport and determinism.",
        ),
    ]
}

pub fn build_feature(id: &str) -> Option<&'static str> {
    match id {
        "jobs" => Some("jobs"),
        "physics2d" => Some("physics2d"),
        "physics3d" => Some("physics3d"),
        "camera2d" => Some("camera2d"),
        "camera3d" => Some("camera3d"),
        "random" => Some("random"),
        "ui" => Some("ui"),
        "save" => Some("save"),
        "audio" => Some("audio"),
        "spine" => Some("spine"),
        "particle" => Some("particle"),
        "effekseer" => Some("effekseer"),
        _ => None,
    }
}
pub fn is_compiled(id: &str) -> bool {
    match id {
        "jobs" => cfg!(feature = "jobs"),
        "physics2d" => cfg!(feature = "physics2d"),
        "physics3d" => cfg!(feature = "physics3d"),
        "camera2d" => cfg!(feature = "camera2d"),
        "camera3d" => cfg!(feature = "camera3d"),
        "random" => cfg!(feature = "random"),
        "ui" => cfg!(feature = "ui"),
        "save" => cfg!(feature = "save"),
        "audio" => cfg!(feature = "audio"),
        "spine" => cfg!(feature = "spine"),
        "particle" => cfg!(feature = "particle"),
        "effekseer" => cfg!(feature = "effekseer"),
        _ => matches!(id, "world" | "input" | "observation"),
    }
}
pub fn compiled_systems() -> &'static [String] {
    static IDS: std::sync::LazyLock<Vec<String>> = std::sync::LazyLock::new(|| {
        descriptors()
            .into_iter()
            .filter(|d| d.compiled)
            .map(|d| d.id)
            .collect()
    });
    &IDS
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{SystemSettings, describe, descriptors, search};

    #[test]
    fn defaults_follow_the_engine_declaration() {
        let settings = SystemSettings::default();
        assert!(settings.is_enabled("physics2d"));
        assert!(settings.is_enabled("camera3d"));
        assert!(!settings.is_enabled("spine"));
        for descriptor in descriptors() {
            assert_eq!(
                settings.is_enabled(&descriptor.id),
                descriptor.default_enabled,
                "{} default",
                descriptor.id
            );
        }
    }

    #[test]
    fn resolves_declared_switches_and_rejects_impossible_ones() {
        let declared = BTreeMap::from([("physics2d".to_string(), false)]);
        let settings = SystemSettings::resolve(&declared).unwrap();
        assert!(!settings.is_enabled("physics2d"));
        assert!(settings.is_enabled("ui"));

        let unknown = BTreeMap::from([("physics4d".to_string(), false)]);
        assert_eq!(
            SystemSettings::resolve(&unknown).unwrap_err().code,
            "SYSTEM_UNKNOWN"
        );

        let required = BTreeMap::from([("observation".to_string(), false)]);
        assert_eq!(
            SystemSettings::resolve(&required).unwrap_err().code,
            "SYSTEM_NOT_OPTIONAL"
        );

        let host_required = BTreeMap::from([("spine".to_string(), true)]);
        assert!(
            SystemSettings::resolve(&host_required)
                .unwrap()
                .is_enabled("spine")
        );
    }

    #[test]
    fn finds_systems_by_meaning() {
        let matches = search("physics");
        assert!(matches.iter().any(|system| system.id == "physics2d"));
        assert!(search("skeletal").iter().any(|system| system.id == "spine"));
        assert!(describe("PHYSICS2D").is_some());
        assert!(describe("nope").is_none());
    }
}
