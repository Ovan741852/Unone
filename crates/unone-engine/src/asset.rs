use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::{
    bundle::{BundleManager, BundleManifest, digest_bytes},
    diagnostics::{ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult},
    project::{ProjectFileStatus, ProjectPaths, resolve_project_path},
    scene::{parse_scene_file, scene_read_failed},
};

pub const SUPPORTED_ASSET_MANIFEST_VERSION: u32 = 1;
const ACTIVE_ASSET_MANIFEST_BUNDLE_ID: &str = "asset-manifest";

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
    /// Extra project-relative sources this asset cannot be used without, such
    /// as a Spine atlas and its texture pages. They are packed into the same
    /// bundle; the engine does not parse them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
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
    pub static_reference_scope: StaticReferenceScope,
    pub ready_for_packaging: bool,
    pub blockers: Vec<AssetInspectBlocker>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StaticReferenceScope {
    pub roots_inspected: Vec<String>,
    pub components_inspected: Vec<String>,
    pub dynamic_luau_assets_included: bool,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetInspectBlocker {
    pub code: String,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AssetInitReport {
    pub manifest: String,
    pub created: bool,
    pub added_asset: Option<AssetSpec>,
    pub assets: Vec<AssetSpec>,
    pub changed_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub describe_argv: Option<Vec<String>>,
}

pub(crate) fn load_for_pack(root: &Path, path: &Path) -> Result<AssetManifest, Box<Diagnostic>> {
    let path = project_path_from_path(root, path, "asset manifest")?;
    let text = fs::read_to_string(&path).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_READ_FAILED",
            "無法讀取 asset manifest",
            format!("{}：{}", path.display(), error),
        ))
    })?;
    let manifest: AssetManifest = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_INVALID",
            "asset manifest 不是有效 JSON",
            format!("{}：{}", path.display(), error),
        ))
    })?;
    validate_asset_manifest(root, &manifest)?;
    for asset in &manifest.assets {
        let source = resolve_project_path(root, &asset.source)?;
        if !source.is_file() {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SOURCE_NOT_FOUND",
                "找不到 asset source",
                format!(
                    "asset '{}' 指向 '{}'，但 source 檔案不存在。",
                    asset.id, asset.source
                ),
            )));
        }
        for file in &asset.files {
            let companion = resolve_project_path(root, file)?;
            if !companion.is_file() {
                return Err(Box::new(Diagnostic::error(
                    "ASSET_SOURCE_NOT_FOUND",
                    "找不到 asset 附屬檔案",
                    format!("asset '{}' 需要 '{file}'，但檔案不存在。", asset.id),
                )));
            }
        }
    }
    Ok(manifest)
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

#[derive(Debug, Clone, Serialize)]
pub struct AssetReadReport {
    pub project: String,
    pub asset: AssetSpec,
    /// Companion file that was read, when the request was not for the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    pub bundle_generation: u64,
    pub size_bytes: u64,
    pub sha256: String,
    pub output: Option<String>,
    pub host_responsibilities: Vec<String>,
}

/// Verified native-local bytes and their matching active declaration.
/// This Rust-only value is not a JSON report; decoding remains a host concern.
#[derive(Debug)]
pub struct ResolvedAssetBytes {
    pub project: String,
    pub asset: AssetSpec,
    pub bundle_generation: u64,
    pub bytes: Vec<u8>,
}

pub(crate) fn load_declared_manifest(paths: &ProjectPaths) -> Result<AssetManifest, Box<Diagnostic>> {
    let Some(manifest_path) = paths.asset_manifest.as_deref() else {
        return Err(Box::new(Diagnostic::error(
            "ASSET_MANIFEST_MISSING",
            "專案沒有宣告 asset manifest",
            "先在 project.unone.json 設定 asset_manifest，host 才能由 bundle 解析資產。",
        )));
    };
    let manifest_path = project_path_from_path(&paths.root, manifest_path, "asset manifest")?;
    let text = fs::read_to_string(&manifest_path).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_READ_FAILED",
            "無法讀取 asset manifest",
            format!("{}：{}", manifest_path.display(), error),
        ))
    })?;
    let manifest: AssetManifest = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_INVALID",
            "asset manifest 不是有效 JSON",
            format!("{}：{}", manifest_path.display(), error),
        ))
    })?;
    validate_asset_manifest(&paths.root, &manifest)?;
    Ok(manifest)
}

pub(crate) fn load_active_asset_manifest(
    root: &Path,
    manager: &BundleManager,
) -> Result<AssetManifest, Box<Diagnostic>> {
    let bytes = manager.read_active_bundle(ACTIVE_ASSET_MANIFEST_BUNDLE_ID)?;
    let manifest: AssetManifest = serde_json::from_slice(&bytes).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_ACTIVE_MANIFEST_INVALID",
            "active asset manifest 不是有效 JSON",
            error.to_string(),
        ))
    })?;
    validate_asset_manifest(root, &manifest)?;
    Ok(manifest)
}

