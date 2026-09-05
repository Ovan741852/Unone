use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::asset::{AssetManifest, AssetSpec, load_for_pack};
use crate::diagnostics::{ActionSuggestion, Diagnostic, EngineResult};
use crate::project::{ProjectPaths, resolve_project_path};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BundleManifest {
    pub version: u32,
    #[serde(default)]
    pub bundles: Vec<BundleSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct BundleSpec {
    pub id: String,
    pub version: String,
    pub source: String,
    pub sha256: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

const MAX_SAFE_BUNDLE_SIZE: u64 = 9_007_199_254_740_991;

fn validate_bundle_manifest(manifest: &BundleManifest) -> Result<(), Box<Diagnostic>> {
    if manifest.bundles.is_empty() {
        return Err(Box::new(Diagnostic::error(
            "BUNDLE_MANIFEST_EMPTY",
            "bundle manifest 沒有可啟用的 bundle",
            "bundle activation 需要至少一個 bundle；不會建立空的 active generation。",
        )));
    }
    let mut ids = BTreeSet::new();
    for spec in &manifest.bundles {
        if spec.id.trim().is_empty() {
            return Err(Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "bundle id 不可為空",
                "bundle manifest 中的每個 id 都必須是非空字串。",
            )));
        }
        if !ids.insert(spec.id.clone()) {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_MANIFEST_DUPLICATE_ID",
                "bundle manifest 有重複的 bundle id",
                format!("bundle id '{}' 只能宣告一次。", spec.id),
            );
            diagnostic.facts = serde_json::json!({"bundle_id": spec.id});
            return Err(Box::new(diagnostic));
        }
        if spec.source.trim().is_empty() {
            return Err(Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "bundle source 不可為空",
                format!("bundle '{}' 必須宣告 source。", spec.id),
            )));
        }
        if spec.size_bytes > MAX_SAFE_BUNDLE_SIZE || !is_valid_sha256(&spec.sha256) {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "bundle integrity 欄位無效",
                format!(
                    "bundle '{}' 的 size_bytes 必須是安全非負整數，sha256 必須是小寫 64 位 SHA-256。",
                    spec.id
                ),
            );
            diagnostic.facts = serde_json::json!({
                "bundle_id": spec.id,
                "size_bytes": spec.size_bytes,
                "sha256": spec.sha256,
            });
            return Err(Box::new(diagnostic));
        }
        if spec.dependencies.iter().any(|dependency| dependency.trim().is_empty()) {
            return Err(Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "bundle dependency id 不可為空",
                format!("bundle '{}' 的 dependencies 含有空 id。", spec.id),
            )));
        }
    }
    let specs = manifest
        .bundles
        .iter()
        .map(|spec| (spec.id.clone(), spec))
        .collect::<BTreeMap<_, _>>();
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for spec in &manifest.bundles {
        validate_dependency_graph(
            &spec.id,
            &specs,
            &mut visiting,
            &mut visited,
        )?;
    }
    Ok(())
}

fn validate_dependency_graph(
    id: &str,
    specs: &BTreeMap<String, &BundleSpec>,
    visiting: &mut BTreeSet<String>,
    visited: &mut BTreeSet<String>,
) -> Result<(), Box<Diagnostic>> {
    if visited.contains(id) {
        return Ok(());
    }
    if visiting.contains(id) {
        let mut diagnostic = Diagnostic::error(
            "BUNDLE_DEPENDENCY_CYCLE",
            "bundle 依賴有循環",
            format!("bundle '{id}' 的 dependencies 形成循環。"),
        );
        diagnostic.facts = serde_json::json!({"bundle_id": id});
        return Err(Box::new(diagnostic));
    }
    let Some(spec) = specs.get(id) else {
        let mut diagnostic = Diagnostic::error(
            "BUNDLE_DEPENDENCY_NOT_FOUND",
            "bundle 依賴不存在",
            format!("manifest 中找不到 dependency bundle '{id}'。"),
        );
        diagnostic.facts = serde_json::json!({"dependency": id});
        return Err(Box::new(diagnostic));
    };
    visiting.insert(id.to_string());
    for dependency in &spec.dependencies {
        validate_dependency_graph(dependency, specs, visiting, visited)?;
    }
    visiting.remove(id);
    visited.insert(id.to_string());
    Ok(())
}

fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

enum InstallSelection {
    Id(String),
    All,
}

fn validate_selection(
    bundle_id: Option<&str>,
    all: bool,
) -> Result<InstallSelection, Box<Diagnostic>> {
    match (bundle_id, all) {
        (Some(id), false) if !id.trim().is_empty() => Ok(InstallSelection::Id(id.to_string())),
        (None, true) => Ok(InstallSelection::All),
        (Some(_), false) => Err(Box::new(Diagnostic::error(
            "BUNDLE_SELECTION_INVALID",
            "bundle install 的 id 不可為空",
            "請提供一個非空 id，或使用 --all；兩者不能省略或同時提供。",
        ))),
        _ => Err(Box::new(Diagnostic::error(
            "BUNDLE_SELECTION_INVALID",
            "bundle install 必須恰好選擇 id 或 all",
            "請提供一個 id 或 --all，不能兩者都省略或同時提供。",
        ))),
    }
}

