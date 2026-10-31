#[cfg(feature = "dev-tools")]
use crate::project::TestSpec;
use std::{cell::RefCell, collections::{BTreeMap, BTreeSet}, path::PathBuf, rc::Rc};
#[cfg(feature = "dev-tools")]
use std::{env, fs, path::Path, process::Command, time::SystemTime};

use mlua::{Function, Lua, Table, Value};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult, SourceLocation},
    performance::{FrameCounts, FrameTiming, PerformanceCollector, PerformanceReport, StartupPhase, timed},
    project::{InputFrame, ProjectConfig, ProjectPaths},
    systems::SystemSettings,
    ui::UiTree,
    world::{SceneFile, Vec2, World, WorldSnapshot},
};

const FIXED_DT: f64 = 1.0 / 60.0;
mod bindings;
mod host_time;
mod save_state;
mod sprite_resources;
use save_state::SaveState;
mod spatial;
mod spatial_metrics;
pub use spatial::SpatialTask;
mod determinism;
#[cfg(feature = "dev-tools")]
pub(crate) mod import_nodes;
#[cfg(feature = "jobs")]
mod jobs;
#[cfg(feature = "preview-tools")]
mod preview;
#[cfg(feature = "preview-tools")]
mod profiling;
#[cfg(feature = "phase-profile")]
mod phase_profile;
#[cfg(feature = "preview-tools")]
mod memory;
#[cfg(feature = "dev-tools")]
mod replay_adapter;
#[cfg(feature = "preview-tools")]
mod vm_metrics;
use bindings::build_api;
#[cfg(feature = "preview-tools")]
pub use preview::{DebugControl, DebugTab, PreviewRequest};

/// Compute the canonical digest for an already generated observation snapshot.
///
/// Packed instance pose bytes are presentation-only and are not hashed. The
/// digest still includes batch identity (`asset`, `count`, `format`) plus the
/// rest of `WorldSnapshot`. Encoding is read-only relative to runtime state.
pub fn observation_digest(snapshot: &WorldSnapshot) -> Result<String, serde_json::Error> {
    let bytes = serde_json::to_vec(snapshot)?;
    Ok(format!("sha256:{}", hex_digest(&bytes)))
}

/// Serialize the canonical world (no instance pose payloads) and its digest.
pub fn encode_observation(
    snapshot: &WorldSnapshot,
) -> Result<(Box<serde_json::value::RawValue>, String), serde_json::Error> {
    let raw = serde_json::value::to_raw_value(snapshot)?;
    let digest = format!("sha256:{}", hex_digest(raw.get().as_bytes()));
    Ok((raw, digest))
}