/// Load the game-owned asset manifest a host needs before resolving bundles.
///
/// The engine validates only the declaration contract: supported manifest
/// version, stable ids, project-relative sources, kind and bundle id.
pub fn manifest(project_root: impl AsRef<Path>) -> EngineResult<AssetManifest> {
    let (_, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let manifest = match load_declared_manifest(&paths) {
        Ok(manifest) => manifest,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    EngineResult::success(manifest)
}

/// Resolve one declared asset from the project's active bundle generation.
///
/// This is the native half of the cross-host asset contract: the same asset id
/// must produce the same bytes and digest in the Web host and here. The engine
/// verifies the complete active declaration, bundle/archive integrity and the
/// observation token; decoding, texture upload and download policy stay in each host.
pub fn read(
    project_root: impl AsRef<Path>,
    asset_id: &str,
    file: Option<&str>,
    output: Option<&Path>,
) -> EngineResult<AssetReadReport> {
    read_with_observation_hook(project_root, asset_id, file, output, || {})
}

/// Resolve a primary or declared companion with matching authoring/active specs.
/// A changing manifest or active record fails before bytes reach the caller.
pub fn resolve_asset_bytes(
    project_root: impl AsRef<Path>,
    asset_id: &str,
    file: Option<&str>,
) -> Result<ResolvedAssetBytes, Box<Diagnostic>> {
    resolve_asset_bytes_with_observation_hook(project_root, asset_id, file, || {})
}

// A private hook makes external host-state changes deterministic in tests.
fn resolve_asset_bytes_with_observation_hook(
    project_root: impl AsRef<Path>,
    asset_id: &str,
    file: Option<&str>,
    after_read: impl FnOnce(),
) -> Result<ResolvedAssetBytes, Box<Diagnostic>> {
    let (config, paths) = ProjectPaths::discover(project_root)?;
    let manifest = load_declared_manifest(&paths)?;
    let Some(asset) = manifest
        .assets
        .iter()
        .find(|candidate| candidate.id == asset_id)
    else {
        let mut diagnostic = Diagnostic::error(
            "ASSET_ID_NOT_DECLARED",
            "asset manifest 沒有這個 asset id",
            format!("manifest 沒有宣告 asset '{asset_id}'；引擎不會猜測資產來源。"),
        );
        diagnostic.facts = serde_json::json!({
            "asset_id": asset_id,
            "declared": manifest
                .assets
                .iter()
                .map(|asset| asset.id.clone())
                .collect::<Vec<_>>(),
        });
        diagnostic.suggested_actions.push(ActionSuggestion {
            action: "inspect_assets".to_string(),
            description: "列出目前宣告與被場景參照的 asset id。".to_string(),
            command: Some("game asset inspect --json".to_string()),
        });
        return Err(Box::new(diagnostic));
    };
    let manager = BundleManager::from_project(&paths.root)?;
    let observation_before = manager.observation_token()?;
    let Some(bundle_generation) = manager.active_generation()? else {
        return Err(Box::new(Diagnostic::error(
            "BUNDLE_GENERATION_MISMATCH",
            "沒有已啟用的 bundle generation",
            "讀取資產前必須先安裝並啟用一個 generation。",
        )));
    };
    let active_manifest = load_active_asset_manifest(&paths.root, &manager)?;
    let active_asset = active_manifest
        .assets
        .iter()
        .find(|candidate| candidate.id == asset_id);
    if active_asset != Some(asset) {
        let mut diagnostic = Diagnostic::error(
            "BUNDLE_GENERATION_MISMATCH",
            "asset 宣告與 active generation 不一致",
            format!(
                "active asset-manifest 中 asset '{asset_id}' 的完整宣告必須與作者宣告相同；不會混用作者 metadata 與 active bytes。"
            ),
        );
        diagnostic.facts = serde_json::json!({
            "asset_id": asset_id,
            "generation": bundle_generation,
            "authoring_asset": asset,
            "active_asset": active_asset,
        });
        return Err(Box::new(diagnostic));
    }
    let active_asset = active_asset.expect("the complete active spec matched above");
    let mut resolved = active_asset.clone();
    if let Some(file) = file {
        if !active_asset.files.iter().any(|candidate| candidate == file) {
            let mut diagnostic = Diagnostic::error(
                "ASSET_FILE_NOT_DECLARED",
                "asset 沒有宣告這個附屬檔案",
                format!("asset '{asset_id}' 的 files 沒有 '{file}'；引擎不會讀取未宣告的內容。"),
            );
            diagnostic.facts = serde_json::json!({
                "asset_id": asset_id,
                "requested": file,
                "declared": active_asset.files,
            });
            return Err(Box::new(diagnostic));
        }
        resolved.source = file.to_string();
    }
    let bytes = manager.read_active_asset(&resolved)?;
    after_read();
    let observation_after = manager.observation_token()?;
    if observation_before != observation_after {
        let mut diagnostic = Diagnostic::error(
            "BUNDLE_GENERATION_MISMATCH",
            "asset read 期間 active observation 發生變更",
            "bundle manifest 或 active record 在讀取期間改變；無法確認 metadata、generation 與 bytes 屬於同一次觀測，因此未寫出 output。",
        );
        diagnostic.facts = serde_json::json!({
            "asset_id": asset_id,
            "generation": bundle_generation,
            "observation_token_before": observation_before,
            "observation_token_after": observation_after,
        });
        return Err(Box::new(diagnostic));
    }
    Ok(ResolvedAssetBytes {
        project: config.name,
        asset: active_asset.clone(),
        bundle_generation,
        bytes,
    })
}

fn read_with_observation_hook(
    project_root: impl AsRef<Path>,
    asset_id: &str,
    file: Option<&str>,
    output: Option<&Path>,
    after_read: impl FnOnce(),
) -> EngineResult<AssetReadReport> {
    let ResolvedAssetBytes {
        project,
        asset,
        bundle_generation,
        bytes,
    } = match resolve_asset_bytes_with_observation_hook(project_root, asset_id, file, after_read) {
        Ok(resolved) => resolved,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let mut effects = Vec::new();
    let written = match output {
        Some(path) => {
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
                && let Err(error) = fs::create_dir_all(parent)
            {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_OUTPUT_WRITE_FAILED",
                    "無法建立 asset 輸出目錄",
                    format!("{}：{}", parent.display(), error),
                ));
            }
            if let Err(error) = fs::write(path, &bytes) {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_OUTPUT_WRITE_FAILED",
                    "無法寫出 asset 內容",
                    format!("{}：{}", path.display(), error),
                ));
            }
            effects.push(format!(
                "asset '{}' ({}) written to {}",
                asset.id,
                file.unwrap_or(&asset.source),
                path.display()
            ));
            Some(path.display().to_string())
        }
        None => None,
    };
    let mut result = EngineResult::success(AssetReadReport {
        project,
        asset,
        file: file.map(str::to_string),
        bundle_generation,
        size_bytes: bytes.len() as u64,
        sha256: digest_bytes(&bytes),
        output: written,
        host_responsibilities: vec![
            "decode 與 GPU 資源生命週期屬於 host".to_string(),
            "下載、重試、快取容量與 CDN policy 屬於 host".to_string(),
            "engine 只驗證 bundle 與 archive entry 的完整性".to_string(),
        ],
    });
    result.effects = effects;
    result
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

    let manifest_path = match paths
        .asset_manifest
        .as_deref()
        .map(|path| project_path_from_path(&paths.root, path, "asset manifest"))
        .transpose()
    {
        Ok(path) => path,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let bundle_manifest_path = match paths
        .bundle_manifest
        .as_deref()
        .map(|path| project_path_from_path(&paths.root, path, "bundle manifest"))
        .transpose()
    {
        Ok(path) => path,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let manifest_status = manifest_path.as_deref().map(file_status);
    let Some(manifest_path) = manifest_path.as_deref() else {
        let report = AssetInspectReport {
            project: config.name,
            manifest: None,
            bundle_manifest: bundle_manifest_path.as_deref().map(file_status),
            manifest_version: None,
            assets: Vec::new(),
            references: references.clone(),
            missing_asset_ids: sorted_unique(
                references.iter().map(|reference| reference.id.clone()),
            ),
            missing_sources: Vec::new(),
            undeclared_bundles: Vec::new(),
            unreferenced_asset_ids: Vec::new(),
            static_reference_scope: static_reference_scope(&paths),
            ready_for_packaging: references.is_empty(),
            blockers: if references.is_empty() {
                Vec::new()
            } else {
                vec![AssetInspectBlocker {
                    code: "ASSET_MANIFEST_MISSING".to_string(),
                    items: sorted_unique(references.iter().map(|reference| reference.id.clone())),
                }]
            },
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
    if let Err(diagnostic) = validate_asset_manifest(&paths.root, &manifest) {
        return EngineResult::failure(*diagnostic);
    }

    let mut by_id = BTreeMap::new();
    for asset in &manifest.assets {
        by_id.insert(asset.id.clone(), asset);
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
    let missing_sources = sorted_unique(
        manifest
            .assets
            .iter()
            .flat_map(|asset| {
                std::iter::once(asset.source.clone()).chain(asset.files.iter().cloned())
            })
            .filter(|source| {
                resolve_project_path(&paths.root, source)
                    .map(|path| !path.is_file())
                    .unwrap_or(true)
            }),
    );
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
        bundle_manifest: bundle_manifest_path.as_deref().map(file_status),
        manifest_version: Some(manifest.version),
        assets: manifest.assets,
        references,
        missing_asset_ids: missing_asset_ids.clone(),
        missing_sources: missing_sources.clone(),
        undeclared_bundles: undeclared_bundles.clone(),
        unreferenced_asset_ids,
        static_reference_scope: static_reference_scope(&paths),
        ready_for_packaging: missing_asset_ids.is_empty()
            && missing_sources.is_empty()
            && undeclared_bundles.is_empty(),
        blockers: {
            let mut blockers = Vec::new();
            if !missing_asset_ids.is_empty() {
                blockers.push(AssetInspectBlocker {
                    code: "ASSET_REFERENCE_MISSING".to_string(),
                    items: missing_asset_ids.clone(),
                });
            }
            if !missing_sources.is_empty() {
                blockers.push(AssetInspectBlocker {
                    code: "ASSET_SOURCE_MISSING".to_string(),
                    items: missing_sources.clone(),
                });
            }
            if !undeclared_bundles.is_empty() {
                blockers.push(AssetInspectBlocker {
                    code: "ASSET_BUNDLE_NOT_DECLARED".to_string(),
                    items: undeclared_bundles.clone(),
                });
            }
            blockers
        },
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
                command: Some(
                    "game asset init --id \"<asset-id>\" --source \"<project-relative-source>\" --json"
                        .to_string(),
                ),
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
            if let Some(asset) = report.assets.iter().find(|asset| {
                report
                    .missing_sources
                    .iter()
                    .any(|path| path == &asset.source || asset.files.iter().any(|file| file == path))
            }) {
                diagnostic.suggested_actions.push(ActionSuggestion {
                    action: "describe_asset".to_string(),
                    description: "查看這個 declared asset 的 manifest pointer、shared files、引用與 native-local freshness。"
                        .to_string(),
                    command: Some(format!(
                        "game asset describe --id {:?} --json",
                        asset.id
                    )),
                });
            }
            result.diagnostics.push(diagnostic);
        }
        if !report.undeclared_bundles.is_empty() {
            let mut diagnostic = Diagnostic::warning(
                "ASSET_BUNDLE_NOT_DECLARED",
                "asset 指向 manifest 沒有的 bundle",
                "asset 的 bundle id 沒有出現在 bundle manifest；不要讓 host 猜測資產該下載哪一包。",
            );
            diagnostic.facts = serde_json::json!({"undeclared_bundles": report.undeclared_bundles});
            if let Some(asset) = report.assets.iter().find(|asset| {
                report
                    .undeclared_bundles
                    .iter()
                    .any(|bundle| bundle == &asset.bundle)
            }) {
                diagnostic.suggested_actions.push(ActionSuggestion {
                    action: "describe_asset".to_string(),
                    description: "先以單筆 asset describe 確認宣告與 active 狀態，再依序 pack/inspect/install。"
                        .to_string(),
                    command: Some(format!(
                        "game asset describe --id {:?} --json",
                        asset.id
                    )),
                });
            }
            result.diagnostics.push(diagnostic);
        }
    }
    result
}

/// Create or extend the game's asset manifest without inventing source files.
///
/// This is a developer-tool operation. Runtime hosts consume the resulting
/// JSON contract but do not walk the project or call this function.
pub fn init_asset_manifest(
    project_root: impl AsRef<Path>,
    output_path: Option<&Path>,
    new_asset: Option<AssetSpec>,
) -> EngineResult<AssetInitReport> {
    let (config, paths) = match ProjectPaths::discover(project_root) {
        Ok(value) => value,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let root = match fs::canonicalize(&paths.root) {
        Ok(root) => root,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_ROOT_NOT_FOUND",
                "找不到 Unone 專案根目錄",
                format!("{}：{}", paths.root.display(), error),
            ));
        }
    };
    let candidate_relative = match output_path {
        Some(path) if path.is_absolute() => match path.strip_prefix(&root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_MANIFEST_OUTPUT_OUTSIDE_PROJECT",
                    "asset manifest 輸出位置超出專案根目錄",
                    "asset init 只會修改目前遊戲專案內的 manifest 與 project config。",
                ));
            }
        },
        Some(path) => path.to_string_lossy().replace('\\', "/"),
        None => config
            .asset_manifest
            .as_deref()
            .map(|path| path.replace('\\', "/"))
            .unwrap_or_else(|| "assets/manifest.json".to_string()),
    };
    let candidate = match resolve_project_path(&root, &candidate_relative) {
        Ok(path) => path,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let config_path = match resolve_project_path(&root, "project.unone.json") {
        Ok(path) => path,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };

    let mut manifest = if candidate.is_file() {
        let text = match fs::read_to_string(&candidate) {
            Ok(text) => text,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_MANIFEST_READ_FAILED",
                    "無法讀取 asset manifest",
                    format!("{}：{}", candidate.display(), error),
                ));
            }
        };
        match serde_json::from_str::<AssetManifest>(&text) {
            Ok(manifest) => manifest,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_MANIFEST_INVALID",
                    "asset manifest 不是有效 JSON",
                    format!("{}：{}", candidate.display(), error),
                ));
            }
        }
    } else {
        AssetManifest {
            version: SUPPORTED_ASSET_MANIFEST_VERSION,
            assets: Vec::new(),
        }
    };
    if let Err(diagnostic) = validate_asset_manifest(&root, &manifest) {
        return EngineResult::failure(*diagnostic);
    }
    let mut ids = BTreeSet::new();
    for asset in &manifest.assets {
        ids.insert(asset.id.clone());
    }
    if let Some(asset) = &new_asset {
        if let Err(diagnostic) = validate_asset_spec(asset) {
            return EngineResult::failure(*diagnostic);
        }
        if let Err(diagnostic) = validate_asset_paths(&root, asset) {
            return EngineResult::failure(*diagnostic);
        }
        if !ids.insert(asset.id.clone()) {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_DUPLICATE_ID",
                "asset manifest 已有相同的 asset id",
                format!(
                    "asset id '{}' 已存在，避免 asset init 靜默覆蓋既有宣告。",
                    asset.id
                ),
            ));
        }
        manifest.assets.push(asset.clone());
    }
    let created = !candidate.is_file();
    let changed = created || new_asset.is_some();
    let mut changed_files = Vec::new();
    let mut effects = Vec::new();
    if changed {
        let bytes = match serde_json::to_vec_pretty(&manifest) {
            Ok(bytes) => bytes,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_MANIFEST_WRITE_FAILED",
                    "無法序列化 asset manifest",
                    error.to_string(),
                ));
            }
        };
        if let Some(parent) = candidate.parent()
            && let Err(error) = fs::create_dir_all(parent)
        {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_WRITE_FAILED",
                "無法建立 asset manifest 目錄",
                format!("{}：{}", parent.display(), error),
            ));
        }
        if let Err(error) = fs::write(&candidate, bytes) {
            return init_failure_with_effects(
                Diagnostic::error(
                "ASSET_MANIFEST_WRITE_FAILED",
                "無法寫入 asset manifest",
                format!("{}：{}", candidate.display(), error),
                ),
                effects,
                changed_files,
            );
        }
        let path = candidate.display().to_string();
        changed_files.push(path.clone());
        effects.push(format!("asset init wrote {path}"));
    }

    let manifest_relative = candidate_relative;
    let config_text = match fs::read_to_string(&config_path) {
        Ok(text) => text,
        Err(error) => {
            return init_failure_with_effects(
                Diagnostic::error(
                "PROJECT_CONFIG_READ_FAILED",
                "無法更新 asset manifest 設定",
                format!("{}：{}", config_path.display(), error),
                ),
                effects,
                changed_files,
            );
        }
    };
    let mut config_json: serde_json::Value = match serde_json::from_str(&config_text) {
        Ok(config_json) => config_json,
        Err(error) => {
            return init_failure_with_effects(
                Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "Unone 專案設定不是有效 JSON",
                error.to_string(),
                ),
                effects,
                changed_files,
            );
        }
    };
    let Some(config_object) = config_json.as_object_mut() else {
        return init_failure_with_effects(
            Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "專案設定必須是 JSON object",
                "asset init 需要在 project.unone.json 設定 asset_manifest。",
            ),
            effects,
            changed_files,
        );
    };
    let config_changed = config_object
        .get("asset_manifest")
        .and_then(|value| value.as_str())
        != Some(&manifest_relative);
    if config_changed {
        config_object.insert(
            "asset_manifest".to_string(),
            serde_json::Value::String(manifest_relative.clone()),
        );
        let bytes = match serde_json::to_vec_pretty(&config_json) {
            Ok(bytes) => bytes,
            Err(error) => {
                return init_failure_with_effects(
                    Diagnostic::error(
                        "PROJECT_CONFIG_WRITE_FAILED",
                        "無法序列化專案設定",
                        error.to_string(),
                    ),
                    effects,
                    changed_files,
                );
            }
        };
        if let Err(error) = fs::write(&config_path, bytes) {
            return init_failure_with_effects(
                Diagnostic::error(
                    "PROJECT_CONFIG_WRITE_FAILED",
                    "無法更新 asset_manifest 設定",
                    error.to_string(),
                ),
                effects,
                changed_files,
            );
        }
        let path = config_path.display().to_string();
        changed_files.push(path.clone());
        effects.push(format!("asset init wrote {path}"));
    }

    let describe_argv = new_asset.as_ref().map(|asset| {
        vec![
            "--project".to_string(),
            root.display().to_string(),
            "asset".to_string(),
            "describe".to_string(),
            "--id".to_string(),
            asset.id.clone(),
            "--json".to_string(),
        ]
    });
    let mut result = EngineResult::success(AssetInitReport {
        manifest: candidate.display().to_string(),
        created,
        added_asset: new_asset,
        assets: manifest.assets,
        changed_files,
        describe_argv,
    });
    result.effects = effects;
    result
}