fn select_roots(
    manifest: &BundleManifest,
    selection: InstallSelection,
) -> Result<Vec<&BundleSpec>, Box<Diagnostic>> {
    match selection {
        InstallSelection::All => Ok(manifest.bundles.iter().collect()),
        InstallSelection::Id(bundle_id) => {
            let Some(spec) = manifest
                .bundles
                .iter()
                .find(|candidate| candidate.id == bundle_id)
            else {
                let mut diagnostic = Diagnostic::error(
                    "BUNDLE_NOT_FOUND",
                    "找不到要求安裝的 bundle",
                    format!("manifest 中沒有 bundle '{bundle_id}'。"),
                );
                diagnostic.facts = serde_json::json!({
                    "bundle_id": bundle_id,
                    "available": manifest
                        .bundles
                        .iter()
                        .map(|spec| &spec.id)
                        .collect::<Vec<_>>(),
                });
                return Err(Box::new(diagnostic));
            };
            Ok(vec![spec])
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BundlePackReport {
    pub project_root: String,
    pub manifest_path: String,
    pub manifest_version: u32,
    pub manifest_changed: bool,
    pub project_config_changed: bool,
    pub bundles: Vec<BundleSpec>,
}

fn resolve_pack_output_path(
    root: &Path,
    output_path: Option<&Path>,
) -> Result<(PathBuf, String), Box<Diagnostic>> {
    let relative = match output_path {
        None => "bundles/manifest.json".to_string(),
        Some(path) if !path.is_absolute() => normalize_relative_path(path),
        Some(path) => {
            let mut existing = path;
            let canonical_existing = loop {
                match fs::symlink_metadata(existing) {
                    Ok(_) => break fs::canonicalize(existing),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        existing = existing.parent().ok_or_else(|| {
                            Box::new(Diagnostic::error(
                                "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
                                "bundle manifest 輸出位置無法解析",
                                format!("{} 沒有可檢查的既存 parent directory。", path.display()),
                            ))
                        })?;
                    }
                    Err(error) => {
                        return Err(Box::new(Diagnostic::error(
                            "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
                            "bundle manifest 輸出位置無法解析",
                            format!("{}：{}", existing.display(), error),
                        )));
                    }
                }
            }
            .map_err(|error| {
                Box::new(Diagnostic::error(
                    "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
                    "bundle manifest 輸出位置無法解析",
                    format!("{}：{}", existing.display(), error),
                ))
            })?;
            if !canonical_existing.starts_with(root) {
                return Err(Box::new(Diagnostic::error(
                    "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
                    "bundle manifest 輸出位置超出專案根目錄",
                    format!("{} 不在專案根目錄 {} 內。", path.display(), root.display()),
                )));
            }
            let suffix = path.strip_prefix(existing).map_err(|_| {
                Box::new(Diagnostic::error(
                    "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
                    "bundle manifest 輸出位置無法解析",
                    format!("{} 的 parent 路徑無法重組。", path.display()),
                ))
            })?;
            let mut canonical_candidate = canonical_existing;
            canonical_candidate.push(suffix);
            normalize_relative_path(canonical_candidate.strip_prefix(root).map_err(|_| {
                Box::new(Diagnostic::error(
                    "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
                    "bundle manifest 輸出位置超出專案根目錄",
                    format!("{} 不在專案根目錄 {} 內。", path.display(), root.display()),
                ))
            })?)
        }
    };
    let manifest_path = resolve_project_path(root, &relative).map_err(|diagnostic| {
        let mut diagnostic = *diagnostic;
        diagnostic.code = "BUNDLE_OUTPUT_OUTSIDE_PROJECT".to_string();
        diagnostic.summary = "bundle manifest 輸出位置不安全".to_string();
        Box::new(diagnostic)
    })?;
    Ok((manifest_path, relative))
}

/// Generate the smallest runtime bundle manifest for a project.
///
/// Package the project sources and, when configured, deterministic asset
/// bundles. The archive is intentionally uncompressed and host-readable: the
/// engine owns content boundaries and integrity metadata, while each host owns
/// decoding and GPU/resource lifetime.
pub fn pack_project(
    project_root: impl AsRef<Path>,
    output_path: Option<&Path>,
) -> EngineResult<BundlePackReport> {
    let root = match fs::canonicalize(project_root.as_ref()) {
        Ok(root) => root,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_ROOT_NOT_FOUND",
                "找不到 Unone 專案根目錄",
                format!("{}：{}", project_root.as_ref().display(), error),
            ));
        }
    };
    let (config, paths) = match ProjectPaths::discover(&root) {
        Ok(result) => result,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let (manifest_path, manifest_relative) = match resolve_pack_output_path(&root, output_path) {
        Ok(paths) => paths,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let mut config_json: serde_json::Value = match fs::read_to_string(&paths.config)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str(&text).map_err(|error| error.to_string()))
    {
        Ok(config) => config,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "無法準備 bundle 的專案設定",
                error,
            ));
        }
    };
    let Some(config_object) = config_json.as_object_mut() else {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_INVALID",
            "專案設定必須是 JSON object",
            "bundle pack 需要在 project.unone.json 設定 bundle_manifest。",
        ));
    };
    let config_changed = config_object
        .get("bundle_manifest")
        .and_then(|value| value.as_str())
        != Some(&manifest_relative);
    if config_changed {
        config_object.insert(
            "bundle_manifest".to_string(),
            serde_json::Value::String(manifest_relative.clone()),
        );
    }

    let mut sources = Vec::new();
    let mut generated_archives = BTreeMap::<String, Vec<u8>>::new();
    if let Err(diagnostic) = validate_pack_source(&root, "project config", "project.unone.json") {
        return EngineResult::failure(*diagnostic);
    }
    sources.push((
        "project".to_string(),
        "project.unone.json".to_string(),
        Vec::new(),
    ));
    if let Err(diagnostic) = validate_pack_source(&root, "entry script", &config.entry_script) {
        return EngineResult::failure(*diagnostic);
    }
    sources.push((
        "script".to_string(),
        normalize_source_path(&config.entry_script),
        vec!["project".to_string()],
    ));
    if let Some(scene) = &config.main_scene {
        if let Err(diagnostic) = validate_pack_source(&root, "main scene", scene) {
            return EngineResult::failure(*diagnostic);
        }
        sources.push((
            "scene".to_string(),
            normalize_source_path(scene),
            vec!["project".to_string()],
        ));
    }

    if let Some(asset_manifest_path) = &paths.asset_manifest {
        let asset_manifest_source = match asset_manifest_path.strip_prefix(&root) {
            Ok(path) => normalize_relative_path(path),
            Err(_) => {
                return EngineResult::failure(Diagnostic::error(
                    "BUNDLE_SOURCE_OUTSIDE_PROJECT",
                    "asset manifest 超出專案根目錄",
                    "asset manifest 必須是專案內的相對路徑。",
                ));
            }
        };
        if let Err(diagnostic) =
            validate_pack_source(&root, "asset manifest", &asset_manifest_source)
        {
            return EngineResult::failure(*diagnostic);
        }
        let asset_manifest = match load_for_pack(&root, asset_manifest_path) {
            Ok(manifest) => manifest,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        if let Err(diagnostic) = validate_pack_asset_references(&paths, &asset_manifest) {
            return EngineResult::failure(*diagnostic);
        }
        if let Err(diagnostic) = validate_generated_asset_bundle_ids(&asset_manifest, &sources) {
            return EngineResult::failure(*diagnostic);
        }
        sources.push((
            "asset-manifest".to_string(),
            asset_manifest_source,
            vec!["project".to_string()],
        ));
        let mut grouped = BTreeMap::<String, Vec<(String, Vec<u8>)>>::new();
        for asset in asset_manifest.assets {
            // A Spine skeleton without its atlas, or an effect without its
            // textures, is not usable content: companion files ship in the
            // same archive as the source they belong to.
            let sources = std::iter::once(asset.source.clone()).chain(asset.files.iter().cloned());
            for source in sources {
                let path = match resolve_bundle_source(&root, "asset bundle source", &source) {
                    Ok(path) => path,
                    Err(diagnostic) => return EngineResult::failure(*diagnostic),
                };
                let bytes = match fs::read(&path) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        return EngineResult::failure(Diagnostic::error(
                            "BUNDLE_ASSET_SOURCE_READ_FAILED",
                            "無法讀取 asset bundle 來源",
                            format!("{}：{}", path.display(), error),
                        ));
                    }
                };
                grouped
                    .entry(asset.bundle.clone())
                    .or_default()
                    .push((normalize_source_path(&source), bytes));
            }
        }
        for (bundle_id, entries) in grouped {
            let archive = match build_bundle_archive(entries) {
                Ok(archive) => archive,
                Err(error) => {
                    return EngineResult::failure(Diagnostic::error(
                        "BUNDLE_ASSET_ARCHIVE_FAILED",
                        "無法建立 asset bundle archive",
                        error,
                    ));
                }
            };
            let source = format!("bundles/{bundle_id}.bundle");
            generated_archives.insert(source.clone(), archive);
            sources.push((
                bundle_id,
                source,
                vec!["project".to_string(), "asset-manifest".to_string()],
            ));
        }
    }

    let config_bytes = if config_changed {
        match serde_json::to_vec_pretty(&config_json) {
            Ok(bytes) => bytes,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "PROJECT_CONFIG_WRITE_FAILED",
                    "無法序列化 bundle 專案設定",
                    error.to_string(),
                ));
            }
        }
    } else {
        Vec::new()
    };

    let mut bundles = Vec::with_capacity(sources.len());
    for (id, source, dependencies) in sources {
        let bytes = if id == "project" && config_changed {
            config_bytes.clone()
        } else if let Some(bytes) = generated_archives.get(&source) {
            bytes.clone()
        } else {
            let path = match resolve_bundle_source(&root, "bundle source", &source) {
                Ok(path) => path,
                Err(diagnostic) => return EngineResult::failure(*diagnostic),
            };
            match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(error) => {
                    return EngineResult::failure(Diagnostic::error(
                        "BUNDLE_SOURCE_READ_FAILED",
                        "無法讀取 bundle 來源",
                        format!("{}：{}", path.display(), error),
                    ));
                }
            }
        };
        bundles.push(BundleSpec {
            id,
            version: "1".to_string(),
            source,
            sha256: digest_bytes(&bytes),
            size_bytes: bytes.len() as u64,
            dependencies,
        });
    }

    let previous = match read_existing_manifest(&manifest_path) {
        Ok(previous) => previous,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let manifest_version = match previous {
        Some(previous) if previous.bundles == bundles => previous.version,
        Some(previous) => previous.version.saturating_add(1).max(1),
        None => 1,
    };
    let manifest = BundleManifest {
        version: manifest_version,
        bundles: bundles.clone(),
    };
    let manifest_bytes = match serde_json::to_vec_pretty(&manifest) {
        Ok(bytes) => bytes,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "BUNDLE_MANIFEST_WRITE_FAILED",
                "無法序列化 bundle manifest",
                error.to_string(),
            ));
        }
    };
    let manifest_changed = fs::read(&manifest_path)
        .map(|current| current != manifest_bytes)
        .unwrap_or(true);
    if config_changed
        && let Err(error) = write_atomic(&root, &paths.config, &config_bytes)
    {
        return EngineResult::failure(Diagnostic::error(
            "PROJECT_CONFIG_WRITE_FAILED",
            "無法更新 bundle_manifest 設定",
            error,
        ));
    }
    for (source, archive) in generated_archives {
        let path = match resolve_bundle_source(&root, "generated bundle source", &source) {
            Ok(path) => path,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let changed = fs::read(&path)
            .map(|current| current != archive)
            .unwrap_or(true);
        if changed && let Err(error) = write_atomic(&root, &path, &archive) {
            return EngineResult::failure(Diagnostic::error(
                "BUNDLE_ASSET_ARCHIVE_WRITE_FAILED",
                "無法寫入 asset bundle archive",
                error,
            ));
        }
    }
    if manifest_changed && let Err(error) = write_atomic(&root, &manifest_path, &manifest_bytes) {
        return EngineResult::failure(Diagnostic::error(
            "BUNDLE_MANIFEST_WRITE_FAILED",
            "無法寫入 bundle manifest",
            error,
        ));
    }

    EngineResult::success(BundlePackReport {
        project_root: root.display().to_string(),
        manifest_path: manifest_path.display().to_string(),
        manifest_version,
        manifest_changed,
        project_config_changed: config_changed,
        bundles,
    })
}

fn validate_generated_asset_bundle_ids(
    manifest: &AssetManifest,
    sources: &[(String, String, Vec<String>)],
) -> Result<(), Box<Diagnostic>> {
    for asset in &manifest.assets {
        if sources.iter().any(|(id, _, _)| id == &asset.bundle) || asset.bundle == "asset-manifest"
        {
            return Err(Box::new(Diagnostic::error(
                "BUNDLE_ASSET_ID_COLLISION",
                "asset bundle id 與既有 bundle 衝突",
                format!(
                    "asset '{}' 指向 bundle '{}'，但該 id 已被 project/script/scene 或 asset-manifest 使用。",
                    asset.id, asset.bundle
                ),
            )));
        }
    }
    Ok(())
}

fn validate_pack_asset_references(
    paths: &ProjectPaths,
    manifest: &AssetManifest,
) -> Result<(), Box<Diagnostic>> {
    let references = crate::asset::read_scene_references(paths)?;
    let ids = manifest
        .assets
        .iter()
        .map(|asset| asset.id.as_str())
        .collect::<BTreeSet<_>>();
    let missing = references
        .iter()
        .filter(|reference| !ids.contains(reference.id.as_str()))
        .map(|reference| reference.id.clone())
        .collect::<BTreeSet<_>>();
    if missing.is_empty() {
        return Ok(());
    }
    let mut diagnostic = Diagnostic::error(
        "ASSET_REFERENCE_MISSING",
        "bundle pack 拒絕未解決的場景 asset reference",
        "靜態主場景中的每個 sprite/mesh3d asset id 都必須先在 asset manifest 宣告；不要打包一個 host 無法可靠解析的專案。",
    );
    diagnostic.facts = serde_json::json!({
        "missing_asset_ids": missing,
        "static_reference_scope": "main_scene only; assets created or selected by Luau are not statically discoverable",
    });
    diagnostic
        .suggested_actions
        .push(crate::diagnostics::ActionSuggestion {
            action: "declare_asset".to_string(),
            description: "在 asset manifest 為場景引用補上相同 id、source、kind 與 bundle。"
                .to_string(),
            command: Some("game asset inspect --strict --json".to_string()),
        });
    Err(Box::new(diagnostic))
}

const BUNDLE_ARCHIVE_MAGIC: &[u8] = b"UNONE-BUNDLE-1\n";

/// Only version 1 of the deterministic, uncompressed asset archive exists.
///
/// The engine writes and reads this format; each host owns decoding, caching
/// and GPU/resource lifetime.
pub const ASSET_ARCHIVE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct BundleArchiveHeader {
    version: u32,
    files: Vec<AssetArchiveEntry>,
}

/// One file inside an engine-produced asset archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetArchiveEntry {
    pub path: String,
    pub offset: u64,
    pub size_bytes: u64,
    pub sha256: String,
}