/// A project a host assembled from bytes it fetched itself.
///
/// Defaults match a file-backed project that declares nothing, so a host adds
/// only what it actually has.
#[derive(Debug, Default)]
pub struct SourceProject {
    pub config: ProjectConfig,
    pub source: String,
    /// Entry chunk precompiled by `compile_production_script`; replaces `source`.
    pub script_bytecode: Option<Vec<u8>>,
    pub job_sources: BTreeMap<String, String>,
    pub scene: Option<SceneFile>,
    pub seed: u64,
    pub restored_save: Option<serde_json::Value>,
    pub viewport_aspect: Option<f64>,
    pub viewport_size: Option<[u32;2]>,
    /// Declared data assets and the bytes the host delivered for each.
    pub data_assets: Vec<crate::DataAssetDecl>,
    pub data: BTreeMap<String, Vec<u8>>,
    pub asset_catalog: Vec<crate::AssetCatalogEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckReport {
    pub project: String,
    pub script: String,
    pub strict_mode: bool,
    pub entrypoints: Vec<String>,
    pub type_check: Option<TypeCheckReport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TypeCheckReport {
    pub tool: String,
    pub files: Vec<String>,
    pub passed: bool,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<serde_json::Value>,
    pub project: String,
    pub seed: u64,
    pub status: String,
    pub frames: u64,
    pub observation_digest: String,
    pub world: WorldSnapshot,
    pub save_payload: Option<serde_json::Value>,
    pub trace: Vec<TraceEvent>,
    /// Where the time went. Wall clock, so it is not part of the digest.
    pub performance: PerformanceReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestCaseReport {
    pub name: String,
    pub passed: bool,
    pub frames: u64,
    pub observation_digest: Option<String>,
    pub save_payload: Option<serde_json::Value>,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestSuiteReport {
    pub project: String,
    pub passed: bool,
    pub cases: Vec<TestCaseReport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraceEvent {
    pub frame: u64,
    pub event: String,
    pub details: serde_json::Value,
}

#[derive(Debug, Clone, Default)]
struct InputState {
    physical: crate::physical_input_session::PhysicalSession,
    down: BTreeMap<String, bool>,
    previous_down: BTreeMap<String, bool>,
    pressed: BTreeSet<String>,
    released: BTreeSet<String>,
    pointer: PointerState,
    ui_sliders: BTreeMap<String, crate::project::SliderInteraction>,
    pending_ui_sliders: BTreeMap<String, crate::project::SliderInteraction>,
    ui_text_inputs: BTreeMap<String, crate::project::TextInputInteraction>,
    pending_ui_text_inputs: BTreeMap<String, crate::project::TextInputInteraction>,
    pending_presentation: crate::PresentationResourceInput,
}

// Host writes may arrive several times between ticks. Publish one read-only
// edge snapshot for the tick and advance its held baseline only on success.
// A failed script/physics/job step must not consume the next retry's edges.
struct InputTick {
    input: Rc<RefCell<InputState>>,
    down: BTreeMap<String, bool>,
    previous_pressed: BTreeSet<String>,
    previous_released: BTreeSet<String>,
    previous_ui_sliders: BTreeMap<String, crate::project::SliderInteraction>,
    previous_ui_text_inputs: BTreeMap<String, crate::project::TextInputInteraction>,
    committed: bool,
}

impl InputTick {
    fn begin(input: &Rc<RefCell<InputState>>) -> Self {
        let mut state = input.borrow_mut();
        state.physical.begin();
        let pressed = state.down.iter().filter(|(action, down)| **down && !state.previous_down.get(*action).copied().unwrap_or(false)).map(|(action, _)| action.clone()).collect();
        let released = state.previous_down.iter().filter(|(action, down)| **down && !state.down.get(*action).copied().unwrap_or(false)).map(|(action, _)| action.clone()).collect();
        let sliders = state.pending_ui_sliders.clone();
        let text_inputs=state.pending_ui_text_inputs.clone();
        Self {
            input: Rc::clone(input),
            down: state.down.clone(),
            previous_pressed: std::mem::replace(&mut state.pressed, pressed),
            previous_released: std::mem::replace(&mut state.released, released),
            previous_ui_sliders: std::mem::replace(&mut state.ui_sliders, sliders),
            previous_ui_text_inputs: std::mem::replace(&mut state.ui_text_inputs,text_inputs),
            committed: false,
        }
    }

    fn commit(mut self) {
        let mut input = self.input.borrow_mut();
        input.previous_down = std::mem::take(&mut self.down);
        input.pending_ui_sliders.clear();
        input.pending_ui_text_inputs.clear();
        input.pending_presentation = Default::default();
        input.physical.commit();
        self.committed = true;
    }
}

impl Drop for InputTick {
    fn drop(&mut self) {
        if !self.committed {
            let mut input = self.input.borrow_mut();
            input.physical.fail();
            input.pressed = std::mem::take(&mut self.previous_pressed);
            input.released = std::mem::take(&mut self.previous_released);
            input.ui_sliders = std::mem::take(&mut self.previous_ui_sliders);
            input.ui_text_inputs = std::mem::take(&mut self.previous_ui_text_inputs);
        }
    }
}

#[derive(Debug, Clone, Default)]
struct PointerState {
    position: Vec2,
    screen_position: Vec2,
    down: bool,
}

#[derive(Clone)]
struct ApiState {
    sprite_resources: Rc<RefCell<sprite_resources::Registry>>,
    host_time: Rc<RefCell<crate::host_time::HostTime>>,
    spatial: Rc<RefCell<spatial::SpatialJobs>>,
    #[cfg(feature = "ui")]
    runtime_packages: BTreeMap<String, String>,
    #[cfg(feature = "jobs")]
    jobs: Rc<RefCell<jobs::Jobs>>,
    #[cfg(feature = "preview-tools")]
    debug_tools: Rc<RefCell<preview::DebugTools>>,
    world: Rc<RefCell<World>>,
    input: Rc<RefCell<InputState>>,
    random: Rc<RefCell<DeterministicRng>>,
    trace: Rc<RefCell<Vec<TraceEvent>>>,
    observations: Rc<RefCell<BTreeMap<String, serde_json::Value>>>,
    ui: Rc<RefCell<Option<UiTree>>>,
    viewport_aspect: Rc<RefCell<f64>>,
    save_payload: Rc<RefCell<SaveState>>,
    data_assets: Rc<RefCell<crate::data_assets::DataAssets>>,
    script_profile: Rc<RefCell<crate::performance::ScriptProfile>>,
    /// Depth of host-driven UI view callbacks (virtual renderItem). Simulation
    /// mutators refuse to run while it is nonzero.
    pure_view: Rc<std::cell::Cell<usize>>,
}

#[derive(Debug, Clone)]
struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E3779B97F4A7C15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94D049BB133111EB);
        value ^ (value >> 31)
    }

    fn next_float(&mut self) -> f64 {
        const SCALE: f64 = 1.0 / ((1u64 << 53) as f64);
        (self.next_u64() >> 11) as f64 * SCALE
    }

    fn next_int(&mut self, min: i64, max: i64) -> Result<i64, String> {
        if min > max {
            return Err(format!(
                "random.nextInt min ({min}) must not exceed max ({max})."
            ));
        }
        let range = (max as i128 - min as i128 + 1) as u128;
        let domain = 1u128 << 64;
        let limit = domain - (domain % range);
        loop {
            let sample = self.next_u64() as u128;
            if sample < limit {
                let value = (sample % range) as i128 + min as i128;
                return Ok(value as i64);
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(feature = "dev-tools")]
struct ScriptStamp {
    modified: SystemTime,
    size: u64,
}

#[cfg(feature = "dev-tools")]
struct ReloadRollbackState {
    input: InputState,
    random: DeterministicRng,
    trace: Vec<TraceEvent>,
    observations: BTreeMap<String, serde_json::Value>,
    ui: Option<UiTree>,
    viewport_aspect: f64,
    save_payload: SaveState,
    generation: u64,
    last_seen_script_stamp: Option<ScriptStamp>,
    script_source: Option<String>,
}

pub struct EngineRuntime {
    sprite_resources: Rc<RefCell<sprite_resources::Registry>>,
    host_time: Rc<RefCell<crate::host_time::HostTime>>,
    spatial: Rc<RefCell<spatial::SpatialJobs>>,
    #[cfg(feature = "jobs")]
    jobs: Rc<RefCell<jobs::Jobs>>,
    #[cfg(feature = "preview-tools")]
    debug_tools: Rc<RefCell<preview::DebugTools>>,
    config: ProjectConfig,
    paths: ProjectPaths,
    systems: SystemSettings,
    world: Rc<RefCell<World>>,
    input: Rc<RefCell<InputState>>,
    #[cfg(feature = "dev-tools")]
    random: Rc<RefCell<DeterministicRng>>,
    lua: Lua,
    api: Table,
    update_fn: Function,
    trace: Rc<RefCell<Vec<TraceEvent>>>,
    observations: Rc<RefCell<BTreeMap<String, serde_json::Value>>>,
    ui: Rc<RefCell<Option<UiTree>>>,
    viewport_aspect: Rc<RefCell<f64>>,
    save_payload: Rc<RefCell<SaveState>>,
    /// Shared with a hot-reloaded VM, which decodes data assets afresh.
    #[cfg(feature = "preview-tools")]
    data_assets: Rc<RefCell<crate::data_assets::DataAssets>>,
    #[cfg(feature = "dev-tools")]
    generation: u64,
    #[cfg(feature = "dev-tools")]
    last_seen_script_stamp: Option<ScriptStamp>,
    script_source: Option<String>,
    /// Precompiled entry chunk, consumed by the first load.
    script_bytecode: Option<Vec<u8>>,
    performance: PerformanceCollector,
    performance_counts: FrameCounts,
    /// What the game measured with api.profile; shared with the API.
    script_profile: Rc<RefCell<crate::performance::ScriptProfile>>,
    startup: crate::performance::StartupCost,
    /// Whether to time the observation a host would receive. Off by default:
    /// only a profiling run should pay for a cost it is measuring.
    measure_serialization: bool,
    #[cfg(feature = "dev-tools")]
    loaded_script_digest: String,
}

impl EngineRuntime {
    /// UI-only work: no Game.update, input consumption or world-frame advance.
    /// renderItem is a pure view callback, never a gameplay callback.
    pub fn ui_request(&mut self, request: serde_json::Value) -> Result<(), String> {
        if !self.systems.is_enabled("ui") { return Err("UI_SYSTEM_DISABLED".into()); }
        let ui = self.api.get::<Table>("ui").map_err(|e| e.to_string())?;
        let render = ui.get::<Function>("_materialize").map_err(|e| e.to_string())?;
        let request = bindings::value::json_to_lua(&self.lua, request).map_err(|e| e.to_string())?;
        render.call::<bool>(request).map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(feature = "dev-tools")]
    pub fn check(project_root: impl AsRef<Path>) -> EngineResult<CheckReport> {
        let (config, paths) = match ProjectPaths::discover(project_root) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let settings = match SystemSettings::from_config(&config) {
            Ok(settings) => settings,
            Err(error) => return EngineResult::failure(*error),
        };
        if let Err(error) = crate::runtime_packages::validate_runtime_packages(&config.runtime_packages, &settings) {
            return EngineResult::failure(*error);
        }
        let source = match fs::read_to_string(&paths.entry_script) {
            Ok(source) => source,
            Err(err) => {
                return EngineResult::failure(Diagnostic::error(
                    "SCRIPT_READ_FAILED",
                    "Unable to read entry script",
                    format!("{}: {}", paths.entry_script.display(), err),
                ));
            }
        };
        let lua = match determinism::new_vm() {
            Ok(lua) => lua,
            Err(error) => return EngineResult::failure(*error),
        };
        let value = match lua
            .load(&source)
            .set_name(paths.entry_script.to_string_lossy())
            .set_mode(mlua::ChunkMode::Text)
            .eval::<Value>()
        {
            Ok(value) => value,
            Err(err) => return EngineResult::failure(script_diagnostic(&paths, err.to_string())),
        };
        let table = match value {
            Value::Table(table) => table,
            _ => {
                return EngineResult::failure(Diagnostic::error(
                    "SCRIPT_ENTRY_INVALID",
                    "Entry script must return a Game table",
                    "The entry script must return a table containing start and update functions.",
                ));
            }
        };
        let mut entrypoints = Vec::new();
        for name in ["start", "update"] {
            match table.get::<Value>(name) {
                Ok(Value::Function(_)) => entrypoints.push(name.to_string()),
                Ok(_) => {
                    return EngineResult::failure(Diagnostic::error(
                        "SCRIPT_ENTRYPOINT_INVALID",
                        format!("Game.{name} is not a function"),
                        format!(
                            "The engine requires Game.{name}(api{}) to run the project.",
                            if name == "update" { ", dt" } else { "" }
                        ),
                    ));
                }
                Err(err) => {
                    return EngineResult::failure(script_diagnostic(&paths, err.to_string()));
                }
            }
        }
        let strict_mode = source
            .lines()
            .next()
            .map(|line| line.trim() == "--!strict")
            .unwrap_or(false);
        let mut result = EngineResult::success(CheckReport {
            project: config.name,
            script: paths.entry_script.display().to_string(),
            strict_mode,
            entrypoints,
            type_check: None,
        });
        for (path, text) in project_scripts(&paths, &source) {
            let shown = path.strip_prefix(&paths.root).unwrap_or(&path);
            if let Some(diagnostic) = crate::script_data::embedded_data_diagnostic(shown, &text) {
                result.ok = false;
                result.diagnostics.push(diagnostic);
            }
        }
        if !strict_mode {
            result.diagnostics.push(Diagnostic::warning(
                "STRICT_MODE_NOT_ENABLED",
                "Entry script does not enable strict mode",
                "Only Luau syntax and the Engine entrypoint contract are checked currently; add --!strict so type analysis can report problems earlier.",
            ));
        }
        result
    }

    #[cfg(feature = "dev-tools")]
    pub fn check_with_types(project_root: impl AsRef<Path>) -> EngineResult<CheckReport> {
        let mut result = Self::check(&project_root);
        if !result.ok {
            return result;
        }
        let (_, paths) = match ProjectPaths::discover(project_root) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        match run_luau_analyzer(&paths) {
            Ok(report) => {
                if let Some(check) = result.value.as_mut() {
                    check.type_check = Some(report);
                }
            }
            Err(diagnostic) => {
                result.ok = false;
                result.diagnostics.push(*diagnostic);
            }
        }
        result
    }

    #[cfg(feature = "dev-tools")]
    pub fn load(project_root: impl AsRef<Path>) -> Result<Self, Box<Diagnostic>> {
        Self::load_with_seed(project_root, 42)
    }

    #[cfg(feature = "dev-tools")]
    pub fn load_with_seed(
        project_root: impl AsRef<Path>,
        seed: u64,
    ) -> Result<Self, Box<Diagnostic>> {
        Self::load_with_seed_and_save(project_root, seed, None)
    }

    /// Load a project with a host-provided save payload already restored.
    ///
    /// The payload is visible to `api.save.get()` inside `Game.start`, so a game
    /// can rebuild its state before the first frame instead of detecting the
    /// restore on its first update.
    #[cfg(feature = "dev-tools")]
    pub fn load_with_seed_and_save(
        project_root: impl AsRef<Path>,
        seed: u64,
        restored_save: Option<serde_json::Value>,
    ) -> Result<Self, Box<Diagnostic>> {
        // Imported assets' files are brought up to date before anything reads them.
        let mut startup = crate::performance::StartupCost::default();
        timed_startup(&mut startup, StartupPhase::Imports, || crate::import::prepare_imports(project_root.as_ref()))?;
        let (config, paths, world, data_assets, catalog) = timed_startup(&mut startup, StartupPhase::Project, || {
            let (config, paths) = ProjectPaths::discover(project_root)?;
            let world = Rc::new(RefCell::new(World::default()));
            if let Some(scene) = &paths.main_scene {
                world.borrow_mut().load_scene(scene)?;
            }
            let (decls, data) = crate::data_assets::read_from_project(&paths)?;
            let data_assets = crate::data_assets::DataAssets::new(decls, data)?;
            let catalog = crate::sprite_resources::read_catalog(&paths)?;
            Ok::<_, Box<Diagnostic>>((config, paths, world, data_assets, catalog))
        })?;
        let mut runtime = Self::with_world(config, paths, world, None, None, seed, restored_save, None, None, data_assets, catalog)?;
        (runtime.startup.imports_ms, runtime.startup.project_ms) = (startup.imports_ms, startup.project_ms);
        Ok(runtime)
    }

    /// Create a runtime from host-provided source instead of a native filesystem.
    ///
    /// Browser hosts fetch the manifest, scene and Luau source themselves, then
    /// hand the bytes to this same engine runtime. This keeps storage, fetch and
    /// hot-update policy in the platform host while preserving one simulation
    /// contract across native and Web.
    pub fn load_source(
        project_name: impl Into<String>,
        script_name: impl Into<String>,
        source: impl Into<String>,
        scene: Option<SceneFile>,
    ) -> Result<Self, Box<Diagnostic>> {
        Self::load_source_with_seed(project_name, script_name, source, scene, 42)
    }

    pub fn load_source_with_seed(
        project_name: impl Into<String>,
        script_name: impl Into<String>,
        source: impl Into<String>,
        scene: Option<SceneFile>,
        seed: u64,
    ) -> Result<Self, Box<Diagnostic>> {
        Self::load_source_with_systems(
            project_name,
            script_name,
            source,
            scene,
            seed,
            BTreeMap::new(),
        )
    }

    /// Load an in-memory project that declares its own engine systems.
    ///
    /// Web and mobile hosts receive a project payload instead of a directory,
    /// so they need the same `systems` switches a file-backed project gets.
    /// Unknown or impossible switches fail here, exactly as they do on disk.
    pub fn load_source_with_systems(
        project_name: impl Into<String>,
        script_name: impl Into<String>,
        source: impl Into<String>,
        scene: Option<SceneFile>,
        seed: u64,
        systems: BTreeMap<String, bool>,
    ) -> Result<Self, Box<Diagnostic>> {
        Self::load_source_with_options(
            project_name,
            script_name,
            source,
            scene,
            seed,
            systems,
            None,
        )
    }

    /// Load a host-provided project with its systems and a restored save.
    #[allow(
        clippy::too_many_arguments,
        reason = "kept for existing callers; new declarations go on SourceProject"
    )]
    pub fn load_source_with_options(
        project_name: impl Into<String>,
        script_name: impl Into<String>,
        source: impl Into<String>,
        scene: Option<SceneFile>,
        seed: u64,
        systems: BTreeMap<String, bool>,
        restored_save: Option<serde_json::Value>,
    ) -> Result<Self, Box<Diagnostic>> {
        Self::load_source_project(SourceProject {
            config: ProjectConfig {
                name: project_name.into(),
                entry_script: script_name.into(),
                systems,
                ..ProjectConfig::default()
            },
            source: source.into(),
            scene,
            seed,
            restored_save,
            ..SourceProject::default()
        })
    }

    /// Load the canonical ProjectConfig and separately resolved source bytes.
    /// Host and disk loading reach the same with_world configuration path.
    pub fn load_source_project(project: SourceProject) -> Result<Self, Box<Diagnostic>> {
        let SourceProject {
            mut config,
            source,
            script_bytecode,
            job_sources,
            scene,
            seed,
            restored_save,
            viewport_aspect,
            viewport_size,
            data_assets,
            data,
            asset_catalog,
        } = project;
        let data_assets = crate::data_assets::DataAssets::new(data_assets, data)?;
        let script_name = if config.entry_script.is_empty() {
            "main.luau".to_string()
        } else {
            config.entry_script.clone()
        };
        config.entry_script = script_name.clone();
        let paths = ProjectPaths {
            root: PathBuf::from("<memory>"),
            config: PathBuf::from("<memory>/project.unone.json"),
            entry_script: PathBuf::from(script_name),
            main_scene: None,
            test_files: Vec::new(),
            bundle_manifest: None,
            asset_manifest: None,
        };
        let world = Rc::new(RefCell::new(World::default()));
        if let Some(scene) = scene {
            world.borrow_mut().load_scene_data(scene)?;
        }
        let viewport_aspect=if let Some([width,height])=viewport_size {
            world.borrow_mut().set_projected_viewport(width,height).map_err(|e|Box::new(Diagnostic::error("PROJECTED_VIEWPORT_INVALID","Invalid physical viewport",e)))?;
            Some(width as f64/height as f64)
        } else {viewport_aspect};
        Self::with_world(
            config,
            paths,
            world,
            Some(source),
            script_bytecode,
            seed,
            restored_save,
            viewport_aspect,
            Some(job_sources),
            data_assets,
            asset_catalog,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn with_world(
        config: ProjectConfig,
        paths: ProjectPaths,
        world: Rc<RefCell<World>>,
        script_source: Option<String>,
        script_bytecode: Option<Vec<u8>>,
        seed: u64,
        restored_save: Option<serde_json::Value>,
        initial_viewport_aspect: Option<f64>,
        job_sources: Option<BTreeMap<String, String>>,
        data_assets: crate::data_assets::DataAssets,
        asset_catalog: Vec<crate::AssetCatalogEntry>,
    ) -> Result<Self, Box<Diagnostic>> {
        let data_assets = Rc::new(RefCell::new(data_assets));
        let sprite_resources = Rc::new(RefCell::new(sprite_resources::Registry::new(asset_catalog)
            .map_err(|e| Box::new(script_diagnostic(&paths, e)))?));
        let host_time = Rc::new(RefCell::new(crate::host_time::HostTime::new(config.host_time.clone())
            .map_err(|e| Box::new(script_diagnostic(&paths, e)))?));
        let input = Rc::new(RefCell::new(InputState::default()));
        let random = Rc::new(RefCell::new(DeterministicRng::new(seed)));
        let trace = Rc::new(RefCell::new(Vec::new()));
        let observations = Rc::new(RefCell::new(BTreeMap::new()));
        let ui = Rc::new(RefCell::new(None));
        let viewport_aspect = Rc::new(RefCell::new(crate::ui::UI_REFERENCE_ASPECT));
        // A restored save has to exist before Game.start runs: start is the only
        // place a game can rebuild its state before the first frame, and an
        // injection after start would both hide the payload and silently
        // overwrite anything start saved.
        let save_payload = Rc::new(RefCell::new(SaveState::new(restored_save)));
        #[cfg(feature = "preview-tools")]
        let debug_tools = Rc::new(RefCell::new(preview::DebugTools::default()));
        let script_profile = Rc::new(RefCell::new(crate::performance::ScriptProfile::default()));
        let api_state = ApiState {
            sprite_resources: Rc::clone(&sprite_resources),
            host_time: Rc::clone(&host_time),
            spatial: Rc::new(RefCell::new(spatial::SpatialJobs::new())),
            #[cfg(feature = "ui")]
            runtime_packages: config.runtime_packages.clone(),
            #[cfg(feature = "jobs")]
            jobs: Rc::new(RefCell::new(jobs::Jobs::default())),
            #[cfg(feature = "preview-tools")]
            debug_tools: Rc::clone(&debug_tools),
            world: Rc::clone(&world),
            input: Rc::clone(&input),
            random: Rc::clone(&random),
            trace: Rc::clone(&trace),
            observations: Rc::clone(&observations),
            ui: Rc::clone(&ui),
            viewport_aspect: Rc::clone(&viewport_aspect),
            save_payload: Rc::clone(&save_payload),
            data_assets: Rc::clone(&data_assets),
            script_profile: Rc::clone(&script_profile),
            pure_view: Rc::new(std::cell::Cell::new(0)),
        };
        let systems = SystemSettings::from_config(&config)?;
        systems.validate_compiled()?;
        if let Some(pipeline) = &config.render_pipeline {
            pipeline.validate().map_err(|error| {
                Box::new(Diagnostic::error("RENDER_PIPELINE_INVALID", "Invalid render pipeline", error))
            })?;
            world.borrow_mut().render_pipeline = Some(pipeline.clone());
        }
        crate::runtime_packages::validate_runtime_packages(&config.runtime_packages, &systems)?;
        #[cfg(feature = "physics3d")]
        if world.borrow().physics3d.is_some() && !systems.is_enabled("physics3d") {
            return Err(Box::new(Diagnostic::error(
                "SYSTEM_DISABLED",
                "3D physics is declared but disabled",
                "Set systems.physics3d=true in project.unone.json.",
            )));
        }
        if let Some(audio) = &config.audio {
            // A declared rule this build does not act on is a configuration
            // error, not a no-op: a game that believes it configured ducking
            // and got silence has no way to find out.
            audio.validate().map_err(|explanation| {
                Box::new(Diagnostic::error(
                    "AUDIO_RULE_NOT_IMPLEMENTED",
                    "project.unone.json declares an audio rule not implemented by this build",
                    explanation,
                ))
            })?;
            world.borrow_mut().audio.config = audio.clone();
        }
        let lua = determinism::new_vm()?;
        let api = build_api(&lua, &api_state, &systems).map_err(|err| {
            Box::new(Diagnostic::error(
                "ENGINE_API_BIND_FAILED",
                "Unable to create the Luau Engine API",
                err.to_string(),
            ))
        })?;
        let placeholder = lua.create_function(|_, _: ()| Ok(())).map_err(|err| {
            Box::new(Diagnostic::error(
                "ENGINE_INIT_FAILED",
                "Unable to initialize the Luau runtime",
                err.to_string(),
            ))
        })?;
        let mut runtime = Self {
            sprite_resources,
            host_time,
            spatial: Rc::clone(&api_state.spatial),
            #[cfg(feature = "jobs")]
            jobs: Rc::clone(&api_state.jobs),
            #[cfg(feature = "preview-tools")]
            debug_tools,
            config,
            paths,
            systems,
            world,
            input,
            #[cfg(feature = "dev-tools")]
            random,
            lua,
            api,
            update_fn: placeholder,
            trace,
            observations,
            ui,
            viewport_aspect,
            save_payload,
            #[cfg(feature = "preview-tools")]
            data_assets,
            #[cfg(feature = "dev-tools")]
            generation: 0,
            #[cfg(feature = "dev-tools")]
            last_seen_script_stamp: None,
            script_source,
            script_bytecode,
            performance: PerformanceCollector::default(),
            performance_counts: FrameCounts::default(),
            script_profile,
            startup: crate::performance::StartupCost::default(),
            measure_serialization: false,
            #[cfg(feature = "dev-tools")]
            loaded_script_digest: String::new(),
        };
        if let Some(aspect) = initial_viewport_aspect {
            runtime.set_viewport_aspect(aspect)?;
        }
        if !runtime.config.job_scripts.is_empty() && !runtime.systems.is_enabled("jobs") {
            return Err(Box::new(script_diagnostic(
                &runtime.paths,
                "JOB_MODULES_REQUIRE_JOBS_SYSTEM".into(),
            )));
        }
        if let Some(sources) = &job_sources
            && sources.keys().ne(runtime.config.job_scripts.keys()) {
                return Err(Box::new(script_diagnostic(
                    &runtime.paths,
                    "JOB_MODULE_SOURCE_MISMATCH".into(),
                )));
        }
        #[cfg(feature = "jobs")]
        for (id, path) in &runtime.config.job_scripts {
            let invalid = || {
                Box::new(script_diagnostic(
                    &runtime.paths,
                    format!("JOB_MODULE_PATH_INVALID: {path}"),
                ))
            };
            if path.is_empty()
                || !path.ends_with(".luau")
                || path.contains('\\')
                || path.contains(':')
                || path
                    .split('/')
                    .any(|s| s.is_empty() || s == ".." || s == ".")
            {
                return Err(invalid());
            }
            let source = if let Some(sources) = &job_sources {
                sources[id].clone()
            } else {
                let root = runtime.paths.root.canonicalize().map_err(|_| invalid())?;
                let file = root.join(path).canonicalize().map_err(|_| invalid())?;
                if !file.starts_with(&root) {
                    return Err(invalid());
                }
                std::fs::read_to_string(file).map_err(|e| {
                    Box::new(script_diagnostic(
                        &runtime.paths,
                        format!("JOB_MODULE_READ_FAILED: {path}: {e}"),
                    ))
                })?
            };
            runtime
                .jobs
                .borrow_mut()
                .register_file(id.clone(), source, path.clone())
                .map_err(|e| Box::new(script_diagnostic(&runtime.paths, e)))?;
        }
        runtime.host_time.borrow_mut().begin("start", 0)
            .map_err(|e| Box::new(script_diagnostic(&runtime.paths, e)))?;
        runtime.load_script(false, None)?;
        runtime.host_time.borrow_mut().finish()
            .map_err(|e| Box::new(script_diagnostic(&runtime.paths, e)))?;
        runtime.spatial.borrow_mut().loaded();
        #[cfg(feature = "jobs")]
        runtime.jobs.borrow_mut().loaded();
        runtime.cache_performance_counts(&runtime.observe());
        Ok(runtime)
    }

    /// Tell the engine the shape of the viewport the host is drawing into.
    ///
    /// Anchored UI nodes resolve against this, so a host that never calls it
    /// gets the reference 16:9 layout, which is also what headless tests use.
    pub fn set_viewport_aspect(&mut self, aspect: f64) -> Result<(), Box<Diagnostic>> {
        if !aspect.is_finite() || aspect <= 0.0 {
            return Err(Box::new(Diagnostic::error(
                "VIEWPORT_ASPECT_INVALID",
                "viewport aspect must be a finite number greater than 0",
                format!("The host provided {aspect}; the engine will not infer UI layout from it."),
            )));
        }
        *self.viewport_aspect.borrow_mut() = aspect;
        Ok(())
    }

    /// Name this project reports itself as.
    pub fn project_name(&self) -> &str {
        &self.config.name
    }

    pub fn viewport_aspect(&self) -> f64 {
        *self.viewport_aspect.borrow()
    }

    /// Physical render-target pixels. Hosts report this before each resized frame.
    pub fn set_viewport_size(&mut self,width:u32,height:u32)->Result<(),Box<Diagnostic>> {
        self.world.borrow_mut().set_projected_viewport(width,height).map_err(|e|Box::new(Diagnostic::error("PROJECTED_VIEWPORT_INVALID","Invalid physical viewport",e)))?;
        self.set_viewport_aspect(width as f64/height as f64)
    }

    pub fn set_input(&mut self, action: impl Into<String>, is_down: bool) {
        self.input.borrow_mut().down.insert(action.into(), is_down);
    }

    pub fn set_pointer_position(&mut self, position: Vec2) {
        let mut input = self.input.borrow_mut();
        input.pointer.position = position;
        input.pointer.screen_position = position;
    }

    /// Set the host's normalized screen-space pointer without changing the
    /// world-space pointer. Native/Web hosts should use this when their
    /// viewport mapping can provide both coordinates.
    pub fn set_screen_pointer_position(&mut self, position: Vec2) {
        self.input.borrow_mut().pointer.screen_position = position;
    }

    pub fn set_pointer_down(&mut self, is_down: bool) {
        self.input.borrow_mut().pointer.down = is_down;
    }

    /// Provide an opaque, host-loaded save payload to the game script.
    ///
    /// The engine validates the transport as JSON but does not interpret the
    /// game schema. The game owns versioning and migration decisions.
    pub fn set_save_payload(&mut self, payload: Option<serde_json::Value>) {
        self.save_payload.borrow_mut().replace(payload);
    }

    pub fn save_payload(&self) -> Option<serde_json::Value> {
        self.save_payload.borrow().owned()
    }

    /// Immutable encoding of the current save for host publication. Repeated
    /// reads reuse one encoding; every accepted replacement invalidates it.
    /// The returned Rc holds no RefCell borrow and remains valid after writes.
    /// The ordinary owned getter and Lua save.get remain detached copies.
    pub fn serialized_save_payload(&self) -> Option<Rc<serde_json::value::RawValue>> {
        self.save_payload.borrow().encoded()
    }

    #[cfg(feature = "dev-tools")]
    pub fn reload(&mut self) -> Result<(), Box<Diagnostic>> {
        self.load_script(true, None)
    }

    /// Replace a host-provided script while keeping Rust-owned world state.
    ///
    /// A failed source keeps the previous update function active, matching
    /// filesystem hot reload behavior. The host can fix the source and retry.
    #[cfg(feature = "dev-tools")]
    pub fn reload_source(&mut self, source: impl Into<String>) -> Result<(), Box<Diagnostic>> {
        self.load_script(true, Some(source.into()))
    }

    /// Reload the entry script once its file metadata changes.
    ///
    /// The changed stamp is remembered before attempting the reload so an
    /// invalid file does not spam the preview every frame. A later file edit
    /// produces a new stamp and can be retried.
    #[cfg(feature = "dev-tools")]
    pub fn reload_if_changed(&mut self) -> Result<bool, Box<Diagnostic>> {
        let current = self.script_stamp()?;
        if self.last_seen_script_stamp.as_ref() == Some(&current) {
            return Ok(false);
        }
        self.last_seen_script_stamp = Some(current);
        self.reload()?;
        Ok(true)
    }

    pub fn run(&mut self, frames: u64, seed: u64) -> EngineResult<RunReport> {
        self.run_internal(frames, seed, None)
    }

    pub fn run_with_input_sequence(
        &mut self,
        frames: u64,
        seed: u64,
        input_sequence: &[InputFrame],
    ) -> EngineResult<RunReport> {
        self.run_internal(frames, seed, Some(input_sequence))
    }

    /// Apply one host-normalized input frame, advance the fixed-step runtime,
    /// and return the resulting observation.
    ///
    /// Native, Web, iOS and Android adapters should converge on this method
    /// instead of each maintaining a separate input-to-tick convention.
    pub fn tick_with_input(
        &mut self,
        frame: &InputFrame,
    ) -> Result<WorldSnapshot, Box<Diagnostic>> {
        frame.validate()?;
        {
            let mut input = self.input.borrow_mut();
            // Retryable host barriers must not discard an unconsumed semantic
            // event. Repeated frames are idempotent; conflicting replacements
            // are rejected before admitting any part of the new frame.
            let conflicts = frame.ui_sliders.iter().any(|(id, event)|
                input.pending_ui_sliders.get(id).is_some_and(|old| old != event))
                || frame.ui_text_inputs.iter().any(|(id, event)|
                    input.pending_ui_text_inputs.get(id).is_some_and(|old| old != event));
            let presentation_conflict = !input.pending_presentation.is_empty()
                && !frame.presentation_resources.is_empty()
                && input.pending_presentation != frame.presentation_resources;
            let slider_count = input.pending_ui_sliders.len() + frame.ui_sliders.keys()
                .filter(|id| !input.pending_ui_sliders.contains_key(*id)).count();
            let text_count = input.pending_ui_text_inputs.len() + frame.ui_text_inputs.keys()
                .filter(|id| !input.pending_ui_text_inputs.contains_key(*id)).count();
            if conflicts || presentation_conflict || slider_count > 256 || text_count > 64 {
                return Err(Box::new(Diagnostic::error(
                    "INPUT_UI_PENDING", "Semantic input is still pending",
                    "Complete the pending tick with tick() or an unchanged input frame before submitting replacement UI events; no part of this frame was admitted.",
                )));
            }
            input.physical.stage(frame.physical.clone()).map_err(|e|Box::new(Diagnostic::error("INPUT_PHYSICAL_INVALID","Physical input admission rejected",e)))?;
            input.down = frame.actions.clone();
            input.pending_ui_sliders.extend(frame.ui_sliders.clone());
            input.pending_ui_text_inputs.extend(frame.ui_text_inputs.clone());
            if !frame.presentation_resources.is_empty() { input.pending_presentation = frame.presentation_resources.clone(); }
        }
        if let Some(pointer) = &frame.pointer {
            let mut input = self.input.borrow_mut();
            input.pointer.position = pointer.position;
            input.pointer.screen_position = pointer.screen_position.unwrap_or(pointer.position);
            input.pointer.down = pointer.down;
        } else {
            self.input.borrow_mut().pointer.down = false;
        }
        self.tick().map_err(|mut diagnostic|{
            if frame.physical.is_some(){diagnostic.facts["physical_input"]=self.physical_input_report();}
            diagnostic
        })
    }

    fn run_internal(
        &mut self,
        frames: u64,
        seed: u64,
        input_sequence: Option<&[InputFrame]>,
    ) -> EngineResult<RunReport> {
        for frame_index in 0..frames {
            let tick = if let Some(input_sequence) = input_sequence {
                let default_frame;
                let frame = match input_sequence.get(frame_index as usize) {
                    Some(frame) => frame,
                    None => {
                        default_frame = InputFrame::default();
                        &default_frame
                    }
                };
                self.tick_with_input(frame)
            } else {
                self.tick()
            };
            if let Err(err) = tick {
                return EngineResult::failure(*err);
            }
        }
        let world = self.observe();
        let digest = match observation_digest(&world) {
            Ok(digest) => digest,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "OBSERVATION_SERIALIZATION_FAILED",
                    "Unable to serialize observation snapshot",
                    format!(
                        "WorldSnapshot could not be serialized, so the observation digest cannot be computed: {error}"
                    ),
                ));
            }
        };
        EngineResult::success(RunReport {
            jobs: self.jobs_report(),
            project: self.config.name.clone(),
            seed,
            status: "completed".to_string(),
            frames,
            observation_digest: digest,
            world,
            save_payload: self.save_payload(),
            trace: self.trace.borrow().clone(),
            performance: self.performance_report(),
        })
    }

    /// Time what a host pays to receive each observation.
    ///
    /// Opt-in canonical JSON serialization probe for CLI profiling. This adds
    /// work to the measured tick. It is not the Web bridge's presentation or
    /// decode cost; use its publication and host-window metrics for those.
    pub fn measure_serialization(&mut self, measure: bool) {
        self.measure_serialization = measure;
    }

    pub fn tick(&mut self) -> Result<WorldSnapshot, Box<Diagnostic>> {
        self.input.borrow().physical.healthy().map_err(|e|Box::new(Diagnostic::error("INPUT_PHYSICAL_TERMINAL","Physical input session faulted",e)))?;
        self.host_time.borrow().healthy().map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        let started = std::time::Instant::now();
        // External jobs may still be pending. Keep that preflight retryable
        // before activating the spatial update phase.
        #[cfg(feature = "jobs")]
        if self.systems.is_enabled("jobs") {
            self.jobs.borrow_mut().begin(self.world.borrow().frame)
                .map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        }
        self.spatial.borrow_mut().begin(self.world.borrow().frame)
            .map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        let host_time_tick = host_time::TimeScope::begin(&self.host_time, "tick", self.world.borrow().frame)
            .map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        // Input becomes accepted execution only after every retryable host
        // barrier has passed. A pending spatial/job result is not a failed
        // physical-input execution and must leave the staged batch intact.
        let input_tick = InputTick::begin(&self.input);
        let sprite_tick = sprite_resources::Tick::begin(&self.sprite_resources, &self.world,
            &self.input.borrow().pending_presentation)
            .map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        #[cfg(feature = "phase-profile")]
        let phase_tick = phase_profile::TickScope::begin(&self.lua, self.world.borrow().frame + 1);
        let spatial_fault = Rc::clone(&self.spatial);
        let spatial_paths = self.paths.clone();
        let fail_spatial = |message: String| {
            spatial_fault.borrow_mut().abort_tick(message.clone());
            Box::new(script_diagnostic(&spatial_paths, message))
        };
        let allocated_before = self.lua.used_memory();
        {
            let mut world = self.world.borrow_mut();
            world.ticking = true;
            let frame = world.frame;
            #[cfg(feature = "audio")]
            if self.systems.is_enabled("audio") {
                world.audio.begin_frame(frame);
            }
        }
        #[cfg(all(feature = "preview-tools", not(feature = "phase-profile")))]
        let vm_probe = if profiling::state(&self.lua).borrow().active {
            Some(
                // SAFETY: this scope ends immediately after update.call, before
                // removing/changing sampler callbacks, including on Lua errors.
                unsafe { vm_metrics::Probe::begin(&self.lua) }
                    .map_err(|err| fail_spatial(err.to_string()))?,
            )
        } else {
            None
        };
        let (script, script_time) = timed(|| {
            #[cfg(feature = "jobs")]
            if self.systems.is_enabled("jobs") {
                jobs::pump_schedules(&self.lua, &self.jobs, &self.api)
                    .map_err(|e| Box::new(script_diagnostic(&self.paths, e.to_string())))?;
            }
            self.update_fn
                .call::<()>((self.api.clone(), FIXED_DT))
                .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))
        });
        #[cfg(feature = "phase-profile")]
        if let Some(scope)=&phase_tick { scope.record(phase_profile::Phase::Script,script_time); }
        #[cfg(all(feature = "preview-tools", not(feature = "phase-profile")))]
        if let Some(probe) = vm_probe {
            let frame = probe.finish(self.world.borrow().frame + 1, script.is_ok());
            profiling::state(&self.lua).borrow_mut().record_vm(frame);
        }
        #[cfg(feature = "preview-tools")]
        if script.is_err() {
            self.lua.remove_interrupt();
            profiling::state(&self.lua).borrow_mut().active = false;
        }
        #[cfg(feature = "jobs")]
        if let Err(error) = &script {
            self.jobs.borrow_mut().fail(error.explanation.clone());
        }
        if let Err(error) = &script {
            self.spatial.borrow_mut().abort_tick(error.explanation.clone());
        }
        script?;
        let (physics_result, physics_time) = timed(|| -> Result<(), Box<Diagnostic>> {
            #[cfg(feature = "physics2d")]
            if self.systems.is_enabled("physics2d") {
                self.world.borrow_mut().step_physics(FIXED_DT);
            }
            #[cfg(feature = "physics3d")]
            if self.systems.is_enabled("physics3d") {
                let mut world = self.world.borrow_mut();
                let world = &mut *world;
                if let Some(physics) = &mut world.physics3d {
                    physics
                        .step(FIXED_DT, &mut world.entities)
                        .map_err(|message| {
                            Box::new(Diagnostic::error(
                                "PHYSICS3D_STATE_INVALID",
                                "3D simulation exceeded its numeric bounds",
                                message,
                            ))
                        })?;
                }
            }
            Ok(())
        });
        #[cfg(feature = "phase-profile")]
        if let Some(scope)=&phase_tick { scope.record(phase_profile::Phase::Physics,physics_time); }
        #[cfg(feature = "jobs")]
        if let Err(error) = &physics_result {
            self.jobs.borrow_mut().fail(error.explanation.clone());
        }
        if let Err(error) = &physics_result {
            self.spatial.borrow_mut().abort_tick(error.explanation.clone());
        }
        physics_result?;
        #[cfg(feature = "jobs")]
        if self.systems.is_enabled("jobs") {
            self.jobs
                .borrow_mut()
                .finish()
                .map_err(&fail_spatial)?;
        }
        let spatial_result = self.spatial.borrow_mut().finish();
        if let Err(error) = spatial_result {
            #[cfg(feature = "jobs")]
            self.jobs.borrow_mut().fail(error.clone());
            // finish already retired work and retained its detailed terminal
            // diagnostic. Do not overwrite it with a generic host failure.
            return Err(Box::new(script_diagnostic(&self.paths, error)));
        }
        {
            let mut world = self.world.borrow_mut();
            // Before the frame advances, so an attached source is observed at
            // the position its entity actually holds this frame.
            #[cfg(feature = "audio")]
            if self.systems.is_enabled("audio") {
                world.follow_audio_entities();
            }
            world.frame += 1;
            world.ticking = false;
            world.time_seconds = world.frame as f64 / 60.0;
        }
        {
            let mut world = self.world.borrow_mut();
            let frame = world.frame;
            #[cfg(feature = "audio")]
            if self.systems.is_enabled("audio") {
                world.audio.end_frame(frame);
            }
            #[cfg(feature = "particle")]
            if self.systems.is_enabled("particle") {
                world.particles.advance(frame);
            }
        }
        let (mut snapshot, observe_time) = timed(|| self.observe());
        #[cfg(feature = "phase-profile")]
        if let Some(scope)=&phase_tick { scope.record(phase_profile::Phase::Observe,observe_time); }
        self.cache_performance_counts(&snapshot);
        #[cfg(feature = "preview-tools")]
        let record = {
            let p = profiling::state(&self.lua);
            let mut p = p.borrow_mut();
            if p.active {
                p.last_frame = snapshot.frame;
            }
            p.id == 0 || p.active
        };
        #[cfg(not(feature = "preview-tools"))]
        let record = true;
        if record {
            // Freeze heap and serialization counters with the same frame window.
            self.performance
                .record_heap_delta(self.lua.used_memory().saturating_sub(allocated_before));
            if self.measure_serialization {
                let (bytes, serialize_time) = timed(|| {
                    serde_json::to_vec(&snapshot)
                        .map(|bytes| bytes.len())
                        .unwrap_or(0)
                });
                self.performance.record_serialization(serialize_time, bytes);
            }

            self.script_profile.borrow_mut().end_frame();
            self.performance.record(
                snapshot.frame,
                FrameTiming {
                    script: script_time,
                    physics: physics_time,
                    observe: observe_time,
                    total: started.elapsed(),
                },
            );
        }
        host_time_tick.commit().map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        input_tick.commit();
        sprite_tick.commit();
        snapshot.physical_input_receipt=self.input.borrow().physical.receipt.clone();
        #[cfg(feature = "phase-profile")]
        if let Some(scope)=phase_tick { scope.complete(); }
        Ok(snapshot)
    }

