use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path},
};

use serde::{Deserialize, Serialize};

use crate::{
    bundle::BundleManifest,
    diagnostics::{ActionSuggestion, Diagnostic, EngineResult},
    project::{ProjectFileStatus, ProjectPaths},
    world::SceneFile,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetManifest {
    #[serde(default = "default_manifest_version")]
    pub version: u32,
    #[serde(default)]
    pub assets: Vec<AssetSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AssetSpec {
    pub id: String,
    pub source: String,
    #[serde(default = "default_asset_kind")]
    pub kind: String,
    #[serde(default = "default_asset_bundle")]
    pub bundle: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetReference {
    pub id: String,
    pub entity: String,
    pub component: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetInspectReport {
    pub project: String,
    pub manifest: Option<ProjectFileStatus>,
    pub bundle_manifest: Option<ProjectFileStatus>,
    pub manifest_version: Option<u32>,
    pub assets: Vec<AssetSpec>,
    pub references: Vec<AssetReference>,
    pub missing_asset_ids: Vec<String>,
    pub missing_sources: Vec<String>,
    pub undeclared_bundles: Vec<String>,
    pub unreferenced_asset_ids: Vec<String>,
    pub static_reference_scope: String,
}

fn default_manifest_version() -> u32 {
    1
}

fn default_asset_kind() -> String {
    "texture2d".to_string()
}

fn default_asset_bundle() -> String {
    "content".to_string()
}

/// Inspect scene-declared asset references against the game-owned asset manifest.
///
/// The engine does not decode, cache, download or choose assets here. It only
/// checks the small cross-platform contract that hosts need before resolving a
/// bundle: stable asset id, project-relative source, kind and bundle id.
pub fn inspect(project_root: impl AsRef<Path>) -> EngineResult<AssetInspectReport> {
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let references = match read_scene_references(&paths) {
        Ok(references) => references,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };

    let manifest_status = paths.asset_manifest.as_deref().map(file_status);
    let Some(manifest_path) = paths.asset_manifest.as_deref() else {
        let report = AssetInspectReport {
            project: config.name,
            manifest: None,
            bundle_manifest: paths.bundle_manifest.as_deref().map(file_status),
            manifest_version: None,
            assets: Vec::new(),
            references: references.clone(),
            missing_asset_ids: sorted_unique(references.iter().map(|reference| reference.id.clone())),
            missing_sources: Vec::new(),
            undeclared_bundles: Vec::new(),
            unreferenced_asset_ids: Vec::new(),
            static_reference_scope: "main_scene only; assets created or selected by Luau are not statically discoverable".to_string(),
        };
        let mut result = EngineResult::success(report);
        if !references.is_empty() {
            result
                .diagnostics
                .push(missing_manifest_diagnostic(&references));
        }
        return result;
    };
    if !manifest_path.is_file() {
        let mut diagnostic = Diagnostic::error(
            "ASSET_MANIFEST_NOT_FOUND",
            "找不到專案 asset manifest",
            format!(
                "project.unone.json 宣告了 asset manifest '{}'，但檔案不存在。先建立 manifest，再檢查資產 source 與 bundle。",
                manifest_path.display()
            ),
        );
        diagnostic.facts = serde_json::json!({
            "manifest": manifest_path.display().to_string(),
            "references": references,
        });
        diagnostic.suggested_actions.push(ActionSuggestion {
            action: "create_asset_manifest".to_string(),
            description: "在專案內建立 project.unone.json 宣告的 asset manifest。".to_string(),
            command: Some("game asset inspect --json".to_string()),
        });
        return EngineResult::failure(diagnostic);
    }

    let text = match fs::read_to_string(manifest_path) {
        Ok(text) => text,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_READ_FAILED",
                "無法讀取 asset manifest",
                format!("{}：{}", manifest_path.display(), error),
            ));
        }
    };
    let manifest: AssetManifest = match serde_json::from_str(&text) {
        Ok(manifest) => manifest,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_INVALID",
                "asset manifest 不是有效 JSON",
                format!("{}：{}", manifest_path.display(), error),
            ));
        }
    };
    if manifest.version == 0 {
        return EngineResult::failure(Diagnostic::error(
            "ASSET_MANIFEST_VERSION_INVALID",
            "asset manifest version 無效",
            "asset manifest version 必須是大於 0 的整數。",
        ));
    }

    let mut by_id = BTreeMap::new();
    for asset in &manifest.assets {
        if let Err(diagnostic) = validate_asset_spec(asset) {
            return EngineResult::failure(*diagnostic);
        }
        if by_id.insert(asset.id.clone(), asset).is_some() {
            let mut diagnostic = Diagnostic::error(
                "ASSET_MANIFEST_DUPLICATE_ID",
                "asset manifest 有重複的 asset id",
                format!("asset id '{}' 只能宣告一次。", asset.id),
            );
            diagnostic.facts = serde_json::json!({"asset_id": asset.id});
            return EngineResult::failure(diagnostic);
        }
    }

    let bundle_ids = match read_bundle_ids(&paths) {
        Ok(ids) => ids,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let missing_asset_ids = sorted_unique(
        references
            .iter()
            .filter(|reference| !by_id.contains_key(&reference.id))
            .map(|reference| reference.id.clone()),
    );
    let missing_sources = manifest
        .assets
        .iter()
        .filter(|asset| !paths.root.join(&asset.source).is_file())
        .map(|asset| asset.source.clone())
        .collect::<Vec<_>>();
    let undeclared_bundles = sorted_unique(
        manifest
            .assets
            .iter()
            .filter(|asset| !bundle_ids.contains(&asset.bundle))
            .map(|asset| asset.bundle.clone()),
    );
    let referenced_ids = references
        .iter()
        .map(|reference| reference.id.as_str())
        .collect::<BTreeSet<_>>();
    let unreferenced_asset_ids = manifest
        .assets
        .iter()
        .filter(|asset| !referenced_ids.contains(asset.id.as_str()))
        .map(|asset| asset.id.clone())
        .collect();

    let report = AssetInspectReport {
        project: config.name,
        manifest: manifest_status,
        bundle_manifest: paths.bundle_manifest.as_deref().map(file_status),
        manifest_version: Some(manifest.version),
        assets: manifest.assets,
        references,
        missing_asset_ids,
        missing_sources,
        undeclared_bundles,
        unreferenced_asset_ids,
        static_reference_scope:
            "main_scene only; assets created or selected by Luau are not statically discoverable"
                .to_string(),
    };
    let mut result = EngineResult::success(report);
    if let Some(report) = result.value.as_ref() {
        if !report.missing_asset_ids.is_empty() {
            let mut diagnostic = Diagnostic::warning(
                "ASSET_REFERENCE_MISSING",
                "場景引用了未宣告的 asset id",
                "場景中的 sprite/mesh3d asset id 沒有對應 manifest entry；host 無法可靠解析 source 或 bundle。",
            );
            diagnostic.facts = serde_json::json!({"missing_asset_ids": report.missing_asset_ids});
            diagnostic.suggested_actions.push(ActionSuggestion {
                action: "declare_asset".to_string(),
                description: "在 asset manifest 以相同 id 宣告 source、kind 與 bundle。"
                    .to_string(),
                command: Some("game asset inspect --json".to_string()),
            });
            result.diagnostics.push(diagnostic);
        }
        if !report.missing_sources.is_empty() {
            let mut diagnostic = Diagnostic::warning(
                "ASSET_SOURCE_MISSING",
                "asset manifest 宣告了不存在的 source",
                "asset id 已存在，但 source 檔案不存在；打包或 host 載入會在這裡失敗。",
            );
            diagnostic.facts = serde_json::json!({"missing_sources": report.missing_sources});
            result.diagnostics.push(diagnostic);
        }
        if !report.undeclared_bundles.is_empty() {
            let mut diagnostic = Diagnostic::warning(
                "ASSET_BUNDLE_NOT_DECLARED",
                "asset 指向 manifest 沒有的 bundle",
                "asset 的 bundle id 沒有出現在 bundle manifest；不要讓 host 猜測資產該下載哪一包。",
            );
            diagnostic.facts = serde_json::json!({"undeclared_bundles": report.undeclared_bundles});
            result.diagnostics.push(diagnostic);
        }
    }
    result
}