fn build_bundle_archive(mut entries: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    if entries.windows(2).any(|window| window[0].0 == window[1].0) {
        return Err("asset bundle 內含重複的 source path".to_string());
    }
    let mut payload = Vec::new();
    let mut files = Vec::with_capacity(entries.len());
    for (path, bytes) in entries {
        let offset = payload.len() as u64;
        let size_bytes = bytes.len() as u64;
        files.push(AssetArchiveEntry {
            path,
            offset,
            size_bytes,
            sha256: digest_bytes(&bytes),
        });
        payload.extend_from_slice(&bytes);
    }
    let header = serde_json::to_vec(&BundleArchiveHeader { version: 1, files })
        .map_err(|error| format!("序列化 asset bundle archive header 失敗：{error}"))?;
    let header_len = u32::try_from(header.len())
        .map_err(|_| "asset bundle archive header 超過 4 GiB".to_string())?;
    let mut archive =
        Vec::with_capacity(BUNDLE_ARCHIVE_MAGIC.len() + 4 + header.len() + payload.len());
    archive.extend_from_slice(BUNDLE_ARCHIVE_MAGIC);
    archive.extend_from_slice(&header_len.to_le_bytes());
    archive.extend_from_slice(&header);
    archive.extend_from_slice(&payload);
    Ok(archive)
}

/// Read one declared asset out of a deterministic engine asset archive.
///
/// This is the Rust half of the same host contract the Web host implements in
/// `web/live/bundle-store.js`: the caller supplies already hash-verified bundle
/// bytes, the engine resolves the manifest source to an archive entry and
/// verifies that entry's own digest. The engine still does not decode, cache,
/// download or manage GPU resources for the asset.
pub fn read_asset_from_archive(
    archive: &[u8],
    asset: &AssetSpec,
) -> Result<Vec<u8>, Box<Diagnostic>> {
    let header_len_offset = BUNDLE_ARCHIVE_MAGIC.len();
    let header_offset = header_len_offset + 4;
    if archive.len() < header_offset || !archive.starts_with(BUNDLE_ARCHIVE_MAGIC) {
        return Err(Box::new(Diagnostic::error(
            "ASSET_ARCHIVE_INVALID",
            "asset bundle 不是引擎 archive",
            format!(
                "bundle '{}' 的內容沒有引擎 asset archive 標頭。",
                asset.bundle
            ),
        )));
    }
    let header_len = u32::from_le_bytes(
        archive[header_len_offset..header_offset]
            .try_into()
            .expect("archive header length slice is 4 bytes"),
    ) as usize;
    let payload_offset = match header_offset.checked_add(header_len) {
        Some(offset) if offset <= archive.len() => offset,
        _ => {
            return Err(Box::new(Diagnostic::error(
                "ASSET_ARCHIVE_INVALID",
                "asset bundle 的 header 長度超出內容",
                format!(
                    "bundle '{}' 宣告的 header 長度超過已驗證的位元組。",
                    asset.bundle
                ),
            )));
        }
    };
    let header: BundleArchiveHeader =
        serde_json::from_slice(&archive[header_offset..payload_offset]).map_err(|error| {
            Box::new(Diagnostic::error(
                "ASSET_ARCHIVE_INVALID",
                "asset bundle 的 header 不是有效 JSON",
                format!("bundle '{}'：{error}", asset.bundle),
            ))
        })?;
    if header.version != ASSET_ARCHIVE_VERSION {
        return Err(Box::new(Diagnostic::error(
            "ASSET_ARCHIVE_INVALID",
            "asset archive version 不支援",
            format!(
                "目前只支援 asset archive version {ASSET_ARCHIVE_VERSION}，不會把未支援的版本靜默當成目前格式。"
            ),
        )));
    }
    let source = normalize_source_path(&asset.source);
    let Some(entry) = header.files.iter().find(|entry| entry.path == source) else {
        let mut diagnostic = Diagnostic::error(
            "ASSET_NOT_IN_BUNDLE",
            "asset 不在指定的 bundle 內",
            format!(
                "asset '{}' 的 source '{}' 不在 bundle '{}' 的 archive 內。",
                asset.id, source, asset.bundle
            ),
        );
        diagnostic.facts = serde_json::json!({
            "asset_id": asset.id,
            "source": source,
            "bundle": asset.bundle,
            "archive_files": header
                .files
                .iter()
                .map(|entry| entry.path.clone())
                .collect::<Vec<_>>(),
        });
        return Err(Box::new(diagnostic));
    };
    let start = usize::try_from(entry.offset).ok();
    let size = usize::try_from(entry.size_bytes).ok();
    let range = start
        .zip(size)
        .and_then(|(start, size)| {
            let start = payload_offset.checked_add(start)?;
            let end = start.checked_add(size)?;
            (end <= archive.len()).then_some(start..end)
        })
        .ok_or_else(|| {
            Box::new(Diagnostic::error(
                "ASSET_ARCHIVE_INVALID",
                "asset archive entry 超出內容範圍",
                format!(
                    "asset '{}' 在 bundle '{}' 的 offset/size 指向已驗證位元組之外。",
                    asset.id, asset.bundle
                ),
            ))
        })?;
    let bytes = archive[range].to_vec();
    let digest = digest_bytes(&bytes);
    if digest != entry.sha256 {
        let mut diagnostic = Diagnostic::error(
            "ASSET_CONTENT_CORRUPT",
            "asset 內容雜湊與 archive 宣告不符",
            format!(
                "asset '{}' 在 bundle '{}' 的內容雜湊不符，主機不應使用這份資料。",
                asset.id, asset.bundle
            ),
        );
        diagnostic.facts = serde_json::json!({
            "asset_id": asset.id,
            "bundle": asset.bundle,
            "expected_sha256": entry.sha256,
            "actual_sha256": digest,
        });
        return Err(Box::new(diagnostic));
    }
    Ok(bytes)
}

fn validate_pack_source(root: &Path, label: &str, source: &str) -> Result<(), Box<Diagnostic>> {
    let path = resolve_bundle_source(root, label, source)?;
    if !path.is_file() {
        return Err(Box::new(Diagnostic::error(
            "BUNDLE_SOURCE_NOT_FOUND",
            "找不到 bundle 來源",
            format!(
                "{label} 指向 '{}'，請先建立檔案或修正 project.unone.json。",
                path.display()
            ),
        )));
    }
    Ok(())
}

fn resolve_bundle_source(
    root: &Path,
    label: &str,
    source: &str,
) -> Result<PathBuf, Box<Diagnostic>> {
    resolve_project_path(root, source).map_err(|diagnostic| {
        let mut diagnostic = *diagnostic;
        diagnostic.code = "BUNDLE_SOURCE_OUTSIDE_PROJECT".to_string();
        diagnostic.summary = "bundle 來源超出專案根目錄".to_string();
        diagnostic.explanation = format!(
            "{label} 的路徑 '{source}' 必須是專案內的安全相對路徑：{}",
            diagnostic.explanation
        );
        Box::new(diagnostic)
    })
}

fn read_existing_manifest(path: &Path) -> Result<Option<BundleManifest>, Box<Diagnostic>> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|error| {
            Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "既有 bundle manifest 不是有效 JSON",
                format!("{}：{}", path.display(), error),
            ))
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(Box::new(Diagnostic::error(
            "BUNDLE_MANIFEST_READ_FAILED",
            "無法讀取既有 bundle manifest",
            format!("{}：{}", path.display(), error),
        ))),
    }
}