    fn cache_performance_counts(&mut self, snapshot: &WorldSnapshot) {
        let instances: usize = snapshot.instances3d.values().map(|b| b.count).sum();
        self.performance_counts = FrameCounts {
            entities: snapshot.entities.len(),
            rigidbodies: snapshot
                .entities
                .values()
                .filter(|e| e.rigidbody.is_some())
                .count()
                + snapshot.physics3d.as_ref().map_or(0, |p| p.bodies.len()),
            ui_nodes: snapshot.ui.as_ref().map_or(0, |t| t.children.len()),
            effects: snapshot.effects.len(),
            particles: snapshot.particles.len(),
            observations: snapshot.observations.len(),
            instances,
            instance_bytes: instances * 40,
        };
    }
    /// Cached counters: profiling must not clone/serialize the full scene.
    fn performance_report(&self) -> PerformanceReport {
        let mut report = self.performance.report(
            self.performance_counts,
            self.lua.used_memory(),
            std::time::Duration::from_secs_f64(FIXED_DT),
        );
        report.startup = Some(self.startup);
        self.script_profile.borrow().apply(&mut report);
        report
    }

    #[cfg(feature = "dev-tools")]
    pub fn run_tests(project_root: impl AsRef<Path>) -> EngineResult<TestSuiteReport> {
        let (config, paths) = match ProjectPaths::discover(project_root) {
            Ok(value) => value,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        if let Err(diagnostic) = Self::require_replayable_host_time(&config) {
            return EngineResult::failure(*diagnostic);
        }
        if paths.test_files.is_empty() {
            return EngineResult::failure(Diagnostic::error(
                "TESTS_NOT_CONFIGURED",
                "The project has no test files configured",
                "Add .test.json files to the test_files array in project.unone.json.",
            ));
        }
        let mut cases = Vec::new();
        for test_path in paths.test_files {
            let text = match fs::read_to_string(&test_path) {
                Ok(text) => text,
                Err(err) => {
                    return EngineResult::failure(Diagnostic::error(
                        "TEST_READ_FAILED",
                        "Unable to read test file",
                        format!("{}: {}", test_path.display(), err),
                    ));
                }
            };
            let spec: TestSpec = match serde_json::from_str(&text) {
                Ok(spec) => spec,
                Err(err) => {
                    return EngineResult::failure(Diagnostic::error(
                        "TEST_INVALID",
                        "Test file is not valid JSON",
                        format!("{}: {}", test_path.display(), err),
                    ));
                }
            };
            for (index, assertion) in spec.assertions.iter().enumerate() {
                if let Err(error) = assertion.validate() {
                    return EngineResult::failure(Diagnostic::error(
                        "TEST_ASSERTION_INVALID",
                        "Test assertion does not satisfy the single-target contract",
                        format!(
                            "{} assertions[{index}]: {error}. Fix it according to test.schema.json in the package.",
                            test_path.display()
                        ),
                    ));
                }
            }
            let mut runtime =
                match Self::load_with_seed_and_save(&paths.root, spec.seed, spec.load_save.clone())
                {
                    Ok(runtime) => runtime,
                    Err(diagnostic) => return EngineResult::failure(*diagnostic),
                };
            for (action, is_down) in &spec.input {
                runtime.set_input(action.clone(), *is_down);
            }
            let run = if spec.input_sequence.is_empty() {
                runtime.run(spec.frames, spec.seed)
            } else {
                runtime.run_with_input_sequence(spec.frames, spec.seed, &spec.input_sequence)
            };
            let report = match run.value {
                Some(report) => report,
                None => {
                    return EngineResult::failure(
                        run.diagnostics.into_iter().next().unwrap_or_else(|| {
                            Diagnostic::error(
                                "TEST_RUN_FAILED",
                                "Test execution failed",
                                "The test runtime produced no result.",
                            )
                        }),
                    );
                }
            };
            let mut failures = Vec::new();
            if let Err(error) = runtime.host_time_replay_complete() {
                failures.push(error);
            }
            for assertion in &spec.assertions {
                match evaluate_assertion(&report.world, assertion) {
                    Ok(()) => {}
                    Err(failure) => failures.push(failure),
                }
            }
            cases.push(TestCaseReport {
                name: spec.name,
                passed: failures.is_empty(),
                frames: report.frames,
                observation_digest: Some(report.observation_digest),
                save_payload: report.save_payload,
                failures,
            });
        }
        let passed = cases.iter().all(|case| case.passed);
        EngineResult::success(TestSuiteReport {
            project: config.name,
            passed,
            cases,
        })
    }

    pub fn observe(&self) -> WorldSnapshot {
        #[cfg(feature = "phase-profile")]
        let mut snapshot = phase_profile::measure(&self.lua,phase_profile::Phase::WorldSnapshot,||self.world.borrow().snapshot());
        #[cfg(not(feature = "phase-profile"))]
        let mut snapshot = self.world.borrow().snapshot();
        let host_state=|| {
            snapshot.physical_input_receipt=self.input.borrow().physical.receipt.clone();
            snapshot.spatial = self.spatial.borrow().snapshot();
            #[cfg(feature = "jobs")]
            if self.systems.is_enabled("jobs") {
                snapshot.jobs = Some(self.jobs.borrow().snapshot());
            }
        };
        #[cfg(feature = "phase-profile")]
        phase_profile::measure(&self.lua,phase_profile::Phase::ObserveHostState,host_state);
        #[cfg(not(feature = "phase-profile"))]
        { let mut host_state=host_state;host_state(); }
        #[cfg(feature = "phase-profile")]
        { snapshot.observations = phase_profile::measure(&self.lua,phase_profile::Phase::ObservationsClone,||self.observations.borrow().clone());
          snapshot.ui = phase_profile::measure(&self.lua,phase_profile::Phase::UiClone,||self.ui.borrow().clone()); }
        #[cfg(not(feature = "phase-profile"))]
        {
        snapshot.observations = self.observations.borrow().clone();
        snapshot.ui = self.ui.borrow().clone();
        }
        snapshot
    }

    pub fn physical_input_report(&self)->serde_json::Value {self.input.borrow().physical.report()}

    /// Return only the semantic observations used by host-side agents.
    ///
    /// Unlike `observe`, this avoids cloning the complete world snapshot
    /// (entities, particles, UI, and jobs) for frequent polling requests.
    pub fn semantic_observations(&self) -> BTreeMap<String, serde_json::Value> {
        self.observations.borrow().clone()
    }

    /// Current simulation frame without constructing a world snapshot.
    pub fn current_frame(&self) -> u64 {
        self.world.borrow().frame
    }

    /// Host-owned executor selection. Configure before the first simulation tick.
    pub fn set_spatial_executor(&mut self, executor: Box<dyn crate::spatial::SpatialExecutor>) -> Result<(), String> {
        self.spatial.borrow_mut().set_executor(executor)
    }

    /// The asynchronous host executes drained tasks before the following tick.
    pub fn set_spatial_external_backend(&mut self, name: String) -> Result<(), String> {
        self.spatial.borrow_mut().set_external_backend(name)
    }

    pub fn drain_spatial_tasks(&mut self) -> Vec<SpatialTask> {
        self.spatial.borrow_mut().drain_tasks()
    }

    pub fn complete_spatial_task(&mut self, id: u64, result: crate::spatial::SpatialBatchResult) -> Result<(), String> {
        self.spatial.borrow_mut().complete(id, result)
    }

    /// Optional host diagnostics accompany completion without changing the
    /// result, ticket lifecycle, or canonical state. Older hosts may omit them.
    pub fn complete_spatial_task_with_profile(&mut self, id: u64, result: crate::spatial::SpatialBatchResult, profile: Option<crate::spatial::SpatialExecutionProfile>) -> Result<(), String> {
        self.spatial.borrow_mut().complete_with_profile(id, result, profile)
    }

    pub fn spatial_profile(&self) -> serde_json::Value {
        self.spatial.borrow().profile()
    }

    /// The latest detached diagnostic remains readable after a failed tick.
    pub fn spatial_diagnostic(&self) -> Option<crate::diagnostics::EngineDiagnostic> {
        self.spatial.borrow().last_diagnostic()
    }

    pub fn spatial_report(&self) -> serde_json::Value {
        self.spatial.borrow().info()
    }

    pub fn fail_spatial(&mut self, message: String) {
        self.spatial.borrow_mut().fail(message);
    }

    /// UJB1 host transport; opaque payloads never pass through JSON values.
    pub fn jobs_binary_request(&mut self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        #[cfg(feature = "jobs")]
        if self.systems.is_enabled("jobs") {
            return self.jobs.borrow_mut().binary(bytes);
        }
        let _ = bytes;
        Err("JOBS_SYSTEM_DISABLED".into())
    }
    pub fn execute_job_binary(bytes: &[u8]) -> Result<Vec<u8>, String> {
        #[cfg(feature = "jobs")]
        {
            jobs::execute_binary(bytes)
        }
        #[cfg(not(feature = "jobs"))]
        {
            let _ = bytes;
            Err("JOBS_SYSTEM_NOT_COMPILED".into())
        }
    }

    /// Host-only executor transport. Never exposed to game Lua.
    pub fn jobs_host_request(
        &mut self,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        #[cfg(feature = "jobs")]
        if self.systems.is_enabled("jobs") {
            return self.jobs.borrow_mut().host(request);
        }
        let _ = request;
        Err("JOBS_SYSTEM_DISABLED".into())
    }
    pub fn execute_job_host(request: serde_json::Value) -> Result<serde_json::Value, String> {
        #[cfg(feature = "jobs")]
        {
            jobs::execute_host(request)
        }
        #[cfg(not(feature = "jobs"))]
        {
            let _ = request;
            Err("JOBS_SYSTEM_NOT_COMPILED".into())
        }
    }

    /// Diagnostic-only executor capabilities and costs; never available to gameplay.
    pub fn jobs_report(&self) -> Option<serde_json::Value> {
        #[cfg(feature = "jobs")]
        if self.systems.is_enabled("jobs") {
            return Some(self.jobs.borrow().report());
        }
        None
    }

    #[cfg(feature = "dev-tools")]
    pub(crate) fn developer_generation(&self) -> u64 {
        self.generation
    }

    #[cfg(feature = "dev-tools")]
    pub(crate) fn developer_script_digest(&self) -> &str {
        &self.loaded_script_digest
    }

    #[cfg(feature = "dev-tools")]
    pub(crate) fn take_developer_trace(&mut self) -> Vec<serde_json::Value> {
        std::mem::take(&mut *self.trace.borrow_mut())
            .into_iter()
            .map(|event| serde_json::to_value(event).expect("trace serializes"))
            .collect()
    }

    #[cfg(feature = "dev-tools")]
    pub(crate) fn developer_performance(&self) -> PerformanceReport {
        self.performance_report()
    }

    /// Validate an entire developer batch on candidate Rust state, then publish once.
    /// No Lua callback runs here. The caller serializes this between simulation ticks.
    #[cfg(feature = "dev-tools")]
    pub(crate) fn enact_developer(
        &mut self,
        operations: &[crate::developer::EnactOperation],
        dry_run: bool,
    ) -> Result<(WorldSnapshot, Vec<serde_json::Value>), Box<Diagnostic>> {
        let mut world = self.world.borrow().clone();
        let mut ui = self.ui.borrow().clone();
        let results =
            crate::developer::apply_operations(&mut world, &mut ui, &self.systems, operations)?;
        world.follow_audio_entities();
        let mut snapshot = world.snapshot();
        snapshot.observations = self.observations.borrow().clone();
        snapshot.ui = ui.clone();
        if !dry_run {
            *self.world.borrow_mut() = world;
            *self.ui.borrow_mut() = ui;
        }
        Ok((snapshot, results))
    }

    #[cfg(not(feature = "dev-tools"))]
    fn load_script(
        &mut self,
        _is_reload: bool,
        _source_override: Option<String>,
    ) -> Result<(), Box<Diagnostic>> {
        // A player loads its script once and never reloads it, so it keeps
        // neither the source text nor the bytecode after loading.
        let table = if let Some(bytecode) = self.script_bytecode.take() {
            self.script_source = None;
            timed_startup(&mut self.startup, StartupPhase::Script, || evaluate_chunk(&self.lua, &self.paths, &bytecode, mlua::ChunkMode::Binary))?
        } else {
            let source = self.script_source.take().ok_or_else(|| {
                Box::new(Diagnostic::error(
                    "PLAYER_SOURCE_REQUIRED",
                    "Player requires packaged source",
                    "Filesystem loading and hot reload are developer-only.",
                ))
            })?;
            timed_startup(&mut self.startup, StartupPhase::Script, || evaluate_script(&self.lua, &self.paths, &source))?
        };
        let update_fn = script_entrypoint(&table, "update", &self.paths)?;
        let start_fn = script_entrypoint(&table, "start", &self.paths)?;
        timed_startup(&mut self.startup, StartupPhase::Start, || start_fn.call::<()>(self.api.clone()))
            .map_err(|error| Box::new(script_diagnostic(&self.paths, error.to_string())))?;
        self.startup.luau_heap_after_start_bytes = self.lua.used_memory();
        self.update_fn = update_fn;
        Ok(())
    }

    #[cfg(feature = "dev-tools")]
    fn load_script(
        &mut self,
        is_reload: bool,
        source_override: Option<String>,
    ) -> Result<(), Box<Diagnostic>> {
        if self.script_bytecode.is_some() {
            return Err(Box::new(Diagnostic::error("SCRIPT_BYTECODE_UNSUPPORTED", "Developer players load script source",
                "Hot reload and script digests need the source; export a production player to load bytecode.")));
        }
        let script_stamp = self.script_stamp()?;
        let source = match source_override.as_deref() {
            Some(source) => source.to_string(),
            None => match &self.script_source {
                Some(source) => source.clone(),
                None => fs::read_to_string(&self.paths.entry_script).map_err(|err| {
                    Box::new(Diagnostic::error(
                        "SCRIPT_READ_FAILED",
                        "Unable to read entry script",
                        format!("{}: {}", self.paths.entry_script.display(), err),
                    ))
                })?,
            },
        };
        if !is_reload {
            let table = timed_startup(&mut self.startup, StartupPhase::Script, || evaluate_script(&self.lua, &self.paths, &source))?;
            // Optional developer metadata must not invoke gameplay metatables or
            // break existing games that already use a non-table `replay` field.
            if let Ok(Value::Table(adapter)) = table.raw_get::<Value>("replay") {
                self.lua.set_named_registry_value("unone.replay.adapter", adapter).map_err(|e| Box::new(script_diagnostic(&self.paths, e.to_string())))?;
            }
            let update_fn = script_entrypoint(&table, "update", &self.paths)?;
            let start_fn = script_entrypoint(&table, "start", &self.paths)?;
            timed_startup(&mut self.startup, StartupPhase::Start, || start_fn.call::<()>(self.api.clone()))
                .map_err(|err| Box::new(script_diagnostic(&self.paths, err.to_string())))?;
            self.startup.luau_heap_after_start_bytes = self.lua.used_memory();
            self.update_fn = update_fn;
            self.loaded_script_digest = format!("sha256:{}", hex_digest(source.as_bytes()));
            if let Some(source) = source_override {
                self.script_source = Some(source);
            }
            self.last_seen_script_stamp = Some(script_stamp);
            return Ok(());
        }

        // A candidate gets its own Lua state so top-level evaluation cannot
        // mutate the live script state before the candidate is accepted.
        self.host_time.borrow().healthy().map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        self.input.borrow().physical.healthy().map_err(|e|Box::new(script_diagnostic(&self.paths,e)))?;
        let candidate_lua = determinism::new_vm()?;
        let table = evaluate_script(&candidate_lua, &self.paths, &source)?;
        // The adapter belongs to the candidate VM just like its update
        // function. Publish the new registry only with a successful reload.
        if let Ok(Value::Table(adapter)) = table.raw_get::<Value>("replay") {
            candidate_lua.set_named_registry_value("unone.replay.adapter", adapter).map_err(|e| Box::new(script_diagnostic(&self.paths, e.to_string())))?;
        }
        let update_fn = script_entrypoint(&table, "update", &self.paths)?;
        let _start_fn = script_entrypoint(&table, "start", &self.paths)?;
        let on_reload = table.get::<Function>("onReload").ok();
        let has_on_reload = on_reload.is_some();
        let rollback = self.capture_reload_state();

        // onReload is allowed to update the world. Run it against a complete
        // private clone so every world-owned subsystem, including audio and
        // effect handles, is discarded together if the candidate fails. The
        // old Rc cell remains the live cell until commit.
        let candidate_world = if on_reload.is_some() {
            Rc::new(RefCell::new(self.world.borrow().clone()))
        } else {
            Rc::clone(&self.world)
        };
        let candidate_api_state = ApiState {
            sprite_resources: Rc::new(RefCell::new(self.sprite_resources.borrow().clone())),
            host_time: Rc::new(RefCell::new(self.host_time.borrow().clone())),
            spatial: Rc::new(RefCell::new(self.spatial.borrow().reload_candidate())),
            #[cfg(feature = "ui")]
            runtime_packages: self.config.runtime_packages.clone(),
            #[cfg(feature = "jobs")]
            jobs: Rc::new(RefCell::new(self.jobs.borrow().reload_candidate())),
            debug_tools: Rc::new(RefCell::new(preview::DebugTools::with_revision(
                self.debug_tools.borrow().revision + 1,
            ))),
            world: Rc::clone(&candidate_world),
            input: Rc::clone(&self.input),
            random: Rc::clone(&self.random),
            trace: Rc::clone(&self.trace),
            observations: Rc::clone(&self.observations),
            ui: Rc::clone(&self.ui),
            viewport_aspect: Rc::clone(&self.viewport_aspect),
            save_payload: Rc::clone(&self.save_payload),
            data_assets: Rc::clone(&self.data_assets),
            script_profile: Rc::clone(&self.script_profile),
            pure_view: Rc::new(std::cell::Cell::new(0)),
        };
        let candidate_api = match build_api(&candidate_lua, &candidate_api_state, &self.systems) {
            Ok(api) => api,
            Err(err) => {
                self.restore_failed_reload(rollback);
                return Err(Box::new(Diagnostic::error(
                    "ENGINE_API_BIND_FAILED",
                    "Unable to create the Luau Engine API",
                    err.to_string(),
                )));
            }
        };
        let candidate_time = host_time::TimeScope::begin(&candidate_api_state.host_time, "reload", self.world.borrow().frame)
            .map_err(|e| Box::new(script_diagnostic(&self.paths, e)))?;
        if let Some(on_reload) = on_reload
            && let Err(err) = on_reload.call::<()>(candidate_api.clone())
        {
            self.restore_failed_reload(rollback);
            return Err(Box::new(script_diagnostic(&self.paths, err.to_string())));
        }

        if let Err(error) = candidate_time.commit() {
            self.restore_failed_reload(rollback);
            return Err(Box::new(script_diagnostic(&self.paths, error)));
        }

        if has_on_reload {
            self.world = candidate_world;
        }
        self.spatial = Rc::clone(&candidate_api_state.spatial);
        self.sprite_resources = Rc::clone(&candidate_api_state.sprite_resources);
        self.host_time = Rc::clone(&candidate_api_state.host_time);
        self.spatial.borrow_mut().loaded();
        #[cfg(feature = "jobs")]
        {
            candidate_api_state.jobs.borrow_mut().loaded();
            self.jobs = Rc::clone(&candidate_api_state.jobs);
        }
        self.generation += 1;
        self.trace.borrow_mut().push(TraceEvent {
            frame: self.world.borrow().frame,
            event: "script_reloaded".to_string(),
            details: serde_json::json!({"generation": self.generation, "state_policy": "rust_owned_state_preserved"}),
        });
        self.debug_tools = Rc::clone(&candidate_api_state.debug_tools);
        self.lua = candidate_lua;
        self.api = candidate_api;
        self.update_fn = update_fn;
        self.loaded_script_digest = format!("sha256:{}", hex_digest(source.as_bytes()));
        if let Some(source) = source_override {
            self.script_source = Some(source);
        }
        self.last_seen_script_stamp = Some(script_stamp);
        Ok(())
    }

    #[cfg(feature = "dev-tools")]
    fn capture_reload_state(&self) -> ReloadRollbackState {
        ReloadRollbackState {
            input: self.input.borrow().clone(),
            random: self.random.borrow().clone(),
            trace: self.trace.borrow().clone(),
            observations: self.observations.borrow().clone(),
            ui: self.ui.borrow().clone(),
            viewport_aspect: *self.viewport_aspect.borrow(),
            save_payload: self.save_payload.borrow().clone(),
            generation: self.generation,
            last_seen_script_stamp: self.last_seen_script_stamp.clone(),
            script_source: self.script_source.clone(),
        }
    }

    #[cfg(feature = "dev-tools")]
    fn restore_failed_reload(&mut self, state: ReloadRollbackState) {
        *self.input.borrow_mut() = state.input;
        *self.random.borrow_mut() = state.random;
        *self.trace.borrow_mut() = state.trace;
        *self.observations.borrow_mut() = state.observations;
        *self.ui.borrow_mut() = state.ui;
        *self.viewport_aspect.borrow_mut() = state.viewport_aspect;
        *self.save_payload.borrow_mut() = state.save_payload;
        self.generation = state.generation;
        self.last_seen_script_stamp = state.last_seen_script_stamp;
        self.script_source = state.script_source;
    }

    #[cfg(feature = "dev-tools")]
    fn script_stamp(&self) -> Result<ScriptStamp, Box<Diagnostic>> {
        if self.script_source.is_some() {
            return Ok(ScriptStamp {
                modified: SystemTime::UNIX_EPOCH,
                size: 0,
            });
        }
        let metadata = fs::metadata(&self.paths.entry_script).map_err(|err| {
            Box::new(Diagnostic::error(
                "SCRIPT_METADATA_FAILED",
                "Unable to get entry script metadata",
                format!("{}: {}", self.paths.entry_script.display(), err),
            ))
        })?;
        let modified = metadata.modified().map_err(|err| {
            Box::new(Diagnostic::error(
                "SCRIPT_METADATA_FAILED",
                "Unable to get entry script modification time",
                format!("{}: {}", self.paths.entry_script.display(), err),
            ))
        })?;
        Ok(ScriptStamp {
            modified,
            size: metadata.len(),
        })
    }
}

fn evaluate_script(
    lua: &Lua,
    paths: &ProjectPaths,
    source: &str,
) -> Result<Table, Box<Diagnostic>> {
    evaluate_chunk(lua, paths, source.as_bytes(), mlua::ChunkMode::Text)
}

// The mode is always explicit: auto-detection treats any source whose first
// byte is below '\n' (a leading tab, for one) as unchecked bytecode.
fn evaluate_chunk(
    lua: &Lua,
    paths: &ProjectPaths,
    chunk: &[u8],
    mode: mlua::ChunkMode,
) -> Result<Table, Box<Diagnostic>> {
    let value = lua
        .load(chunk)
        .set_name(paths.entry_script.to_string_lossy())
        .set_mode(mode)
        .eval::<Value>()
        .map_err(|err| Box::new(script_diagnostic(paths, err.to_string())))?;
    match value {
        Value::Table(table) => {
            reject_misspelled_hooks(&table)?;
            Ok(table)
        }
        _ => Err(Box::new(Diagnostic::error(
            "SCRIPT_ENTRY_INVALID",
            "Entry script must return a Game table",
            "The entry script must return a table containing start and update functions.",
        ))),
    }
}

/// Optional hooks are looked up by exact name, so `Game.onreload` or
/// `Game.on_reload` would never run and never fail. Other helper keys on the
/// Game table remain allowed.
fn reject_misspelled_hooks(table: &Table) -> Result<(), Box<Diagnostic>> {
    const HOOKS: [&str; 4] = ["start", "update", "onReload", "replay"];
    for pair in table.pairs::<Value, Value>() {
        let Ok((Value::String(key), _)) = pair else { continue };
        let Ok(key) = key.to_str() else { continue };
        let normalized: String = key.chars().filter(|c| *c != '_').flat_map(char::to_lowercase).collect();
        if let Some(hook) = HOOKS.iter().find(|hook| hook.to_lowercase() == normalized)
            && *hook != &*key
        {
            return Err(Box::new(Diagnostic::error(
                "GAME_HOOK_MISSPELLED",
                "Game table declares a misspelled engine hook",
                format!("Game.{} is never called; the engine hook is Game.{hook}.", &*key),
            )));
        }
    }
    Ok(())
}

fn script_entrypoint(
    table: &Table,
    name: &str,
    paths: &ProjectPaths,
) -> Result<Function, Box<Diagnostic>> {
    table
        .get::<Function>(name)
        .map_err(|err| Box::new(script_diagnostic(paths, err.to_string())))
}

/// Strip Windows' extended-length prefix before handing a path to another tool.
///
/// `fs::canonicalize` returns `\\\\?\\D:\\...` on Windows, and luau-analyze cannot
/// open that form. Measured against the same file carrying a deliberate type
/// error, the plain path exits 1 and reports the TypeError while the prefixed
/// path exits 0 and says nothing. Since exit 0 means "nothing found", the whole
/// type gate silently passed for every project.
#[cfg(feature = "dev-tools")]
fn analyzer_argument(path: &Path) -> String {
    let text = path.display().to_string();
    if let Some(rest) = text.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{rest}");
    }
    text.strip_prefix("\\\\?\\")
        .map(str::to_string)
        .unwrap_or(text)
}