fn validate_asset_spec(asset: &AssetSpec) -> Result<(), Box<Diagnostic>> {
    if !looks_like_asset_id(&asset.id) {
        let mut diagnostic = Diagnostic::error(
            "ASSET_ID_INVALID",
            "asset id 無效",
            format!(
                "asset id '{}' 必須是帶 scheme 的穩定識別字，例如 asset://characters/bird/red 或 mesh://car。",
                asset.id
            ),
        );
        diagnostic.facts = serde_json::json!({"asset_id": asset.id});
        return Err(Box::new(diagnostic));
    }
    if asset.kind.trim().is_empty() || asset.bundle.trim().is_empty() {
        return Err(Box::new(Diagnostic::error(
            "ASSET_SPEC_INVALID",
            "asset spec 缺少 kind 或 bundle",
            format!("asset '{}' 的 kind 與 bundle 都不可為空。", asset.id),
        )));
    }
    if !is_project_relative(&asset.source) {
        return Err(Box::new(Diagnostic::error(
            "ASSET_SOURCE_OUTSIDE_PROJECT",
            "asset source 超出專案根目錄",
            format!(
                "asset '{}' 的 source '{}' 必須是專案內的相對路徑。",
                asset.id, asset.source
            ),
        )));
    }
    Ok(())
}