fn write_atomic(root: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    let path = resolve_project_path(
        root,
        &normalize_relative_path(
            path.strip_prefix(root)
                .map_err(|error| format!("path '{}' is outside project: {error}", path.display()))?,
        ),
    )
    .map_err(|diagnostic| diagnostic.explanation)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("path '{}' has no parent directory", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create '{}': {error}", parent.display()))?;
    let staging_candidate = PathBuf::from(format!("{}.part", path.display()));
    let staging = resolve_project_path(
        root,
        &normalize_relative_path(
            staging_candidate
                .strip_prefix(root)
                .map_err(|error| format!("staging path is outside project: {error}"))?,
        ),
    )
    .map_err(|diagnostic| diagnostic.explanation)?;
    let mut file = File::create(&staging)
        .map_err(|error| format!("create '{}': {error}", staging.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("write '{}': {error}", staging.display()))?;
    file.flush()
        .map_err(|error| format!("flush '{}': {error}", staging.display()))?;
    file.sync_all()
        .map_err(|error| format!("sync '{}': {error}", staging.display()))?;
    drop(file);
    replace_staged_file(&staging, &path)
}

#[cfg(not(windows))]
fn replace_staged_file(staging: &Path, path: &Path) -> Result<(), String> {
    fs::rename(staging, path).map_err(|error| {
        format!(
            "rename '{}' -> '{}': {error}",
            staging.display(),
            path.display()
        )
    })
}

#[cfg(windows)]
fn replace_staged_file(staging: &Path, path: &Path) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    use windows_sys::Win32::{
        Foundation::GetLastError,
        Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
            REPLACEFILE_WRITE_THROUGH, ReplaceFileW,
        },
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let staging_wide = wide(staging);
    let path_wide = wide(path);
    // ReplaceFileW is preferred because it keeps the previous destination until
    // the replacement is committed. It is not always available: it needs the
    // destination to exist, and it returns ACCESS_DENIED on paths where its
    // backup semantics cannot be satisfied, which is reproducible on ordinary
    // project directories. MoveFileExW with replace and write-through is the
    // documented fallback, so try it whenever ReplaceFileW declines, and only
    // report a failure when both refuse.
    let replaced = unsafe {
        ReplaceFileW(
            path_wide.as_ptr(),
            staging_wide.as_ptr(),
            ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            ptr::null(),
            ptr::null(),
        )
    };
    if replaced != 0 {
        return Ok(());
    }
    let replace_error = unsafe { GetLastError() };
    let moved = unsafe {
        MoveFileExW(
            staging_wide.as_ptr(),
            path_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        let move_error = unsafe { GetLastError() };
        return Err(format!(
            "replace '{}' -> '{}' failed: {} (and the rename fallback failed: {})",
            staging.display(),
            path.display(),
            std::io::Error::from_raw_os_error(replace_error as i32),
            std::io::Error::from_raw_os_error(move_error as i32)
        ));
    }
    Ok(())
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_source_path(source: &str) -> String {
    normalize_relative_path(Path::new(source))
}

pub(crate) fn digest_bytes(bytes: &[u8]) -> String {
    hex_digest(&Sha256::digest(bytes))
}

/// Host-owned source for a bundle.
///
/// Native callers can open a local file; Web/mobile callers can fetch or
/// decrypt bytes outside the engine and return a reader here. The engine only
/// owns streaming verification, staging and activation.
pub trait BundleFetcher {
    fn open(&mut self, spec: &BundleSpec) -> Result<Box<dyn Read + '_>, Box<Diagnostic>>;
}

/// Incremental integrity verifier shared by native storage and Web hosts.
///
/// Fetching, retry policy and persistence stay outside the engine. The engine
/// owns the one integrity rule so a host can feed a response in bounded chunks
/// without reimplementing the manifest contract in JavaScript or mobile code.
pub struct BundleVerifier {
    bundle_id: String,
    expected_sha256: String,
    expected_size_bytes: u64,
    hasher: Sha256,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BundleVerification {
    pub bundle_id: String,
    pub size_bytes: u64,
    pub sha256: String,
}

impl BundleVerifier {
    pub fn new(spec: &BundleSpec) -> Self {
        Self {
            bundle_id: spec.id.clone(),
            expected_sha256: spec.sha256.clone(),
            expected_size_bytes: spec.size_bytes,
            hasher: Sha256::new(),
            size_bytes: 0,
        }
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.size_bytes += bytes.len() as u64;
        self.hasher.update(bytes);
    }

    pub fn finish(self) -> Result<BundleVerification, Box<Diagnostic>> {
        let actual_sha256 = hex_digest(&self.hasher.finalize());
        if self.size_bytes != self.expected_size_bytes || actual_sha256 != self.expected_sha256 {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_VERIFY_FAILED",
                "bundle 驗證失敗",
                format!(
                    "bundle '{}' 的大小或 SHA-256 與 manifest 不一致。",
                    self.bundle_id
                ),
            );
            diagnostic.facts = serde_json::json!({
                "bundle_id": self.bundle_id,
                "actual_sha256": actual_sha256,
                "expected_sha256": self.expected_sha256,
                "actual_size_bytes": self.size_bytes,
                "expected_size_bytes": self.expected_size_bytes,
            });
            return Err(Box::new(diagnostic));
        }
        Ok(BundleVerification {
            bundle_id: self.bundle_id,
            size_bytes: self.size_bytes,
            sha256: actual_sha256,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BundleEntryReport {
    pub id: String,
    pub source: String,
    pub source_exists: bool,
    pub size_valid: bool,
    pub hash_valid: bool,
    pub cached: bool,
    pub cache_valid: bool,
    pub available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BundleReport {
    pub manifest_version: u32,
    pub valid: bool,
    pub entries: Vec<BundleEntryReport>,
    pub active_generation: Option<u64>,
    pub active_bundles: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveGeneration {
    generation: u64,
    manifest_version: u32,
    bundles: BTreeMap<String, String>,
}

struct LoadedActiveGeneration {
    record: ActiveGeneration,
    path: PathBuf,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct BundleManager {
    root: PathBuf,
    manifest_path: PathBuf,
    cache_dir: PathBuf,
    staging_dir: PathBuf,
    active_dir: PathBuf,
}

impl BundleManager {
    pub fn from_project(project_root: impl AsRef<Path>) -> Result<Self, Box<Diagnostic>> {
        let (config, paths) = ProjectPaths::discover(project_root)?;
        let manifest = config
            .bundle_manifest
            .as_deref()
            .ok_or_else(|| {
                Box::new(Diagnostic::error(
                    "BUNDLE_MANIFEST_NOT_CONFIGURED",
                    "專案沒有設定 bundle manifest",
                    "請在 project.unone.json 設定 bundle_manifest；引擎不會猜測遠端內容目錄。",
                ))
            })?;
        Self::new(paths.root, manifest)
    }

    pub fn new(
        root: impl AsRef<Path>,
        manifest_path: impl AsRef<Path>,
    ) -> Result<Self, Box<Diagnostic>> {
        let root = fs::canonicalize(root.as_ref()).map_err(|error| {
            Box::new(Diagnostic::error(
                "BUNDLE_PROJECT_ROOT_INVALID",
                "無法解析 bundle 專案根目錄",
                format!("{}：{}", root.as_ref().display(), error),
            ))
        })?;
        let manifest_path = if manifest_path.as_ref().is_absolute() {
            let relative = manifest_path.as_ref().strip_prefix(&root).map_err(|_| {
                Box::new(Diagnostic::error(
                    "BUNDLE_MANIFEST_OUTSIDE_PROJECT",
                    "bundle manifest 超出專案根目錄",
                    format!("{} 必須位於專案根目錄內。", manifest_path.as_ref().display()),
                ))
            })?;
            resolve_project_path(&root, &normalize_relative_path(relative)).map_err(|_| {
                Box::new(Diagnostic::error(
                    "BUNDLE_MANIFEST_OUTSIDE_PROJECT",
                    "bundle manifest 超出專案根目錄",
                    format!("{} 必須是專案內的安全相對路徑。", manifest_path.as_ref().display()),
                ))
            })?
        } else {
            resolve_project_path(&root, &manifest_path.as_ref().to_string_lossy()).map_err(|_| {
                Box::new(Diagnostic::error(
                    "BUNDLE_MANIFEST_OUTSIDE_PROJECT",
                    "bundle manifest 超出專案根目錄",
                    format!("{} 必須是專案內的安全相對路徑。", manifest_path.as_ref().display()),
                ))
            })?
        };
        let manager = Self {
            root,
            manifest_path,
            cache_dir: PathBuf::new(),
            staging_dir: PathBuf::new(),
            active_dir: PathBuf::new(),
        };
        let storage_root = manager.root.join(".unone");
        let cache_dir = manager.checked_project_path(
            &storage_root.join("cache/bundles"),
            "bundle cache",
            "BUNDLE_STORAGE_PATH_UNSAFE",
        )?;
        let staging_dir = manager.checked_project_path(
            &storage_root.join("staging/bundles"),
            "bundle staging",
            "BUNDLE_STORAGE_PATH_UNSAFE",
        )?;
        let active_dir = manager.checked_project_path(
            &storage_root.join("active/bundles"),
            "active bundle storage",
            "BUNDLE_STORAGE_PATH_UNSAFE",
        )?;
        Ok(Self {
            cache_dir,
            staging_dir,
            active_dir,
            ..manager
        })
    }

    pub fn inspect(&self) -> EngineResult<BundleReport> {
        let manifest = match self.read_manifest() {
            Ok(manifest) => manifest,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let active = match self.latest_active() {
            Ok(active) => active,
            Err(error) => return EngineResult::failure(active_generation_error(error)),
        };
        let mut valid = true;
        let mut entries = Vec::with_capacity(manifest.bundles.len());
        for spec in &manifest.bundles {
            let verification = self.verify_source(spec);
            let source_exists = verification.is_ok();
            let (size_valid, hash_valid, error) = match verification {
                Ok(result) => (
                    result.size == spec.size_bytes,
                    result.sha256 == spec.sha256,
                    None,
                ),
                Err(error) => (false, false, Some(error)),
            };
            let cache_path = match self.cache_path(spec) {
                Ok(path) => path,
                Err(error) => return EngineResult::failure(*error),
            };
            let cached = cache_path.is_file();
            let cache_valid = cached && self.verify_cache(spec);
            let source_valid = source_exists && size_valid && hash_valid;
            let available = source_valid || cache_valid;
            if !available || (cached && !cache_valid) {
                valid = false;
            }
            entries.push(BundleEntryReport {
                id: spec.id.clone(),
                source: spec.source.clone(),
                source_exists,
                size_valid,
                hash_valid,
                cached,
                cache_valid,
                available,
                error,
            });
        }
        let active_generation = active
            .as_ref()
            .map(|value| value.record.generation);
        let active_bundles = active
            .map(|value| value.record.bundles)
            .unwrap_or_default();
        EngineResult::success(BundleReport {
            manifest_version: manifest.version,
            valid,
            entries,
            active_generation,
            active_bundles,
        })
    }

    pub fn install(&self, bundle_id: &str) -> EngineResult<BundleReport> {
        self.install_selected(Some(bundle_id), false)
    }

    pub fn install_selected(
        &self,
        bundle_id: Option<&str>,
        all: bool,
    ) -> EngineResult<BundleReport> {
        let mut fetcher = LocalBundleFetcher { root: &self.root };
        self.install_selected_with_fetcher(bundle_id, all, &mut fetcher)
    }

    pub fn install_with_fetcher(
        &self,
        bundle_id: &str,
        fetcher: &mut dyn BundleFetcher,
    ) -> EngineResult<BundleReport> {
        self.install_selected_with_fetcher(Some(bundle_id), false, fetcher)
    }

    pub fn install_selected_with_fetcher(
        &self,
        bundle_id: Option<&str>,
        all: bool,
        fetcher: &mut dyn BundleFetcher,
    ) -> EngineResult<BundleReport> {
        let roots = match validate_selection(bundle_id, all) {
            Ok(selection) => selection,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let manifest = match self.read_manifest() {
            Ok(manifest) => manifest,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let roots = match select_roots(&manifest, roots) {
            Ok(roots) => roots,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let previous = match self.latest_active() {
            Ok(active) => active,
            Err(error) => return EngineResult::failure(active_generation_error(error)),
        };
        let mut visiting = BTreeSet::new();
        let mut installed = BTreeMap::new();
        for root_spec in roots {
            if let Err(diagnostic) = self.install_recursive(
                &manifest,
                root_spec,
                &mut visiting,
                &mut installed,
                fetcher,
            ) {
                return EngineResult::failure(*diagnostic);
            }
        }
        let generation = match previous
            .as_ref()
            .map(|active| active.record.generation)
            .unwrap_or(0)
            .checked_add(1)
        {
            Some(generation) => generation,
            None => {
                return EngineResult::failure(Diagnostic::error(
                    "BUNDLE_ACTIVATE_FAILED",
                    "無法配置下一個 bundle generation",
                    "active generation 編號已達 u64 上限；不會覆寫目前 active。",
                ));
            }
        };
        let active = ActiveGeneration {
            generation,
            manifest_version: manifest.version,
            bundles: installed,
        };
        if let Err(err) = self.write_generation(&active) {
            return EngineResult::failure(Diagnostic::error(
                "BUNDLE_ACTIVATE_FAILED",
                "bundle 已驗證但啟用失敗",
                format!("無法建立 active generation：{err}"),
            ));
        }
        let mut result = self.inspect();
        if result.ok {
            result
                .effects
                .push(format!("active bundle generation {} created", generation));
        }
        result
    }

    /// Report the currently active bundle generation, if one was activated.
    pub fn active_generation(&self) -> Result<Option<u64>, Box<Diagnostic>> {
        self.latest_active()
            .map(|active| active.map(|active| active.record.generation))
            .map_err(|error| Box::new(active_generation_error(error)))
    }

    /// Return a token for one consistent manifest/active-record observation.
    ///
    /// The token is deliberately derived from the raw current manifest bytes
    /// and the identity/content of the newest formal active record. Callers can
    /// compare tokens before and after a read without combining generations.
    pub(crate) fn observation_token(&self) -> Result<String, Box<Diagnostic>> {
        let (_, manifest_bytes) = self.load_manifest()?;
        let active = self
            .latest_active()
            .map_err(|error| Box::new(active_generation_error(error)))?;
        let mut hasher = Sha256::new();
        hasher.update(b"unone-observation-v1\0manifest\0");
        hasher.update((manifest_bytes.len() as u64).to_le_bytes());
        hasher.update(&manifest_bytes);
        match active {
            Some(active) => {
                hasher.update(b"\0active\0");
                hasher.update(active.record.generation.to_le_bytes());
                if let Some(name) = active.path.file_name().and_then(|name| name.to_str()) {
                    hasher.update((name.len() as u64).to_le_bytes());
                    hasher.update(name.as_bytes());
                } else {
                    hasher.update(0_u64.to_le_bytes());
                }
                hasher.update((active.bytes.len() as u64).to_le_bytes());
                hasher.update(&active.bytes);
            }
            None => hasher.update(b"\0no-active-record\0"),
        }
        Ok(hex_digest(&hasher.finalize()))
    }

    /// Read the cached bytes of an activated bundle.
    ///
    /// Mirrors the Web host's `readActiveBundle`: the bundle must exist in the
    /// manifest, be part of the active generation, be cached and still match
    /// the manifest digest. The engine never fetches here; installing a
    /// generation stays a host-driven action.
    pub fn read_active_bundle(&self, bundle_id: &str) -> Result<Vec<u8>, Box<Diagnostic>> {
        let manifest = self.read_manifest()?;
        let Some(spec) = manifest.bundles.iter().find(|spec| spec.id == bundle_id) else {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_NOT_FOUND",
                "找不到要求讀取的 bundle",
                format!("manifest 中沒有 bundle '{bundle_id}'。"),
            );
            diagnostic.facts = serde_json::json!({
                "bundle_id": bundle_id,
                "available": manifest
                    .bundles
                    .iter()
                    .map(|spec| spec.id.clone())
                    .collect::<Vec<_>>(),
            });
            return Err(Box::new(diagnostic));
        };
        let active = self
            .latest_active()
            .map_err(|error| Box::new(active_generation_error(error)))?;
        let Some(active) = active else {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_GENERATION_MISMATCH",
                "沒有已啟用的 bundle generation",
                format!("讀取 bundle '{bundle_id}' 前必須先安裝並啟用一個 generation。"),
            );
            diagnostic.suggested_actions.push(ActionSuggestion {
                action: "install_bundle".to_string(),
                description: format!("安裝並啟用 bundle '{bundle_id}'。"),
                command: Some(format!("game bundle install {bundle_id}")),
            });
            return Err(Box::new(diagnostic));
        };
        if active.record.bundles.get(bundle_id) != Some(&spec.sha256) {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_GENERATION_MISMATCH",
                "bundle 不屬於目前啟用的 generation",
                format!(
                    "bundle '{bundle_id}' 的 manifest 雜湊與 active generation 不一致；不會讀取未啟用的內容。"
                ),
            );
            diagnostic.facts = serde_json::json!({
                "bundle_id": bundle_id,
                "generation": active.record.generation,
                "manifest_sha256": spec.sha256,
                "active_sha256": active.record.bundles.get(bundle_id),
            });
            diagnostic.suggested_actions.push(ActionSuggestion {
                action: "install_bundle".to_string(),
                description: format!("重新安裝 bundle '{bundle_id}' 以啟用目前 manifest。"),
                command: Some(format!("game bundle install {bundle_id}")),
            });
            return Err(Box::new(diagnostic));
        }
        let cache_path = self.cache_path(spec)?;
        let bytes = fs::read(&cache_path).map_err(|error| {
            Box::new(Diagnostic::error(
                "BUNDLE_CACHE_MISS",
                "找不到已啟用 bundle 的快取內容",
                format!("{}：{}", cache_path.display(), error),
            ))
        })?;
        if bytes.len() as u64 != spec.size_bytes || digest_bytes(&bytes) != spec.sha256 {
            return Err(Box::new(Diagnostic::error(
                "BUNDLE_CACHE_CORRUPT",
                "已啟用 bundle 的快取內容已損壞",
                format!("bundle '{bundle_id}' 的快取大小或雜湊與 manifest 不符。"),
            )));
        }
        Ok(bytes)
    }

    /// Resolve one declared asset from the active generation.
    pub fn read_active_asset(&self, asset: &AssetSpec) -> Result<Vec<u8>, Box<Diagnostic>> {
        let archive = self.read_active_bundle(&asset.bundle)?;
        read_asset_from_archive(&archive, asset)
    }

    fn install_recursive(
        &self,
        manifest: &BundleManifest,
        spec: &BundleSpec,
        visiting: &mut BTreeSet<String>,
        installed: &mut BTreeMap<String, String>,
        fetcher: &mut dyn BundleFetcher,
    ) -> Result<(), Box<Diagnostic>> {
        if installed.contains_key(&spec.id) {
            return Ok(());
        }
        if !visiting.insert(spec.id.clone()) {
            return Err(Box::new(Diagnostic::error(
                "BUNDLE_DEPENDENCY_CYCLE",
                "bundle 依賴有循環",
                format!("安裝 '{}' 時發現依賴循環。", spec.id),
            )));
        }
        for dependency in &spec.dependencies {
            let Some(dependency_spec) = manifest
                .bundles
                .iter()
                .find(|candidate| candidate.id == *dependency)
            else {
                return Err(Box::new(Diagnostic::error(
                    "BUNDLE_DEPENDENCY_NOT_FOUND",
                    "bundle 依賴不存在",
                    format!(
                        "bundle '{}' 依賴 '{}', 但 manifest 沒有該項目。",
                        spec.id, dependency
                    ),
                )));
            };
            self.install_recursive(manifest, dependency_spec, visiting, installed, fetcher)?;
        }
        let staging_dir = self.checked_project_path(
            &self.staging_dir,
            "bundle staging",
            "BUNDLE_STORAGE_PATH_UNSAFE",
        )?;
        fs::create_dir_all(&staging_dir).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STORAGE_FAILED",
                "無法建立 bundle staging",
                err.to_string(),
            ))
        })?;
        let cache_dir = self.checked_project_path(
            &self.cache_dir,
            "bundle cache",
            "BUNDLE_STORAGE_PATH_UNSAFE",
        )?;
        fs::create_dir_all(&cache_dir).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STORAGE_FAILED",
                "無法建立 bundle cache",
                err.to_string(),
            ))
        })?;
        let cache_path = self.cache_path(spec)?;
        if cache_path.exists() && !self.verify_cache(spec) {
            fs::remove_file(&cache_path).map_err(|err| {
                Box::new(Diagnostic::error(
                    "BUNDLE_CACHE_CORRUPT",
                    "無法移除損壞的 bundle cache",
                    err.to_string(),
                ))
            })?;
        }
        if !cache_path.exists() {
            let staged_path = self.checked_project_path(
                &self.staging_dir.join(format!("{}.part", spec.sha256)),
                "bundle staging",
                "BUNDLE_STORAGE_PATH_UNSAFE",
            )?;
            let mut reader = fetcher.open(spec)?;
            if let Err(diagnostic) = self.write_verified_stream(spec, &staged_path, &mut *reader) {
                let _ = fs::remove_file(&staged_path);
                return Err(diagnostic);
            }
            replace_staged_file(&staged_path, &cache_path).map_err(|err| {
                Box::new(Diagnostic::error(
                    "BUNDLE_CACHE_COMMIT_FAILED",
                    "無法提交 bundle cache",
                    err.to_string(),
                ))
            })?;
        }
        installed.insert(spec.id.clone(), spec.sha256.clone());
        visiting.remove(&spec.id);
        Ok(())
    }

    fn read_manifest(&self) -> Result<BundleManifest, Box<Diagnostic>> {
        self.load_manifest().map(|(manifest, _)| manifest)
    }

    fn load_manifest(&self) -> Result<(BundleManifest, Vec<u8>), Box<Diagnostic>> {
        let manifest_path = self.checked_project_path(
            &self.manifest_path,
            "bundle manifest",
            "BUNDLE_MANIFEST_PATH_UNSAFE",
        )?;
        let bytes = fs::read(&manifest_path).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_READ_FAILED",
                "無法讀取 bundle manifest",
                format!("{}：{}", manifest_path.display(), err),
            ))
        })?;
        let manifest = serde_json::from_slice(&bytes).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "bundle manifest 不是有效 JSON",
                format!("{}：{}", manifest_path.display(), err),
            ))
        })?;
        validate_bundle_manifest(&manifest)?;
        Ok((manifest, bytes))
    }

    fn checked_project_path(
        &self,
        path: &Path,
        label: &str,
        code: &str,
    ) -> Result<PathBuf, Box<Diagnostic>> {
        let relative = path.strip_prefix(&self.root).map_err(|_| {
            Box::new(Diagnostic::error(
                code,
                format!("{label} 不在專案根目錄內"),
                format!("{} 必須位於專案根目錄內。", path.display()),
            ))
        })?;
        resolve_project_path(&self.root, &normalize_relative_path(relative)).map_err(|diagnostic| {
            let mut diagnostic = *diagnostic;
            diagnostic.code = code.to_string();
            diagnostic.summary = format!("{label} 路徑不安全");
            diagnostic.explanation = format!("{}：{}", label, diagnostic.explanation);
            Box::new(diagnostic)
        })
    }

    fn source_path(&self, spec: &BundleSpec) -> Result<PathBuf, String> {
        resolve_project_path(&self.root, &spec.source)
            .map_err(|diagnostic| format!("{}：{}", diagnostic.code, diagnostic.explanation))
    }

    fn write_verified_stream(
        &self,
        spec: &BundleSpec,
        staged_path: &Path,
        reader: &mut dyn Read,
    ) -> Result<(), Box<Diagnostic>> {
        let mut file = File::create(staged_path).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STAGING_FAILED",
                "無法建立 bundle staging 檔案",
                format!("{}：{}", staged_path.display(), err),
            ))
        })?;
        let mut verifier = BundleVerifier::new(spec);
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = reader.read(&mut buffer).map_err(|err| {
                Box::new(Diagnostic::error(
                    "BUNDLE_FETCH_FAILED",
                    "讀取 bundle 來源失敗",
                    format!("bundle '{}'：{}", spec.id, err),
                ))
            })?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read]).map_err(|err| {
                Box::new(Diagnostic::error(
                    "BUNDLE_STAGING_FAILED",
                    "寫入 bundle staging 失敗",
                    format!("bundle '{}'：{}", spec.id, err),
                ))
            })?;
            verifier.update(&buffer[..read]);
        }
        file.flush().map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STAGING_FAILED",
                "flush bundle staging 失敗",
                format!("bundle '{}'：{}", spec.id, err),
            ))
        })?;
        file.sync_all().map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STAGING_FAILED",
                "同步 bundle staging 失敗",
                format!("bundle '{}'：{}", spec.id, err),
            ))
        })?;
        verifier.finish().map(|_| ())
    }

    fn cache_path(&self, spec: &BundleSpec) -> Result<PathBuf, Box<Diagnostic>> {
        self.checked_project_path(
            &self.cache_dir.join(format!("{}.bundle", spec.sha256)),
            "bundle cache",
            "BUNDLE_STORAGE_PATH_UNSAFE",
        )
    }

    fn verify_source(&self, spec: &BundleSpec) -> Result<FileVerification, String> {
        self.verify_path(&self.source_path(spec)?)
    }

    fn verify_cache(&self, spec: &BundleSpec) -> bool {
        self.cache_path(spec)
            .and_then(|path| self.verify_path(&path).map_err(|error| Box::new(Diagnostic::error(
                "BUNDLE_CACHE_CORRUPT",
                "bundle cache 驗證失敗",
                error,
            ))))
            .map(|result| result.size == spec.size_bytes && result.sha256 == spec.sha256)
            .unwrap_or(false)
    }

    fn verify_path(&self, path: &Path) -> Result<FileVerification, String> {
        let mut file = File::open(path).map_err(|err| err.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut size = 0_u64;
        loop {
            let read = file.read(&mut buffer).map_err(|err| err.to_string())?;
            if read == 0 {
                break;
            }
            size += read as u64;
            hasher.update(&buffer[..read]);
        }
        Ok(FileVerification {
            size,
            sha256: hex_digest(&hasher.finalize()),
        })
    }

    fn latest_active(&self) -> Result<Option<LoadedActiveGeneration>, String> {
        let active_dir = self
            .checked_project_path(
                &self.active_dir,
                "active bundle storage",
                "BUNDLE_STORAGE_PATH_UNSAFE",
            )
            .map_err(|diagnostic| diagnostic.explanation)?;
        let entries = match fs::read_dir(&active_dir) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.to_string()),
        };
        let mut paths = Vec::new();
        for entry in entries {
            let path = entry.map_err(|error| error.to_string())?.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(number) = formal_generation_number(name)? else {
                continue;
            };
            paths.push((number, path));
        }
        let Some((generation_number, path)) = paths.into_iter().max_by_key(|(number, _)| *number)
        else {
            return Ok(None);
        };
        let path = self
            .checked_project_path(
                &path,
                "active bundle record",
                "BUNDLE_STORAGE_PATH_UNSAFE",
            )
            .map_err(|diagnostic| diagnostic.explanation)?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let record = serde_json::from_slice::<ActiveGeneration>(&bytes)
            .map_err(|error| format!("{}：{}", path.display(), error))?;
        if record.generation != generation_number {
            return Err(format!(
                "{} 的 record generation {} 與檔名 generation {} 不一致。",
                path.display(),
                record.generation,
                generation_number
            ));
        }
        validate_active_generation(&record)?;
        Ok(Some(LoadedActiveGeneration {
            record,
            path,
            bytes,
        }))
    }

    fn write_generation(&self, generation: &ActiveGeneration) -> Result<(), String> {
        let active_dir = self
            .checked_project_path(
                &self.active_dir,
                "active bundle storage",
                "BUNDLE_STORAGE_PATH_UNSAFE",
            )
            .map_err(|diagnostic| diagnostic.explanation)?;
        fs::create_dir_all(&active_dir)
            .map_err(|err| format!("create active dir '{}': {err}", self.active_dir.display()))?;
        let path = active_dir
            .join(format!("generation-{:020}.json", generation.generation));
        let staging_path = active_dir.join(format!(
            "generation-{:020}.json.part",
            generation.generation
        ));
        let path = self
            .checked_project_path(
                &path,
                "active bundle record",
                "BUNDLE_STORAGE_PATH_UNSAFE",
            )
            .map_err(|diagnostic| diagnostic.explanation)?;
        let staging_path = self
            .checked_project_path(
                &staging_path,
                "active bundle staging",
                "BUNDLE_STORAGE_PATH_UNSAFE",
            )
            .map_err(|diagnostic| diagnostic.explanation)?;
        let text = serde_json::to_vec_pretty(generation).map_err(|err| err.to_string())?;
        let mut file = File::create(&staging_path).map_err(|err| {
            format!(
                "write generation staging '{}': {err}",
                staging_path.display()
            )
        })?;
        file.write_all(&text).map_err(|err| {
            format!(
                "write generation staging '{}': {err}",
                staging_path.display()
            )
        })?;
        file.flush().map_err(|err| {
            format!(
                "flush generation staging '{}': {err}",
                staging_path.display()
            )
        })?;
        file.sync_all().map_err(|err| {
            format!(
                "sync generation staging '{}': {err}",
                staging_path.display()
            )
        })?;
        drop(file);
        replace_staged_file(&staging_path, &path)
    }
}

