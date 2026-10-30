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
pub const SUPPORTED_ASSET_KINDS: &[&str] = &["texture2d", "mesh3d", "spine", "effekseer", "audio", "data"];
const ACTIVE_ASSET_MANIFEST_BUNDLE_ID: &str = "asset-manifest";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AssetManifest {
    #[serde(default = "default_manifest_version")]
    pub version: u32,
    #[serde(default)]
    pub assets: Vec<AssetSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AssetSpec {
    pub id: String,
    pub source: String,
    #[serde(default = "default_asset_kind")]
    #[cfg_attr(feature = "dev-tools", schemars(schema_with = "asset_kind_schema"))]
    pub kind: String,
    #[serde(default = "default_asset_bundle")]
    pub bundle: String,
    /// Extra project-relative sources this asset cannot be used without, such
    /// as a Spine atlas and its texture pages. They are packed into the same
    /// bundle; the engine does not parse them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    /// Optional explicit encoding contract. Absence means legacy/unspecified,
    /// not that a host can decode this asset. Every companion still belongs in files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encoding: Option<AssetEncoding>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AssetEncoding {
    pub format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_version: Option<String>,
    pub mime: String,
    /// Capability id the selected host must explicitly advertise. No extension inference.
    pub decoder: String,
    #[serde(default)]
    pub companions: Vec<AssetCompanion>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AssetCompanion {
    pub path: String,
    pub role: String,
    pub mime: String,
}

#[cfg(feature = "dev-tools")]
fn asset_kind_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string", "enum": SUPPORTED_ASSET_KINDS})
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
            "Unable to read asset manifest",
            format!("{}: {}", path.display(), error),
        ))
    })?;
    let manifest: AssetManifest = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_INVALID",
            "Asset manifest is not valid JSON",
            format!("{}: {}", path.display(), error),
        ))
    })?;
    validate_asset_manifest(root, &manifest)?;
    for asset in &manifest.assets {
        let source = resolve_project_path(root, &asset.source)?;
        if !source.is_file() {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SOURCE_NOT_FOUND",
                "Asset source not found",
                format!(
                    "Asset '{}' points to '{}', but the source file does not exist.",
                    asset.id, asset.source
                ),
            )));
        }
        for file in &asset.files {
            let companion = resolve_project_path(root, file)?;
            if !companion.is_file() {
                return Err(Box::new(Diagnostic::error(
                    "ASSET_SOURCE_NOT_FOUND",
                    "Asset companion file not found",
                    format!(
                        "Asset '{}' requires '{file}', but the file does not exist.",
                        asset.id
                    ),
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

pub(crate) fn load_declared_manifest(
    paths: &ProjectPaths,
) -> Result<AssetManifest, Box<Diagnostic>> {
    let Some(manifest_path) = paths.asset_manifest.as_deref() else {
        return Err(Box::new(Diagnostic::error(
            "ASSET_MANIFEST_MISSING",
            "Project does not declare an asset manifest",
            "Set asset_manifest in project.unone.json so the host can resolve assets from the bundle.",
        )));
    };
    let manifest_path = project_path_from_path(&paths.root, manifest_path, "asset manifest")?;
    let text = fs::read_to_string(&manifest_path).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_READ_FAILED",
            "Unable to read asset manifest",
            format!("{}: {}", manifest_path.display(), error),
        ))
    })?;
    let manifest: AssetManifest = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "ASSET_MANIFEST_INVALID",
            "Asset manifest is not valid JSON",
            format!("{}: {}", manifest_path.display(), error),
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
            "Active asset manifest is not valid JSON",
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
            "Asset manifest does not contain this asset id",
            format!(
                "The manifest does not declare asset '{asset_id}'; the engine will not guess the asset source."
            ),
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
            description: "List currently declared and scene-referenced asset ids.".to_string(),
            command: Some("game asset inspect --json".to_string()),
        });
        return Err(Box::new(diagnostic));
    };
    let manager = BundleManager::from_project(&paths.root)?;
    let observation_before = manager.observation_token()?;
    let Some(bundle_generation) = manager.active_generation()? else {
        return Err(Box::new(Diagnostic::error(
            "BUNDLE_GENERATION_MISMATCH",
            "No bundle generation is active",
            "A generation must be installed and activated before reading assets.",
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
            "Asset declaration does not match the active generation",
            format!(
                "The complete declaration for asset '{asset_id}' in the active asset manifest must match the authoring declaration; authoring metadata will not be combined with active bytes."
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
                "Asset has not declared this companion file",
                format!(
                    "The files for asset '{asset_id}' do not include '{file}'; the engine will not read undeclared content."
                ),
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
            "Active observation changed during asset read",
            "The bundle manifest or active record changed during the read; metadata, generation, and bytes cannot be confirmed to come from the same observation, so no output was written.",
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
                    "Unable to create asset output directory",
                    format!("{}: {}", parent.display(), error),
                ));
            }
            if let Err(error) = fs::write(path, &bytes) {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_OUTPUT_WRITE_FAILED",
                    "Unable to write asset contents",
                    format!("{}: {}", path.display(), error),
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
            "Decoding and GPU resource lifetime belong to the host.".to_string(),
            "Downloading, retries, cache capacity, and CDN policy belong to the host.".to_string(),
            "The engine only verifies the integrity of the bundle and archive entry.".to_string(),
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
            "Project asset manifest not found",
            format!(
                "project.unone.json declares asset manifest '{}', but the file does not exist. Create the manifest first, then check the asset sources and bundle.",
                manifest_path.display()
            ),
        );
        diagnostic.facts = serde_json::json!({
            "manifest": manifest_path.display().to_string(),
            "references": references,
        });
        diagnostic.suggested_actions.push(ActionSuggestion {
            action: "create_asset_manifest".to_string(),
            description: "Create the asset manifest declared by project.unone.json in the project."
                .to_string(),
            command: Some("game asset inspect --json".to_string()),
        });
        return EngineResult::failure(diagnostic);
    }

    let text = match fs::read_to_string(manifest_path) {
        Ok(text) => text,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_READ_FAILED",
                "Unable to read asset manifest",
                format!("{}: {}", manifest_path.display(), error),
            ));
        }
    };
    let manifest: AssetManifest = match serde_json::from_str(&text) {
        Ok(manifest) => manifest,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_INVALID",
                "Asset manifest is not valid JSON",
                format!("{}: {}", manifest_path.display(), error),
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
                "Scene references an undeclared asset id",
                "The scene's sprite/mesh3d asset id has no corresponding manifest entry; the host cannot reliably resolve the source or bundle.",
            );
            diagnostic.facts = serde_json::json!({"missing_asset_ids": report.missing_asset_ids});
            diagnostic.suggested_actions.push(ActionSuggestion {
                action: "declare_asset".to_string(),
                description: "Declare source, kind, and bundle under the same id in the asset manifest."
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
                "Asset manifest declares a source that does not exist",
                "The asset id exists, but the source file does not; packing or host loading will fail here.",
            );
            diagnostic.facts = serde_json::json!({"missing_sources": report.missing_sources});
            if let Some(asset) = report.assets.iter().find(|asset| {
                report.missing_sources.iter().any(|path| {
                    path == &asset.source || asset.files.iter().any(|file| file == path)
                })
            }) {
                diagnostic.suggested_actions.push(ActionSuggestion {
                    action: "describe_asset".to_string(),
                    description: "Inspect this declared asset's manifest pointer, shared files, references, and native-local freshness."
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
                "Asset points to a bundle missing from the manifest",
                "The asset's bundle id does not appear in the bundle manifest; do not make the host guess which package to download.",
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
                    description: "First use a single-asset describe to confirm the declaration and active status, then run pack/inspect/install in order."
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
                "Unone project root not found",
                format!("{}: {}", paths.root.display(), error),
            ));
        }
    };
    let candidate_relative = match output_path {
        Some(path) if path.is_absolute() => match path.strip_prefix(&root) {
            Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
            Err(_) => {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_MANIFEST_OUTPUT_OUTSIDE_PROJECT",
                    "Asset manifest output path is outside the project root",
                    "asset init only modifies the current game project's manifest and project configuration.",
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
                    "Unable to read asset manifest",
                    format!("{}: {}", candidate.display(), error),
                ));
            }
        };
        match serde_json::from_str::<AssetManifest>(&text) {
            Ok(manifest) => manifest,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "ASSET_MANIFEST_INVALID",
                    "Asset manifest is not valid JSON",
                    format!("{}: {}", candidate.display(), error),
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
                "Asset manifest already has the same asset id",
                format!(
                    "Asset id '{}' already exists; this prevents asset init from silently overwriting the existing declaration.",
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
                    "Unable to serialize asset manifest",
                    error.to_string(),
                ));
            }
        };
        if let Some(parent) = candidate.parent()
            && let Err(error) = fs::create_dir_all(parent)
        {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_MANIFEST_WRITE_FAILED",
                "Unable to create asset manifest directory",
                format!("{}: {}", parent.display(), error),
            ));
        }
        if let Err(error) = fs::write(&candidate, bytes) {
            return init_failure_with_effects(
                Diagnostic::error(
                    "ASSET_MANIFEST_WRITE_FAILED",
                    "Unable to write asset manifest",
                    format!("{}: {}", candidate.display(), error),
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
                    "Unable to update asset manifest configuration",
                    format!("{}: {}", config_path.display(), error),
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
                    "Unone project configuration is not valid JSON",
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
                "Project configuration must be a JSON object",
                "asset init requires asset_manifest to be set in project.unone.json.",
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
                        "Unable to serialize project configuration",
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
                    "Unable to update asset_manifest configuration",
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
            "Invalid asset manifest version",
            format!(
                "Only asset manifest version {} is supported; unsupported versions will not be silently treated as the current format.",
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
                "Asset manifest contains a duplicate asset id",
                format!("Asset id '{}' may be declared only once.", asset.id),
            )));
        }
        validate_asset_paths(root, asset)?;
    }
    Ok(())
}