#[cfg(feature = "dev-tools")]
fn run_luau_analyzer(paths: &ProjectPaths) -> Result<TypeCheckReport, Box<Diagnostic>> {
    run_luau_analyzer_with(&analyzer_path(), &paths.entry_script)
}

/// The analyzer call itself, with the tool and script named explicitly so a test
/// can prove the gate still rejects a bad script.
#[cfg(feature = "dev-tools")]
fn run_luau_analyzer_with(
    analyzer: &Path,
    entry_script: &Path,
) -> Result<TypeCheckReport, Box<Diagnostic>> {
    let script_argument = analyzer_argument(entry_script);
    let output = Command::new(analyzer)
        .arg("--formatter=gnu")
        .arg(&script_argument)
        .output()
        .map_err(|err| {
            let mut diagnostic = Diagnostic::error(
                "LUAU_ANALYZER_NOT_FOUND",
                "Luau static analyzer not found",
                "`game check --types` requires the official luau-analyze; the runtime embeds only the Luau interpreter and does not pretend to run full type analysis.",
            );
            diagnostic.facts = serde_json::json!({
                "requested_tool": analyzer.display().to_string(),
                "error": err.to_string(),
                "override_environment": "UNONE_LUAU_ANALYZER",
            });
            diagnostic.suggested_actions = vec![
                ActionSuggestion {
                    action: "install_luau_analyzer".to_string(),
                    description: "Fetch the pinned official analyzer into .toolcache. Run it from the engine repository root; it verifies the download against a recorded hash.".to_string(),
                    command: Some(
                        "powershell -File scripts/install-luau-analyze.ps1".to_string(),
                    ),
                },
                ActionSuggestion {
                    action: "use_existing_luau_analyzer".to_string(),
                    description: "Or point the engine at an analyzer you already have.".to_string(),
                    command: Some(
                        "$env:UNONE_LUAU_ANALYZER = 'D:/tools/luau-analyze.exe'".to_string(),
                    ),
                },
            ];
            Box::new(diagnostic)
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = [stdout, stderr]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let tool = analyzer.display().to_string();
    let files = vec![script_argument.clone()];
    classify_analyzer_result(
        output.status.success(),
        output.status.code(),
        combined,
        tool,
        files,
    )
}

/// Decide what a finished analyzer run means.
///
/// The exit code alone cannot say this. `--formatter=gnu` exists so that a real
/// type error is reported as text, so a run that failed while saying nothing did
/// not find a type error — it did not get far enough to look. Reporting that as
/// a type error sends the author to rewrite a script that is fine, which is what
/// an analyzer killed by an antivirus scan or a file lock looks like from here.
#[cfg(feature = "dev-tools")]
fn classify_analyzer_result(
    success: bool,
    exit_code: Option<i32>,
    output: String,
    tool: String,
    files: Vec<String>,
) -> Result<TypeCheckReport, Box<Diagnostic>> {
    if success {
        return Ok(TypeCheckReport {
            tool,
            files,
            passed: true,
            output,
        });
    }
    if output.is_empty() {
        let mut diagnostic = Diagnostic::error(
            "LUAU_ANALYZER_FAILED",
            "Luau static analyzer did not complete",
            "The analyzer exited with a failure but reported nothing, so it never got as far as              checking types. This is a tool or environment problem, not a problem with the game              script; the script has not been type checked either way.",
        );
        diagnostic.facts = serde_json::json!({
            "tool": tool,
            "exit_code": exit_code,
            "files": files,
            "output": "",
        });
        diagnostic.likely_causes = vec![
            "an antivirus or endpoint agent stopped the analyzer process".to_string(),
            "the analyzer executable or the script was locked by another process".to_string(),
            "the analyzer crashed before producing output".to_string(),
        ];
        diagnostic.suggested_actions = vec![ActionSuggestion {
            action: "retry_type_check".to_string(),
            description: "Run the type check again. If it keeps failing with no output, check                           antivirus and file locks on the analyzer and the entry script."
                .to_string(),
            command: Some("game check --types --json".to_string()),
        }];
        return Err(Box::new(diagnostic));
    }
    let mut diagnostic = Diagnostic::error(
        "LUAU_TYPECHECK_FAILED",
        "Luau static analyzer found type or lint issues",
        "The entry script passes the runtime contract but not official luau-analyze; fix the typecheck output before hot reload or running tests.",
    );
    diagnostic.facts = serde_json::json!({
        "tool": tool,
        "exit_code": exit_code,
        "files": files,
        "output": output,
    });
    diagnostic.suggested_actions = vec![ActionSuggestion {
        action: "fix_typecheck".to_string(),
        description: "Fix Luau type or lint issues using the files, line numbers, and messages in the output.".to_string(),
        command: Some("game check --types --json".to_string()),
    }];
    Err(Box::new(diagnostic))
}

#[cfg(feature = "dev-tools")]
fn analyzer_path() -> PathBuf {
    if let Ok(path) = env::var("UNONE_LUAU_ANALYZER") {
        return PathBuf::from(path);
    }
    let tool_name = if cfg!(windows) {
        "luau-analyze.exe"
    } else {
        "luau-analyze"
    };
    if let Ok(executable) = env::current_exe()
        && let Some(bin_dir) = executable.parent()
    {
        let packaged_tool = bin_dir.join(tool_name);
        if packaged_tool.is_file() {
            return packaged_tool;
        }
    }
    // Walk up from the working directory, not just look in it: an author
    // running the CLI from a subdirectory of the engine repository should get
    // the same analyzer as one standing at the root, rather than a silent
    // "analyzer not found" that depends on where they happened to be.
    if let Ok(cwd) = env::current_dir() {
        for root in cwd.ancestors() {
            let candidate = root.join(".toolcache/luau-0.734").join(tool_name);
            if candidate.is_file() {
                return candidate;
            }
        }
    }
    PathBuf::from("luau-analyze")
}

/// The entry script and every other Luau file beside it or below it, so data
/// moved into another module is still found. Asset and build folders are skipped.
fn project_scripts(paths: &ProjectPaths, entry_source: &str) -> Vec<(PathBuf, String)> {
    const SKIP: [&str; 5] = ["assets", "bundles", "dist", "target", "node_modules"];
    let mut scripts = vec![(paths.entry_script.clone(), entry_source.to_string())];
    let mut pending: Vec<PathBuf> = paths.entry_script.parent().map(Path::to_path_buf).into_iter().collect();
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                if !name.starts_with('.') && !SKIP.contains(&name.as_str()) { pending.push(path); }
            } else if path.extension().is_some_and(|ext| ext == "luau") && path != paths.entry_script {
                if let Ok(text) = fs::read_to_string(&path) { scripts.push((path, text)); }
            }
        }
    }
    scripts
}