fn read_scene_references(paths: &ProjectPaths) -> Result<Vec<AssetReference>, Box<Diagnostic>> {
    let Some(scene_path) = paths.main_scene.as_deref() else {
        return Ok(Vec::new());
    };
    let text = fs::read_to_string(scene_path).map_err(|error| {
        Box::new(Diagnostic::error(
            "SCENE_READ_FAILED",
            "無法讀取主場景",
            format!("{}：{}", scene_path.display(), error),
        ))
    })?;
    let scene: SceneFile = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "SCENE_INVALID",
            "主場景不是有效的 Unone scene JSON",
            format!("{}：{}", scene_path.display(), error),
        ))
    })?;
    let mut references = Vec::new();
    for entity in scene.entities {
        if let Some(sprite) = entity.sprite {
            references.push(AssetReference {
                id: sprite.asset,
                entity: entity.id.clone(),
                component: "sprite".to_string(),
            });
        }
        if let Some(mesh3d) = entity.mesh3d {
            references.push(AssetReference {
                id: mesh3d.asset,
                entity: entity.id,
                component: "mesh3d".to_string(),
            });
        }
    }
    Ok(references)
}

fn read_bundle_ids(paths: &ProjectPaths) -> Result<BTreeSet<String>, Box<Diagnostic>> {
    let Some(bundle_path) = paths.bundle_manifest.as_deref() else {
        return Ok(BTreeSet::new());
    };
    if !bundle_path.is_file() {
        return Ok(BTreeSet::new());
    }
    let text = fs::read_to_string(bundle_path).map_err(|error| {
        Box::new(Diagnostic::error(
            "BUNDLE_MANIFEST_READ_FAILED",
            "無法讀取 bundle manifest",
            format!("{}：{}", bundle_path.display(), error),
        ))
    })?;
    let manifest: BundleManifest = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "BUNDLE_MANIFEST_INVALID",
            "bundle manifest 不是有效 JSON",
            format!("{}：{}", bundle_path.display(), error),
        ))
    })?;
    Ok(manifest
        .bundles
        .into_iter()
        .map(|bundle| bundle.id)
        .collect())
}

fn file_status(path: &Path) -> ProjectFileStatus {
    ProjectFileStatus {
        path: path.display().to_string(),
        exists: path.is_file(),
    }
}

fn looks_like_asset_id(id: &str) -> bool {
    let Some((scheme, path)) = id.split_once("://") else {
        return false;
    };
    !scheme.is_empty()
        && scheme.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
        && !path.trim().is_empty()
        && !id.chars().any(char::is_whitespace)
}

fn is_project_relative(source: &str) -> bool {
    let path = Path::new(source);
    !path.is_absolute()
        && !path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
}

fn sorted_unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn missing_manifest_diagnostic(references: &[AssetReference]) -> Diagnostic {
    let ids = sorted_unique(references.iter().map(|reference| reference.id.clone()));
    let mut diagnostic = Diagnostic::warning(
        "ASSET_MANIFEST_MISSING",
        "場景有 asset reference 但專案沒有 asset manifest",
        "引擎只看見 scene 裡的 asset id，沒有 manifest 就無法驗證 source、kind、bundle 或跨平台 host 解析結果。",
    );
    diagnostic.facts = serde_json::json!({"asset_ids": ids});
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "declare_asset_manifest".to_string(),
        description: "在 project.unone.json 加入 asset_manifest，並為每個靜態 asset reference 宣告 source、kind 與 bundle。".to_string(),
        command: Some("game asset inspect --json".to_string()),
    });
    diagnostic
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::inspect;

    fn write_project(root: &std::path::Path, config: &str, scene: &str) {
        fs::create_dir_all(root.join("scenes")).unwrap();
        fs::write(root.join("project.unone.json"), config).unwrap();
        fs::write(root.join("scenes/main.scene.json"), scene).unwrap();
    }

    #[test]
    fn reports_scene_references_without_inventing_sources() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-test","main_scene":"scenes/main.scene.json"}"#,
            r#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        );
        let result = inspect(dir.path());
        assert!(result.ok);
        assert_eq!(
            result.value.as_ref().unwrap().missing_asset_ids,
            vec!["asset://bird"]
        );
        assert_eq!(result.diagnostics[0].code, "ASSET_MANIFEST_MISSING");
    }

    #[test]
    fn validates_sources_and_bundle_ids() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        fs::create_dir_all(dir.path().join("bundles")).unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-test","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/manifest.json"}"#,
            r#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        );
        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("bundles/manifest.json"),
            r#"{"version":1,"bundles":[{"id":"project","version":"1","source":"project.unone.json","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":1}]}"#,
        )
        .unwrap();
        let result = inspect(dir.path());
        assert!(result.ok);
        let report = result.value.unwrap();
        assert_eq!(report.missing_sources, vec!["assets/bird.svg"]);
        assert_eq!(report.undeclared_bundles, vec!["content"]);
        assert_eq!(result.diagnostics.len(), 2);
    }
}