pub(crate) fn validate_asset_paths(root: &Path, asset: &AssetSpec) -> Result<(), Box<Diagnostic>> {
    resolve_project_path(root, &asset.source)?;
    for file in &asset.files {
        resolve_project_path(root, file)?;
    }
    Ok(())
}

pub(crate) fn validate_asset_spec(asset: &AssetSpec) -> Result<(), Box<Diagnostic>> {
    if let Some(encoding) = &asset.encoding {
        let mime_valid = |mime: &str| {
            mime.split_once('/')
                .is_some_and(|(a, b)| !a.is_empty() && !b.is_empty())
                && !mime.chars().any(char::is_whitespace)
        };
        let mut described = BTreeSet::new();
        if encoding.format.trim().is_empty()
            || encoding.decoder.trim().is_empty()
            || !mime_valid(&encoding.mime)
            || encoding
                .format_version
                .as_ref()
                .is_some_and(|version| version.trim().is_empty())
            || encoding.companions.iter().any(|file| {
                file.role.trim().is_empty()
                    || !mime_valid(&file.mime)
                    || !asset.files.contains(&file.path)
                    || !described.insert(&file.path)
            })
            || described.len() != asset.files.len()
        {
            return Err(Box::new(Diagnostic::error(
                "ASSET_ENCODING_INVALID",
                "Invalid asset encoding contract",
                "Declare nonblank format/decoder, MIME types, and exactly one role/MIME descriptor for every required files entry.",
            )));
        }
    }
    if !looks_like_asset_id(&asset.id) {
        let mut diagnostic = Diagnostic::error(
            "ASSET_ID_INVALID",
            "Invalid asset id",
            format!(
                "Asset id '{}' must be a stable identifier with a scheme, such as asset://characters/bird/red or mesh://car.",
                asset.id
            ),
        );
        diagnostic.facts = serde_json::json!({"asset_id": asset.id});
        return Err(Box::new(diagnostic));
    }
    if !is_supported_asset_kind(&asset.kind) || asset.bundle.trim().is_empty() {
        return Err(Box::new(Diagnostic::error(
            "ASSET_SPEC_INVALID",
            "Invalid asset spec kind or bundle",
            format!(
                "Asset '{}' must have kind texture2d, mesh3d, spine, effekseer, audio, or data, and bundle must not be empty.",
                asset.id
            ),
        )));
    }
    if !is_safe_bundle_id(&asset.bundle) {
        return Err(Box::new(Diagnostic::error(
            "ASSET_BUNDLE_ID_INVALID",
            "Invalid asset bundle id",
            format!(
                "Asset '{}' bundle '{}' may contain only a single safe name and no path separators.",
                asset.id, asset.bundle
            ),
        )));
    }
    if !is_project_relative(&asset.source) {
        return Err(Box::new(Diagnostic::error(
            "ASSET_SOURCE_OUTSIDE_PROJECT",
            "Asset source is outside the project root",
            format!(
                "Asset '{}' source '{}' must be a project-relative path.",
                asset.id, asset.source
            ),
        )));
    }
    let mut files = BTreeSet::new();
    for file in &asset.files {
        if !is_project_relative(file) {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SOURCE_OUTSIDE_PROJECT",
                "Asset companion file is outside the project root",
                format!(
                    "Asset '{}' files entry '{file}' must be a project-relative path.",
                    asset.id
                ),
            )));
        }
        if *file == asset.source {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SPEC_INVALID",
                "Asset companion file duplicates the source",
                format!(
                    "Asset '{}' files must not list the source itself again.",
                    asset.id
                ),
            )));
        }
        if !files.insert(file) {
            return Err(Box::new(Diagnostic::error(
                "ASSET_SPEC_INVALID",
                "Duplicate asset companion file declaration",
                format!(
                    "Asset '{}' files must not list '{file}' more than once.",
                    asset.id
                ),
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
            "Asset workflow path is outside the project root",
            format!(
                "{label} '{}' must be inside the project root.",
                path.display()
            ),
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
    let text =
        fs::read_to_string(&scene_path).map_err(|error| scene_read_failed(&scene_path, error))?;
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
            "Unable to read bundle manifest",
            format!("{}: {}", bundle_path.display(), error),
        ))
    })?;
    let manifest: BundleManifest = serde_json::from_str(&text).map_err(|error| {
        Box::new(Diagnostic::error(
            "BUNDLE_MANIFEST_INVALID",
            "Bundle manifest is not valid JSON",
            format!("{}: {}", bundle_path.display(), error),
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
    SUPPORTED_ASSET_KINDS.contains(&kind)
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
        "Scene has asset references but the project has no asset manifest",
        "The engine only sees asset ids in the scene; without a manifest it cannot verify the source, kind, bundle, or cross-platform host resolution result.",
    );
    diagnostic.facts = serde_json::json!({"asset_ids": ids});
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "declare_asset_manifest".to_string(),
        description: "Add asset_manifest to project.unone.json and declare source, kind, and bundle for each static asset reference.".to_string(),
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

    use crate::asset_workflow::describe_asset;
    use crate::bundle::{BundleManager, pack_project};

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
        assert!(!packed.ok, "out-of-scope companion must not be packed");
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
                encoding: None,
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
        assert!(
            first
                .changed_files
                .iter()
                .any(|path| path.ends_with("assets\\manifest.json")
                    || path.ends_with("assets/manifest.json"))
        );
        assert!(
            first
                .changed_files
                .iter()
                .any(|path| path.ends_with("project.unone.json"))
        );
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
        assert!(
            !result.ok,
            "a read-only project config must not report init success"
        );
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
            (
                "encoding",
                serde_json::json!({"format":"svg","mime":"image/svg+xml","decoder":"image","companions":[
                    {"path":"assets/a.atlas","role":"atlas","mime":"text/plain"},
                    {"path":"assets/a.png","role":"texture","mime":"image/png"}
                ]}),
            ),
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

#[cfg(test)]
mod encoding_tests {
    use super::*;
    #[test]
    fn explicit_encoding_requires_exact_companion_descriptors() {
        let mut asset: AssetSpec = serde_json::from_str(r#"{"id":"asset://actor","source":"actor.json","kind":"spine","files":["actor.atlas"],"encoding":{"format":"spine-json","mime":"application/json","decoder":"spine","companions":[{"path":"actor.atlas","role":"atlas","mime":"text/plain"}]}}"#).unwrap();
        validate_asset_spec(&asset).unwrap();
        let original = asset.clone();
        asset.encoding.as_mut().unwrap().companions.clear();
        assert_eq!(
            validate_asset_spec(&asset).unwrap_err().code,
            "ASSET_ENCODING_INVALID"
        );
        assert_ne!(asset, original);
        let mut typo = serde_json::to_value(original).unwrap();
        typo["encoding"]["decodre"] = serde_json::json!("spine");
        assert!(serde_json::from_value::<AssetSpec>(typo).is_err());
    }
}