fn script_diagnostic(paths: &ProjectPaths, message: String) -> Diagnostic {
    // Only promote a location explicitly reported for this exact loaded chunk.
    // Unknown/truncated chunk names remain unknown rather than guessing a line.
    let script_file = paths.entry_script.display().to_string();
    let reported_line = [format!("[string \"{script_file}\"]:"), format!("{script_file}:")]
        .iter().find_map(|prefix| {
            let offset = message.find(prefix)? + prefix.len();
            let suffix = &message[offset..];
            let digits = suffix.split_once(':')?.0;
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) { return None; }
            digits.parse::<u32>().ok().filter(|n| *n > 0)
        });
    let mut diagnostic = Diagnostic::error(
        "LUAU_RUNTIME_ERROR",
        "Luau script could not be loaded or executed",
        message.clone(),
    );
    diagnostic.facts = serde_json::json!({
        "script": paths.entry_script.display().to_string(),
        "runtime": "Luau",
        "message": message,
    });
    diagnostic.source = Some(SourceLocation {
        file: paths.entry_script.display().to_string(),
        line: reported_line,
        column: None,
    });
    diagnostic.likely_causes = vec![
        "The entry script syntax or Engine API calls do not satisfy the current contract"
            .to_string(),
        "The script uses a missing Entity or field at runtime".to_string(),
    ];
    diagnostic.suggested_actions = vec![
        ActionSuggestion {
            action: "check_script".to_string(),
            description: "Check the entry script contract first.".to_string(),
            command: Some("game check --json".to_string()),
        },
        ActionSuggestion {
            action: "inspect_project".to_string(),
            description: "Confirm the scene and Entity ids.".to_string(),
            command: Some("game project inspect --json".to_string()),
        },
    ];
    diagnostic
}

