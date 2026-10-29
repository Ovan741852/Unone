use std::{collections::BTreeMap, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::world::Vec2;

#[derive(Debug, Clone, Deserialize, Default, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ProjectConfig {
    pub name: String,
    /// Explicit opt-in demand-sampled host time; absent keeps deterministic legacy behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_time: Option<crate::HostTimeConfig>,
    #[serde(default = "default_entry_script")]
    pub entry_script: String,
    /// Isolated Luau job modules, keyed by operation name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub job_scripts: BTreeMap<String, String>,
    /// Exact versions of SDK-bundled Luau runtime packages used by this project.
    /// Declare @unone/ui before using api.ui.components constructors. This is
    /// compatibility data, not a network resolver or filesystem module loader.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub runtime_packages: BTreeMap<String, String>,
    #[serde(default)]
    pub main_scene: Option<String>,
    #[serde(default)]
    pub test_files: Vec<String>,
    #[serde(default)]
    pub bundle_manifest: Option<String>,
    #[serde(default)]
    pub asset_manifest: Option<String>,
    /// Screens `verify` must check the layout of.
    ///
    /// Without this only the opening screen is ever drawn, so a broken win or
    /// lose screen passes every gate. Each entry says how to reach a screen,
    /// the same way `test_files` says how to reach a state worth asserting.
    #[serde(default)]
    pub ui_previews: Vec<UiPreviewSpec>,
    /// Engine systems this game explicitly turns on or off.
    ///
    /// Anything not declared keeps the engine default; the engine rejects
    /// unknown ids instead of treating a typo as a disabled system.
    #[serde(default)]
    pub systems: BTreeMap<String, bool>,
    /// Which gates `verify` runs, in what order, and which of them are
    /// advisory.
    ///
    /// Undeclared means the engine's default order with every gate required.
    #[serde(default)]
    pub verify: Option<VerifyConfig>,
    /// Sound categories and the rules between them.
    ///
    /// Undeclared means no rules, not no sound: a game can still play and loop
    /// without ever naming a category. Categories exist to say what happens
    /// *between* sounds, which is the part the engine owns.
    #[serde(default)]
    pub audio: Option<crate::audio::AudioConfig>,
}

fn default_entry_script() -> String {
    "scripts/main.luau".to_string()
}

