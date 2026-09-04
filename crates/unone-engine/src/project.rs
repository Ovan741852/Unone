use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::diagnostics::{Diagnostic, EngineResult};

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
        Ok((
            config,
            Self {
                root,
                config: config_path,
                entry_script,
                main_scene,
                test_files,
            },
        ))
    }
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
        if !missing.is_empty() {
            result.diagnostics.push(Diagnostic::warning(
                "PROJECT_FILES_MISSING",
                "專案宣告了尚未存在的檔案",
                "設定檔可以被讀取，但部分入口、場景、測試或 bundle manifest 不存在；下一步應先修正路徑或建立檔案。",
            ));
            if let Some(diagnostic) = result.diagnostics.last_mut() {
                diagnostic.facts = serde_json::json!({"missing": missing});
            }
        }
    }
    result
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
    pub assertions: Vec<TestAssertion>,
}

fn default_test_frames() -> u64 {
    60
}
fn default_test_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestAssertion {
    pub entity: String,
    pub field: String,
    #[serde(default)]
    pub equals: Option<f64>,
    #[serde(default)]
    pub greater_than: Option<f64>,
    #[serde(default)]
    pub less_than: Option<f64>,
}