fn hex_digest(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(feature = "dev-tools")]
fn evaluate_assertion(
    world: &WorldSnapshot,
    assertion: &crate::project::TestAssertion,
) -> Result<(), String> {
    if let Some(ui) = &assertion.ui {
        let actual = world
            .ui
            .as_ref()
            .ok_or_else(|| "UI tree does not exist.".to_string())?;
        let expected = UiTree::from_json_for_viewport_with_resources(ui.equals.clone(),crate::ui::UI_REFERENCE_ASPECT,&world.ui_image_batches)
            .map_err(|error| format!("UI assertion is not a valid UI tree: {error}"))?;
        if actual != &expected {
            return Err(format!(
                "UI tree does not equal the expected value; actual={} expected={}",
                serde_json::to_string(actual).unwrap_or_else(|_| "<unserializable>".to_string()),
                serde_json::to_string(&expected).unwrap_or_else(|_| "<unserializable>".to_string())
            ));
        }
        return Ok(());
    }
    if let Some(animation) = &assertion.animation {
        let entity = world
            .entities
            .get(&animation.entity)
            .ok_or_else(|| format!("Entity '{}' does not exist.", animation.entity))?;
        let actual = serde_json::to_value(&entity.animation)
            .map_err(|error| format!("Unable to serialize animation state: {error}"))?;
        if actual != animation.equals {
            return Err(format!(
                "Entity '{}' animation = {actual}, does not equal expected {}.",
                animation.entity, animation.equals
            ));
        }
        return Ok(());
    }
    if let Some(effects) = &assertion.effects {
        let actual = serde_json::to_value(&world.effects)
            .map_err(|error| format!("Unable to serialize effects: {error}"))?;
        if actual != effects.equals {
            return Err(format!(
                "effects = {actual}, does not equal expected {}.",
                effects.equals
            ));
        }
        return Ok(());
    }
    if let Some(audio) = &assertion.audio {
        if let Some(expected) = &audio.events {
            let actual = serde_json::to_value(&world.audio_events)
                .map_err(|error| format!("Unable to serialize audio events: {error}"))?;
            if actual != *expected {
                return Err(format!(
                    "audio events = {actual}, does not equal expected {expected}."
                ));
            }
        }
        if let Some(expected) = &audio.loops {
            let actual = serde_json::to_value(&world.audio_loops)
                .map_err(|error| format!("Unable to serialize audio loops: {error}"))?;
            if actual != *expected {
                return Err(format!(
                    "audio loops = {actual}, does not equal expected {expected}."
                ));
            }
        }
        return Ok(());
    }
    if let Some(observation) = &assertion.observation {
        let actual = world
            .observations
            .get(&observation.key)
            .ok_or_else(|| format!("Observation '{}' does not exist.", observation.key))?;
        if actual != &observation.equals {
            return Err(format!(
                "Observation '{}' = {}, does not equal expected {}.",
                observation.key, actual, observation.equals
            ));
        }
        return Ok(());
    }
    let entity_id = assertion
        .entity
        .as_deref()
        .ok_or_else(|| "Assertion must provide entity/field or observation.".to_string())?;
    let field = assertion
        .field
        .as_deref()
        .ok_or_else(|| "Entity assertion must provide field.".to_string())?;
    let entity = world
        .entities
        .get(entity_id)
        .ok_or_else(|| format!("Entity '{}' does not exist.", entity_id))?;
    let actual = match field {
        "transform.x" => entity.transform.x,
        "transform.y" => entity.transform.y,
        field => {
            return Err(format!(
                "Unsupported assertion field '{field}'; currently supported fields are transform.x and transform.y."
            ));
        }
    };
    if let Some(expected) = assertion.equals
        && (actual - expected).abs() > 0.000_001
    {
        return Err(format!(
            "{} {} does not equal expected {}.",
            entity_id, field, expected
        ));
    }
    if let Some(expected) = assertion.greater_than
        && actual <= expected
    {
        return Err(format!(
            "{} {} = {} is not greater than {}.",
            entity_id, field, actual, expected
        ));
    }
    if let Some(expected) = assertion.less_than
        && actual >= expected
    {
        return Err(format!(
            "{} {} = {} is not less than {}.",
            entity_id, field, actual, expected
        ));
    }
    Ok(())
}

#[cfg(all(test, feature = "dev-tools"))]
mod tests {
    use std::{collections::BTreeMap, fs};

    use tempfile::tempdir;

    use super::{DeterministicRng, EngineRuntime, hex_digest, observation_digest};
    use crate::{
        project::InputFrame,
        ui::UiTree,
        world::{SceneFile, Vec2},
    };

    fn write_project(dir: &std::path::Path, script: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::create_dir_all(dir.join("scenes")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            r#"{
            "name": "ReloadTest",
            "entry_script": "scripts/main.luau",
            "main_scene": "scenes/main.scene.json"
        }"#,
        )
        .unwrap();
        fs::write(
            dir.join("scenes/main.scene.json"),
            r#"{
            "entities": [{
                "id": "player",
                "name": "Player",
                "transform": {"x": 0.0, "y": 0.0}
            }]
        }"#,
        )
        .unwrap();
        fs::write(dir.join("scripts/main.luau"), script).unwrap();
    }

    const SCRIPT: &str = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { isDown: (action: string) -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi, log: (message: string) -> () }
local Game = {}
local speed: number = 4
function Game.start(api: EngineApi) end
function Game.update(api: EngineApi, dt: number)
    local p = api.entity.getPosition("player")
    if api.input.isDown("Right") then p.x += speed * dt end
    api.entity.setPosition("player", p)
end
return Game
"#;

    const PHYSICS_SCRIPT: &str = r#"--!strict
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.physics.applyImpulse("player", {x = 1.0, y = 0.0})
end
return Game
"#;

    fn write_project_with_systems(dir: &std::path::Path, script: &str, systems: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::create_dir_all(dir.join("scenes")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            format!(
                r#"{{
                "name": "SystemsTest",
                "entry_script": "scripts/main.luau",
                "main_scene": "scenes/main.scene.json",
                "systems": {systems}
            }}"#
            ),
        )
        .unwrap();
        fs::write(
            dir.join("scenes/main.scene.json"),
            r#"{
            "entities": [{
                "id": "player",
                "name": "Player",
                "transform": {"x": 0.0, "y": 10.0},
                "rigidbody": {"body_type": "dynamic"}
            }]
        }"#,
        )
        .unwrap();
        fs::write(dir.join("scripts/main.luau"), script).unwrap();
    }

    const IDLE_SCRIPT: &str = r#"--!strict
local Game = {}
function Game.start(_api) end
function Game.update(_api, _dt) end
return Game
"#;

    #[test]
    fn a_disabled_system_stops_stepping_and_says_so_when_called() {
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), PHYSICS_SCRIPT, r#"{"physics2d": false}"#);
        let error = EngineRuntime::load(dir.path()).unwrap().tick().unwrap_err();
        assert!(
            error.explanation.contains("SYSTEM_DISABLED"),
            "{}",
            error.explanation
        );
        assert!(
            error.explanation.contains("physics2d"),
            "{}",
            error.explanation
        );

        write_project_with_systems(dir.path(), IDLE_SCRIPT, r#"{"physics2d": false}"#);
        let mut disabled = EngineRuntime::load(dir.path()).unwrap();
        disabled.run(30, 42);
        let held = disabled.observe().entities["player"].transform.y;
        assert!((held - 10.0).abs() < 1e-9, "physics still advanced: {held}");

        write_project_with_systems(dir.path(), IDLE_SCRIPT, "{}");
        let mut enabled = EngineRuntime::load(dir.path()).unwrap();
        enabled.run(30, 42);
        let fallen = enabled.observe().entities["player"].transform.y;
        assert!(fallen < 10.0, "physics did not advance: {fallen}");
    }

    const PRESENTATION_SCRIPT: &str = r#"--!strict
local Game = {}
local handle: string? = nil
function Game.start(_api) end
function Game.update(api, _dt)
    api.animation.play("player", "spin", {asset = "spine://reel", loop = false, speed = 2.0})
    if handle == nil then
        handle = api.effect.spawn("effekseer://win", {x = 1.0, y = 2.0, scale = 1.5})
    end
end
return Game
"#;

    #[test]
    fn animation_and_effect_state_reach_the_snapshot_for_a_host_to_play() {
        let dir = tempdir().unwrap();
        write_project_with_systems(
            dir.path(),
            PRESENTATION_SCRIPT,
            r#"{"spine": true, "effekseer": true}"#,
        );
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        runtime.run(3, 42);
        let snapshot = runtime.observe();

        let animation = snapshot.entities["player"].animation.as_ref().unwrap();
        assert_eq!(animation.asset, "spine://reel");
        assert_eq!(animation.animation, "spin");
        assert!(!animation.looping);
        assert!((animation.speed - 2.0).abs() < f64::EPSILON);
        // Replaying the same clip must not restart it every frame.
        assert_eq!(animation.started_frame, 0);

        assert_eq!(snapshot.effects.len(), 1);
        let effect = &snapshot.effects[0];
        assert_eq!(effect.handle, "effect-1");
        assert_eq!(effect.asset, "effekseer://win");
        assert!((effect.position.x - 1.0).abs() < f64::EPSILON);
        assert!((effect.scale - 1.5).abs() < f64::EPSILON);
    }

    #[test]
    fn presentation_systems_are_off_until_a_game_declares_them() {
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), PRESENTATION_SCRIPT, "{}");
        let error = EngineRuntime::load(dir.path()).unwrap().tick().unwrap_err();
        assert!(
            error.explanation.contains("SYSTEM_DISABLED"),
            "{}",
            error.explanation
        );
        assert!(error.explanation.contains("spine"), "{}", error.explanation);
    }

    const SAVE_SCRIPT: &str = r#"--!strict
local Game = {}
local restored: any = nil
function Game.start(api)
    restored = api.save.get()
    api.observation.set("restored_in_start", restored)
end
function Game.update(api, _dt)
    api.observation.set("restored_in_start", restored)
end
return Game
"#;

    const ANCHOR_SCRIPT: &str = r#"--!strict
local Game = {}
local function publish(api)
    api.ui.setRoot({
        kind = "screen", id = "s", node = "s",
        children = {
            { kind = "button", id = "spin", text = "Spin", action = "Spin",
              anchor = "bottom_right", offset = { x = 4, y = 4 },
              size = { width = 30, height = 10 } },
        },
    })
end
function Game.start(api) publish(api) end
function Game.update(api, _dt) publish(api) end
return Game
"#;

    #[test]
    fn virtual_ui_materializes_without_a_game_tick_and_rejects_stale_work() {
        let source = r#"
local Game={}
local items={}
for i=1,10000 do items[i]={id='key_'..i,name='Item '..i} end
function Game.start(api)
 local list=api.ui.virtualList({id='list',viewport={left=10,top=10,width=80,height=70},
  items=items,key='id',rowHeight=4,gapY=.5,
  renderItem=function(item,index,key)
   return {{kind='button',id='row_'..key,text=item.name,action='Inspect_'..key,
    rect={x=0,y=0,width=80,height=4}}}
  end})
 api.ui.setRoot({kind='screen',id='s',node='list',children={list}})
end
function Game.update(api,dt)
 api.observation.set('sample',api.random.nextFloat())
end
return Game
"#;
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), source, r#"{"ui":true,"random":true}"#);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        let mut baseline = EngineRuntime::load(dir.path()).unwrap();
        let before = runtime.observe();
        let json = serde_json::to_value(before.ui.as_ref().unwrap()).unwrap();
        let node = &json["children"][0];
        assert_eq!(node["rect"]["y"].as_f64(), Some(20.0));
        assert_eq!(node["scroll"]["virtual_items"]["keys"].as_array().unwrap().len(), 10000);
        assert!(node["children"].as_array().unwrap().len() < 20);
        let revision = node["scroll"]["virtual_items"]["revision"].clone();
        runtime.ui_request(serde_json::json!({"id":"list","revision":revision,"first":9982,"last":10000})).unwrap();
        let after = runtime.observe();
        assert_eq!(after.frame, before.frame);
        assert_eq!(after.observations, before.observations);
        let ui = serde_json::to_value(after.ui.as_ref().unwrap()).unwrap();
        assert_eq!(ui["children"][0]["children"][0]["children"][0]["id"], "row_key_9982");
        runtime.ui_request(serde_json::json!({"id":"list","revision":0,"first":1,"last":20})).unwrap();
        assert_eq!(runtime.observe().ui, after.ui);
        assert!(runtime.ui_request(serde_json::json!({"id":"list","revision":revision,"first":1,"last":10000})).unwrap_err().contains("UI_VIRTUAL_RANGE"));
        assert_eq!(runtime.observe().ui, after.ui);
        assert_eq!(runtime.tick().unwrap().observations["sample"], baseline.tick().unwrap().observations["sample"]);
    }

    #[test]
    fn scroll_helpers_cover_empty_data_nested_views_and_fail_loudly() {
        let source = r#"
local Game={}
function Game.start(api)
 local function empty() return {{kind='text',id='never',text='',rect={x=0,y=0,width=1,height=1}}} end
 local list=api.ui.virtualList({id='empty',viewport={left=0,top=0,width=10,height=10},items={},key='id',rowHeight=4,renderItem=empty,inertia=true,deceleration=12})
 local nested=api.ui.scrollView({id='nested',viewport={left=2,top=110,width=10,height=10},content={}})
 local outer=api.ui.scrollView({id='outer',viewport={left=10,top=10,width=80,height=70},content={nested,list}})
 api.ui.setRoot({kind='screen',id='s',node='empty',children={outer}})
 assert(not pcall(function()api.ui.scrollView({id='bad',viewport={x=0,y=0,width=10,height=10}})end))
 assert(not pcall(function()api.ui.scrollView({id='bad',viewport={left=0,top=0,width=10,height=10},contentHeight=10})end))
 assert(not pcall(function()api.ui.scrollView({id='bad',viewport={left=0,top=0,width=10,height=10},inertia='yes'})end))
 for _,bad in ipairs({0,-1,101,math.huge,0/0,'8'}) do
  assert(not pcall(function()api.ui.scrollView({id='bad',viewport={left=0,top=0,width=10,height=10},deceleration=bad})end))
 end
 assert(not pcall(function()api.ui.virtualGrid({id='bad',viewport={left=0,top=0,width=10,height=10},items={},key='id',columns=2,columnWidth=10,rowHeight=4,renderItem=empty})end))
 assert(not pcall(function()api.ui.virtualList({id='bad',viewport={left=0,top=0,width=10,height=10},items={{id='x'},{id='x'}},key='id',rowHeight=4,renderItem=empty})end))
end
function Game.update(api,dt)end
return Game
"#;
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), source, r#"{"ui":true}"#);
        let ui = EngineRuntime::load(dir.path()).unwrap().observe().ui.unwrap();
        let json = serde_json::to_value(ui).unwrap();
        assert_eq!(json["children"][0]["children"][0]["rect"]["y"].as_f64(), Some(110.0));
        assert_eq!(json["children"][0]["children"][1]["scroll"]["virtual_items"]["keys"], serde_json::json!([]));
        assert_eq!(json["children"][0]["scroll"]["inertia"], false);
        assert_eq!(json["children"][0]["scroll"]["deceleration"], 8.0);
        assert_eq!(json["children"][0]["children"][1]["scroll"]["inertia"], true);
        assert_eq!(json["children"][0]["children"][1]["scroll"]["deceleration"], 12.0);
    }

    const NESTED_COMPONENT_UI_SCRIPT: &str = r#"
local Game = {}
function Game.start(api)
    local child = { kind = "text", id = "leaf", text = "Leaf", rect = { x = 1, y = 1, width = 10, height = 5 } }
    for index = 16, 1, -1 do
        child = { kind = "component", id = "layer" .. index, component = "ui.layer", rect = { x = 0, y = 0, width = 100, height = 100 }, children = { child } }
    end
    api.ui.setRoot({ kind = "screen", id = "nested", node = "nested", children = { child } })