fn init_failure_with_effects(
    mut diagnostic: Diagnostic,
    effects: Vec<String>,
    changed_files: Vec<String>,
) -> EngineResult<AssetInitReport> {
    diagnostic.facts = serde_json::json!({"changed_files": changed_files});
    let mut result = EngineResult::failure(diagnostic);
    result.effects = effects;
    result
}

/// Turn static asset warnings into a build/CI gate failure.
///
/// inspect remains useful while an AI is authoring a project: it returns the
/// partial report and explains unresolved references. A release or handoff
/// gate must call this strict form so ok=false cannot be mistaken for a
/// verified content contract.
pub fn inspect_strict(project_root: impl AsRef<Path>) -> EngineResult<AssetInspectReport> {
    let mut result = inspect(project_root);
    if result.ok {
        let has_warning = result
            .diagnostics
            .iter()
            .any(|diagnostic| matches!(diagnostic.severity, DiagnosticSeverity::Warning));
        if has_warning {
            result.ok = false;
            for diagnostic in &mut result.diagnostics {
                if matches!(diagnostic.severity, DiagnosticSeverity::Warning) {
                    diagnostic.severity = DiagnosticSeverity::Error;
                }
            }
        }
    }
    result
}

pub(crate) fn validate_asset_manifest(
    root: &Path,
    manifest: &AssetManifest,
) -> Result<(), Box<Diagnostic>> {
    if manifest.version != SUPPORTED_ASSET_MANIFEST_VERSION {
        return Err(Box::new(Diagnostic::error(
            "ASSET_MANIFEST_VERSION_INVALID",
            "asset manifest version 無效",
            format!(
                "目前只支援 asset manifest version {}，不會把未支援的版本靜默當成目前格式。",
                SUPPORTED_ASSET_MANIFEST_VERSION
            ),
        )));
    }
    let mut ids = BTreeSet::new();
    for asset in &manifest.assets {
        validate_asset_spec(asset)?;
        if !ids.insert(asset.id.clone()) {
            return Err(Box::new(Diagnostic::error(
                "ASSET_MANIFEST_DUPLICATE_ID",
                "asset manifest 有重複的 asset id",
                format!("asset id '{}' 只能宣告一次。", asset.id),
            )));
        }
        validate_asset_paths(root, asset)?;
    }
    Ok(())
}