#[derive(Debug, Clone)]
pub struct ProjectPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub entry_script: PathBuf,
    pub main_scene: Option<PathBuf>,
    pub test_files: Vec<PathBuf>,
    pub bundle_manifest: Option<PathBuf>,
    pub asset_manifest: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectFileStatus {
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInspectReport {
    pub project: String,
    pub root: String,
    pub config: ProjectFileStatus,
    pub entry_script: ProjectFileStatus,
    pub main_scene: Option<ProjectFileStatus>,
    pub test_files: Vec<ProjectFileStatus>,
    pub bundle_manifest: Option<ProjectFileStatus>,
    pub asset_manifest: Option<ProjectFileStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInitReport {
    pub project: String,
    pub root: String,
    pub files: Vec<ProjectInitFile>,
    pub workflow_scope: String,
    pub suggested_next_actions: Vec<ProjectInitAction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInitFile {
    pub path: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectInitAction {
    pub executable: String,
    pub argv: Vec<String>,
    pub reason: String,
    pub prerequisites: Vec<usize>,
}

#[cfg(feature = "dev-tools")]
#[path = "project_authoring.rs"]
mod authoring;
#[cfg(feature = "dev-tools")]
pub(crate) use authoring::resolve_project_path;
#[cfg(feature = "dev-tools")]
pub use authoring::{init, inspect};
#[cfg(feature = "dev-tools")]
#[path = "ui_preview_fixture.rs"]
mod ui_preview_fixture;

/// The gates this project wants `verify` to run.
///
/// The default order is the engine's opinion, not a law. A project that draws
/// no screen, or that is mid-way through acquiring assets, should be able to
/// say so once in its config rather than teaching its author to read past a
/// red line — a gate people learn to ignore is worse than a gate that says it
/// is advisory.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct VerifyConfig {
    #[serde(default)]
    pub steps: Vec<VerifyStepSpec>,
}

/// One declared gate: either the bare id, or the id with its settings.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(untagged)]
pub enum VerifyStepSpec {
    Name(String),
    Detailed(VerifyStepDetail),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct VerifyStepDetail {
    pub step: String,
    /// A failing advisory gate is reported and does not fail the run.
    #[serde(default = "default_true_flag")]
    pub required: bool,
    /// Reserved: a project-owned command as a gate. Declaring it is an error in
    /// this build rather than a step that silently never runs.
    #[serde(default)]
    pub command: Option<serde_json::Value>,
}

fn default_true_flag() -> bool {
    true
}

impl VerifyStepSpec {
    pub fn step(&self) -> &str {
        match self {
            Self::Name(name) => name,
            Self::Detailed(detail) => &detail.step,
        }
    }

    pub fn required(&self) -> bool {
        match self {
            Self::Name(_) => true,
            Self::Detailed(detail) => detail.required,
        }
    }

    pub fn reserved_command(&self) -> bool {
        matches!(self, Self::Detailed(detail) if detail.command.is_some())
    }
}

/// One test case, one file.
///
/// Unknown keys are rejected: a test file with a misspelled or invented key
/// used to load with that key ignored, so a file whose assertions lived under
/// the wrong name passed green while checking nothing.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct TestSpec {
    pub name: String,
    #[serde(default = "default_test_frames")]
    pub frames: u64,
    #[serde(default = "default_test_seed")]
    pub seed: u64,
    #[serde(default)]
    pub input: BTreeMap<String, bool>,
    #[serde(default)]
    pub input_sequence: Vec<InputFrame>,
    #[serde(default)]
    pub load_save: Option<serde_json::Value>,
    #[serde(default)]
    pub assertions: Vec<TestAssertion>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct InputFrame {
    #[cfg_attr(feature="dev-tools",schemars(with="crate::PhysicalBatch"))]
    #[serde(default, skip_serializing_if = "Option::is_none",deserialize_with="crate::physical_input::present")]
    pub physical: Option<crate::PhysicalBatch>,
    #[serde(default)]
    pub actions: BTreeMap<String, bool>,
    #[serde(default)]
    pub pointer: Option<PointerInput>,
    /// Host-projected semantic slider events, consumed once per successful tick.
    /// Values/ranges remain in the official Luau control, not platform adapters.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub ui_sliders: BTreeMap<String, SliderInteraction>,
    /// Host-owned UTF-8 editing snapshots, one event per ID per successful tick.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub ui_text_inputs: BTreeMap<String, TextInputInteraction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SliderPhase { Start, Drag, End, Cancel }

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SliderInteraction {
    pub phase: SliderPhase,
    pub ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum TextInputPhase { Change, Submit, Cancel, Focus, Blur }

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct TextInputInteraction {
    pub phase: TextInputPhase, pub text: String, pub composing: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct PointerInput {
    pub position: Vec2,
    #[serde(default)]
    pub down: bool,
    /// Host-normalized logical UI coordinates. When omitted, world position
    /// is used as a compatibility-free default for headless callers.
    #[serde(default)]
    pub screen_position: Option<Vec2>,
}

impl InputFrame {
    /// Validate before mutating input or ticking, across every host path.
    pub fn validate(&self) -> Result<(), Box<crate::Diagnostic>> {
        if let Some(b)=&self.physical {b.validate().map_err(|e|Box::new(crate::Diagnostic::error("INPUT_PHYSICAL_INVALID","Invalid physical batch",e)))?;}
        if self.ui_sliders.len() > 256 || self.ui_sliders.iter().any(|(id, event)| {
            id.trim().is_empty() || id.len() > 1024 || !event.ratio.is_finite()
                || !(0.0..=1.0).contains(&event.ratio)
        }) {
            return Err(Box::new(crate::Diagnostic::error(
                "INPUT_FRAME_INVALID", "Invalid semantic slider input",
                "ui_sliders accepts at most 256 stable nonblank IDs (up to 1024 bytes), each with a phase and finite ratio in 0..1",
            )));
        }
        if self.ui_text_inputs.len()>64 || self.ui_text_inputs.iter().any(|(id,event)| {
            id.trim().is_empty() || id.len()>1024 || event.text.len()>65536 || event.text.contains(['\n','\r'])
                || event.composing && matches!(event.phase,TextInputPhase::Submit)
        }) {return Err(Box::new(crate::Diagnostic::error("INPUT_FRAME_INVALID","Invalid semantic text input",
            "ui_text_inputs accepts at most 64 stable IDs, single-line UTF-8 text <=65536 bytes, no submit during composition")));}
        if self.actions.keys().any(|action| action.trim().is_empty()) {
            return Err(Box::new(crate::Diagnostic::error(
                "INPUT_FRAME_INVALID",
                "Invalid action name",
                "Action names must not be blank",
            )));
        }
        if let Some(pointer) = &self.pointer {
            crate::world::validate_vec2(pointer.position, "Pointer position")?;
            if let Some(screen) = pointer.screen_position {
                crate::world::validate_vec2(screen, "Pointer screen position")?;
            }
        }
        Ok(())
    }
}

fn default_test_frames() -> u64 {
    60
}
fn default_test_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct TestAssertion {
    #[serde(default)]
    pub entity: Option<String>,
    #[serde(default)]
    pub field: Option<String>,
    #[serde(default)]
    pub equals: Option<f64>,
    #[serde(default)]
    pub greater_than: Option<f64>,
    #[serde(default)]
    pub less_than: Option<f64>,
    #[serde(default)]
    pub observation: Option<ObservationAssertion>,
    #[serde(default)]
    pub ui: Option<UiAssertion>,
    #[serde(default)]
    pub animation: Option<AnimationAssertion>,
    #[serde(default)]
    pub effects: Option<EffectsAssertion>,
    #[serde(default)]
    pub audio: Option<AudioAssertion>,
}

impl TestAssertion {
    pub fn validate(&self) -> Result<(), String> {
        let target_count = [
            self.observation.is_some(),
            self.ui.is_some(),
            self.animation.is_some(),
            self.effects.is_some(),
            self.audio.is_some(),
            self.entity.is_some() || self.field.is_some(),
        ]
        .into_iter()
        .filter(|present| *present)
        .count();
        if target_count != 1 {
            return Err(
                "An assertion must provide exactly one target: observation, ui, animation, effects, audio, or entity/field."
                .to_string(),
            );
        }
        if (self.ui.is_some()
            || self.animation.is_some()
            || self.effects.is_some()
            || self.audio.is_some())
            && self.has_numeric_comparator()
        {
            return Err(
                "Non-entity assertions cannot provide equals, greater_than, or less_than numeric comparators."
                    .to_string(),
            );
        }
        if let Some(observation) = &self.observation {
            if observation.key.trim().is_empty() {
                return Err("Observation assertion key cannot be empty.".to_string());
            }
            if self.has_numeric_comparator() {
                return Err(
                    "Observation assertions cannot provide numeric comparators.".to_string()
                );
            }
        }
        if let Some(animation) = &self.animation
            && animation.entity.trim().is_empty()
        {
            return Err("Animation assertion entity cannot be empty.".to_string());
        }
        if let Some(audio) = &self.audio
            && audio.events.is_none()
            && audio.loops.is_none()
        {
            return Err(
                "An audio assertion must provide at least one of events or loops; otherwise it checks nothing."
                    .to_string(),
            );
        }
        if self.entity.is_some() || self.field.is_some() {
            if self
                .entity
                .as_deref()
                .is_none_or(|entity| entity.trim().is_empty())
            {
                return Err("An entity assertion must provide a non-empty entity.".to_string());
            }
            let field = self
                .field
                .as_deref()
                .ok_or_else(|| "An entity assertion must provide a field.".to_string())?;
            if !matches!(field, "transform.x" | "transform.y") {
                return Err(format!("Unsupported assertion field '{field}'."));
            }
            if self.numeric_comparator_count() != 1 {
                return Err(
                    "An entity assertion must provide exactly one of equals, greater_than, or less_than."
                        .to_string(),
                );
            }
        }
        Ok(())
    }

    fn has_numeric_comparator(&self) -> bool {
        self.numeric_comparator_count() != 0
    }

    fn numeric_comparator_count(&self) -> usize {
        [
            self.equals.is_some(),
            self.greater_than.is_some(),
            self.less_than.is_some(),
        ]
        .into_iter()
        .filter(|present| *present)
        .count()
    }
}

/// Full equality against one entity's published animation state.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AnimationAssertion {
    pub entity: String,
    pub equals: serde_json::Value,
}

/// Full equality against the live effect list a host would be playing.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct EffectsAssertion {
    pub equals: serde_json::Value,
}

/// Full equality against what the game asked to be heard.
///
/// `events` is what was fired on the asserted frame; `loops` is what should
/// still be playing. They are separate because a test usually cares about one
/// or the other: "the reel stopped and made a noise" is an event, "the music
/// survived the win screen" is a loop.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AudioAssertion {
    #[serde(default)]
    pub events: Option<serde_json::Value>,
    #[serde(default)]
    pub loops: Option<serde_json::Value>,
}

/// One reachable screen the layout gate should inspect.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiPreviewSpec {
    pub name: String,
    #[serde(default = "default_preview_frames")]
    pub frames: u64,
    #[serde(default = "default_preview_seed")]
    pub seed: u64,
    /// Project-relative per-frame input replay that reaches this screen.
    #[serde(default)]
    pub input_sequence: Option<String>,
    /// Tool-only project-relative JSON save restored before Game.start.
    /// Omitted from serialized/exported project payloads and production files.
    #[serde(default, skip_serializing)]
    pub save_fixture: Option<String>,
    /// Project-relative exact image-behind-control overlap policy for this preview.
    #[serde(default)]
    pub overlap_policy: Option<String>,
}

fn default_preview_frames() -> u64 {
    1
}

fn default_preview_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ObservationAssertion {
    pub key: String,
    pub equals: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct UiAssertion {
    pub equals: serde_json::Value,
}
