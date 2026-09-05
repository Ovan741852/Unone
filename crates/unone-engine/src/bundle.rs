use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::diagnostics::{Diagnostic, EngineResult};
use crate::project::ProjectPaths;

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

#[derive(Debug, Clone, Serialize)]
pub struct BundlePackReport {
    pub project_root: String,
    pub manifest_path: String,
    pub manifest_version: u32,
    pub manifest_changed: bool,
    pub project_config_changed: bool,
    pub bundles: Vec<BundleSpec>,
}

/// Generate the smallest runtime bundle manifest for a project.
///
/// The first packaging boundary intentionally keeps source files as the
/// bundle payload. Compression, archive layout and asset cooking belong to a
/// later host/content pipeline once a real game requires them. The engine
/// still owns the manifest shape and integrity fields used by native, Web and
/// mobile hosts.
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
    let manifest_path = output_path
        .map(|path| {
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                root.join(path)
            }
        })
        .unwrap_or_else(|| root.join("bundles/manifest.json"));
    if !manifest_path.starts_with(&root) {
        return EngineResult::failure(Diagnostic::error(
            "BUNDLE_OUTPUT_OUTSIDE_PROJECT",
            "bundle manifest 輸出位置超出專案根目錄",
            "打包工具只會修改目前遊戲專案內的 manifest 與 project config，避免 AI 工作流誤寫到其他目錄。",
        ));
    }

    let manifest_relative = match manifest_path.strip_prefix(&root) {
        Ok(path) => normalize_relative_path(path),
        Err(_) => unreachable!("manifest path was checked to be inside project root"),
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

    if config_changed {
        let config_bytes = match serde_json::to_vec_pretty(&config_json) {
            Ok(bytes) => bytes,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "PROJECT_CONFIG_WRITE_FAILED",
                    "無法序列化 bundle 專案設定",
                    error.to_string(),
                ));
            }
        };
        if let Err(error) = write_atomic(&paths.config, &config_bytes) {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_CONFIG_WRITE_FAILED",
                "無法更新 bundle_manifest 設定",
                error,
            ));
        }
    }

    let mut bundles = Vec::with_capacity(sources.len());
    for (id, source, dependencies) in sources {
        let bytes = match fs::read(root.join(&source)) {
            Ok(bytes) => bytes,
            Err(error) => {
                return EngineResult::failure(Diagnostic::error(
                    "BUNDLE_SOURCE_READ_FAILED",
                    "無法讀取 bundle 來源",
                    format!("{}：{}", root.join(&source).display(), error),
                ));
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
    if manifest_changed && let Err(error) = write_atomic(&manifest_path, &manifest_bytes) {
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

fn validate_pack_source(root: &Path, label: &str, source: &str) -> Result<(), Box<Diagnostic>> {
    let path = Path::new(source);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(Box::new(Diagnostic::error(
            "BUNDLE_SOURCE_OUTSIDE_PROJECT",
            "bundle 來源超出專案根目錄",
            format!("{label} 的路徑 '{source}' 必須是專案內的相對路徑。"),
        )));
    }
    let path = root.join(path);
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

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path '{}' has no parent directory", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create '{}': {error}", parent.display()))?;
    let staging = PathBuf::from(format!("{}.part", path.display()));
    let mut file = File::create(&staging)
        .map_err(|error| format!("create '{}': {error}", staging.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("write '{}': {error}", staging.display()))?;
    file.flush()
        .map_err(|error| format!("flush '{}': {error}", staging.display()))?;
    #[cfg(not(windows))]
    file.sync_all()
        .map_err(|error| format!("sync '{}': {error}", staging.display()))?;
    drop(file);
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace '{}': {error}", path.display()))?;
    }
    fs::rename(&staging, path).map_err(|error| {
        format!(
            "rename '{}' -> '{}': {error}",
            staging.display(),
            path.display()
        )
    })
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_source_path(source: &str) -> String {
    normalize_relative_path(Path::new(source))
}

fn digest_bytes(bytes: &[u8]) -> String {
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
        let project_root = project_root.as_ref().to_path_buf();
        let config_path = project_root.join("project.unone.json");
        let config_text = fs::read_to_string(&config_path).map_err(|err| {
            Box::new(Diagnostic::error(
                "PROJECT_CONFIG_NOT_FOUND",
                "找不到 Unone 專案設定",
                format!("{}：{}", config_path.display(), err),
            ))
        })?;
        let config: serde_json::Value = serde_json::from_str(&config_text).map_err(|err| {
            Box::new(Diagnostic::error(
                "PROJECT_CONFIG_INVALID",
                "Unone 專案設定不是有效 JSON",
                format!("{}：{}", config_path.display(), err),
            ))
        })?;
        let manifest = config
            .get("bundle_manifest")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                Box::new(Diagnostic::error(
                    "BUNDLE_MANIFEST_NOT_CONFIGURED",
                    "專案沒有設定 bundle manifest",
                    "請在 project.unone.json 設定 bundle_manifest；引擎不會猜測遠端內容目錄。",
                ))
            })?;
        Self::new(project_root, manifest)
    }

    pub fn new(
        root: impl AsRef<Path>,
        manifest_path: impl AsRef<Path>,
    ) -> Result<Self, Box<Diagnostic>> {
        let root = root.as_ref().to_path_buf();
        let manifest_path = if manifest_path.as_ref().is_absolute() {
            manifest_path.as_ref().to_path_buf()
        } else {
            root.join(manifest_path)
        };
        let manager = Self {
            root,
            manifest_path,
            cache_dir: PathBuf::new(),
            staging_dir: PathBuf::new(),
            active_dir: PathBuf::new(),
        };
        let storage_root = manager.root.join(".unone");
        Ok(Self {
            cache_dir: storage_root.join("cache/bundles"),
            staging_dir: storage_root.join("staging/bundles"),
            active_dir: storage_root.join("active/bundles"),
            ..manager
        })
    }

    pub fn inspect(&self) -> EngineResult<BundleReport> {
        let manifest = match self.read_manifest() {
            Ok(manifest) => manifest,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let active = self.latest_active().ok().flatten();
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
            let cached = self.cache_path(spec).is_file();
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
        let active_generation = active.as_ref().map(|value| value.generation);
        let active_bundles = active.map(|value| value.bundles).unwrap_or_default();
        EngineResult::success(BundleReport {
            manifest_version: manifest.version,
            valid,
            entries,
            active_generation,
            active_bundles,
        })
    }

    pub fn install(&self, bundle_id: &str) -> EngineResult<BundleReport> {
        let mut fetcher = LocalBundleFetcher { root: &self.root };
        self.install_with_fetcher(bundle_id, &mut fetcher)
    }

    pub fn install_with_fetcher(
        &self,
        bundle_id: &str,
        fetcher: &mut dyn BundleFetcher,
    ) -> EngineResult<BundleReport> {
        let manifest = match self.read_manifest() {
            Ok(manifest) => manifest,
            Err(diagnostic) => return EngineResult::failure(*diagnostic),
        };
        let Some(root_spec) = manifest.bundles.iter().find(|spec| spec.id == bundle_id) else {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_NOT_FOUND",
                "找不到要求安裝的 bundle",
                format!("manifest 中沒有 bundle '{bundle_id}'。"),
            );
            diagnostic.facts = serde_json::json!({"bundle_id": bundle_id, "available": manifest.bundles.iter().map(|spec| &spec.id).collect::<Vec<_>>()});
            return EngineResult::failure(diagnostic);
        };
        let mut visiting = BTreeSet::new();
        let mut installed = BTreeMap::new();
        if let Err(diagnostic) =
            self.install_recursive(&manifest, root_spec, &mut visiting, &mut installed, fetcher)
        {
            return EngineResult::failure(*diagnostic);
        }
        let generation = self.next_generation();
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
        fs::create_dir_all(&self.staging_dir).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STORAGE_FAILED",
                "無法建立 bundle staging",
                err.to_string(),
            ))
        })?;
        fs::create_dir_all(&self.cache_dir).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_STORAGE_FAILED",
                "無法建立 bundle cache",
                err.to_string(),
            ))
        })?;
        let cache_path = self.cache_path(spec);
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
            let staged_path = self.staging_dir.join(format!("{}.part", spec.sha256));
            let mut reader = fetcher.open(spec)?;
            if let Err(diagnostic) = self.write_verified_stream(spec, &staged_path, &mut *reader) {
                let _ = fs::remove_file(&staged_path);
                return Err(diagnostic);
            }
            fs::rename(&staged_path, &cache_path).map_err(|err| {
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
        let text = fs::read_to_string(&self.manifest_path).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_READ_FAILED",
                "無法讀取 bundle manifest",
                format!("{}：{}", self.manifest_path.display(), err),
            ))
        })?;
        serde_json::from_str(&text).map_err(|err| {
            Box::new(Diagnostic::error(
                "BUNDLE_MANIFEST_INVALID",
                "bundle manifest 不是有效 JSON",
                format!("{}：{}", self.manifest_path.display(), err),
            ))
        })
    }

    fn source_path(&self, spec: &BundleSpec) -> PathBuf {
        self.root.join(&spec.source)
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

    fn cache_path(&self, spec: &BundleSpec) -> PathBuf {
        self.cache_dir.join(format!("{}.bundle", spec.sha256))
    }

    fn verify_source(&self, spec: &BundleSpec) -> Result<FileVerification, String> {
        self.verify_path(&self.source_path(spec))
    }

    fn verify_cache(&self, spec: &BundleSpec) -> bool {
        self.verify_path(&self.cache_path(spec))
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

    fn latest_active(&self) -> Result<Option<ActiveGeneration>, String> {
        let entries = match fs::read_dir(&self.active_dir) {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.to_string()),
        };
        let mut paths: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        paths.sort();
        for path in paths.into_iter().rev() {
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path)
                && let Ok(generation) = serde_json::from_str::<ActiveGeneration>(&text)
            {
                return Ok(Some(generation));
            }
        }
        Ok(None)
    }

    fn next_generation(&self) -> u64 {
        self.latest_active()
            .ok()
            .flatten()
            .map(|generation| generation.generation + 1)
            .unwrap_or(1)
    }

    fn write_generation(&self, generation: &ActiveGeneration) -> Result<(), String> {
        fs::create_dir_all(&self.active_dir)
            .map_err(|err| format!("create active dir '{}': {err}", self.active_dir.display()))?;
        let path = self
            .active_dir
            .join(format!("generation-{:020}.json", generation.generation));
        let staging_path = self.active_dir.join(format!(
            "generation-{:020}.json.part",
            generation.generation
        ));
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
        #[cfg(not(windows))]
        file.sync_all().map_err(|err| {
            format!(
                "sync generation staging '{}': {err}",
                staging_path.display()
            )
        })?;
        drop(file);
        fs::rename(&staging_path, &path).map_err(|err| {
            format!(
                "rename generation '{}' -> '{}': {err}",
                staging_path.display(),
                path.display()
            )
        })
    }
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
        let path = self.root.join(&spec.source);
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
    use std::{collections::BTreeMap, fs, io::Cursor};

    use tempfile::tempdir;

    use crate::diagnostics::Diagnostic;

    use super::{
        BundleFetcher, BundleManager, BundleManifest, BundleSpec, BundleVerifier, pack_project,
    };

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

    struct MemoryFetcher {
        bundles: BTreeMap<String, Vec<u8>>,
    }

    impl MemoryFetcher {
        fn new<'a>(bundles: impl IntoIterator<Item = (&'a str, &'a [u8])>) -> Self {
            Self {
                bundles: bundles
                    .into_iter()
                    .map(|(id, bytes)| (id.to_string(), bytes.to_vec()))
                    .collect(),
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