pub(crate) fn validate_asset_paths(
    root: &Path,
    asset: &AssetSpec,
) -> Result<(), Box<Diagnostic>> {
    resolve_project_path(root, &asset.source)?;
    for file in &asset.files {
        resolve_project_path(root, file)?;
    }
    Ok(())
}

pub(crate) fn validate_asset_spec(asset: &AssetSpec) -> Result<(), Box<Diagnostic>> {
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
    if !is_supported_asset_kind(&asset.kind) || asset.bundle.trim().is_empty() {
        return Err(Box::new(Diagnostic::error(
            "ASSET_SPEC_INVALID",
            "asset spec 的 kind 或 bundle 無效",
            format!(
                "asset '{}' 的 kind 必須是 texture2d、mesh3d、spine、effekseer 或 audio，bundle 不可為空。",
                asset.id
            ),
        )));
    }
    if !is_safe_bundle_id(&asset.bundle) {
        return Err(Box::new(Diagnostic::error(
            "ASSET_BUNDLE_ID_INVALID",
            "asset bundle id 無效",
            format!(
                "asset '{}' 的 bundle '{}' 只能包含單一安全名稱，不能包含路徑分隔符。",
                asset.id, asset.bundle
            ),
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
    let mut files = BTreeSet::new();
    for file in &asset.files {
        if !is_project_relative(file) {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SOURCE_OUTSIDE_PROJECT",
                "asset 附屬檔案超出專案根目錄",
                format!(
                    "asset '{}' 的 files 項目 '{file}' 必須是專案內的相對路徑。",
                    asset.id
                ),
            )));
        }
        if *file == asset.source {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SPEC_INVALID",
                "asset 附屬檔案重複宣告了 source",
                format!("asset '{}' 的 files 不可再列出 source 本身。", asset.id),
            )));
        }
        if !files.insert(file) {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SPEC_INVALID",
                "asset 附屬檔案重複宣告",
                format!("asset '{}' 的 files 不可重複列出 '{file}'。", asset.id),
            )));
        }
    }
    Ok(())
}

