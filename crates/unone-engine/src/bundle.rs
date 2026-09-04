use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::diagnostics::{Diagnostic, EngineResult};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BundleManifest {
    pub version: u32,
    #[serde(default)]
    pub bundles: Vec<BundleSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BundleSpec {
    pub id: String,
    pub version: String,
    pub source: String,
    pub sha256: String,
    pub size_bytes: u64,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

/// Host-owned source for a bundle.
///
/// Native callers can open a local file; Web/mobile callers can fetch or
/// decrypt bytes outside the engine and return a reader here. The engine only
/// owns streaming verification, staging and activation.
pub trait BundleFetcher {
    fn open(&mut self, spec: &BundleSpec) -> Result<Box<dyn Read + '_>, Box<Diagnostic>>;
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
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        let mut size = 0_u64;
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
            size += read as u64;
            hasher.update(&buffer[..read]);
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
        let actual_sha256 = hex_digest(&hasher.finalize());
        if size != spec.size_bytes || actual_sha256 != spec.sha256 {
            let mut diagnostic = Diagnostic::error(
                "BUNDLE_VERIFY_FAILED",
                "bundle 驗證失敗",
                format!("bundle '{}' 的大小或 SHA-256 與 manifest 不一致。", spec.id),
            );
            diagnostic.facts = serde_json::json!({
                "bundle_id": spec.id,
                "actual_sha256": actual_sha256,
                "expected_sha256": spec.sha256,
                "actual_size_bytes": size,
                "expected_size_bytes": spec.size_bytes,
                "staging_removed": true,
            });
            return Err(Box::new(diagnostic));
        }
        Ok(())
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
        fs::create_dir_all(&self.active_dir).map_err(|err| err.to_string())?;
        let path = self
            .active_dir
            .join(format!("generation-{:020}.json", generation.generation));
        let text = serde_json::to_vec_pretty(generation).map_err(|err| err.to_string())?;
        fs::write(path, text).map_err(|err| err.to_string())
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

    use super::{BundleFetcher, BundleManager, BundleManifest, BundleSpec};

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
