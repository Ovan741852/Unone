use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;

use crate::diagnostics::Diagnostic;

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