fn project_path_from_path(
    root: &Path,
    path: &Path,
    label: &str,
) -> Result<PathBuf, Box<Diagnostic>> {
    let relative = path.strip_prefix(root).map_err(|_| {
        Box::new(Diagnostic::error(
            "ASSET_PATH_OUTSIDE_PROJECT",
            "asset workflow path 超出專案根目錄",
            format!("{label} '{}' 必須位於專案根目錄內。", path.display()),
        ))
    })?;
    resolve_project_path(root, &relative.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn read_scene_references(
    paths: &ProjectPaths,
) -> Result<Vec<AssetReference>, Box<Diagnostic>> {
    let Some(scene_path) = paths.main_scene.as_deref() else {
        return Ok(Vec::new());
    };
    let scene_path = project_path_from_path(&paths.root, scene_path, "main scene")?;
    let text = fs::read_to_string(&scene_path).map_err(|error| {
        scene_read_failed(&scene_path, error)
    })?;
    let scene = parse_scene_file(&text, &scene_path)?;
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
                entity: entity.id.clone(),
                component: "mesh3d".to_string(),
            });
        }
        if let Some(animation) = entity.animation {
            references.push(AssetReference {
                id: animation.asset,
                entity: entity.id,
                component: "animation".to_string(),
            });
        }
    }
    Ok(references)
}