fn formal_generation_number(name: &str) -> Result<Option<u64>, String> {
    let Some(number) = name
        .strip_prefix("generation-")
        .and_then(|value| value.strip_suffix(".json"))
    else {
        return Ok(None);
    };
    if number.is_empty() || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("active generation 檔名 '{}' 的編號無效。", name));
    }
    number
        .parse::<u64>()
        .map(Some)
        .map_err(|error| format!("active generation 檔名 '{}' 的編號無效：{}", name, error))
}

fn validate_active_generation(record: &ActiveGeneration) -> Result<(), String> {
    if record.generation == 0 {
        return Err("active generation 編號不可為 0。".to_string());
    }
    if record.bundles.is_empty() {
        return Err("active generation 不可包含空的 bundle set。".to_string());
    }
    for (id, sha256) in &record.bundles {
        if id.trim().is_empty() || !is_valid_sha256(sha256) {
            return Err(format!("active generation 中 bundle '{}' 的記錄無效。", id));
        }
    }
    Ok(())
}

fn active_generation_error(error: String) -> Diagnostic {
    let mut diagnostic = Diagnostic::error(
        "BUNDLE_ACTIVE_GENERATION_UNREADABLE",
        "無法讀取 active bundle generation",
        error,
    );
    diagnostic.facts = serde_json::json!({
        "active_record_policy": "latest formal generation only; corrupt records do not fall back",
    });
    diagnostic
}

