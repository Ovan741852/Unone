use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::diagnostics::{Diagnostic, EngineResult};
use crate::world::Vec2;

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    #[serde(default = "default_entry_script")]
    pub entry_script: String,
    #[serde(default)]
    pub main_scene: Option<String>,
    #[serde(default)]
    pub test_files: Vec<String>,
    #[serde(default)]
    pub bundle_manifest: Option<String>,
    #[serde(default)]
    pub asset_manifest: Option<String>,
    /// Engine systems this game explicitly turns on or off.
    ///
    /// Anything not declared keeps the engine default; the engine rejects
    /// unknown ids instead of treating a typo as a disabled system.
    #[serde(default)]
    pub systems: BTreeMap<String, bool>,
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
    pub files: Vec<ProjectFileStatus>,
}

impl ProjectPaths {
    pub fn discover(root: impl AsRef<Path>) -> Result<(ProjectConfig, Self), Box<Diagnostic>> {
        let root = root.as_ref().to_path_buf();
        let config_path = root.join("project.unone.json");
        let text = fs::read_to_string(&config_path).map_err(|err| {
            Box::new(Diagnostic::error(
                "PROJECT_CONFIG_NOT_FOUND",
                "找不到 Unone 專案設定",
                format!("無法讀取 {}：{}", config_path.display(), err),
            ))
        })?;
        let config: ProjectConfig = serde_json::from_str(&text).map_err(|err| {
            Box::new(Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "Unone 專案設定不是有效 JSON",
                format!("{}：{}", config_path.display(), err),
            ))
        })?;
        let entry_script = root.join(&config.entry_script);
        let main_scene = config.main_scene.as_ref().map(|path| root.join(path));
        let test_files = config
            .test_files
            .iter()
            .map(|path| root.join(path))
            .collect();
        let asset_manifest = config.asset_manifest.as_ref().map(|path| root.join(path));
        let bundle_manifest = config.bundle_manifest.as_ref().map(|path| root.join(path));
        Ok((
            config,
            Self {
                root,
                config: config_path,
                entry_script,
                main_scene,
                test_files,
                bundle_manifest,
                asset_manifest,
            },
        ))
    }
}

/// Bootstrap a minimal, valid game project without adding game-specific rules.
///
/// This is a developer-tool operation. It gives an AI a canonical project
/// schema and entrypoint instead of requiring it to infer required fields.
pub fn init(project_root: impl AsRef<Path>, name: &str) -> EngineResult<ProjectInitReport> {
    if name.trim().is_empty() {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_INIT_NAME_INVALID",
            "project name 不可為空",
            "請提供一個非空的 --name；project init 不會替 AI 猜測專案名稱。",
        ));
    }
    let root = project_root.as_ref().to_path_buf();
    if root.exists() && !root.is_dir() {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_ROOT_INVALID",
            "project root 不是目錄",
            format!("{} 必須是目錄。", root.display()),
        ));
    }
    if let Err(error) = fs::create_dir_all(&root) {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_ROOT_CREATE_FAILED",
            "無法建立 project root",
            format!("{}：{}", root.display(), error),
        ));
    }
    let config_path = root.join("project.unone.json");
    let script_path = root.join("scripts/main.luau");
    let scene_path = root.join("scenes/main.scene.json");
    let files = [&config_path, &script_path, &scene_path];
    if let Some(existing) = files.iter().find(|path| path.is_file()) {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_ALREADY_EXISTS",
            "project init 不會覆蓋既有專案檔案",
            format!(
                "{} 已存在；請使用新的空目錄，或手動修改既有 project。",
                existing.display()
            ),
        ));
    }
    if let Err(error) = fs::create_dir_all(root.join("scripts")) {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_INIT_WRITE_FAILED",
            "無法建立 scripts 目錄",
            error.to_string(),
        ));
    }
    if let Err(error) = fs::create_dir_all(root.join("scenes")) {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_INIT_WRITE_FAILED",
            "無法建立 scenes 目錄",
            error.to_string(),
        ));
    }
    let config = serde_json::json!({
        "name": name,
        "entry_script": "scripts/main.luau",
        "main_scene": "scenes/main.scene.json",
        "test_files": []
    });
    let writes = [
        (
            &config_path,
            serde_json::to_vec_pretty(&config).unwrap_or_default(),
        ),
        (&script_path, scaffold_script().into_bytes()),
        (&scene_path, b"{\n  \"entities\": []\n}\n".to_vec()),
    ];
    for (path, bytes) in writes {
        if let Err(error) = fs::write(path, bytes) {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_INIT_WRITE_FAILED",
                "無法寫入 project scaffold",
                format!("{}：{}", path.display(), error),
            ));
        }
    }
    EngineResult::success(ProjectInitReport {
        project: name.to_string(),
        root: root.display().to_string(),
        files: files.iter().map(|path| file_status(path)).collect(),
    })
}