fn read_bundle_ids(paths: &ProjectPaths) -> Result<BTreeSet<String>, Box<Diagnostic>> {
    let Some(bundle_path) = paths.bundle_manifest.as_deref() else {
        return Ok(BTreeSet::new());
    };
    let bundle_path = project_path_from_path(&paths.root, bundle_path, "bundle manifest")?;
    if !bundle_path.is_file() {
        return Ok(BTreeSet::new());
    }
    let text = fs::read_to_string(&bundle_path).map_err(|error| {
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
    if source.trim().is_empty() || source.contains('\\') || source.contains(':') {
        return false;
    }
    let path = Path::new(source);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn is_supported_asset_kind(kind: &str) -> bool {
    matches!(kind, "texture2d" | "mesh3d" | "spine" | "effekseer" | "audio")
}

fn is_safe_bundle_id(bundle: &str) -> bool {
    bundle != "."
        && bundle != ".."
        && !bundle.is_empty()
        && !bundle.chars().any(|character| {
            character == '/' || character == '\\' || character == ':' || character.is_whitespace()
        })
}

fn sorted_unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn static_reference_scope(paths: &ProjectPaths) -> StaticReferenceScope {
    let mut roots_inspected = vec!["project.unone.json".to_string()];
    if paths.main_scene.is_some() {
        roots_inspected.push("main_scene".to_string());
    }
    if paths.asset_manifest.is_some() {
        roots_inspected.push("asset_manifest".to_string());
    }
    if paths.bundle_manifest.is_some() {
        roots_inspected.push("bundle_manifest".to_string());
    }
    StaticReferenceScope {
        roots_inspected,
        components_inspected: vec![
            "sprite".to_string(),
            "mesh3d".to_string(),
            "animation".to_string(),
        ],
        dynamic_luau_assets_included: false,
        limitations: vec![
            "Only main_scene static references are inspected.".to_string(),
            "Assets created or selected dynamically by Luau are not discoverable here.".to_string(),
            "Effect assets are spawned from Luau, so they are never a static scene reference."
                .to_string(),
        ],
    }
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
        command: Some("game asset init --json".to_string()),
    });
    diagnostic
}

#[cfg(test)]
pub(crate) mod workflow_test_support {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use crate::bundle::{BundleManager, BundleManifest, digest_bytes, pack_project};

    pub fn installed_project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for directory in ["assets", "scripts", "scenes"] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        fs::write(
            root.join("project.unone.json"),
            r#"{"name":"ActiveAssetRead","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/manifest.json"}"#,
        ).unwrap();
        fs::write(root.join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(root.join("scenes/main.scene.json"), br#"{"entities":[]}"#).unwrap();
        fs::write(
            root.join("assets/manifest.json"),
            br#"{"version":1,"assets":[{"id":"asset://a","source":"assets/a.svg","kind":"texture2d","bundle":"content","files":["assets/a.atlas","assets/a.png"]}]}"#,
        ).unwrap();
        fs::write(root.join("assets/a.svg"), b"primary").unwrap();
        fs::write(root.join("assets/a.atlas"), b"atlas").unwrap();
        fs::write(root.join("assets/a.png"), b"page").unwrap();
        let packed = pack_project(root, None);
        assert!(packed.ok, "{packed:?}");
        let installed = BundleManager::from_project(root)
            .unwrap()
            .install("content");
        assert!(installed.ok, "{installed:?}");
        dir
    }

    pub fn bundle_manifest(root: &Path) -> BundleManifest {
        serde_json::from_slice(&fs::read(root.join("bundles/manifest.json")).unwrap()).unwrap()
    }

    pub fn cache_path(root: &Path, bundle_id: &str) -> PathBuf {
        let manifest = bundle_manifest(root);
        let spec = manifest
            .bundles
            .iter()
            .find(|spec| spec.id == bundle_id)
            .unwrap();
        root.join(".unone/cache/bundles")
            .join(format!("{}.bundle", spec.sha256))
    }

    // Re-sign and install deliberately invalid inner payloads so tests reach
    // asset declaration/archive validation after bundle integrity succeeds.
    pub fn replace_installed_bundle(root: &Path, bundle_id: &str, bytes: &[u8]) {
        let manager = BundleManager::from_project(root).unwrap();
        let mut manifest = bundle_manifest(root);
        let spec = manifest
            .bundles
            .iter_mut()
            .find(|spec| spec.id == bundle_id)
            .unwrap();
        spec.source = format!("bundles/test-{bundle_id}.bin");
        spec.size_bytes = bytes.len() as u64;
        spec.sha256 = digest_bytes(bytes);
        fs::write(root.join(&spec.source), bytes).unwrap();
        fs::write(
            root.join("bundles/manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let installed = manager.install("content");
        assert!(installed.ok, "{installed:?}");
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use crate::bundle::{BundleManager, pack_project};
    use crate::asset_workflow::describe_asset;

    use super::{
        AssetSpec, init_asset_manifest, inspect, inspect_strict, is_project_relative, read,
        read_with_observation_hook,
        workflow_test_support::{
            bundle_manifest, cache_path, installed_project, replace_installed_bundle,
        },
    };

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
        assert!(!result.value.as_ref().unwrap().ready_for_packaging);
        assert!(
            !result
                .value
                .as_ref()
                .unwrap()
                .static_reference_scope
                .dynamic_luau_assets_included
        );
        assert_eq!(result.diagnostics[0].code, "ASSET_MANIFEST_MISSING");
        assert_eq!(
            result.diagnostics[0].suggested_actions[0]
                .command
                .as_deref(),
            Some("game asset init --json")
        );
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

    #[test]
    fn strict_inspection_turns_unresolved_references_into_a_gate_failure() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-test","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json"}"#,
            r#"{"entities":[{"id":"bird","sprite":{"asset":"asset://missing"}}]}"#,
        );
        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[]}"#,
        )
        .unwrap();
        let result = inspect_strict(dir.path());
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "ASSET_REFERENCE_MISSING");
        assert!(matches!(
            result.diagnostics[0].severity,
            crate::diagnostics::DiagnosticSeverity::Error
        ));
    }

    #[test]
    fn rejects_unsupported_manifest_version_and_kind() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-test","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json"}"#,
            r#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        );
        fs::write(dir.path().join("assets/bird.svg"), b"svg").unwrap();
        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":2,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();
        let result = inspect(dir.path());
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "ASSET_MANIFEST_VERSION_INVALID");

        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"typo","bundle":"content"}]}"#,
        )
        .unwrap();
        let result = inspect(dir.path());
        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "ASSET_SPEC_INVALID");
    }

    #[test]
    fn duplicate_ids_fail_closed_for_manifest_read_and_describe() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-duplicate","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/manifest.json"}"#,
            r#"{"entities":[]}"#,
        );
        fs::write(dir.path().join("assets/a.svg"), b"a").unwrap();
        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[{"id":"asset://same","source":"assets/a.svg","kind":"texture2d","bundle":"content"},{"id":"asset://same","source":"assets/a.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();
        assert_eq!(
            super::manifest(dir.path()).diagnostics[0].code,
            "ASSET_MANIFEST_DUPLICATE_ID"
        );
        assert_eq!(
            read(dir.path(), "asset://same", None, None).diagnostics[0].code,
            "ASSET_MANIFEST_DUPLICATE_ID"
        );
        assert_eq!(
            describe_asset(dir.path(), "asset://same").diagnostics[0].code,
            "ASSET_MANIFEST_DUPLICATE_ID"
        );
    }

    #[test]
    fn companion_path_safety_is_shared_by_inspect_and_pack() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-companion-path","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/manifest.json"}"#,
            r#"{"entities":[]}"#,
        );
        fs::write(dir.path().join("assets/a.svg"), b"a").unwrap();
        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[{"id":"asset://a","source":"assets/a.svg","kind":"texture2d","bundle":"content","files":["../outside.atlas"]}]}"#,
        )
        .unwrap();
        assert_eq!(
            inspect(dir.path()).diagnostics[0].code,
            "ASSET_SOURCE_OUTSIDE_PROJECT"
        );
        let packed = pack_project(dir.path(), None);
        assert!(!packed.ok, "越界 companion 不應被 pack");
        assert!(!packed.diagnostics.is_empty());
    }

    #[test]
    fn rejects_nonportable_asset_source_paths() {
        assert!(!is_project_relative(""));
        assert!(!is_project_relative("."));
        assert!(!is_project_relative(r"assets\bird.svg"));
        assert!(!is_project_relative("../outside.svg"));
        assert!(!is_project_relative("C:/outside.svg"));
        assert!(is_project_relative("assets/bird.svg"));
    }

    #[test]
    fn asset_init_creates_contract_and_adds_explicit_declaration() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-init","main_scene":"scenes/main.scene.json"}"#,
            r#"{"entities":[]}"#,
        );
        let first = init_asset_manifest(dir.path(), None, None);
        assert!(first.ok);
        assert!(first.value.as_ref().unwrap().created);
        let manifest_path = dir.path().join("assets/manifest.json");
        let manifest: super::AssetManifest =
            serde_json::from_str(&fs::read_to_string(&manifest_path).unwrap()).unwrap();
        assert_eq!(manifest.version, 1);
        assert!(manifest.assets.is_empty());
        let config: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.path().join("project.unone.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(config["asset_manifest"], "assets/manifest.json");

        let second = init_asset_manifest(
            dir.path(),
            None,
            Some(AssetSpec {
                id: "asset://bird".to_string(),
                source: "assets/bird.svg".to_string(),
                kind: "texture2d".to_string(),
                bundle: "content".to_string(),
                files: Vec::new(),
            }),
        );
        assert!(second.ok, "{:?}", second.diagnostics);
        let second = second.value.unwrap();
        assert_eq!(second.assets.len(), 1);
        assert_eq!(
            second.describe_argv,
            Some(vec![
                "--project".to_string(),
                dir.path().canonicalize().unwrap().display().to_string(),
                "asset".to_string(),
                "describe".to_string(),
                "--id".to_string(),
                "asset://bird".to_string(),
                "--json".to_string(),
            ])
        );
    }

    #[test]
    fn empty_asset_init_reports_actual_writes_without_inventing_a_describe_id() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-init-empty","main_scene":"scenes/main.scene.json"}"#,
            r#"{"entities":[]}"#,
        );
        let first = init_asset_manifest(dir.path(), None, None);
        assert!(first.ok, "{:?}", first.diagnostics);
        let first = first.value.unwrap();
        assert_eq!(first.changed_files.len(), 2);
        assert!(first
            .changed_files
            .iter()
            .any(|path| path.ends_with("assets\\manifest.json") || path.ends_with("assets/manifest.json")));
        assert!(first
            .changed_files
            .iter()
            .any(|path| path.ends_with("project.unone.json")));
        assert_eq!(first.describe_argv, None);

        let second = init_asset_manifest(dir.path(), None, None);
        assert!(second.ok, "{:?}", second.diagnostics);
        let second = second.value.unwrap();
        assert!(second.changed_files.is_empty());
        assert_eq!(second.describe_argv, None);
    }

    #[test]
    fn asset_init_reports_a_manifest_write_when_the_followup_config_write_fails() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"name":"asset-init-partial","main_scene":"scenes/main.scene.json"}"#,
            r#"{"entities":[]}"#,
        );
        let config_path = dir.path().join("project.unone.json");
        let mut permissions = fs::metadata(&config_path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&config_path, permissions).unwrap();

        let result = init_asset_manifest(dir.path(), None, None);
        assert!(!result.ok, "唯讀 project config 不應宣稱 init 成功");
        assert_eq!(result.diagnostics[0].code, "PROJECT_CONFIG_WRITE_FAILED");
        assert!(result.effects.iter().any(|effect| {
            effect.contains("assets\\manifest.json") || effect.contains("assets/manifest.json")
        }));
        assert!(dir.path().join("assets/manifest.json").is_file());
        assert_eq!(
            result.diagnostics[0].facts["changed_files"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn reads_primary_and_companions_with_verified_active_metadata() {
        let dir = installed_project();
        let exports = tempdir().unwrap();
        // Authoring byte changes alone do not authorize a source fallback.
        fs::write(dir.path().join("assets/a.svg"), b"unpacked-primary").unwrap();
        fs::write(dir.path().join("assets/a.atlas"), b"unpacked-atlas").unwrap();
        for (file, expected) in [
            (None, b"primary".as_slice()),
            (Some("assets/a.atlas"), b"atlas".as_slice()),
            (Some("assets/a.png"), b"page".as_slice()),
        ] {
            let output = exports.path().join("export.bin");
            let result = read(dir.path(), "asset://a", file, Some(&output));
            assert!(result.ok, "{result:?}");
            let report = result.value.unwrap();
            assert_eq!(report.asset.kind, "texture2d");
            assert_eq!(report.asset.source, "assets/a.svg");
            assert_eq!(report.asset.files, vec!["assets/a.atlas", "assets/a.png"]);
            assert_eq!(report.file.as_deref(), file);
            assert_eq!(report.bundle_generation, 1);
            assert_eq!(report.sha256, crate::bundle::digest_bytes(expected));
            assert_eq!(report.size_bytes, expected.len() as u64);
            assert_eq!(fs::read(output).unwrap(), expected);
        }
        let undeclared = read(dir.path(), "asset://a", Some("assets/other.png"), None);
        assert!(!undeclared.ok);
        assert_eq!(undeclared.diagnostics[0].code, "ASSET_FILE_NOT_DECLARED");
    }

    #[test]
    fn read_rejects_every_unpacked_asset_spec_change_before_export() {
        let dir = installed_project();
        let manifest_path = dir.path().join("assets/manifest.json");
        let original: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        let output = dir.path().join("existing-export.bin");
        fs::write(&output, b"keep-existing-output").unwrap();
        let new_output = dir.path().join("uncreated-export/result.bin");
        for (field, value) in [
            ("kind", serde_json::json!("spine")),
            ("source", serde_json::json!("assets/moved.svg")),
            ("bundle", serde_json::json!("other")),
            ("files", serde_json::json!([])),
            (
                "files",
                serde_json::json!(["assets/a.atlas", "assets/a.png", "assets/new.png"]),
            ),
            (
                "files",
                serde_json::json!(["assets/a.png", "assets/a.atlas"]),
            ),
        ] {
            let mut changed = original.clone();
            changed["assets"][0][field] = value;
            fs::write(&manifest_path, serde_json::to_vec(&changed).unwrap()).unwrap();
            for (file, destination) in [(None, &output), (Some("assets/a.atlas"), &new_output)] {
                let result = read(dir.path(), "asset://a", file, Some(destination));
                assert!(!result.ok, "{field}: {result:?}");
                assert!(result.value.is_none());
                assert!(result.effects.is_empty());
                assert_eq!(result.diagnostics[0].code, "BUNDLE_GENERATION_MISMATCH");
                assert_eq!(
                    result.diagnostics[0].facts["active_asset"],
                    original["assets"][0]
                );
                assert_eq!(fs::read(&output).unwrap(), b"keep-existing-output");
                assert!(!new_output.parent().unwrap().exists());
            }
        }
    }

    #[test]
    fn read_validates_missing_and_invalid_active_declarations_before_export() {
        let valid = serde_json::json!({
            "id": "asset://a", "source": "assets/a.svg", "kind": "texture2d",
            "bundle": "content", "files": ["assets/a.atlas", "assets/a.png"]
        });
        let mut invalid_kind = valid.clone();
        invalid_kind["kind"] = serde_json::json!("unknown");
        let mut unsafe_companion = valid.clone();
        unsafe_companion["files"] = serde_json::json!(["../outside.png"]);
        for (bytes, code) in [
            (b"not-json".to_vec(), "ASSET_ACTIVE_MANIFEST_INVALID"),
            (
                serde_json::to_vec(&serde_json::json!({"version":1,"assets":[]})).unwrap(),
                "BUNDLE_GENERATION_MISMATCH",
            ),
            (
                serde_json::to_vec(
                    &serde_json::json!({"version":1,"assets":[valid.clone(), valid.clone()]}),
                )
                .unwrap(),
                "ASSET_MANIFEST_DUPLICATE_ID",
            ),
            (
                serde_json::to_vec(&serde_json::json!({"version":1,"assets":[invalid_kind]}))
                    .unwrap(),
                "ASSET_SPEC_INVALID",
            ),
            (
                serde_json::to_vec(&serde_json::json!({"version":1,"assets":[unsafe_companion]}))
                    .unwrap(),
                "ASSET_SOURCE_OUTSIDE_PROJECT",
            ),
            (
                serde_json::to_vec(&serde_json::json!({"version":2,"assets":[valid]})).unwrap(),
                "ASSET_MANIFEST_VERSION_INVALID",
            ),
        ] {
            let dir = installed_project();
            replace_installed_bundle(dir.path(), "asset-manifest", &bytes);
            let output = dir.path().join("export/result.bin");
            for file in [None, Some("assets/a.atlas")] {
                let result = read(dir.path(), "asset://a", file, Some(&output));
                assert!(!result.ok, "{code}: {result:?}");
                assert_eq!(result.diagnostics[0].code, code);
                assert!(result.effects.is_empty());
                assert!(!output.parent().unwrap().exists());
            }
        }
    }

    #[test]
    fn read_requires_verified_reserved_manifest_bundle_before_export() {
        for (failure, code) in [
            ("missing_bundle", "BUNDLE_NOT_FOUND"),
            ("cache_miss", "BUNDLE_CACHE_MISS"),
            ("cache_corrupt", "BUNDLE_CACHE_CORRUPT"),
        ] {
            let dir = installed_project();
            let manager = BundleManager::from_project(dir.path()).unwrap();
            match failure {
                "missing_bundle" => {
                    let mut manifest = bundle_manifest(dir.path());
                    manifest.bundles.retain(|spec| spec.id != "asset-manifest");
                    for spec in &mut manifest.bundles {
                        spec.dependencies.retain(|id| id != "asset-manifest");
                    }
                    fs::write(
                        dir.path().join("bundles/manifest.json"),
                        serde_json::to_vec(&manifest).unwrap(),
                    )
                    .unwrap();
                    let installed = manager.install("content");
                    assert!(installed.ok, "{installed:?}");
                }
                "cache_miss" => fs::remove_file(cache_path(dir.path(), "asset-manifest")).unwrap(),
                "cache_corrupt" => {
                    fs::write(cache_path(dir.path(), "asset-manifest"), b"corrupt").unwrap()
                }
                _ => unreachable!(),
            }
            let output = dir.path().join("export.bin");
            fs::write(&output, b"keep-existing-output").unwrap();
            let result = read(dir.path(), "asset://a", None, Some(&output));
            assert!(!result.ok, "{failure}: {result:?}");
            assert_eq!(result.diagnostics[0].code, code);
            assert!(result.effects.is_empty());
            assert_eq!(fs::read(&output).unwrap(), b"keep-existing-output");
        }
    }

    #[test]
    fn read_rejects_observation_changes_and_token_errors_before_export() {
        for change in ["generation", "manifest", "corrupt_record"] {
            for file in [None, Some("assets/a.atlas")] {
                let dir = installed_project();
                let output = dir.path().join("export.bin");
                fs::write(&output, b"keep-existing-output").unwrap();
                let result = read_with_observation_hook(
                    dir.path(),
                    "asset://a",
                    file,
                    Some(&output),
                    || match change {
                        "generation" => {
                            fs::write(dir.path().join("assets/a.svg"), b"new-primary").unwrap();
                            fs::write(dir.path().join("assets/a.atlas"), b"new-atlas").unwrap();
                            let packed = pack_project(dir.path(), None);
                            assert!(packed.ok, "{packed:?}");
                            let installed = BundleManager::from_project(dir.path())
                                .unwrap()
                                .install("content");
                            assert!(installed.ok, "{installed:?}");
                        }
                        "manifest" => {
                            let path = dir.path().join("bundles/manifest.json");
                            let mut bytes = fs::read(&path).unwrap();
                            bytes.push(b'\n');
                            fs::write(path, bytes).unwrap();
                        }
                        "corrupt_record" => {
                            fs::write(
                                dir.path().join(
                                    ".unone/active/bundles/generation-00000000000000000001.json",
                                ),
                                b"corrupt",
                            )
                            .unwrap();
                        }
                        _ => unreachable!(),
                    },
                );
                assert!(!result.ok, "{change}: {result:?}");
                assert!(result.value.is_none());
                assert!(result.effects.is_empty());
                assert_eq!(result.diagnostics.len(), 1);
                assert_eq!(
                    result.diagnostics[0].code,
                    if change == "corrupt_record" {
                        "BUNDLE_ACTIVE_GENERATION_UNREADABLE"
                    } else {
                        "BUNDLE_GENERATION_MISMATCH"
                    }
                );
                assert_eq!(fs::read(&output).unwrap(), b"keep-existing-output");
                if change == "generation" {
                    let next = read(dir.path(), "asset://a", file, None);
                    assert!(next.ok, "{next:?}");
                    let next = next.value.unwrap();
                    assert_eq!(next.bundle_generation, 2);
                    let expected = if file.is_some() {
                        b"new-atlas".as_slice()
                    } else {
                        b"new-primary".as_slice()
                    };
                    assert_eq!(next.sha256, crate::bundle::digest_bytes(expected));
                }
            }
        }
    }

    #[test]
    fn reads_declared_asset_from_the_active_generation_and_reports_its_digest() {
        let dir = tempdir().unwrap();
        write_project(
            dir.path(),
            r#"{"name":"AssetReadCli","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json"}"#,
            r#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        );
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::write(
            dir.path().join("scripts/main.luau"),
            "return {}
",
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("assets/bird.svg"), b"<svg>bird</svg>").unwrap();
        fs::write(
            dir.path().join("assets/manifest.json"),
            r#"{"version":1,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();
        assert!(pack_project(dir.path(), None).ok);

        let before_install = read(dir.path(), "asset://bird", None, None);
        assert!(!before_install.ok);
        assert_eq!(
            before_install.diagnostics[0].code,
            "BUNDLE_GENERATION_MISMATCH"
        );

        assert!(
            BundleManager::from_project(dir.path())
                .unwrap()
                .install("content")
                .ok
        );

        let output = dir.path().join("out/bird.svg");
        let result = read(dir.path(), "asset://bird", None, Some(&output));
        assert!(result.ok, "{:?}", result.diagnostics);
        let report = result.value.unwrap();
        assert_eq!(report.asset.id, "asset://bird");
        assert_eq!(report.bundle_generation, 1);
        assert_eq!(report.size_bytes, 15);
        assert_eq!(
            report.sha256,
            crate::bundle::digest_bytes(b"<svg>bird</svg>")
        );
        assert_eq!(fs::read(&output).unwrap(), b"<svg>bird</svg>");

        let unknown = read(dir.path(), "asset://missing", None, None);
        assert!(!unknown.ok);
        assert_eq!(unknown.diagnostics[0].code, "ASSET_ID_NOT_DECLARED");
    }
}