struct FileVerification {
    size: u64,
    sha256: String,
}

struct LocalBundleFetcher<'a> {
    root: &'a Path,
}

impl BundleFetcher for LocalBundleFetcher<'_> {
    fn open(&mut self, spec: &BundleSpec) -> Result<Box<dyn Read + '_>, Box<Diagnostic>> {
        let path = resolve_bundle_source(self.root, "local bundle source", &spec.source)?;
        File::open(&path)
            .map(|file| Box::new(file) as Box<dyn Read>)
            .map_err(|err| {
                Box::new(Diagnostic::error(
                    "BUNDLE_FETCH_FAILED",
                    "無法開啟本地 bundle 來源",
                    format!("{}：{}", path.display(), err),
                ))
            })
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, io::Cursor, path::Path};

    use tempfile::tempdir;

    use crate::{asset::AssetSpec, diagnostics::Diagnostic};

    use super::{
        BUNDLE_ARCHIVE_MAGIC, BundleFetcher, BundleManager, BundleManifest, BundleSpec,
        BundleVerifier, pack_project, read_asset_from_archive, validate_bundle_manifest,
    };

    #[test]
    fn accepts_only_portable_project_relative_bundle_sources() {
        let directory = tempdir().unwrap();
        assert!(
            crate::project::resolve_project_path(directory.path(), "assets/bird.svg").is_ok()
        );
        for source in [
            "",
            "/etc/passwd",
            r"\Windows\system32.dll",
            "C:/outside/file.bundle",
            "assets/../outside.bundle",
            "assets/./bird.svg",
        ] {
            assert!(
                crate::project::resolve_project_path(directory.path(), source).is_err(),
                "source should be rejected: {source}"
            );
        }
    }

    #[test]
    fn incremental_verifier_accepts_multiple_chunks() {
        let content = b"chunk-a-chunk-b";
        let spec = BundleSpec {
            id: "chunked".to_string(),
            version: "1".to_string(),
            source: "memory".to_string(),
            sha256: digest(content),
            size_bytes: content.len() as u64,
            dependencies: vec![],
        };
        let mut verifier = BundleVerifier::new(&spec);
        verifier.update(b"chunk-a-");
        verifier.update(b"chunk-b");
        let result = verifier.finish().unwrap();
        assert_eq!(result.bundle_id, "chunked");
        assert_eq!(result.size_bytes, content.len() as u64);
        assert_eq!(result.sha256, spec.sha256);
    }

    #[test]
    fn packs_minimal_project_and_only_increments_version_when_content_changes() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        fs::write(
            dir.path().join("project.unone.json"),
            br#"{"name":"PackFixture","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json"}"#,
        )
        .unwrap();
        fs::write(dir.path().join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(
            dir.path().join("scenes/main.scene.json"),
            br#"{"entities":[]}"#,
        )
        .unwrap();

        let first = pack_project(dir.path(), None);
        assert!(first.ok);
        let first = first.value.unwrap();
        assert_eq!(first.manifest_version, 1);
        assert!(first.manifest_changed);
        assert!(first.project_config_changed);
        assert_eq!(first.bundles.len(), 3);
        assert!(dir.path().join("bundles/manifest.json").is_file());

        let second = pack_project(dir.path(), None);
        assert!(second.ok);
        let second = second.value.unwrap();
        assert_eq!(second.manifest_version, 1);
        assert!(!second.manifest_changed);
        assert!(!second.project_config_changed);

        fs::write(
            dir.path().join("scripts/main.luau"),
            b"return {changed=true}\n",
        )
        .unwrap();
        let third = pack_project(dir.path(), None);
        assert!(third.ok);
        assert_eq!(third.value.unwrap().manifest_version, 2);
    }

    #[test]
    fn packs_asset_archive_deterministically_and_declares_generated_bundle() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        fs::write(
            dir.path().join("project.unone.json"),
            br#"{"name":"AssetPackFixture","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json"}"#,
        )
        .unwrap();
        fs::write(dir.path().join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(
            dir.path().join("scenes/main.scene.json"),
            br#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        )
        .unwrap();
        fs::write(dir.path().join("assets/bird.svg"), b"<svg>bird</svg>").unwrap();
        fs::write(
            dir.path().join("assets/manifest.json"),
            br#"{"version":1,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();

        let first = pack_project(dir.path(), None);
        assert!(first.ok);
        let first = first.value.unwrap();
        assert_eq!(first.bundles.len(), 5);
        let content = dir.path().join("bundles/content.bundle");
        let first_bytes = fs::read(&content).unwrap();
        assert!(first_bytes.starts_with(BUNDLE_ARCHIVE_MAGIC));
        let header_len_offset = BUNDLE_ARCHIVE_MAGIC.len();
        let header_len = u32::from_le_bytes(
            first_bytes[header_len_offset..header_len_offset + 4]
                .try_into()
                .unwrap(),
        ) as usize;
        let header_start = header_len_offset + 4;
        let header: serde_json::Value =
            serde_json::from_slice(&first_bytes[header_start..header_start + header_len]).unwrap();
        assert_eq!(header["version"], 1);
        assert_eq!(header["files"][0]["path"], "assets/bird.svg");

        let second = pack_project(dir.path(), None);
        assert!(second.ok);
        let second = second.value.unwrap();
        assert_eq!(second.manifest_version, 1);
        assert!(!second.manifest_changed);
        assert_eq!(first_bytes, fs::read(content).unwrap());
    }

    #[test]
    fn validation_failure_does_not_leave_generated_outputs_or_config_mutation() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::create_dir_all(dir.path().join("scenes")).unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        fs::create_dir_all(dir.path().join("bundles")).unwrap();
        fs::write(
            dir.path().join("project.unone.json"),
            br#"{"name":"AtomicPackFixture","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json"}"#,
        )
        .unwrap();
        fs::write(dir.path().join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(
            dir.path().join("scenes/main.scene.json"),
            br#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        )
        .unwrap();
        fs::write(dir.path().join("assets/bird.svg"), b"<svg>bird</svg>").unwrap();
        fs::write(
            dir.path().join("assets/manifest.json"),
            br#"{"version":1,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();
        fs::write(dir.path().join("bundles/manifest.json"), b"not-json").unwrap();
        let original_config = fs::read(dir.path().join("project.unone.json")).unwrap();

        let result = pack_project(dir.path(), None);

        assert!(!result.ok);
        assert_eq!(result.diagnostics[0].code, "BUNDLE_MANIFEST_INVALID");
        assert_eq!(
            fs::read(dir.path().join("project.unone.json")).unwrap(),
            original_config
        );
        assert!(!dir.path().join("bundles/content.bundle").exists());
    }

    fn write_asset_project(dir: &Path) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        fs::create_dir_all(dir.join("scenes")).unwrap();
        fs::create_dir_all(dir.join("assets")).unwrap();
        fs::write(
            dir.join("project.unone.json"),
            br#"{"name":"AssetReadFixture","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json"}"#,
        )
        .unwrap();
        fs::write(
            dir.join("scripts/main.luau"),
            b"return {}
",
        )
        .unwrap();
        fs::write(
            dir.join("scenes/main.scene.json"),
            br#"{"entities":[{"id":"bird","sprite":{"asset":"asset://bird"}}]}"#,
        )
        .unwrap();
        fs::write(dir.join("assets/bird.svg"), b"<svg>bird</svg>").unwrap();
        fs::write(
            dir.join("assets/manifest.json"),
            br#"{"version":1,"assets":[{"id":"asset://bird","source":"assets/bird.svg","kind":"texture2d","bundle":"content"}]}"#,
        )
        .unwrap();
    }

    fn bird_spec() -> AssetSpec {
        AssetSpec {
            id: "asset://bird".to_string(),
            source: "assets/bird.svg".to_string(),
            kind: "texture2d".to_string(),
            bundle: "content".to_string(),
            files: Vec::new(),
        }
    }

    /// Regression: the Windows replace path refused ordinary project
    /// directories, which broke `bundle pack` on every repack.
    #[test]
    fn writing_over_an_existing_file_succeeds_and_keeps_the_new_bytes() {
        let dir = tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let path = root.join("nested/manifest.json");
        super::write_atomic(&root, &path, b"first").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"first");
        super::write_atomic(&root, &path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert!(
            !path.with_extension("json.part").exists(),
            "staging file was left behind"
        );
    }

    #[test]
    fn reads_packed_asset_bytes_back_out_of_the_archive() {
        let dir = tempdir().unwrap();
        write_asset_project(dir.path());
        assert!(pack_project(dir.path(), None).ok);

        let archive = fs::read(dir.path().join("bundles/content.bundle")).unwrap();
        let bytes = read_asset_from_archive(&archive, &bird_spec()).unwrap();
        assert_eq!(bytes, b"<svg>bird</svg>");
    }

    #[test]
    fn rejects_archive_reads_that_are_not_declared_or_not_an_archive() {
        let dir = tempdir().unwrap();
        write_asset_project(dir.path());
        assert!(pack_project(dir.path(), None).ok);
        let archive = fs::read(dir.path().join("bundles/content.bundle")).unwrap();

        let mut undeclared = bird_spec();
        undeclared.source = "assets/pig.svg".to_string();
        let error = read_asset_from_archive(&archive, &undeclared).unwrap_err();
        assert_eq!(error.code, "ASSET_NOT_IN_BUNDLE");

        let error = read_asset_from_archive(b"not-an-archive", &bird_spec()).unwrap_err();
        assert_eq!(error.code, "ASSET_ARCHIVE_INVALID");
    }

    #[test]
    fn rejects_archive_content_that_does_not_match_its_entry_digest() {
        let dir = tempdir().unwrap();
        write_asset_project(dir.path());
        assert!(pack_project(dir.path(), None).ok);
        let mut archive = fs::read(dir.path().join("bundles/content.bundle")).unwrap();
        let last = archive.len() - 1;
        archive[last] ^= 0xff;

        let error = read_asset_from_archive(&archive, &bird_spec()).unwrap_err();
        assert_eq!(error.code, "ASSET_CONTENT_CORRUPT");
    }

    #[test]
    fn reads_assets_only_from_an_activated_generation() {
        let dir = tempdir().unwrap();
        write_asset_project(dir.path());
        assert!(pack_project(dir.path(), None).ok);
        let manager = BundleManager::from_project(dir.path()).unwrap();

        let error = manager.read_active_asset(&bird_spec()).unwrap_err();
        assert_eq!(error.code, "BUNDLE_GENERATION_MISMATCH");
        assert!(manager.active_generation().unwrap().is_none());

        assert!(manager.install("content").ok);
        assert_eq!(manager.active_generation().unwrap(), Some(1));
        assert_eq!(
            manager.read_active_asset(&bird_spec()).unwrap(),
            b"<svg>bird</svg>"
        );

        let missing = BundleSpec {
            id: "absent".to_string(),
            version: "1".to_string(),
            source: "absent".to_string(),
            sha256: String::new(),
            size_bytes: 0,
            dependencies: Vec::new(),
        };
        assert_eq!(
            manager.read_active_bundle(&missing.id).unwrap_err().code,
            "BUNDLE_NOT_FOUND"
        );
    }

    #[test]
    fn installs_verified_bundle_and_dependencies() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("bundles")).unwrap();
        let base = b"base-content";
        let feature = b"feature-content";
        fs::write(dir.path().join("bundles/base.bundle"), base).unwrap();
        fs::write(dir.path().join("bundles/feature.bundle"), feature).unwrap();
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![
                BundleSpec {
                    id: "base".to_string(),
                    version: "1".to_string(),
                    source: "bundles/base.bundle".to_string(),
                    sha256: digest(base),
                    size_bytes: base.len() as u64,
                    dependencies: vec![],
                },
                BundleSpec {
                    id: "feature".to_string(),
                    version: "1".to_string(),
                    source: "bundles/feature.bundle".to_string(),
                    sha256: digest(feature),
                    size_bytes: feature.len() as u64,
                    dependencies: vec!["base".to_string()],
                },
            ],
        };
        fs::write(
            dir.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let manager = BundleManager::new(dir.path(), "manifest.json").unwrap();
        let report = manager.install("feature");
        assert!(report.ok);
        let report = report.value.unwrap();
        assert!(report.valid);
        assert_eq!(report.active_bundles.len(), 2);
        assert_eq!(report.active_generation, Some(1));
    }

    #[test]
    fn detects_tampered_bundle_before_install() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("bundles")).unwrap();
        fs::write(dir.path().join("bundles/base.bundle"), b"tampered").unwrap();
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![BundleSpec {
                id: "base".to_string(),
                version: "1".to_string(),
                source: "bundles/base.bundle".to_string(),
                sha256: digest(b"expected"),
                size_bytes: 8,
                dependencies: vec![],
            }],
        };
        fs::write(
            dir.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let manager = BundleManager::new(dir.path(), "manifest.json").unwrap();
        let report = manager.install("base");
        assert!(!report.ok);
        assert_eq!(report.diagnostics[0].code, "BUNDLE_VERIFY_FAILED");
    }

    #[test]
    fn host_fetcher_can_install_without_local_source() {
        let dir = tempdir().unwrap();
        let content = b"fetched-content";
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![BundleSpec {
                id: "remote-feature".to_string(),
                version: "1".to_string(),
                source: "https://cdn.example/remote-feature.bundle".to_string(),
                sha256: digest(content),
                size_bytes: content.len() as u64,
                dependencies: vec![],
            }],
        };
        fs::write(
            dir.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let manager = BundleManager::new(dir.path(), "manifest.json").unwrap();
        let mut fetcher = MemoryFetcher::one("remote-feature", content);

        let report = manager
            .install_with_fetcher("remote-feature", &mut fetcher)
            .value
            .unwrap();

        assert!(report.valid);
        assert_eq!(report.active_generation, Some(1));
        assert!(!report.entries[0].source_exists);
        assert!(report.entries[0].cache_valid);
        assert!(report.entries[0].available);
    }

    #[test]
    fn failed_host_fetch_keeps_previous_active_generation() {
        let dir = tempdir().unwrap();
        let base = b"base-content";
        let feature = b"feature-content";
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![
                BundleSpec {
                    id: "base".to_string(),
                    version: "1".to_string(),
                    source: "remote/base.bundle".to_string(),
                    sha256: digest(base),
                    size_bytes: base.len() as u64,
                    dependencies: vec![],
                },
                BundleSpec {
                    id: "feature".to_string(),
                    version: "1".to_string(),
                    source: "remote/feature.bundle".to_string(),
                    sha256: digest(feature),
                    size_bytes: feature.len() as u64,
                    dependencies: vec!["base".to_string()],
                },
            ],
        };
        fs::write(
            dir.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let manager = BundleManager::new(dir.path(), "manifest.json").unwrap();
        let mut first_fetcher =
            MemoryFetcher::new([("base", base.as_slice()), ("feature", feature.as_slice())]);
        assert!(manager.install_with_fetcher("base", &mut first_fetcher).ok);

        let mut bad_fetcher = MemoryFetcher::one("feature", b"tampered");
        let failed = manager.install_with_fetcher("feature", &mut bad_fetcher);
        assert!(!failed.ok);
        assert_eq!(failed.diagnostics[0].code, "BUNDLE_VERIFY_FAILED");

        let active = manager.inspect().value.unwrap();
        assert_eq!(active.active_generation, Some(1));
        assert_eq!(active.active_bundles.len(), 1);
        assert!(active.active_bundles.contains_key("base"));
    }

    #[test]
    fn selected_install_requires_exactly_one_root_mode_and_all_is_one_generation() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("bundles")).unwrap();
        let base = b"base-content";
        let feature = b"feature-content";
        fs::write(dir.path().join("bundles/base.bundle"), base).unwrap();
        fs::write(dir.path().join("bundles/feature.bundle"), feature).unwrap();
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![
                BundleSpec {
                    id: "base".to_string(),
                    version: "1".to_string(),
                    source: "bundles/base.bundle".to_string(),
                    sha256: digest(base),
                    size_bytes: base.len() as u64,
                    dependencies: vec![],
                },
                BundleSpec {
                    id: "feature".to_string(),
                    version: "1".to_string(),
                    source: "bundles/feature.bundle".to_string(),
                    sha256: digest(feature),
                    size_bytes: feature.len() as u64,
                    dependencies: vec!["base".to_string()],
                },
            ],
        };
        fs::write(
            dir.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let manager = BundleManager::new(dir.path(), "manifest.json").unwrap();

        assert_eq!(
            manager.install_selected(None, false).diagnostics[0].code,
            "BUNDLE_SELECTION_INVALID"
        );
        assert_eq!(
            manager.install_selected(Some("base"), true).diagnostics[0].code,
            "BUNDLE_SELECTION_INVALID"
        );

        let result = manager.install_selected(None, true);
        assert!(result.ok, "{:?}", result.diagnostics);
        let report = result.value.unwrap();
        assert_eq!(report.active_generation, Some(1));
        assert_eq!(report.active_bundles.len(), 2);
        assert_eq!(manager.active_generation().unwrap(), Some(1));
    }

    #[test]
    fn shared_manifest_fixture_has_matching_native_validation_failures() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/bundle-manifest-validation.json"
        ))
        .unwrap();
        let valid: BundleManifest = serde_json::from_value(fixture["valid"].clone()).unwrap();
        validate_bundle_manifest(&valid).unwrap();

        for (name, value) in fixture["invalid"].as_object().unwrap() {
            let expected_code = match name.as_str() {
                "empty_bundles" => "BUNDLE_MANIFEST_EMPTY",
                "empty_id" | "invalid_hash" | "invalid_size" => "BUNDLE_MANIFEST_INVALID",
                "duplicate_id" => "BUNDLE_MANIFEST_DUPLICATE_ID",
                "missing_dependency" => {
                    "BUNDLE_DEPENDENCY_NOT_FOUND"
                }
                "dependency_cycle" => {
                    "BUNDLE_DEPENDENCY_CYCLE"
                }
                _ => panic!("missing expected diagnostic code for fixture '{name}'"),
            };
            let directory = tempdir().unwrap();
            let manifest: BundleManifest = serde_json::from_value(value.clone()).unwrap();
            fs::write(
                directory.path().join("manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
            let manager = BundleManager::new(directory.path(), "manifest.json").unwrap();
            let root_id = manifest
                .bundles
                .first()
                .map(|spec| spec.id.as_str())
                .filter(|id| !id.trim().is_empty())
                .unwrap_or("probe");
            let mut id_fetcher = MemoryFetcher::new(std::iter::empty());
            let id_result = manager.install_selected_with_fetcher(
                Some(root_id),
                false,
                &mut id_fetcher,
            );
            assert!(!id_result.ok, "fixture case '{name}' unexpectedly activated by id");
            assert_eq!(id_result.diagnostics[0].code, expected_code);
            assert_eq!(id_fetcher.fetches, 0, "fixture case '{name}' fetched before validation");

            let mut all_fetcher = MemoryFetcher::new(std::iter::empty());
            let all_result = manager.install_selected_with_fetcher(None, true, &mut all_fetcher);
            assert!(!all_result.ok, "fixture case '{name}' unexpectedly activated by all");
            assert_eq!(all_result.diagnostics[0].code, expected_code);
            assert_eq!(all_fetcher.fetches, 0, "fixture case '{name}' fetched before validation");
            assert!(manager.active_generation().unwrap().is_none());
        }
    }

    #[test]
    fn host_fetcher_installs_url_sources_for_all_roots() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/bundle-manifest-validation.json"
        ))
        .unwrap();
        let manifest: BundleManifest = serde_json::from_value(fixture["valid"].clone()).unwrap();
        let directory = tempdir().unwrap();
        fs::write(
            directory.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let manager = BundleManager::new(directory.path(), "manifest.json").unwrap();
        let mut fetcher = MemoryFetcher::new([
            ("base", b"base-content".as_slice()),
            ("feature", b"feature-content".as_slice()),
        ]);

        let result = manager.install_selected_with_fetcher(None, true, &mut fetcher);
        assert!(result.ok, "{:?}", result.diagnostics);
        assert_eq!(result.value.unwrap().active_bundles.len(), 2);
    }

    #[test]
    fn newest_corrupt_formal_generation_is_not_skipped() {
        let directory = tempdir().unwrap();
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![BundleSpec {
                id: "base".to_string(),
                version: "1".to_string(),
                source: "https://cdn.example/base.bundle".to_string(),
                sha256: digest(b"base-content"),
                size_bytes: 12,
                dependencies: vec![],
            }],
        };
        fs::write(
            directory.path().join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        let active_dir = directory.path().join(".unone/active/bundles");
        fs::create_dir_all(&active_dir).unwrap();
        fs::write(
            active_dir.join("generation-00000000000000000001.json"),
            serde_json::json!({
                "generation": 1,
                "manifest_version": 1,
                "bundles": {"base": digest(b"base-content")}
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            active_dir.join("generation-00000000000000000002.json"),
            b"not-json",
        )
        .unwrap();
        let manager = BundleManager::new(directory.path(), "manifest.json").unwrap();

        assert_eq!(
            manager.active_generation().unwrap_err().code,
            "BUNDLE_ACTIVE_GENERATION_UNREADABLE"
        );
        assert_eq!(
            manager.inspect().diagnostics[0].code,
            "BUNDLE_ACTIVE_GENERATION_UNREADABLE"
        );
        assert_eq!(
            manager.read_active_bundle("base").unwrap_err().code,
            "BUNDLE_ACTIVE_GENERATION_UNREADABLE"
        );
    }

    #[test]
    fn observation_token_includes_manifest_and_active_record_state() {
        let directory = tempdir().unwrap();
        let manifest = BundleManifest {
            version: 1,
            bundles: vec![BundleSpec {
                id: "base".to_string(),
                version: "1".to_string(),
                source: "https://cdn.example/base.bundle".to_string(),
                sha256: digest(b"base-content"),
                size_bytes: 12,
                dependencies: vec![],
            }],
        };
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        fs::write(directory.path().join("manifest.json"), &manifest_bytes).unwrap();
        let manager = BundleManager::new(directory.path(), "manifest.json").unwrap();
        let before = manager.observation_token().unwrap();
        let mut changed_bytes = vec![b' '];
        changed_bytes.extend_from_slice(&manifest_bytes);
        fs::write(directory.path().join("manifest.json"), changed_bytes).unwrap();
        let manifest_changed = manager.observation_token().unwrap();
        assert_ne!(before, manifest_changed);

        let active_dir = directory.path().join(".unone/active/bundles");
        fs::create_dir_all(&active_dir).unwrap();
        fs::write(
            active_dir.join("generation-00000000000000000001.json"),
            serde_json::json!({
                "generation": 1,
                "manifest_version": 1,
                "bundles": {"base": digest(b"base-content")}
            })
            .to_string(),
        )
        .unwrap();
        let active_changed = manager.observation_token().unwrap();
        assert_ne!(manifest_changed, active_changed);
    }

    struct MemoryFetcher {
        bundles: BTreeMap<String, Vec<u8>>,
        fetches: usize,
    }

    impl MemoryFetcher {
        fn new<'a>(bundles: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> Self {
            Self {
                bundles: bundles
                    .into_iter()
                    .map(|(id, bytes)| (id.to_string(), bytes.to_vec()))
                    .collect(),
                fetches: 0,
            }
        }

        fn one(id: &str, bytes: &[u8]) -> Self {
            Self::new([(id, bytes)])
        }
    }

    impl BundleFetcher for MemoryFetcher {
        fn open(
            &mut self,
            spec: &BundleSpec,
        ) -> Result<Box<dyn std::io::Read + '_>, Box<Diagnostic>> {
            self.fetches += 1;
            self.bundles
                .get(&spec.id)
                .cloned()
                .map(|bytes| Box::new(Cursor::new(bytes)) as Box<dyn std::io::Read>)
                .ok_or_else(|| {
                    Box::new(Diagnostic::error(
                        "BUNDLE_FETCH_FAILED",
                        "測試 bundle fetcher 找不到內容",
                        spec.id.clone(),
                    ))
                })
        }
    }

    fn digest(value: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(value)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}