/// The entry script a new project starts from.
///
/// The engine's Luau runtime has no module require, so a single-file game must
/// carry its own type declarations. Inlining the engine's canonical contract is
/// what makes `game check --types` able to reject a call to an API that does
/// not exist; a scaffold typed `any` reports success for anything.
fn scaffold_script() -> String {
    let types = crate::api::typings()
        .lines()
        .filter(|line| !line.trim_start().starts_with("--"))
        .collect::<Vec<_>>()
        .join(
            "
",
        );
    format!(
        "--!strict
-- Engine type contract, inlined by `project init`.
-- Refresh it after an engine upgrade with `game api typings`.
{}

-- Game code starts here. Rules, numbers, ViewModels and save schemas are
-- game-owned; the engine only provides the API declared above.
local Game = {{}}

function Game.start(_api: EngineApi)
end

function Game.update(_api: EngineApi, _dt: number)
end

return Game
",
        types.trim()
    )
}

pub fn inspect(project_root: impl AsRef<Path>) -> EngineResult<ProjectInspectReport> {
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let report = ProjectInspectReport {
        project: config.name,
        root: paths.root.display().to_string(),
        config: file_status(&paths.config),
        entry_script: file_status(&paths.entry_script),
        main_scene: paths.main_scene.as_deref().map(file_status),
        test_files: paths
            .test_files
            .iter()
            .map(|path| file_status(path))
            .collect(),
        bundle_manifest: config
            .bundle_manifest
            .as_ref()
            .map(|path| file_status(&paths.root.join(path))),
        asset_manifest: paths.asset_manifest.as_deref().map(file_status),
    };
    let mut result = EngineResult::success(report);
    if let Some(report) = &result.value {
        let mut missing = Vec::new();
        if !report.entry_script.exists {
            missing.push(report.entry_script.path.clone());
        }
        if let Some(scene) = &report.main_scene
            && !scene.exists
        {
            missing.push(scene.path.clone());
        }
        missing.extend(
            report
                .test_files
                .iter()
                .filter(|file| !file.exists)
                .map(|file| file.path.clone()),
        );
        if let Some(bundle) = &report.bundle_manifest
            && !bundle.exists
        {
            missing.push(bundle.path.clone());
        }
        if let Some(assets) = &report.asset_manifest
            && !assets.exists
        {
            missing.push(assets.path.clone());
        }
        if !missing.is_empty() {
            result.diagnostics.push(Diagnostic::warning(
                "PROJECT_FILES_MISSING",
                "專案宣告了尚未存在的檔案",
                "設定檔可以被讀取，但部分入口、場景、測試、asset manifest 或 bundle manifest 不存在；下一步應先修正路徑或建立檔案。",
            ));
            if let Some(diagnostic) = result.diagnostics.last_mut() {
                diagnostic.facts = serde_json::json!({"missing": missing});
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::{TestAssertion, init, inspect};

    #[test]
    fn init_creates_a_valid_minimal_project() {
        let directory = tempdir().expect("temp project directory");
        let result = init(directory.path(), "ai-smoke");
        assert!(result.ok);
        let report = result.value.expect("init report");
        assert_eq!(report.project, "ai-smoke");
        assert!(report.files.iter().all(|file| file.exists));

        let inspected = inspect(directory.path());
        assert!(inspected.ok);
        let report = inspected.value.expect("inspect report");
        assert!(report.entry_script.exists);
        assert!(report.main_scene.expect("main scene").exists);
    }

    #[test]
    fn init_never_overwrites_an_existing_project_file() {
        let directory = tempdir().expect("temp project directory");
        std::fs::write(directory.path().join("project.unone.json"), "{}").expect("seed file");

        let result = init(directory.path(), "should-not-overwrite");
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "PROJECT_ALREADY_EXISTS");
        assert_eq!(
            std::fs::read_to_string(directory.path().join("project.unone.json")).unwrap(),
            "{}"
        );
    }

    #[test]
    fn test_assertions_reject_ambiguous_targets_and_comparators() {
        let valid: TestAssertion = serde_json::from_value(serde_json::json!({
            "entity": "player",
            "field": "transform.x",
            "greater_than": 1.0
        }))
        .unwrap();
        assert!(valid.validate().is_ok());

        let ambiguous: TestAssertion = serde_json::from_value(serde_json::json!({
            "entity": "player",
            "field": "transform.x",
            "equals": 1.0,
            "greater_than": 0.0
        }))
        .unwrap();
        assert!(ambiguous.validate().unwrap_err().contains("只能提供"));

        let mixed_target: TestAssertion = serde_json::from_value(serde_json::json!({
            "observation": {"key": "state", "equals": {}},
            "equals": 1.0
        }))
        .unwrap();
        assert!(mixed_target.validate().is_err());
    }
}

fn file_status(path: &Path) -> ProjectFileStatus {
    ProjectFileStatus {
        path: path.display().to_string(),
        exists: path.is_file(),
    }
}

#[derive(Debug, Clone, Deserialize)]
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
pub struct InputFrame {
    #[serde(default)]
    pub actions: BTreeMap<String, bool>,
    #[serde(default)]
    pub pointer: Option<PointerInput>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PointerInput {
    pub position: Vec2,
    #[serde(default)]
    pub down: bool,
    /// Host-normalized logical UI coordinates. When omitted, world position
    /// is used as a compatibility-free default for headless callers.
    #[serde(default)]
    pub screen_position: Option<Vec2>,
}

fn default_test_frames() -> u64 {
    60
}
fn default_test_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Deserialize)]
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
}