end
function Game.update(_api, _dt) end
return Game
"#;

    #[test]
    fn nested_component_ui_survives_the_luau_json_boundary() {
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), NESTED_COMPONENT_UI_SCRIPT, "{}");
        let ui = EngineRuntime::load(dir.path()).unwrap().observe().ui.unwrap();
        let mut leaves = Vec::new();
        ui.children[0].leaf_nodes(&mut leaves);
        assert_eq!(leaves.len(), 1);
        assert_eq!(leaves[0].id(), "leaf");

        let too_deep_dir = tempdir().unwrap();
        let too_deep_script = NESTED_COMPONENT_UI_SCRIPT.replace("index = 16, 1", "index = 17, 1");
        write_project_with_systems(too_deep_dir.path(), &too_deep_script, "{}");
        let error = match EngineRuntime::load(too_deep_dir.path()) {
            Ok(_) => panic!("17 component wrappers should be rejected by Core"),
            Err(error) => error,
        };
        assert!(error.explanation.contains("maximum component nesting depth"), "{}", error.explanation);
    }

    #[test]
    fn the_host_viewport_shape_decides_where_an_anchored_node_lands() {
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), ANCHOR_SCRIPT, "{}");

        let wide = EngineRuntime::load(dir.path())
            .unwrap()
            .observe()
            .ui
            .unwrap();
        let mut narrow_runtime = EngineRuntime::load(dir.path()).unwrap();
        narrow_runtime.set_viewport_aspect(9.0 / 16.0).unwrap();
        narrow_runtime.run(1, 42);
        let narrow = narrow_runtime.observe().ui.unwrap();

        let rect_of = |tree: &crate::ui::UiTree| *tree.children[0].rect();
        let wide_rect = rect_of(&wide);
        let narrow_rect = rect_of(&narrow);
        assert!(
            narrow_rect.width > wide_rect.width,
            "a narrow screen needs more design width: {wide_rect:?} vs {narrow_rect:?}"
        );
        assert!((wide_rect.y - narrow_rect.y).abs() < 1e-9);

        assert_eq!(
            EngineRuntime::load(dir.path())
                .unwrap()
                .set_viewport_aspect(0.0)
                .unwrap_err()
                .code,
            "VIEWPORT_ASPECT_INVALID"
        );
    }

    /// The type gate silently passed for every project because the engine handed
    /// luau-analyze a canonicalized `\\\\?\\` path it cannot open, and a tool that
    /// opens nothing exits 0 with nothing to say. Nothing caught it, because no
    /// test ever proved the gate could still fail.
    #[test]
    fn the_type_gate_still_rejects_a_script_with_a_type_error() {
        let analyzer = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.toolcache/luau-0.734/luau-analyze.exe");
        if !analyzer.is_file() {
            eprintln!("skipped: no analyzer at {}", analyzer.display());
            return;
        }
        let dir = tempdir().unwrap();
        let bad = dir.path().join("bad.luau");
        fs::write(&bad, "--!strict\nlocal x: number = \"text\"\nreturn x\n").unwrap();
        // Canonicalize on purpose: this is the shape the engine really passes.
        let canonical = fs::canonicalize(&bad).unwrap();
        let error = super::run_luau_analyzer_with(&analyzer, &canonical)
            .expect_err("a script with a type error must not pass the gate");
        assert_eq!(error.code, "LUAU_TYPECHECK_FAILED", "{error:?}");
        assert!(
            error.facts["output"]
                .as_str()
                .is_some_and(|output| output.contains("TypeError")),
            "the failure must carry the analyzer own message: {:?}",
            error.facts
        );

        let good = dir.path().join("good.luau");
        fs::write(&good, "--!strict\nlocal x: number = 1\nreturn x\n").unwrap();
        let report =
            super::run_luau_analyzer_with(&analyzer, &fs::canonicalize(&good).unwrap()).unwrap();
        assert!(report.passed);
    }

    #[test]
    fn the_analyzer_argument_drops_the_extended_length_prefix() {
        let prefixed = "\\\\?\\D:\\game\\main.luau";
        assert_eq!(
            super::analyzer_argument(std::path::Path::new(prefixed)),
            "D:\\game\\main.luau"
        );

        let unc = "\\\\?\\UNC\\server\\share\\main.luau";
        assert_eq!(
            super::analyzer_argument(std::path::Path::new(unc)),
            "\\\\server\\share\\main.luau"
        );

        assert_eq!(
            super::analyzer_argument(std::path::Path::new("scripts/main.luau")),
            "scripts/main.luau"
        );
    }

    /// Measured against the real analyzer: a good script exits 0 with no output,
    /// a genuine type error exits 1 carrying the TypeError text. So a failing
    /// exit with nothing to say is the tool dying, never a type error, and the
    /// author must not be told to fix a script that was never checked.
    #[test]
    fn an_analyzer_that_fails_silently_is_not_reported_as_a_type_error() {
        let tool = "luau-analyze".to_string();
        let files = vec!["scripts/main.luau".to_string()];

        let passed = super::classify_analyzer_result(
            true,
            Some(0),
            String::new(),
            tool.clone(),
            files.clone(),
        )
        .expect("a successful run passes");
        assert!(passed.passed);

        let type_error = super::classify_analyzer_result(
            false,
            Some(1),
            "main.luau:2.19-2.32: TypeError: Expected 'number', but got 'string'".to_string(),
            tool.clone(),
            files.clone(),
        )
        .expect_err("a reported type error still fails");
        assert_eq!(type_error.code, "LUAU_TYPECHECK_FAILED");

        let tool_failure =
            super::classify_analyzer_result(false, Some(1), String::new(), tool, files)
                .expect_err("a silent failure still fails the gate");
        assert_eq!(
            tool_failure.code, "LUAU_ANALYZER_FAILED",
            "a silent analyzer failure must not be blamed on the script"
        );
        assert!(
            !tool_failure.suggested_actions.is_empty(),
            "a tool failure must say what to do next"
        );
        assert!(
            !tool_failure.likely_causes.is_empty(),
            "a tool failure must name what tends to cause it"
        );
    }

    #[test]
    fn a_restored_save_is_visible_inside_game_start() {
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), SAVE_SCRIPT, "{}");
        let payload = serde_json::json!({"version": 1, "credits": 9});
        let mut runtime =
            EngineRuntime::load_with_seed_and_save(dir.path(), 42, Some(payload.clone())).unwrap();
        assert_eq!(
            runtime.observe().observations.get("restored_in_start"),
            Some(&payload),
            "Game.start could not see the restored save"
        );
        runtime.run(1, 42);
        assert_eq!(
            runtime.observe().observations.get("restored_in_start"),
            Some(&payload)
        );
    }

    #[test]
    fn an_unknown_system_switch_fails_the_project_load() {
        let dir = tempdir().unwrap();
        write_project_with_systems(dir.path(), IDLE_SCRIPT, r#"{"physics4d": false}"#);
        let error = match EngineRuntime::load(dir.path()) {
            Ok(_) => panic!("unknown system id was accepted"),
            Err(error) => error,
        };
        assert_eq!(error.code, "SYSTEM_UNKNOWN");
    }

    #[test]
    fn same_seed_and_input_produce_same_observation_digest() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut left = EngineRuntime::load(dir.path()).unwrap();
        let mut right = EngineRuntime::load(dir.path()).unwrap();
        left.set_input("Right", true);
        right.set_input("Right", true);
        let left_report = left.run(60, 42).value.unwrap();
        let right_report = right.run(60, 42).value.unwrap();
        assert_eq!(
            left_report.observation_digest,
            right_report.observation_digest
        );
    }

    #[test]
    fn observation_digest_matches_snapshot_bytes_and_does_not_mutate_snapshot() {
        let runtime =
            EngineRuntime::load_source("DigestSmoke", "main.luau", IDLE_SCRIPT, None).unwrap();
        let snapshot = runtime.observe();
        let before = serde_json::to_vec(&snapshot).unwrap();

        let digest = observation_digest(&snapshot).unwrap();
        assert_eq!(digest, format!("sha256:{}", hex_digest(&before)));

        let after = serde_json::to_vec(&runtime.observe()).unwrap();
        assert_eq!(after, before, "digesting must be read-only");

        let mut changed = snapshot.clone();
        changed.frame += 1;
        assert_ne!(
            observation_digest(&changed).unwrap(),
            digest,
            "different snapshot state must produce a different digest"
        );
    }

    #[test]
    fn two_d_script_api_updates_visual_transform_and_preserves_position_shape() {
        let scene = serde_json::from_value::<SceneFile>(serde_json::json!({
            "entities": [{
                "id": "player",
                "transform": {"x": 2.0, "y": 3.0},
                "sprite": {"asset": "asset://player"}
            }]
        }))
        .unwrap();
        let source = r#"
local Game = {}
function Game.start(api)
    local transform = api.entity.getTransform2D("player")
    transform.position.x += 1
    transform.rotation = 1.25
    transform.scale = { x = 2, y = 0.5 }
    api.entity.setTransform2D("player", transform)
end
function Game.update(_api, _dt) end
return Game
"#;

        let runtime =
            EngineRuntime::load_source("Transform2DSmoke", "main.luau", source, Some(scene))
                .unwrap();
        let snapshot = runtime.observe();
        let player = snapshot.entities.get("player").unwrap();

        assert_eq!(player.transform, Vec2 { x: 3.0, y: 3.0 });
        assert_eq!(player.rotation, 1.25);
        assert_eq!(player.scale, Vec2 { x: 2.0, y: 0.5 });
    }

    #[test]
    fn visual_transform_changes_snapshot_but_not_same_seed_physics() {
        let scene = |visual: bool| {
            let bird_rotation = if visual { 1.25 } else { 0.0 };
            let bird_scale = if visual {
                serde_json::json!({"x": 2.0, "y": 0.5})
            } else {
                serde_json::json!({"x": 1.0, "y": 1.0})
            };
            let pig_rotation = if visual { -0.75 } else { 0.0 };
            let pig_scale = if visual {
                serde_json::json!({"x": 0.75, "y": 1.75})
            } else {
                serde_json::json!({"x": 1.0, "y": 1.0})
            };
            serde_json::from_value::<SceneFile>(serde_json::json!({
                "physics": {"ground_y": 0.0},
                "entities": [
                    {
                        "id": "bird",
                        "transform": {"x": 0.0, "y": 3.0},
                        "rotation": bird_rotation,
                        "scale": bird_scale,
                        "sprite": {"asset": "asset://bird"},
                        "rigidbody": {"body_type": "dynamic", "velocity": {"x": 4.0, "y": 0.0}}
                    },
                    {
                        "id": "pig",
                        "transform": {"x": 0.8, "y": 3.0},
                        "rotation": pig_rotation,
                        "scale": pig_scale,
                        "sprite": {"asset": "asset://pig"},
                        "rigidbody": {"body_type": "dynamic"}
                    }
                ]
            }))
            .unwrap()
        };
        let mut baseline = EngineRuntime::load_source_with_seed(
            "TransformPhysicsBaseline",
            "main.luau",
            IDLE_SCRIPT,
            Some(scene(false)),
            1337,
        )
        .unwrap();
        let mut visual_only = EngineRuntime::load_source_with_seed(
            "TransformPhysicsVisualOnly",
            "main.luau",
            IDLE_SCRIPT,
            Some(scene(true)),
            1337,
        )
        .unwrap();
        let input_sequence = vec![InputFrame::default(); 120];

        let baseline_report = baseline
            .run_with_input_sequence(120, 1337, &input_sequence)
            .value
            .unwrap();
        let visual_report = visual_only
            .run_with_input_sequence(120, 1337, &input_sequence)
            .value
            .unwrap();

        for id in ["bird", "pig"] {
            let expected = &baseline_report.world.entities[id];
            let actual = &visual_report.world.entities[id];
            assert_eq!(actual.transform, expected.transform, "position for {id}");
            assert_eq!(
                actual.rigidbody.as_ref().unwrap().velocity,
                expected.rigidbody.as_ref().unwrap().velocity,
                "velocity for {id}"
            );
        }
        assert_eq!(visual_report.world.contacts, baseline_report.world.contacts);
        assert_eq!(
            visual_report.world.ground_contacts,
            baseline_report.world.ground_contacts
        );
        assert_ne!(
            visual_report.world.entities["bird"].rotation,
            baseline_report.world.entities["bird"].rotation
        );
        assert_ne!(
            visual_report.world.entities["bird"].scale,
            baseline_report.world.entities["bird"].scale
        );
        assert_ne!(
            visual_report.observation_digest, baseline_report.observation_digest,
            "full snapshot digest includes visual state, not a physics verdict"
        );
    }

    #[test]
    fn failed_reload_keeps_previous_script_running() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        runtime.set_input("Right", true);
        runtime.run(30, 42);
        fs::write(dir.path().join("scripts/main.luau"), "return broken syntax").unwrap();
        assert!(runtime.reload().is_err());
        let report = runtime.run(30, 42).value.unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 4.0).abs() < 0.000_001);
    }

    #[test]
    fn failed_on_reload_rolls_back_all_owned_state_and_randomness() {
        const OLD: &str = r#"--!strict
local Game = {}
function Game.start(api)
    api.observation.set("mode", "old")
    api.ui.setRoot({
        kind = "screen", id = "root", node = "root",
        children = {
            [1] = { kind = "text", id = "label", text = "old",
                    rect = { x = 0, y = 0, width = 10, height = 10 } },
        },
    })
end
function Game.update(api, _dt)
    api.observation.set("random", api.random.nextFloat())
end
return Game
"#;
        const BROKEN: &str = r#"--!strict
local Game = {}
function Game.start(_api) end
function Game.onReload(api)
    api.entity.spawn("candidate")
    api.save.set({ value = "changed" })
    api.observation.set("mode", "changed")
    api.ui.setRoot({
        kind = "screen", id = "root", node = "root",
        children = {
            [1] = { kind = "text", id = "label", text = "changed",
                    rect = { x = 0, y = 0, width = 10, height = 10 } },
        },
    })
    api.random.nextFloat()
    error("candidate reload failed")
end
function Game.update(_api, _dt) end
return Game
"#;

        let mut runtime =
            EngineRuntime::load_source_with_seed("Reload", "main.luau", OLD, None, 7).unwrap();
        let mut control =
            EngineRuntime::load_source_with_seed("Reload", "main.luau", OLD, None, 7).unwrap();
        let save = serde_json::json!({"value": "before"});
        runtime.set_save_payload(Some(save.clone()));
        control.set_save_payload(Some(save));

        let error = runtime.reload_source(BROKEN).unwrap_err();
        assert!(
            error.explanation.contains("candidate reload failed"),
            "{error:?}"
        );
        assert_eq!(
            serde_json::to_value(runtime.observe().entities).unwrap(),
            serde_json::to_value(control.observe().entities).unwrap()
        );
        assert_eq!(
            runtime.observe().observations,
            control.observe().observations
        );
        assert_eq!(runtime.observe().ui, control.observe().ui);
        assert_eq!(runtime.save_payload(), control.save_payload());

        let actual = runtime.run(1, 7).value.unwrap();
        let expected = control.run(1, 7).value.unwrap();
        assert_eq!(
            serde_json::to_value(actual.world).unwrap(),
            serde_json::to_value(expected.world).unwrap()
        );
        assert_eq!(actual.observation_digest, expected.observation_digest);
        assert_eq!(actual.save_payload, expected.save_payload);
    }

    #[test]
    fn reload_if_changed_swaps_script_and_preserves_world_state() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        runtime.set_input("Right", true);
        runtime.run(30, 42);

        let faster_script = SCRIPT.replace("speed: number = 4", "speed: number = 12");
        fs::write(dir.path().join("scripts/main.luau"), faster_script).unwrap();
        assert!(runtime.reload_if_changed().unwrap());

        let report = runtime.run(30, 42).value.unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 8.0).abs() < 0.000_001);
    }

    #[test]
    fn input_sequence_is_relative_to_run_and_clears_missing_frames() {
        let dir = tempdir().unwrap();
        write_project(dir.path(), SCRIPT);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        let mut actions = BTreeMap::new();
        actions.insert("Right".to_string(), true);
        let active = InputFrame {
            actions,
            pointer: None,
            ..InputFrame::default()
        };
        let sequence = vec![active; 30]
            .into_iter()
            .chain((0..30).map(|_| InputFrame::default()))
            .collect::<Vec<_>>();

        let report = runtime
            .run_with_input_sequence(60, 42, &sequence)
            .value
            .unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 2.0).abs() < 0.000_001);
    }

    #[test]
    fn tick_with_input_is_the_shared_host_frame_boundary() {
        let dir = tempdir().unwrap();
        let script = r#"--!strict
type Vec2 = { x: number, y: number }
type EntityApi = { getPosition: (id: string) -> Vec2, setPosition: (id: string, position: Vec2) -> () }
type InputApi = { getPointerPosition: () -> Vec2, isPointerDown: () -> boolean }
type EngineApi = { entity: EntityApi, input: InputApi }
local Game = {}
function Game.start(_api: EngineApi) end
function Game.update(api: EngineApi, _dt: number)
    if api.input.isPointerDown() then
        api.entity.setPosition("player", api.input.getPointerPosition())
    end
end
return Game
"#;
        write_project(dir.path(), script);
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();
        let frame = InputFrame {
            actions: BTreeMap::new(),
            pointer: Some(crate::project::PointerInput {
                position: crate::world::Vec2 { x: 3.0, y: 4.0 },
                down: true,
                screen_position: None,
            }),
            ..InputFrame::default()
        };

        let snapshot = runtime.tick_with_input(&frame).unwrap();

        assert_eq!(
            snapshot.entities.get("player").unwrap().transform,
            crate::world::Vec2 { x: 3.0, y: 4.0 }
        );
    }

    #[test]
    fn memory_runtime_runs_without_project_files() {
        let source = r#"
local Game = {}
function Game.start(api)
    api.entity.spawn("player")
end
function Game.update(api, dt)
    local position = api.entity.getPosition("player")
    position.x += dt
    api.entity.setPosition("player", position)
end
return Game
"#;
        let mut runtime =
            EngineRuntime::load_source("WebSmoke", "main.luau", source, None).unwrap();
        let report = runtime.run(60, 42).value.unwrap();
        let x = report.world.entities.get("player").unwrap().transform.x;
        assert!((x - 1.0).abs() < 0.000_001);
    }

    #[test]
    fn three_d_script_api_updates_transform_and_camera_without_game_specific_rules() {
        let scene: SceneFile = serde_json::from_value(serde_json::json!({
            "camera3d": {
                "position": {"x": 0, "y": 2, "z": 6},
                "target": {"x": 0, "y": 0, "z": 0},
                "fov_degrees": 60
            },
            "entities": [{
                "id": "car",
                "transform3d": {
                    "position": {"x": 0, "y": 0, "z": 0},
                    "rotation": {"x": 0, "y": 0, "z": 0},
                    "scale": {"x": 1, "y": 1, "z": 2}
                },
                "mesh3d": {"asset": "mesh://car"}
            }]
        }))
        .unwrap();
        let source = r#"
local Game = {}
function Game.start(api)
    local transform = api.entity.getTransform3D("car")
    transform.position.z -= 3
    transform.rotation.y = 0.25
    api.entity.setTransform3D("car", transform)
    api.camera3d.setPosition({ x = 0, y = 3, z = 8 })
    api.camera3d.setTarget({ x = 0, y = 0, z = -3 })
end
function Game.update(_api, _dt) end
return Game
"#;

        let runtime =
            EngineRuntime::load_source("3DContract", "main.luau", source, Some(scene)).unwrap();
        let snapshot = runtime.observe();

        let car = snapshot.entities.get("car").unwrap();
        assert_eq!(car.transform3d.as_ref().unwrap().position.z, -3.0);
        assert_eq!(car.transform3d.as_ref().unwrap().rotation.y, 0.25);
        assert_eq!(snapshot.camera3d.as_ref().unwrap().target.z, -3.0);
    }

    #[test]
    fn unified_camera_api_switches_projection_without_a_second_camera_contract() {
        let source = r#"
local Game = {}
function Game.start(api)
    assert(api.camera.getProjection() == "orthographic")
    api.camera.setTransform({
        projection = "perspective",
        position = { x = 0, y = 3, z = 8 },
        target = { x = 0, y = 0, z = 0 },
        fovDegrees = 55,
    })
end
function Game.update(_api, _dt) end
return Game
"#;
        let runtime = EngineRuntime::load_source("UnifiedCamera", "main.luau", source, None)
            .unwrap();
        let snapshot = runtime.observe();
        let camera = snapshot.camera3d.expect("perspective projection is visible to legacy hosts");
        assert_eq!(camera.position.z, 8.0);
        assert_eq!(camera.fov_degrees, 55.0);
    }

    #[test]
    fn invalid_unified_camera_transform_does_not_switch_projection() {
        let source = r#"
local Game = {}
function Game.start(api)
    local ok = pcall(function()
        api.camera.setTransform({
            projection = "perspective",
            position = { x = 0, y = 3, z = 8 },
            fovDegrees = 55,
        })
    end)
    api.observation.set("camera_attempt", {
        ok = ok,
        projection = api.camera.getProjection(),
    })
end
function Game.update(_api, _dt) end
return Game
"#;
        let runtime = EngineRuntime::load_source("InvalidUnifiedCamera", "main.luau", source, None)
            .unwrap();
        let observation = runtime.observe().observations["camera_attempt"].clone();
        assert_eq!(observation["ok"], false);
        assert_eq!(observation["projection"], "orthographic");
    }

    #[test]
    fn observation_state_serializes_typed_view_model_for_ai() {
        let source = r#"
local Game = {}
function Game.start(api)
    api.observation.set("view_model", {
        screen = "dialogue",
        node = "intro",
        choices = { "kind", "brave" },
        enabled = true,
    })
end
function Game.update(_api, _dt) end
return Game
"#;
        let runtime =
            EngineRuntime::load_source("ObservationSmoke", "main.luau", source, None).unwrap();

        let snapshot = runtime.observe();

        assert_eq!(
            snapshot.observations.get("view_model"),
            Some(&serde_json::json!({
                "screen": "dialogue",
                "node": "intro",
                "choices": ["kind", "brave"],
                "enabled": true,
            }))
        );
    }

    #[test]
    fn observation_rejects_non_serializable_values_with_runtime_diagnostic() {
        let source = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.observation.set("invalid", { callback = function() end })
end
return Game
"#;
        let mut runtime =
            EngineRuntime::load_source("ObservationError", "main.luau", source, None).unwrap();

        let result = runtime.run(1, 42);

        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "LUAU_RUNTIME_ERROR");
        assert!(
            result.diagnostics[0]
                .explanation
                .contains("not serializable")
        );
    }

    #[test]
    fn observation_preserves_wide_binary64_numbers_without_widening_save_inputs() {
        let source = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.observation.set("wide", {
        unsigned = 4294967295,
        safe = 9007199254740991,
        negative = -9007199254740991,
        binary64 = 1e20,
    })
    local saved, message = pcall(api.save.set, {value = 2147483648})
    assert(not saved and string.find(tostring(message), "portable"))
end
return Game
"#;
        let mut runtime =
            EngineRuntime::load_source("ObservationBinary64", "main.luau", source, None).unwrap();

        let result = runtime.run(1, 42);

        assert!(result.ok, "{:?}", result.diagnostics);
        let values = &runtime.observe().observations["wide"];
        assert_eq!(values["unsigned"].as_f64(), Some(4_294_967_295.0));
        assert_eq!(values["safe"].as_f64(), Some(9_007_199_254_740_991.0));
        assert_eq!(values["negative"].as_f64(), Some(-9_007_199_254_740_991.0));
        assert_eq!(values["binary64"].as_f64(), Some(1e20));
    }

    #[test]
    fn ui_set_root_validates_and_exposes_host_render_contract() {
        let source = r#"
local Game = {}
function Game.start(api)
    api.ui.setRoot({
        kind = "screen",
        id = "dialogue",
        node = "intro",
        children = {
            { kind = "text", id = "speaker", rect = { x = 10, y = 70, width = 80, height = 10 }, text = "Mira" },
            { kind = "button", id = "choice", rect = { x = 10, y = 10, width = 35, height = 10 }, text = "Listen", action = "Continue" },
        },
    })
end
function Game.update(_api, _dt) end
return Game
"#;
        let runtime = EngineRuntime::load_source("UiSmoke", "main.luau", source, None).unwrap();

        assert_eq!(
            runtime.observe().ui,
            Some(UiTree::from_json(serde_json::json!({
                "kind": "screen",
                "id": "dialogue",
                "node": "intro",
                "children": [
                    {"kind": "text", "id": "speaker", "rect": {"x": 10, "y": 70, "width": 80, "height": 10}, "text": "Mira"},
                    {"kind": "button", "id": "choice", "rect": {"x": 10, "y": 10, "width": 35, "height": 10}, "text": "Listen", "action": "Continue"}
                ]
            })).unwrap())
        );
    }

    #[test]
    fn ui_set_root_rejects_unknown_nodes_with_runtime_diagnostic() {
        let source = r#"
local Game = {}
function Game.start(api)
    api.ui.setRoot({
        kind = "screen", id = "screen", node = "intro",
        children = {{ kind = "not_a_ui_kind", id = "volume", rect = { x = 0, y = 0, width = 1, height = 1 }, text = "" }},
    })
end
function Game.update(_api, _dt) end
return Game
"#;
        let error = match EngineRuntime::load_source("UiError", "main.luau", source, None) {
            Ok(_) => panic!("invalid UI root unexpectedly loaded"),
            Err(error) => error,
        };

        assert_eq!(error.code, "LUAU_RUNTIME_ERROR");
        assert!(error.explanation.contains("unsupported kind"));
    }

    #[test]
    fn save_payload_round_trips_between_host_and_luau() {
        let source = r#"
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    local loaded = api.save.get()
    if loaded ~= nil then
        api.observation.set("loaded_node", loaded.node)
    end
    if api.input.isDown("Save") then
        api.save.set({ version = 1, node = "kind" })
    end
end
return Game
"#;
        let mut runtime =
            EngineRuntime::load_source_with_seed("SaveSmoke", "main.luau", source, None, 42)
                .unwrap();
        runtime.set_save_payload(Some(serde_json::json!({
            "version": 1,
            "node": "brave",
        })));
        runtime.set_input("Save", true);

        let report = runtime.run(1, 42).value.unwrap();

        assert_eq!(
            report.world.observations.get("loaded_node"),
            Some(&serde_json::json!("brave"))
        );
        assert_eq!(
            report.save_payload,
            Some(serde_json::json!({
                "version": 1,
                "node": "kind",
            }))
        );
    }

    #[test]
    fn seed_controls_luau_random_sequence() {
        let source = r#"
local Game = {}
function Game.start(api)
    api.entity.spawn("player")
end
function Game.update(api, _dt)
    local position = api.entity.getPosition("player")
    position.x = api.random.nextFloat()
    api.entity.setPosition("player", position)
end
return Game
"#;
        let mut left =
            EngineRuntime::load_source_with_seed("RandomSmoke", "main.luau", source, None, 7)
                .unwrap();
        let mut right =
            EngineRuntime::load_source_with_seed("RandomSmoke", "main.luau", source, None, 7)
                .unwrap();
        let mut different =
            EngineRuntime::load_source_with_seed("RandomSmoke", "main.luau", source, None, 8)
                .unwrap();
        let left_digest = left.run(3, 7).value.unwrap().observation_digest;
        let right_digest = right.run(3, 7).value.unwrap().observation_digest;
        let different_digest = different.run(3, 8).value.unwrap().observation_digest;
        assert_eq!(left_digest, right_digest);
        assert_ne!(left_digest, different_digest);
    }

    fn write_audio_project(dir: &std::path::Path, script: &str, audio: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            format!(
                r#"{{
                "name": "AudioTest",
                "entry_script": "scripts/main.luau",
                "audio": {audio}
            }}"#
            ),
        )
        .unwrap();
        fs::write(dir.join("scripts/main.luau"), script).unwrap();
    }

    /// A sound fired in `start` has no frame of its own to be observed on, so
    /// clearing events before the first observation would lose it silently.
    #[test]
    fn a_sound_fired_in_start_is_still_heard_on_the_first_frame() {
        let dir = tempdir().unwrap();
        write_audio_project(
            dir.path(),
            r#"--!strict
local Game = {}
function Game.start(api)
    api.audio.play("sfx://boot")
    api.audio.loop("music://lobby", {category = "bgm"})
end
function Game.update(_api, _dt) end
return Game
"#,
            r#"{"categories": {"bgm": {"exclusive": true, "fade_out_frames": 30}}}"#,
        );
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();

        let first = runtime.tick().unwrap();
        assert_eq!(first.audio_events.len(), 2, "{:?}", first.audio_events);
        assert_eq!(first.audio_events[0].asset, "sfx://boot");
        assert!(!first.audio_events[0].looping);
        assert_eq!(first.audio_loops.len(), 1);
        assert_eq!(
            first.audio_loops[0].phase,
            crate::audio::AudioPhase::Playing
        );

        let second = runtime.tick().unwrap();
        assert!(
            second.audio_events.is_empty(),
            "an event belongs to one frame only: {:?}",
            second.audio_events
        );
        assert_eq!(
            second.audio_loops.len(),
            1,
            "a loop is state and survives the frame"
        );
    }

    /// The rule a game cannot implement itself: the engine decides which track
    /// survives the switch and on which frame the old one leaves.
    #[test]
    fn an_exclusive_switch_and_its_fade_are_decided_by_the_engine() {
        let dir = tempdir().unwrap();
        write_audio_project(
            dir.path(),
            r#"--!strict
local Game = {}
local frame = 0
function Game.start(api)
    api.audio.loop("music://lobby", {category = "bgm"})
end
function Game.update(api, _dt)
    frame += 1
    if frame == 2 then
        api.audio.loop("music://game", {category = "bgm"})
    end
end
return Game
"#,
            r#"{"categories": {"bgm": {"exclusive": true, "fade_out_frames": 3}}}"#,
        );
        let mut runtime = EngineRuntime::load(dir.path()).unwrap();

        runtime.tick().unwrap();
        let switched = runtime.tick().unwrap();
        assert_eq!(
            switched.audio_loops.len(),
            2,
            "the old track is still fading"
        );
        assert_eq!(
            switched.audio_loops[0].phase,
            crate::audio::AudioPhase::FadingOut
        );
        assert_eq!(switched.audio_loops[0].asset, "music://lobby");
        assert_eq!(switched.audio_loops[1].asset, "music://game");

        let mut assets = Vec::new();
        for _ in 0..4 {
            assets.push(
                runtime
                    .tick()
                    .unwrap()
                    .audio_loops
                    .iter()
                    .map(|source| source.asset.clone())
                    .collect::<Vec<_>>(),
            );
        }
        assert_eq!(
            assets,
            vec![
                vec!["music://lobby".to_string(), "music://game".to_string()],
                vec!["music://game".to_string()],
                vec!["music://game".to_string()],
                vec!["music://game".to_string()],
            ],
            "fade starts at simulation frame 1 and completes at frame 4; completed-frame observations must not retain an expired loop"
        );
    }

    /// Adding audio must not change what a silent game observes, or every
    /// existing baseline digest breaks for no reason.
    #[test]
    fn a_game_that_makes_no_sound_observes_exactly_what_it_did_before() {
        let mut runtime =
            EngineRuntime::load_source("SilentSmoke", "main.luau", IDLE_SCRIPT, None).unwrap();
        let snapshot = runtime.tick().unwrap();
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("audio_events"), "{json}");
        assert!(!json.contains("audio_loops"), "{json}");
    }

    /// A rule this build reserves but does not act on must fail the load; a
    /// game that believes it configured ducking has no way to find out.
    #[test]
    fn a_reserved_audio_rule_fails_the_load_and_names_what_is_implemented() {
        let dir = tempdir().unwrap();
        write_audio_project(
            dir.path(),
            IDLE_SCRIPT,
            r#"{"categories": {"sfx": {"ducking": true}}}"#,
        );
        let error = match EngineRuntime::load(dir.path()) {
            Ok(_) => panic!("a reserved rule must not load"),
            Err(error) => error,
        };
        assert_eq!(error.code, "AUDIO_RULE_NOT_IMPLEMENTED");
        assert!(
            error.explanation.contains("ducking"),
            "{}",
            error.explanation
        );
        assert!(
            error.explanation.contains("fade_out_frames"),
            "{}",
            error.explanation
        );
    }

    #[test]
    fn a_disabled_audio_system_says_which_switch_turned_it_off() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::write(
            dir.path().join("project.unone.json"),
            r#"{
                "name": "AudioOff",
                "entry_script": "scripts/main.luau",
                "systems": {"audio": false}
            }"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("scripts/main.luau"),
            r#"--!strict