impl TestAssertion {
    pub fn validate(&self) -> Result<(), String> {
        let target_count = [
            self.observation.is_some(),
            self.ui.is_some(),
            self.animation.is_some(),
            self.effects.is_some(),
            self.entity.is_some() || self.field.is_some(),
        ]
        .into_iter()
        .filter(|present| *present)
        .count();
        if target_count != 1 {
            return Err(
                "Assertion 必須且只能提供 observation、ui、animation、effects 或 entity/field 其中一種目標。"
                .to_string(),
            );
        }
        if (self.ui.is_some() || self.animation.is_some() || self.effects.is_some())
            && self.has_numeric_comparator()
        {
            return Err(
                "非 entity assertion 不可提供 equals、greater_than、less_than 數值 comparator。"
                    .to_string(),
            );
        }
        if let Some(observation) = &self.observation {
            if observation.key.trim().is_empty() {
                return Err("Observation assertion 的 key 不可為空。".to_string());
            }
            if self.has_numeric_comparator() {
                return Err("Observation assertion 不可提供數值 comparator。".to_string());
            }
        }
        if let Some(animation) = &self.animation
            && animation.entity.trim().is_empty()
        {
            return Err("Animation assertion 的 entity 不可為空。".to_string());
        }
        if self.entity.is_some() || self.field.is_some() {
            if self
                .entity
                .as_deref()
                .is_none_or(|entity| entity.trim().is_empty())
            {
                return Err("Entity assertion 必須提供非空 entity。".to_string());
            }
            let field = self
                .field
                .as_deref()
                .ok_or_else(|| "Entity assertion 必須提供 field。".to_string())?;
            if !matches!(field, "transform.x" | "transform.y") {
                return Err(format!("不支援的 assertion field '{field}'。"));
            }
            if self.numeric_comparator_count() != 1 {
                return Err(
                    "Entity assertion 必須且只能提供 equals、greater_than、less_than 其中一個。"
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
pub struct AnimationAssertion {
    pub entity: String,
    pub equals: serde_json::Value,
}

/// Full equality against the live effect list a host would be playing.
#[derive(Debug, Clone, Deserialize)]
pub struct EffectsAssertion {
    pub equals: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObservationAssertion {
    pub key: String,
    pub equals: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UiAssertion {
    pub equals: serde_json::Value,
}