local Game = {}
function Game.start(_api) end
function Game.update(api, _dt)
    api.audio.play("sfx://click")
end
return Game
"#,
        )
        .unwrap();
        let error = EngineRuntime::load(dir.path()).unwrap().tick().unwrap_err();
        assert!(
            error.explanation.contains("SYSTEM_DISABLED")
                && error.explanation.contains("--id audio"),
            "{}",
            error.explanation
        );
    }

    #[test]
    fn random_int_is_inclusive_and_rejects_invalid_range() {
        let mut rng = DeterministicRng::new(42);
        for _ in 0..100 {
            let value = rng.next_int(-2, 2).unwrap();
            assert!((-2..=2).contains(&value));
        }
        assert!(rng.next_int(2, -2).is_err());
    }
}

#[cfg(test)]
mod text_input_tick_tests {
    use super::*;
    #[test]
    fn unsuccessful_input_tick_restores_snapshot_and_keeps_pending_edit() {
        let state=Rc::new(RefCell::new(InputState::default()));
        let edit=crate::project::TextInputInteraction{phase:crate::project::TextInputPhase::Change,text:"王重陽".into(),composing:false};
        state.borrow_mut().pending_ui_text_inputs.insert("name".into(),edit.clone());
        {let _tick=InputTick::begin(&state);assert_eq!(state.borrow().ui_text_inputs["name"],edit);}
        assert!(state.borrow().ui_text_inputs.is_empty());
        assert_eq!(state.borrow().pending_ui_text_inputs["name"],edit);
        InputTick::begin(&state).commit();
        assert!(state.borrow().pending_ui_text_inputs.is_empty());
        InputTick::begin(&state).commit();
        assert!(state.borrow().ui_text_inputs.is_empty());
    }
}

/// Run one loading phase and record how long it took.
fn timed_startup<T>(startup: &mut crate::performance::StartupCost, phase: StartupPhase, work: impl FnOnce() -> T) -> T {
    let (value, elapsed) = timed(work);
    startup.set(phase, elapsed);
    value
}
