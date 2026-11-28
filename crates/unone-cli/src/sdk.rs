//! Portable distribution and target dispatch; contains no gameplay policy.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
const NAME: &str = "sdk.json";
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    path: String,
    bytes: u64,
    sha256: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Runtime {
    id: String,
    target: String,
    variant: String,
    path: String,
    compiled_systems: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    runtime_packages: BTreeMap<String, String>,
    bytes: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct PackageVersionGap {
    pub(crate) expected: String,
    pub(crate) found: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeGap {
    pub(crate) id: String,
    pub(crate) target: String,
    pub(crate) variant: String,
    pub(crate) compiled_systems: Vec<String>,
    pub(crate) runtime_packages: BTreeMap<String, String>,
    pub(crate) matches_target: bool,
    pub(crate) matches_variant: bool,
    pub(crate) matches_requested_id: bool,
    pub(crate) missing_systems: Vec<String>,
    pub(crate) missing_packages: BTreeMap<String, PackageVersionGap>,
}

/// Preserve the concrete selection mismatch for CLI/MCP recovery, without
/// choosing which of the game's enabled capabilities it can safely remove.
#[derive(Debug, Serialize)]
pub(crate) struct RuntimeUnavailable {
    pub(crate) sdk_root: PathBuf,
    pub(crate) target: String,
    pub(crate) variant: String,
    pub(crate) requested_runtime_id: Option<String>,
    pub(crate) required_systems: Vec<String>,
    pub(crate) required_packages: BTreeMap<String, String>,
    pub(crate) available_runtimes: Vec<RuntimeGap>,
}

impl std::fmt::Display for RuntimeUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let installed = self.available_runtimes.iter().map(|runtime| format!(
            "{} ({}/{}): missing systems [{}], package mismatches [{}]{}{}{}", runtime.id, runtime.target, runtime.variant,
            runtime.missing_systems.join(", "),
            runtime.missing_packages.iter().map(|(id, gap)| format!("{id}: expected {}, found {}", gap.expected, gap.found.as_deref().unwrap_or("<missing>"))).collect::<Vec<_>>().join(", "),
            if runtime.matches_target { "" } else { "; target does not match" },
            if runtime.matches_variant { "" } else { "; variant does not match" },
            if runtime.matches_requested_id { "" } else { "; requested ID does not match" },
        )).collect::<Vec<_>>().join("; ");
        write!(formatter,
            "SDK_RUNTIME_UNAVAILABLE: no matching target={}, variant={}, runtime_id={}; enabled project systems [{}]; required runtime packages [{}]; installed runtimes: {}. Run game sdk inspect --json and game systems list --json. Explicitly disable only systems the project does not use, or install a runtime pack supporting all required systems and exact package versions. Keep required package declarations intact",
            self.target, self.variant, self.requested_runtime_id.as_deref().unwrap_or("<automatic>"),
            self.required_systems.join(", "), self.required_packages.iter().map(|(id, version)| format!("{id}@{version}")).collect::<Vec<_>>().join(", "), if installed.is_empty() { "<none>" } else { &installed },
        )
    }
}

impl std::error::Error for RuntimeUnavailable {}

/// Keep selection and its failure evidence together. The policy remains exact
/// target/variant/optional ID, systems and exact packages, then smallest bytes and ID.
fn matching_runtime<'a>(
    runtimes: &'a [Runtime],
    sdk_root: &Path,
    target: &str,
    variant: &str,
    id: Option<&str>,
    systems: &[String],
    packages: &BTreeMap<String, String>,
) -> Result<&'a Runtime> {
    let mut candidates: Vec<_> = runtimes.iter().filter(|runtime| {
        runtime.target == target && runtime.variant == variant
            && id.is_none_or(|wanted| wanted == runtime.id)
            && systems.iter().all(|system| runtime.compiled_systems.contains(system))
            && package_version_gaps(packages, &runtime.runtime_packages).is_empty()
    }).collect();
    candidates.sort_by(|left, right| left.bytes.cmp(&right.bytes).then(left.id.cmp(&right.id)));
    candidates.first().copied().ok_or_else(|| RuntimeUnavailable {
        sdk_root: sdk_root.to_path_buf(),
        target: target.to_string(),
        variant: variant.to_string(),
        requested_runtime_id: id.map(str::to_string),
        required_systems: systems.to_vec(),
        required_packages: packages.clone(),
        available_runtimes: runtimes.iter().map(|runtime| RuntimeGap {
            id: runtime.id.clone(),
            target: runtime.target.clone(),
            variant: runtime.variant.clone(),
            compiled_systems: runtime.compiled_systems.clone(),
            runtime_packages: runtime.runtime_packages.clone(),
            matches_target: runtime.target == target,
            matches_variant: runtime.variant == variant,
            matches_requested_id: id.is_none_or(|wanted| wanted == runtime.id),
            missing_systems: systems.iter().filter(|system| !runtime.compiled_systems.contains(system)).cloned().collect(),
            missing_packages: package_version_gaps(packages, &runtime.runtime_packages),
        }).collect(),
    }.into())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    engine_version: String,
    host: String,
    cli: String,
    templates: String,
    runtimes: Vec<Runtime>,
    files: Vec<File>,
}

/// A runtime selected from an already hash-verified SDK manifest.
///
/// Keep this selection in one place so `export` and `project prepare` cannot
/// drift into two different target/variant/system rules.  The descriptor is
/// retained for the caller that needs to derive a trusted launch command.
#[derive(Clone, Debug)]
pub(crate) struct SdkSelection {
    pub(crate) sdk_root: PathBuf,
    pub(crate) templates_root: PathBuf,
    pub(crate) runtime_root: PathBuf,
    pub(crate) runtime_manifest: Value,
    pub(crate) host: &'static crate::hosts::Host,
    pub(crate) runtime_id: String,
    pub(crate) variant: String,
    pub(crate) engine_version: String,
}

impl SdkSelection {
    pub(crate) fn report(&self) -> Value {
        json!({
            "target": self.host.id,
            "family": self.host.family,
            "runtime_id": self.runtime_id,
            "variant": self.variant,
            "engine_version": self.engine_version,
            "runtime_root": self.runtime_root,
            "descriptor": self.runtime_root.join("runtime.json"),
            "readiness": self.runtime_manifest.get("readiness").cloned(),
            "runtime_packages": self.runtime_manifest.get("runtime_packages").cloned().unwrap_or_else(|| json!({})),
            "verified": true,
        })
    }
}

#[derive(Clone, Debug)]
pub(crate) struct VerifiedExecutable {
    pub(crate) relative: PathBuf,
    pub(crate) path: PathBuf,
    pub(crate) sha256: String,
}

/// Resolve the single Windows executable declared by a hash-verified runtime.
/// The canonical path must stay inside that runtime; this is the path a host
/// may launch, while the standalone export still carries its own copy.
pub(crate) fn verified_windows_executable(
    selection: &SdkSelection,
) -> Result<VerifiedExecutable> {
    ensure!(
        selection.runtime_manifest["target"] == "windows",
        "PREPARE_RUNTIME_DESCRIPTOR_INVALID: selected runtime is not a Windows runtime"
    );
    let files = selection.runtime_manifest["files"]
        .as_array()
        .context("PREPARE_RUNTIME_DESCRIPTOR_INVALID: Windows runtime.json has no files")?;
    let declared = selection.runtime_manifest["executable"].as_str();
    let mut candidates = Vec::new();
    for file in files {
        let path = file["path"]
            .as_str()
            .context("PREPARE_RUNTIME_DESCRIPTOR_INVALID: runtime file path is missing")?;
        let expected_hash = file["sha256"]
            .as_str()
            .context("PREPARE_RUNTIME_DESCRIPTOR_INVALID: runtime file hash is missing")?;
        let relative = safe_runtime_file(path)?;
        if relative
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        {
            if declared
                .is_some_and(|declared| normalize_runtime_file(&relative) != declared)
            {
                continue;
            }
            let path = selection
                .runtime_root
                .join(&relative)
                .canonicalize()
                .with_context(|| format!("PREPARE_RUNTIME_DESCRIPTOR_INVALID: missing {path}"))?;
            ensure!(
                path.starts_with(&selection.runtime_root),
                "PREPARE_RUNTIME_DESCRIPTOR_INVALID: runtime executable escapes the selected runtime"
            );
            let bytes = fs::read(&path)
                .with_context(|| format!("PREPARE_RUNTIME_DESCRIPTOR_INVALID: missing {path:?}"))?;
            ensure!(
                hash(&bytes).eq_ignore_ascii_case(expected_hash),
                "PREPARE_RUNTIME_DESCRIPTOR_INVALID: runtime executable hash is invalid"
            );
            candidates.push(VerifiedExecutable {
                relative,
                path,
                sha256: expected_hash.to_string(),
            });
        }
    }
    let candidate = if let Some(declared) = declared {
        ensure!(
            candidates.len() == 1,
            "PREPARE_RUNTIME_DESCRIPTOR_INVALID: declared executable is not a verified .exe file"
        );
        ensure!(
            normalize_runtime_file(&candidates[0].relative) == declared,
            "PREPARE_RUNTIME_DESCRIPTOR_INVALID: declared executable is not the verified runtime file"
        );
        candidates.pop().unwrap()
    } else {
        ensure!(
            candidates.len() == 1,
            "PREPARE_EXECUTABLE_AMBIGUOUS: verified Windows runtime must declare exactly one .exe"
        );
        candidates.pop().unwrap()
    };
    Ok(candidate)
}

pub(crate) fn ensure_windows_runtime_executable_path(path: &Path) -> Result<()> {
    let length = path.to_string_lossy().encode_utf16().count();
    ensure!(
        length < 260,
        "SDK_RUNTIME_EXECUTABLE_PATH_TOO_LONG: canonical SDK runtime executable path is {} UTF-16 code units (the Windows native host requires fewer than 260); Fix: install the trusted SDK in a shallow directory and retry",
        length
    );
    Ok(())
}

fn normalize_runtime_file(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn safe_runtime_file(path: &str) -> Result<PathBuf> {
    let candidate = Path::new(path);
    ensure!(
        !path.is_empty() && !candidate.is_absolute(),
        "PREPARE_RUNTIME_DESCRIPTOR_INVALID: executable path must be relative"
    );
    ensure!(
        candidate
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_))),
        "PREPARE_RUNTIME_DESCRIPTOR_INVALID: executable path escapes the runtime"
    );
    Ok(candidate.to_path_buf())
}
fn runtime_files(r: &Value) -> Result<Vec<(String, String)>> {
    if r.get("target").and_then(Value::as_str).unwrap_or("web") == "web" {
        return ["javascript", "wasm"]
            .into_iter()
            .map(|key| {
                Ok((
                    r[key].as_str().context("SDK_RUNTIME_FILE_INVALID")?.into(),
                    r[format!("{key}_sha256")]
                        .as_str()
                        .context("SDK_RUNTIME_HASH_INVALID")?
                        .into(),
                ))
            })
            .collect();
    }
    r["files"]
        .as_array()
        .context("SDK_RUNTIME_FILES_REQUIRED")?
        .iter()
        .map(|f| {
            Ok((
                f["path"]
                    .as_str()
                    .context("SDK_RUNTIME_PATH_REQUIRED")?
                    .into(),
                f["sha256"]
                    .as_str()
                    .context("SDK_RUNTIME_HASH_REQUIRED")?
                    .into(),
            ))
        })
        .collect()
}
pub(crate) fn descriptor_packages(descriptor: &Value) -> Result<BTreeMap<String, String>> {
    descriptor.get("runtime_packages").map_or_else(
        || Ok(BTreeMap::new()),
        |packages| serde_json::from_value(packages.clone()).context("SDK_RUNTIME_PACKAGES_INVALID"),
    )
}

/// Shared exact-version policy for SDK selection and direct runtime export.
/// Missing legacy metadata is an empty available set, not implicit support.
pub(crate) fn package_version_gaps(
    required: &BTreeMap<String, String>,
    available: &BTreeMap<String, String>,
) -> BTreeMap<String, PackageVersionGap> {
    required.iter().filter(|(id, version)| available.get(*id) != Some(*version))
        .map(|(id, version)| (id.clone(), PackageVersionGap {
            expected: version.clone(), found: available.get(id).cloned(),
        })).collect()
}

fn validate_runtime_package_metadata(runtime: &Runtime, descriptor: &Value) -> Result<()> {
    ensure!(
        runtime.runtime_packages == descriptor_packages(descriptor)?,
        "SDK_RUNTIME_PACKAGES_MISMATCH: {} sdk.json and runtime.json must advertise the same package versions",
        runtime.id
    );
    Ok(())
}

fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn host() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}
fn safe(root: &Path, name: &str) -> Result<PathBuf> {
    ensure!(
        !name.is_empty()
            && !name.contains('\\')
            && !name.contains(':')
            && !name
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
            && !Path::new(name).is_absolute(),
        "SDK_PATH_INVALID: {name}"
    );
    let path = root
        .join(name)
        .canonicalize()
        .with_context(|| format!("SDK_FILE_MISSING: {name}"))?;
    ensure!(
        path.starts_with(root.canonicalize()?),
        "SDK_PATH_ESCAPE: {name}"
    );
    Ok(path)
}
pub fn root(explicit: Option<&Path>) -> Result<PathBuf> {
    if let Some(path) = explicit {
        return Ok(path.canonicalize()?);
    }
    if let Some(path) = std::env::var_os("UNONE_SDK_ROOT") {
        return Ok(PathBuf::from(path).canonicalize()?);
    }
    let exe = std::env::current_exe()?;
    for path in [
        exe.parent().unwrap().to_path_buf(),
        exe.parent().unwrap().join(".."),
    ] {
        if path.join(NAME).is_file() {
            return Ok(path.canonicalize()?);
        }
    }
    bail!(
        "SDK_NOT_FOUND: pass --sdk <directory> or set UNONE_SDK_ROOT; install the published Core SDK"
    )
}
fn load(root: &Path) -> Result<Manifest> {
    let m: Manifest =
        serde_json::from_slice(&fs::read(root.join(NAME))?).context("SDK_MANIFEST_INVALID")?;
    ensure!(
        m.version == 1,
        "SDK_VERSION_UNSUPPORTED: use a CLI matching this SDK"
    );
    ensure!(
        m.engine_version == env!("CARGO_PKG_VERSION"),
        "SDK_ENGINE_VERSION_MISMATCH: use the CLI supplied with this SDK"
    );
    ensure!(
        m.host == host(),
        "SDK_HOST_MISMATCH: install SDK for {}",
        host()
    );
    let mut paths = BTreeSet::new();
    for file in &m.files {
        ensure!(paths.insert(file.path.to_lowercase()), "SDK_DUPLICATE_PATH");
        let bytes = fs::read(safe(root, &file.path)?)?;
        ensure!(
            bytes.len() as u64 == file.bytes && hash(&bytes) == file.sha256,
            "SDK_HASH_MISMATCH: {}; reinstall SDK",
            file.path
        );
    }
    ensure!(paths.contains(&m.cli.to_lowercase()), "SDK_CLI_UNLISTED");
    ensure!(
        hash(&fs::read(std::env::current_exe()?)?) == hash(&fs::read(safe(root, &m.cli)?)?),
        "SDK_CLI_MISMATCH: use the CLI supplied with this SDK"
    );
    ensure!(
        paths.contains("scripts/pack-native-android.ps1"),
        "SDK_PACKAGER_UNLISTED"
    );
    let mut ids = BTreeSet::new();
    for runtime in &m.runtimes {
        ensure!(ids.insert(&runtime.id), "SDK_RUNTIME_DUPLICATE");
        ensure!(
            ["web", "windows", "android-arm64", "android-x86_64"]
                .contains(&runtime.target.as_str())
                && ["production", "development"].contains(&runtime.variant.as_str()),
            "SDK_RUNTIME_UNSUPPORTED"
        );
        let path = format!("{}/runtime.json", runtime.path);
        ensure!(paths.contains(&path.to_lowercase()), "SDK_RUNTIME_UNLISTED");
        let r: Value = serde_json::from_slice(&fs::read(safe(root, &path)?)?)?;
        ensure!(
            r["profile"] == "release"
                && r["dev_tools"] == false
                && r["preview_tools"] == (runtime.variant == "development"),
            "SDK_RUNTIME_VARIANT_MISMATCH"
        );
        ensure!(
            serde_json::to_value(&runtime.compiled_systems)? == r["compiled_systems"],
            "SDK_CAPABILITIES_MISMATCH"
        );
        validate_runtime_package_metadata(runtime, &r)?;
        ensure!(
            r.get("target").and_then(Value::as_str).unwrap_or("web") == runtime.target,
            "SDK_RUNTIME_TARGET_MISMATCH"
        );
        for (name, expected) in runtime_files(&r)? {
            let path = format!("{}/{name}", runtime.path);
            ensure!(
                paths.contains(&path.to_lowercase()),
                "SDK_RUNTIME_FILE_UNLISTED"
            );
            ensure!(
                hash(&fs::read(safe(root, &path)?)?) == expected,
                "SDK_RUNTIME_HASH_MISMATCH"
            );
        }
    }
    for file in template_files() {
        let path = format!("{}/web/{file}", m.templates);
        ensure!(
            paths.contains(&path.to_lowercase()),
            "SDK_TEMPLATE_UNLISTED: {file}"
        );
        safe(root, &path)?;
    }
    Ok(m)
}
pub fn template_root(explicit: Option<&Path>) -> Result<PathBuf> {
    if explicit.is_some() || std::env::var_os("UNONE_SDK_ROOT").is_some() || root(None).is_ok() {
        let root = root(explicit)?;
        let m = load(&root)?;
        return safe(&root, &m.templates);
    }
    // Developer convenience is based on the current checkout, never a build-machine path.
    let cwd = std::env::current_dir()?;
    ensure!(
        cwd.join("Cargo.toml").is_file() && cwd.join("web/player/index.html").is_file(),
        "SDK_NOT_FOUND: pass --sdk <directory>; source development must run from the checkout root"
    );
    Ok(cwd)
}
fn template_files() -> Vec<&'static str> {
    let mut files = crate::export::WEB_FILES.to_vec();
    files.extend([
        "player/index.html",
        "developer/main.js",
        "developer/api.js",
        "developer/asset-usages.js",
        "developer/panel.js",
        "developer/panel.css",
        "vendor/effekseer/effekseer.js",
        "vendor/effekseer/effekseer.wasm",
        "vendor/effekseer/LICENSE",
    ]);
    files.sort();
    files.dedup();
    files
}
pub fn inspect(explicit: Option<&Path>) -> Result<Value> {
    let root = root(explicit)?;
    let m = load(&root)?;
    let sources=m.runtimes.iter().map(|runtime|->Result<Value>{
        let path=safe(&root,&format!("{}/runtime.json",runtime.path))?;
        let data=fs::read(&path)?;
        let descriptor:Value=serde_json::from_slice(&data)?;
        Ok(json!({"id":runtime.id,"path":path,"sha256":hash(&data),"descriptor":descriptor,"evidence":"hash-verified declaration; not renderer execution"}))
    }).collect::<Result<Vec<_>>>()?;
    let package_paths: BTreeSet<_> = unone_engine::runtime_package_files().into_iter().map(|(path, _)| path).collect();
    let package_files = m.files.iter().filter(|file| package_paths.contains(file.path.as_str())).map(|file| -> Result<Value> {
        Ok(json!({"path":safe(&root,&file.path)?,"relative_path":file.path,"bytes":file.bytes,"sha256":file.sha256}))
    }).collect::<Result<Vec<_>>>()?;
    let source_evidence=json!({"sdk_root":root,"cli":{"path":safe(&root,&m.cli)?,"sha256":hash(&fs::read(safe(&root,&m.cli)?)?)},"templates":{"path":safe(&root,&m.templates)?,"files":m.files.iter().filter(|f|f.path.starts_with(&format!("{}/",m.templates))).collect::<Vec<_>>()},"runtime_packages":{"files":package_files,"evidence":"hash-verified bundled source and type inventory; selected runtime descriptors declare executable package versions"},"runtimes":sources,"plugins":"separately discovered; not pinned or compatibility-certified by sdk.json; run plugin list/inspect/test"});
    let mut report =
        json!({"version":m.version,"engine_version":m.engine_version,"host":m.host,"verified":true,"runtimes":m.runtimes,"content":"shared-luau-and-declared-assets","targets":crate::hosts::inspect_targets()})
    ;
    report["sources"]=source_evidence;
    Ok(report)
}

/// Resolve the same trusted SDK/runtime selection used by an export without
/// creating output.  Project content is parsed here as a read-only host gate,
/// so `project prepare` can reject an incompatible presentation before sync or
/// export changes any state.
pub(crate) fn preflight(
    project: &Path,
    explicit: Option<&Path>,
    target: &str,
    id: Option<&str>,
    development: bool,
) -> Result<SdkSelection> {
    let selection = select_runtime(project, explicit, target, id, development)?;
    ensure!(
        !(selection.host.family == "native-wgpu" && development),
        "NATIVE_DEVELOPMENT_VARIANT_UNAVAILABLE: native player exports use the release runtime"
    );
    let (_, settings, assets, mut files) = crate::export::content(project)?;
    // Validate the same presentation payload and packaged font paths that the
    // exporters append, while still keeping preflight read-only.
    let presentation = crate::export::append_presentation(project, &mut files)?;
    if selection.host.family == "native-wgpu" {
        crate::export::native_shader_gate(&files)?;
        crate::hosts::native_wgpu_export_gate(&settings, Some(&presentation))?;
        windows_gpu_memory_for_target(
            selection.host.id,
            presentation.windows_gpu_memory,
            &selection.runtime_manifest,
        )?;
        native_asset_gate(&assets, &selection.runtime_manifest)?;
    }
    if selection.host.id == "windows" {
        let executable = verified_windows_executable(&selection)?;
        ensure_windows_runtime_executable_path(&executable.path)?;
        // `project prepare` hands this descriptor to a host that waits for a
        // readiness line.  Reject an old/incompatible runtime here, before
        // sync or export can leave a generation that the host cannot launch.
        native_readiness_gate(&selection.runtime_manifest)?;
    }
    Ok(selection)
}

fn select_runtime(
    project: &Path,
    explicit: Option<&Path>,
    target: &str,
    id: Option<&str>,
    development: bool,
) -> Result<SdkSelection> {
    let host = crate::hosts::require_exportable(target)?;
    let sdk_root = root(explicit)?;
    let manifest = load(&sdk_root)?;
    let (config, _) = unone_engine::ProjectPaths::discover(project)
        .map_err(|e| anyhow::anyhow!("{}: {}", e.code, e.explanation))?;
    let systems = unone_engine::SystemSettings::from_config(&config)
        .map_err(|e| anyhow::anyhow!("{}: {}", e.code, e.explanation))?
        .enabled_ids();
    let variant = if development {
        "development"
    } else {
        "production"
    };
    let selected = matching_runtime(&manifest.runtimes, &sdk_root, host.id, variant, id, &systems, &config.runtime_packages)?;
    let runtime_root = safe(&sdk_root, &selected.path)?;
    let templates_root = safe(&sdk_root, &manifest.templates)?;
    let runtime_manifest: Value =
        serde_json::from_slice(&fs::read(runtime_root.join("runtime.json"))?)?;
    Ok(SdkSelection {
        sdk_root,
        templates_root,
        runtime_root,
        runtime_manifest,
        host,
        runtime_id: selected.id.clone(),
        variant: variant.to_string(),
        engine_version: manifest.engine_version,
    })
}

pub fn export(
    project: &Path,
    output: &Path,
    explicit: Option<&Path>,
    target: &str,
    id: Option<&str>,
    development: bool,
) -> Result<Value> {
    let selection = select_runtime(project, explicit, target, id, development)?;
    let mut result = match selection.host.packager {
        "web-directory" => crate::export::web_with_templates(
            project,
            output,
            Some(&selection.runtime_root),
            development,
            &selection.templates_root,
        )?,
        "native-directory" | "native-activity-apk" => {
            native_export(
                project,
                output,
                &selection.sdk_root,
                &selection.runtime_root,
                selection.host,
                development,
            )?
        }
        _ => bail!(
            "SDK_TARGET_UNSUPPORTED: {}; {}",
            selection.host.id,
            selection.host.note
        ),
    };
    result["sdk_selection"] = selection.report();
    Ok(result)
}
pub fn pack(source: &Path, runtimes: &[PathBuf], output: &Path) -> Result<Value> {
    ensure!(
        !cfg!(debug_assertions),
        "SDK_CLI_NOT_RELEASE: build cargo build --release -p unone-cli first"
    );
    ensure!(
        !output.exists(),
        "SDK_OUTPUT_EXISTS: choose a new directory"
    );
    ensure!(!runtimes.is_empty(), "SDK_RUNTIME_REQUIRED");
    let mut files = Vec::<(String, Vec<u8>)>::new();
    let cli = format!("bin/game{}", std::env::consts::EXE_SUFFIX);
    files.push((cli.clone(), fs::read(std::env::current_exe()?)?));
    // Official package sources come from this CLI's compiled contract, never
    // from a possibly unrelated checkout passed as the Web template source.
    for (path, source) in unone_engine::runtime_package_files() {
        files.push((path.to_string(), runtime_package_payload(path, source)?));
    }
    for (path, source) in authoring_files() {
        // The example source owns only markers and fixture code. Ship the exact
        // canonical types compiled into this CLI without a hand-maintained copy.
        let bytes = if path == "examples/spatial-diagnostics/main.luau" {
            let begin = source.find("-- BEGIN UNONE API TYPES").unwrap();
            let end = source.find("-- END UNONE API TYPES").unwrap()
                + "-- END UNONE API TYPES".len();
            format!("{}{}{}", &source[..begin], unone_engine::api_typings_block(), &source[end..]).into_bytes()
        } else {
            source.as_bytes().to_vec()
        };
        files.push((path.to_string(), bytes));
    }
    // An index for AI agents, generated from the guides above.
    files.push(("llms.txt".into(), llms_txt().into_bytes()));
    for name in template_files() {
        files.push((
            format!("templates/web/{name}"),
            fs::read(safe(source, &format!("web/{name}"))?)?,
        ));
    }
    files.push((
        "scripts/pack-native-android.ps1".into(),
        fs::read(safe(source, "scripts/pack-native-android.ps1")?)?,
    ));
    let mut entries = Vec::new();
    for (i, dir) in runtimes.iter().enumerate() {
        let bytes = fs::read(dir.join("runtime.json"))?;
        let r: Value = serde_json::from_slice(&bytes)?;
        ensure!(
            r["profile"] == "release" && r["dev_tools"] == false && r["preview_tools"].is_boolean(),
            "SDK_RUNTIME_NOT_RELEASE_PLAYER"
        );
        let variant = if r["preview_tools"] == true {
            "development"
        } else {
            "production"
        };
        let target = r.get("target").and_then(Value::as_str).unwrap_or("web");
        let id = format!("{target}-{variant}-{i}");
        let path = format!("runtimes/{id}");
        let mut size = 0;
        for (name, expected) in runtime_files(&r)? {
            let data = fs::read(safe(dir, &name)?)?;
            ensure!(hash(&data) == expected, "SDK_RUNTIME_HASH_MISMATCH");
            size += data.len() as u64;
            files.push((format!("{path}/{name}"), data));
        }
        entries.push(Runtime {
            id,
            target: target.into(),
            variant: variant.into(),
            path: path.clone(),
            compiled_systems: serde_json::from_value(r["compiled_systems"].clone())?,
            runtime_packages: descriptor_packages(&r)?,
            bytes: size,
        });
        files.push((format!("{path}/runtime.json"), bytes));
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut unique = BTreeSet::new();
    for (name, _) in &files {
        ensure!(unique.insert(name.to_lowercase()), "SDK_DUPLICATE_PATH");
    }
    let manifest = Manifest {
        version: 1,
        engine_version: env!("CARGO_PKG_VERSION").into(),
        host: host(),
        cli: cli.clone(),
        templates: "templates".into(),
        runtimes: entries,
        files: files
            .iter()
            .map(|(p, b)| File {
                path: p.clone(),
                bytes: b.len() as u64,
                sha256: hash(b),
            })
            .collect(),
    };
    fs::create_dir_all(output)?;
    let result = (|| -> Result<Value> {
        for (name, bytes) in files {
            let path = output.join(name);
            fs::create_dir_all(path.parent().unwrap())?;
            fs::write(path, bytes)?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(output.join(&cli), fs::Permissions::from_mode(0o755))?;
        }
        fs::write(output.join(NAME), serde_json::to_vec_pretty(&manifest)?)?;
        inspect(Some(output))
    })();
    if result.is_err() {
        fs::remove_dir_all(output)?;
    }
    result
}

/// Publish structural schemas from this binary's Rust contract, just like its
/// canonical Luau types. Embedded authoring docs may be stale after a type edit;
/// a different checkout must not replace or roll back the packaged contract.
fn runtime_package_payload(path: &str, source: &str) -> Result<Vec<u8>> {
    let Some(name)=path.strip_prefix("docs/").and_then(|p|p.strip_suffix(".schema.json")) else {
        return Ok(source.as_bytes().to_vec());
    };
    let schema=unone_engine::contract_schema(name)
        .with_context(||format!("SDK_SCHEMA_UNKNOWN: {name}; package schemas require a compiled contract"))?;
    Ok(format!("{}\n",serde_json::to_string_pretty(&schema)?).into_bytes())
}

#[cfg(test)]
mod schema_pack_tests {
    use super::*;

    #[test]
    fn ui_doc_comes_from_compiled_contract_even_if_embedded_doc_is_stale() {
        let bytes=runtime_package_payload("docs/ui.schema.json",r#"{"stale":true}"#).unwrap();
        let value:Value=serde_json::from_slice(&bytes).unwrap();
        assert!(value["$defs"]["UiStyle"]["properties"].get("text_shadow").is_some());
        assert!(value["$defs"].get("UiTextShadow").is_some());
        assert_eq!(value,unone_engine::contract_schema("ui").unwrap());
    }

    #[test]
    fn project_doc_uses_its_current_compiled_contract() {
        let bytes=runtime_package_payload("docs/project.schema.json",r#"{"stale":true}"#).unwrap();
        let value:Value=serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value.get("$id"),unone_engine::contract_schema("project").unwrap().get("$id"));
    }

    #[test]
    fn unrecognized_schema_cannot_silently_publish_stale_data() {
        assert!(runtime_package_payload("docs/not_a_contract.schema.json","{}").is_err());
    }

    #[test]
    fn ordinary_package_bytes_remain_exact() {
        assert_eq!(runtime_package_payload("docs/ui-components.md","exact\n").unwrap(),b"exact\n");
    }
}

/// `llms.txt` for the SDK root (llmstxt.org): what an AI author should run
/// before writing code, and every bundled guide with its first sentence.
/// Generated from the same compiled docs the SDK ships, so it never drifts.
pub(crate) fn llms_txt() -> String {
    fn summary(source: &str) -> (String, String) {
        let mut lines = source.lines();
        let title = lines.by_ref().find_map(|line| line.strip_prefix("# ")).unwrap_or("Guide").trim().to_string();
        let paragraph: Vec<&str> = lines
            .skip_while(|line| line.trim().is_empty())
            .take_while(|line| !line.trim().is_empty() && !line.starts_with('#') && !line.starts_with("```") && !line.starts_with('|'))
            .collect();
        let text = paragraph.join(" ");
        // Keep link text, drop link targets, and stop at the first sentence.
        let mut plain = String::new();
        let mut rest = text.as_str();
        while let Some(open) = rest.find("](") {
            plain.push_str(&rest[..open]);
            rest = rest[open..].find(')').map_or("", |close| &rest[open + close + 1..]);
        }
        plain.push_str(rest);
        let plain = plain.replace('[', "");
        let sentence = plain.split_inclusive(". ").next().unwrap_or("").trim().to_string();
        (title, sentence)
    }
    let mut out = String::from(
        "# Unone SDK\n\n> An AI-first game engine: game code in Luau, a deterministic Rust core, and official Web and native players. Use the tools below instead of guessing APIs.\n\n\
         Before writing code:\n\n\
         - `game find \"<need>\"`: existing engine APIs, render passes, systems, official packages, local plugins and marketplace plugins, in the order to prefer them.\n\
         - `game api search \"<meaning>\"`, then `game api describe <name>`: the exact API, its errors and an example.\n\
         - `game systems list`: which engine systems this project runs.\n\
         - `game verify`: types, assets, layouts, tests and declared performance targets in one verdict.\n\
         - `game ui import-html --help`: import an HTML/CSS view as native Unone layout, textures and input actions.\n\
         - `node scripts/audit-web-bundle.mjs --export <export>`: inspect bundle sizes, overlapping groups and duplicate content.\n\
         - `node scripts/measure-web-export.mjs --export <export> --scenario <scenario.json> --output <report.json>`: trace loaded and released groups across real player transitions with bundle_trace.\n\n## Guides\n\n",
    );
    let packages = unone_engine::runtime_package_files();
    let guides = authoring_files().into_iter().chain(packages).filter(|(path, _)| path.ends_with(".md"));
    let mut seen = BTreeSet::new();
    for (path, source) in guides {
        if seen.insert(path) {
            let (title, sentence) = summary(source);
            out.push_str(&format!("- [{title}]({path}): {sentence}\n"));
        }
    }
    out
}

// Keep the public entry guide and its preview/validation tools together. They
// come from the CLI's compiled authoring contract, like the package guides, so a
// different template checkout cannot silently replace the documented tools.
fn authoring_files() -> [(&'static str, &'static str); 51] {
    [
        ("README.md", include_str!("../../../docs/sdk-readme.md")),
        ("docs/profiling.md", include_str!("../../../docs/profiling.md")),
        ("docs/spatial-batches.md", include_str!("../../../docs/spatial-batches.md")),
        ("docs/immutable-bytes.md", include_str!("../../../docs/immutable-bytes.md")),
        ("docs/data-assets.md", include_str!("../../../docs/data-assets.md")),
        ("docs/render-pipeline.md", include_str!("../../../docs/render-pipeline.md")),
        ("docs/find.md", include_str!("../../../docs/find.md")),
        ("docs/lighting.md", include_str!("../../../docs/lighting.md")),
        ("docs/input-gamepad.md", include_str!("../../../docs/input-gamepad.md")),
        ("docs/materials.md", include_str!("../../../docs/materials.md")),
        ("docs/projected-geometry.md", include_str!("../../../docs/projected-geometry.md")),
        ("docs/projected-raster.md", include_str!("../../../docs/projected-raster.md")),
        ("docs/projected-frame.md", include_str!("../../../docs/projected-frame.md")),
        ("docs/host-time.md", include_str!("../../../docs/host-time.md")),
        ("docs/texture-cache.md", include_str!("../../../docs/texture-cache.md")),
        ("docs/ui-preview-fixtures.md", include_str!("../../../docs/ui-preview-fixtures.md")),
        ("docs/ui-cursor.md", include_str!("../../../docs/ui-cursor.md")),
        ("docs/ui-text-input.md", include_str!("../../../docs/ui-text-input.md")),
        ("docs/ui-text-atlas.md", include_str!("../../../docs/ui-text-atlas.md")),
        ("docs/ui-presentation-input.md", include_str!("../../../docs/ui-presentation-input.md")),
        ("docs/ordered-physical-input.md", include_str!("../../../docs/ordered-physical-input.md")),
        ("docs/rollback.md", include_str!("../../../docs/rollback.md")),
        ("docs/web-image-assets.md", include_str!("../../../docs/web-image-assets.md")),
        ("scripts/serve-player.py", include_str!("../../../scripts/serve-player.py")),
        ("scripts/verify-ui-example-browser.mjs", include_str!("../../../scripts/verify-ui-example-browser.mjs")),
        ("scripts/audit-ui-fonts.py", include_str!("../../../scripts/audit-ui-fonts.py")),
        ("scripts/audit-web-bundle.mjs", include_str!("../../../scripts/audit-web-bundle.mjs")),
        ("scripts/web-export-files.mjs", include_str!("../../../scripts/web-export-files.mjs")),
        ("scripts/compare-web-replay.mjs", include_str!("../../../scripts/compare-web-replay.mjs")),
        ("scripts/immutable-bytes-emitted-runtime.mjs", include_str!("../../../scripts/immutable-bytes-emitted-runtime.mjs")),
        ("scripts/refresh-official-web.mjs", include_str!("../../../scripts/refresh-official-web.mjs")),
        ("scripts/web-export-host.mjs", include_str!("../../../scripts/web-export-host.mjs")),
        ("scripts/web-export-content.mjs", include_str!("../../../scripts/web-export-content.mjs")),
        ("scripts/web-export-validate-worker.mjs", include_str!("../../../scripts/web-export-validate-worker.mjs")),
        ("scripts/measure-web-export.mjs", include_str!("../../../scripts/measure-web-export.mjs")),
        ("scripts/measure-web-scenario.mjs", include_str!("../../../scripts/measure-web-scenario.mjs")),
        ("scripts/web-bundle-trace.mjs", include_str!("../../../scripts/web-bundle-trace.mjs")),
        // Publishes player.image-assets.json into a Web export; it verifies
        // itself and the asset template against this SDK's sdk.json.
        ("scripts/prepare-web-image-assets.mjs", include_str!("../../../scripts/prepare-web-image-assets.mjs")),
        ("examples/spatial-diagnostics/README.md", include_str!("../../../examples/spatial-diagnostics/README.md")),
        ("examples/spatial-diagnostics/project.unone.json", include_str!("../../../examples/spatial-diagnostics/project.unone.json")),
        ("examples/spatial-diagnostics/scene.json", include_str!("../../../examples/spatial-diagnostics/scene.json")),
        ("examples/spatial-diagnostics/main.luau", include_str!("../../../examples/spatial-diagnostics/main.luau")),
        ("tools/benchmark-spatial.mjs", include_str!("../../../scripts/benchmark-spatial.mjs")),
        ("tools/html-view/cli.mjs", include_str!("../../../tools/html-view/cli.mjs")),
        ("tools/html-view/capture.mjs", include_str!("../../../tools/html-view/capture.mjs")),
        ("tools/html-view/dom.mjs", include_str!("../../../tools/html-view/dom.mjs")),
        ("tools/html-view/package.json", include_str!("../../../tools/html-view/package.json")),
        ("tools/html-view/test.mjs", include_str!("../../../tools/html-view/test.mjs")),
        ("tools/html-view/README.md", include_str!("../../../tools/html-view/README.md")),
        ("tools/html-view/example/home.html", include_str!("../../../tools/html-view/example/home.html")),
        ("tools/html-view/example/actions.json", include_str!("../../../tools/html-view/example/actions.json")),
    ]
}

fn native_export(
    project: &Path,
    output: &Path,
    sdk: &Path,
    runtime: &Path,
    host: &crate::hosts::Host,
    development: bool,
) -> Result<Value> {
    ensure!(!output.exists(), "SDK_OUTPUT_EXISTS");
    let staging = output.with_extension(format!(
        "native-staging-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));
    ensure!(!staging.exists(), "SDK_STAGING_EXISTS");
    let result = native_export_staged(project, &staging, sdk, runtime, host, development);
    match result {
        Ok(value) => {
            fs::rename(&staging, output)?;
            Ok(value)
        }
        Err(error) => {
            if staging.exists() {
                fs::remove_dir_all(&staging)?;
            }
            Err(error)
        }
    }
}
fn native_export_staged(
    project: &Path,
    output: &Path,
    sdk: &Path,
    runtime: &Path,
    host: &crate::hosts::Host,
    development: bool,
) -> Result<Value> {
    ensure!(
        host.family == "native-wgpu" && host.exportable,
        "SDK_TARGET_UNSUPPORTED: {} is not an exportable native-wgpu packager",
        host.id
    );
    ensure!(!development, "NATIVE_DEVELOPMENT_VARIANT_UNAVAILABLE");
    ensure!(!output.exists(), "SDK_OUTPUT_EXISTS");
    let (config, settings, assets, mut files) = crate::export::content(project)?;
    crate::export::native_shader_gate(&files)?;
    let mut presentation = crate::export::append_presentation(project, &mut files)?;
    crate::hosts::native_wgpu_export_gate(&settings, Some(&presentation))?;
    let metadata: Value = serde_json::from_slice(&fs::read(runtime.join("runtime.json"))?)?;
    presentation.windows_gpu_memory =
        windows_gpu_memory_for_target(host.id, presentation.windows_gpu_memory, &metadata)?;
    // Native players are release players: the declared or release error policy.
    let error_policy = crate::export::resolve_error_policy(&mut presentation, &mut files, false)?;
    native_asset_gate(&assets, &metadata)?;
    // Native players are release builds and load the entry and modules as
    // bytecode compiled for their own codegen setting.
    let script_sources = crate::export::precompile_scripts(&mut files, metadata["native_codegen_compiled"] == true)?;
    let runtime_files = runtime_files(&metadata)?;
    if host.id == "windows" {
        for (name, _) in &runtime_files {
            files.push((name.clone(), fs::read(safe(runtime, name)?)?));
        }
    }
    let mut report = json!({"version":1,"project":config.name,"target":host.id,"family":host.family,"profile":"release","renderer_mode":"official","renderer":host.renderer,"presentation":host.presentation,"dev_tools":false,"preview_tools":false,"error_policy":error_policy,"script_sources":script_sources,"files":files.iter().map(|(p,b)|json!({"path":p,"bytes":b.len(),"sha256":hash(b)})).collect::<Vec<_>>()});
    if let Some(profile) = presentation.windows_gpu_memory {
        report[unone_engine::WindowsGpuMemory::CONFIG_KEY] = json!(profile);
    }
    std::fs::create_dir_all(output)?;
    for (path, bytes) in &files {
        let p = output.join(path);
        fs::create_dir_all(p.parent().unwrap())?;
        fs::write(p, bytes)?;
    }
    fs::write(
        output.join("export.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    fs::write(
        output.join("native-player.json"),
        // No seed: shipped native play draws one per launch (see the player's resolve_seed).
        br#"{"frames":0,"warmup":60,"headless":false,"fixed_tick":false}"#,
    )?;
    if host.packager == "native-activity-apk" {
        let script = safe(sdk, "scripts/pack-native-android.ps1")?;
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .arg("-ContentRoot")
            .arg(output)
            .arg("-RuntimeRoot")
            .arg(runtime)
            .arg("-Target")
            .arg(host.id)
            .arg("-AppName")
            .arg(&config.name)
            .output()?;
        ensure!(
            status.status.success(),
            "ANDROID_PACKAGING_FAILED: {} {}",
            String::from_utf8_lossy(&status.stdout),
            String::from_utf8_lossy(&status.stderr)
        );
    }
    Ok(report)
}

fn native_asset_gate(assets: &Value, metadata: &Value) -> Result<()> {
    for asset in assets["assets"].as_array().context("ASSETS_INVALID")? {
        ensure!(
            ["mesh3d", "texture2d"].contains(&asset["kind"].as_str().unwrap_or("")),
            "NATIVE_DECODER_UNAVAILABLE: {}",
            asset["kind"]
        );
        if asset["kind"] == "texture2d" {
            // This gate admits UI sources. Mesh references are validated by the
            // player separately; SVG here does not imply a mesh texture decoder.
            let source = asset["source"].as_str().unwrap_or("");
            let extension = Path::new(source).extension().and_then(|s| s.to_str()).unwrap_or("");
            let capability = match extension.to_ascii_lowercase().as_str() {
                "png" => continue,
                "jpg" | "jpeg" => "jpeg",
                "svg" => "svg-static",
                _ => bail!("NATIVE_TEXTURE_FORMAT_UNSUPPORTED: {source}; native UI supports PNG, JPEG and static SVG"),
            };
            ensure!(metadata["ui"]["images"].as_array().is_some_and(|images| images.iter().any(|v| v == capability)),
                "NATIVE_TEXTURE_FORMAT_UNSUPPORTED: {source}; requires a runtime advertising ui.images={capability}; use a matching runtime or PNG companion");
        }
    }
    Ok(())
}

fn windows_gpu_memory_for_target(
    target: &str,
    profile: Option<unone_engine::WindowsGpuMemory>,
    metadata: &Value,
) -> Result<Option<unone_engine::WindowsGpuMemory>> {
    if target != "windows" {
        return Ok(None);
    }
    let Some(profile) = profile else {
        return Ok(None);
    };
    let key = unone_engine::WindowsGpuMemory::CONFIG_KEY;
    let capability = &metadata[key];
    let default = unone_engine::WindowsGpuMemory::default().as_str();
    let includes_profiles = capability["profiles"].as_array().is_some_and(|profiles| {
        profiles.iter().any(|mode| mode == default)
            && profiles.iter().any(|mode| mode == profile.as_str())
    });
    ensure!(
        capability["config_key"] == key
            && capability["default"] == default
            && includes_profiles,
        "HOST_WINDOWS_GPU_MEMORY_UNSUPPORTED: the selected Windows runtime does not advertise windows_gpu_memory={}; rebuild or update the Windows runtime",
        profile.as_str()
    );
    Ok(Some(profile))
}

fn native_readiness_gate(metadata: &Value) -> Result<()> {
    let readiness = metadata
        .get("readiness")
        .and_then(Value::as_object)
        .context(
            "NATIVE_READY_DESCRIPTOR_UNAVAILABLE: selected Windows runtime does not declare unone.native-ready.v1; rebuild or update the native runtime",
        )?;
    ensure!(
        readiness.get("contract").and_then(Value::as_str) == Some("unone.native-ready.v1"),
        "NATIVE_READY_DESCRIPTOR_UNAVAILABLE: selected Windows runtime does not declare unone.native-ready.v1; rebuild or update the native runtime"
    );
    ensure!(
        readiness.get("stdout_prefix").and_then(Value::as_str)
            == Some("UNONE_NATIVE_READY ")
            && readiness.get("emission").and_then(Value::as_str)
                == Some("once_after_first_render_ok_true")
            && readiness.get("requires_surface").and_then(Value::as_bool) == Some(true)
            && readiness.get("headless").and_then(Value::as_str) == Some("never_emits"),
        "NATIVE_READY_DESCRIPTOR_INCOMPATIBLE: Windows runtime readiness declaration is not compatible with unone.native-ready.v1; rebuild or update the native runtime"
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_texture_gate_checks_installed_ui_jpeg_support() {
        let older = serde_json::json!({"decoders":["jpeg-rgba"],"ui":{"images":["png","svg-static"]}});
        let current = serde_json::json!({"ui":{"images":["png","jpeg","svg-static"]}});
        let manifest = |source: &str| serde_json::json!({"assets":[{"kind":"texture2d","source":source}]});
        for name in ["cover.jpg", "covers/PHOTO.JPEG"] {
            native_asset_gate(&manifest(name), &current).unwrap();
            let error = native_asset_gate(&manifest(name), &older).unwrap_err().to_string();
            assert!(error.contains(name) && error.contains("ui.images=jpeg"), "{error}");
        }
        native_asset_gate(&manifest("card.PNG"), &serde_json::json!({})).unwrap();
        native_asset_gate(&manifest("card.SVG"), &older).unwrap();
        assert!(native_asset_gate(&manifest("card.svg"), &serde_json::json!({})).is_err());
        assert!(native_asset_gate(&manifest("card.webp"), &current).is_err());
    }

    fn runtime(id: &str, target: &str, variant: &str, systems: &[&str], bytes: u64) -> Runtime {
        Runtime {
            id: id.to_string(), target: target.to_string(), variant: variant.to_string(),
            path: format!("runtimes/{id}"),
            compiled_systems: systems.iter().map(|system| (*system).to_string()).collect(),
            runtime_packages: BTreeMap::new(), bytes,
        }
    }

    fn gpu_memory_runtime_capability() -> Value {
        json!({"config_key":"windows_gpu_memory","profiles":["performance","memory_usage"],"default":"performance"})
    }

    #[test]
    fn windows_gpu_memory_requires_the_selected_runtime_to_advertise_the_profile() {
        let profile = Some(unone_engine::WindowsGpuMemory::MemoryUsage);
        let legacy = json!({});
        assert_eq!(windows_gpu_memory_for_target("windows", None, &legacy).unwrap(), None);
        assert_eq!(windows_gpu_memory_for_target("android-arm64", profile, &legacy).unwrap(), None);
        for capability in [Value::Null, json!({"config_key":"windows_gpu_memory",
            "profiles":["performance"],"default":"performance"})] {
            let error = windows_gpu_memory_for_target(
                "windows", profile, &json!({"windows_gpu_memory":capability}),
            ).unwrap_err();
            assert!(error.to_string().contains("HOST_WINDOWS_GPU_MEMORY_UNSUPPORTED"));
        }
        let runtime = json!({"windows_gpu_memory":gpu_memory_runtime_capability()});
        assert_eq!(windows_gpu_memory_for_target("windows", profile, &runtime).unwrap(), profile);
    }

    #[test]
    fn direct_windows_export_keeps_explicit_gpu_memory_profile_and_rejects_old_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("game");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("project.unone.json"), br#"{"name":"GPU profile fixture","entry_script":"main.luau"}"#).unwrap();
        fs::write(project.join("main.luau"), "return {start=function()end,update=function()end}").unwrap();
        let runtime = dir.path().join("runtime");
        fs::create_dir(&runtime).unwrap();
        fs::write(runtime.join("player.exe"), b"stub").unwrap();
        let mut descriptor = json!({"target":"windows","files":[{"path":"player.exe","sha256":hash(b"stub")}]});
        let descriptor_path = runtime.join("runtime.json");
        fs::write(&descriptor_path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let host = crate::hosts::require_exportable("windows").unwrap();
        let output = dir.path().join("legacy");
        let report = native_export_staged(&project, &output, dir.path(), &runtime, host, false).unwrap();
        assert!(report.get("windows_gpu_memory").is_none());
        let read_presentation = |output: &Path| serde_json::from_slice::<Value>(
            &fs::read(output.join("content/presentation.json")).unwrap(),
        ).unwrap();
        assert!(read_presentation(&output).get("windows_gpu_memory").is_none());

        fs::write(project.join("player.presentation.json"), br#"{"windows_gpu_memory":"memory_usage"}"#).unwrap();
        let output = dir.path().join("requested");
        let error = native_export_staged(&project, &output, dir.path(), &runtime, host, false).unwrap_err();
        assert!(error.to_string().contains("HOST_WINDOWS_GPU_MEMORY_UNSUPPORTED"));
        assert!(!output.exists());

        descriptor["windows_gpu_memory"] = gpu_memory_runtime_capability();
        fs::write(&descriptor_path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let report = native_export_staged(&project, &output, dir.path(), &runtime, host, false).unwrap();
        assert_eq!(report["windows_gpu_memory"], "memory_usage");
        assert_eq!(read_presentation(&output)["windows_gpu_memory"], "memory_usage");
    }

    #[test]
    fn native_exports_ship_bytecode_for_the_runtimes_codegen() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("game");
        fs::create_dir_all(project.join("scripts")).unwrap();
        fs::write(project.join("project.unone.json"), json!({"name":"native modules","entry_script":"scripts/main.luau"}).to_string()).unwrap();
        fs::write(project.join("scripts/main.luau"), "local a=require('./a')\nreturn {start=function()end,update=function()end}").unwrap();
        fs::write(project.join("scripts/a.luau"), "return 1").unwrap();
        let host = crate::hosts::require_exportable("windows").unwrap();
        for (codegen, level) in [(false, "/t0/"), (true, "/t1/")] {
            let runtime = dir.path().join(format!("runtime-{codegen}"));
            fs::create_dir_all(&runtime).unwrap();
            fs::write(runtime.join("player.exe"), b"stub").unwrap();
            fs::write(runtime.join("runtime.json"), json!({"target":"windows","native_codegen_compiled":codegen,
                "files":[{"path":"player.exe","sha256":hash(b"stub")}]}).to_string()).unwrap();
            let output = dir.path().join(format!("export-{codegen}"));
            native_export_staged(&project, &output, dir.path(), &runtime, host, false).unwrap();
            let payload: Value = serde_json::from_slice(&fs::read(output.join("content/project.json")).unwrap()).unwrap();
            assert!(payload.get("script").is_none() && payload.get("script_modules").is_none());
            assert!(payload["script_bytecode"]["format"].as_str().unwrap().contains(level));
            let modules = fs::read(output.join("content/script-modules.luaubc")).unwrap();
            assert_eq!(payload["script_module_bytecode"]["modules"], json!({"a.luau": modules.len()}));
            // The package manifest lists the bytecode, so the player verifies and loads it.
            let manifest: Value = serde_json::from_slice(&fs::read(output.join("export.json")).unwrap()).unwrap();
            let listed = |path: &str| manifest["files"].as_array().unwrap().iter().any(|file| file["path"] == path);
            assert!(listed("content/script.luaubc") && listed("content/script-modules.luaubc"));
            // A native package is a release player: it carries the release error policy.
            let release = json!({"ui_capacity":"keep_previous","script_errors":"continue","max_consecutive_script_errors":60});
            assert_eq!(manifest["error_policy"], release);
            let presentation: Value = serde_json::from_slice(&fs::read(output.join("content/presentation.json")).unwrap()).unwrap();
            assert_eq!(presentation["error_policy"], release);
        }
        fs::write(project.join("player.presentation.json"), json!({"error_policy":{"script_errors":"continue"}}).to_string()).unwrap();
        let output = dir.path().join("export-declared");
        native_export_staged(&project, &output, dir.path(), &dir.path().join("runtime-false"), host, false).unwrap();
        let presentation: Value = serde_json::from_slice(&fs::read(output.join("content/presentation.json")).unwrap()).unwrap();
        assert_eq!(presentation["error_policy"], json!({"ui_capacity":"fail","script_errors":"continue","max_consecutive_script_errors":60}));
    }

    #[test]
    fn unavailable_runtime_exposes_concrete_capability_gaps_without_changing_requirements() {
        let required = ["camera2d", "camera3d", "physics2d", "save", "ui"].map(str::to_string);
        let runtimes = [runtime("web-minimal", "web", "production", &["camera2d", "ui"], 10)];
        let error = matching_runtime(&runtimes, Path::new("trusted-sdk"), "web", "production", None, &required, &BTreeMap::new()).unwrap_err();
        let gap = error.downcast_ref::<RuntimeUnavailable>().unwrap();
        assert_eq!(gap.required_systems, required);
        let candidate = &gap.available_runtimes[0];
        assert!(candidate.matches_target && candidate.matches_variant && candidate.matches_requested_id);
        assert_eq!(candidate.compiled_systems, ["camera2d", "ui"]);
        assert_eq!(candidate.missing_systems, ["camera3d", "physics2d", "save"]);
        let explanation = gap.to_string();
        for system in ["camera3d", "physics2d", "save"] { assert!(explanation.contains(system)); }
        assert!(explanation.contains("only systems the project does not use"));
        assert_eq!(required, ["camera2d", "camera3d", "physics2d", "save", "ui"].map(str::to_string));
    }

    #[test]
    fn runtime_target_variant_and_pinned_id_mismatches_are_independent_of_system_gaps() {
        let runtimes = [runtime("web-production", "web", "production", &["ui"], 10)];
        let required = ["ui".to_string()];
        for (target, variant, id, matches_target, matches_variant, matches_id) in [
            ("windows", "production", None, false, true, true),
            ("web", "development", None, true, false, true),
            ("web", "production", Some("uninstalled"), true, true, false),
        ] {
            let error = matching_runtime(&runtimes, Path::new("sdk"), target, variant, id, &required, &BTreeMap::new()).unwrap_err();
            let gap = error.downcast_ref::<RuntimeUnavailable>().unwrap();
            let report = serde_json::to_value(gap).unwrap();
            assert_eq!(report["target"], target);
            assert_eq!(report["variant"], variant);
            assert_eq!(report["requested_runtime_id"], json!(id));
            let candidate = &gap.available_runtimes[0];
            assert_eq!(candidate.matches_target, matches_target);
            assert_eq!(candidate.matches_variant, matches_variant);
            assert_eq!(candidate.matches_requested_id, matches_id);
            assert!(candidate.missing_systems.is_empty());
        }
    }

    #[test]
    fn compatible_selection_retains_smallest_runtime_then_id_policy_and_explicit_pin() {
        let runtimes = [
            runtime("unsupported-small", "web", "production", &[], 1),
            runtime("b", "web", "production", &["ui"], 10),
            runtime("a", "web", "production", &["ui"], 10),
            runtime("large", "web", "production", &["ui"], 20),
            runtime("other-variant", "web", "development", &["ui"], 1),
        ];
        let required = ["ui".to_string()];
        let select = |id| matching_runtime(&runtimes, Path::new("sdk"), "web", "production", id, &required, &BTreeMap::new()).unwrap().id.as_str();
        assert_eq!(select(None), "a");
        assert_eq!(select(Some("large")), "large");
    }
    #[test]
    fn package_selection_requires_exact_versions_and_preserves_missing_and_found_evidence() {
        let packages = BTreeMap::from([("@unone/ui".into(), "0.1.0".into())]);
        let mut old = runtime("older-ui", "web", "production", &["ui"], 2);
        old.runtime_packages.insert("@unone/ui".into(), "0.0.9".into());
        let runtimes = [runtime("legacy-ui", "web", "production", &["ui"], 1), old];
        let error = matching_runtime(&runtimes, Path::new("sdk"), "web", "production", None, &["ui".into()], &packages).unwrap_err();
        let gap = error.downcast_ref::<RuntimeUnavailable>().unwrap();
        assert_eq!(gap.required_packages, packages);
        let report = serde_json::to_value(gap).unwrap();
        assert_eq!(report["available_runtimes"][0]["missing_packages"]["@unone/ui"], json!({"expected":"0.1.0","found":null}));
        assert_eq!(report["available_runtimes"][1]["missing_packages"]["@unone/ui"], json!({"expected":"0.1.0","found":"0.0.9"}));
        assert!(gap.to_string().contains("Keep required package declarations intact"));
        assert!(gap.available_runtimes.iter().all(|runtime| runtime.missing_systems.is_empty()));

        let mut compatible = runtime("compatible", "web", "production", &["ui"], 10);
        compatible.runtime_packages = packages.clone();
        let candidates = [runtime("legacy-ui", "web", "production", &["ui"], 1), compatible];
        assert_eq!(matching_runtime(&candidates, Path::new("sdk"), "web", "production", None, &["ui".into()], &packages).unwrap().id, "compatible");
        assert!(matching_runtime(&candidates, Path::new("sdk"), "web", "production", Some("legacy-ui"), &["ui".into()], &packages).is_err());
    }

    #[test]
    fn legacy_runtime_metadata_remains_usable_without_package_requirements() {
        let legacy: Runtime = serde_json::from_value(json!({"id":"legacy","target":"web","variant":"production","path":"runtimes/legacy","compiled_systems":["ui"],"bytes":1})).unwrap();
        assert!(legacy.runtime_packages.is_empty());
        assert!(serde_json::to_value(&legacy).unwrap().get("runtime_packages").is_none());
        validate_runtime_package_metadata(&legacy, &json!({})).unwrap();
        let candidates = [legacy];
        assert_eq!(matching_runtime(&candidates, Path::new("sdk"), "web", "production", None, &["ui".into()], &BTreeMap::new()).unwrap().id, "legacy");
    }

    #[test]
    fn package_facts_must_match_between_sdk_and_runtime_descriptor() {
        let mut advertised = runtime("ui", "web", "production", &["ui"], 1);
        advertised.runtime_packages.insert("@unone/ui".into(), "0.1.0".into());
        for descriptor in [json!({}), json!({"runtime_packages":{"@unone/ui":"0.0.9"}})] {
            assert!(validate_runtime_package_metadata(&advertised, &descriptor).unwrap_err().to_string().contains("SDK_RUNTIME_PACKAGES_MISMATCH"));
        }
        validate_runtime_package_metadata(&advertised, &json!({"runtime_packages":{"@unone/ui":"0.1.0"}})).unwrap();
        for invalid in [json!({"runtime_packages":null}), json!({"runtime_packages":["@unone/ui"]}), json!({"runtime_packages":{"@unone/ui":1}})] {
            assert!(descriptor_packages(&invalid).is_err());
        }
        let legacy = runtime("legacy", "web", "production", &["ui"], 1);
        assert!(validate_runtime_package_metadata(&legacy, &json!({"runtime_packages":{"@unone/ui":"0.1.0"}})).is_err());
    }
    #[test]
    fn traversal_and_unknown_manifest_keys_fail() {
        let root = tempfile::tempdir().unwrap();
        for path in ["../a", "/a", "C:/a", "a\\b", "a/../b"] {
            assert!(safe(root.path(), path).is_err());
        }
        assert!(serde_json::from_value::<Manifest>(json!({"typo":1})).is_err());
    }
    #[test]
    #[cfg(not(debug_assertions))]
    fn packed_sdk_contains_documented_authoring_guides_and_tools_without_requiring_them_in_older_sdks() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("templates");
        // These bytes only exercise packaging/inventory, never player execution.
        for name in template_files().into_iter().map(|name| format!("web/{name}"))
            .chain(["scripts/pack-native-android.ps1".to_owned()])
        {
            let path = source.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"packaging fixture").unwrap();
        }
        let runtime = temp.path().join("runtime");
        fs::create_dir(&runtime).unwrap();
        let javascript = b"packaging fixture, not executable";
        let wasm = b"packaging fixture, not executable";
        fs::write(runtime.join("player.js"), javascript).unwrap();
        fs::write(runtime.join("player.wasm"), wasm).unwrap();
        fs::write(runtime.join("runtime.json"), serde_json::to_vec(&json!({
            "profile":"release", "dev_tools":false, "preview_tools":false,
            "javascript":"player.js", "javascript_sha256":hash(javascript),
            "wasm":"player.wasm", "wasm_sha256":hash(wasm),
            "compiled_systems":["world","input","observation"]
        })).unwrap()).unwrap();
        let output = temp.path().join("sdk");
        pack(&source, &[runtime], &output).unwrap();
        let mut manifest = load(&output).unwrap();
        let added = ["README.md", "llms.txt", "docs/spatial-batches.md", "docs/projected-geometry.md", "scripts/serve-player.py", "scripts/verify-ui-example-browser.mjs", "scripts/audit-ui-fonts.py",
            "scripts/prepare-web-image-assets.mjs", "docs/web-image-assets.md",
            "scripts/audit-web-bundle.mjs", "scripts/web-export-files.mjs", "scripts/compare-web-replay.mjs",
            "scripts/immutable-bytes-emitted-runtime.mjs", "scripts/refresh-official-web.mjs",
            "scripts/web-export-host.mjs", "scripts/web-export-content.mjs", "scripts/web-export-validate-worker.mjs",
            "scripts/measure-web-export.mjs", "scripts/measure-web-scenario.mjs", "scripts/web-bundle-trace.mjs",
            "examples/spatial-diagnostics/README.md", "examples/spatial-diagnostics/project.unone.json", "examples/spatial-diagnostics/scene.json", "examples/spatial-diagnostics/main.luau", "tools/benchmark-spatial.mjs",
            "tools/html-view/cli.mjs", "tools/html-view/capture.mjs", "tools/html-view/dom.mjs", "tools/html-view/package.json", "tools/html-view/test.mjs", "tools/html-view/README.md",
            "tools/html-view/example/home.html", "tools/html-view/example/actions.json"];
        for name in added {
            assert!(manifest.files.iter().any(|file| file.path == name), "missing documented SDK entry: {name}");
            assert!(output.join(name).is_file());
        }
        assert!(fs::read_to_string(output.join("llms.txt")).unwrap().contains("](docs/find.md)"));
        let guide = "docs/spatial-batches.md";
        assert_eq!(fs::read_to_string(output.join(guide)).unwrap(), include_str!("../../../docs/spatial-batches.md"));
        assert!(fs::read_to_string(output.join("README.md")).unwrap().contains("](docs/spatial-batches.md)"));
        let example = fs::read_to_string(output.join("examples/spatial-diagnostics/main.luau")).unwrap();
        assert!(example.contains(&unone_engine::api_typings_block()));
        assert!(example.contains("local diagnostic: EngineDiagnostic? = api.spatial.lastDiagnostic()"));
        assert_eq!(example.matches("-- BEGIN UNONE API TYPES").count(), 1);
        assert_eq!(example.matches("-- END UNONE API TYPES").count(), 1);
        assert_eq!(fs::read_to_string(output.join("tools/benchmark-spatial.mjs")).unwrap(), include_str!("../../../scripts/benchmark-spatial.mjs"));
        for name in ["spatial.create", "spatial.submit", "spatial.take", "spatial.info"] {
            assert!(unone_engine::api_describe(name).unwrap().when_to_use.contains(guide));
        }
        // Newly shipped tools receive the same integrity checks as every SDK file.
        let tool = output.join("scripts/serve-player.py");
        let original = fs::read(&tool).unwrap();
        fs::write(&tool, b"changed tool").unwrap();
        assert!(inspect(Some(&output)).unwrap_err().to_string().contains("SDK_HASH_MISMATCH"));
        fs::write(&tool, original).unwrap();
        // They are author conveniences, not new runtime/SDK schema requirements.
        manifest.files.retain(|file| !added.contains(&file.path.as_str()));
        for name in added { fs::remove_file(output.join(name)).unwrap(); }
        fs::write(output.join(NAME), serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        assert!(inspect(Some(&output)).is_ok());
    }
    #[test]
    fn unsupported_target_never_creates_output() {
        let root = tempfile::tempdir().unwrap();
        let out = root.path().join("game");
        assert!(
            export(root.path(), &out, None, "ios", None, false)
                .unwrap_err()
                .to_string()
                .contains("SDK_TARGET_UNSUPPORTED")
        );
        assert!(!out.exists());
        assert!(
            export(root.path(), &out, None, "android-webview", None, false)
                .unwrap_err()
                .to_string()
                .contains("WebView")
        );
        assert!(!out.exists());
    }

    #[test]
    fn windows_prepare_requires_the_native_ready_contract() {
        let error = native_readiness_gate(&json!({})).unwrap_err();
        assert!(error
            .to_string()
            .contains("NATIVE_READY_DESCRIPTOR_UNAVAILABLE"));

        let error = native_readiness_gate(&json!({
            "readiness": {"contract": "legacy-ready-v0"}
        }))
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("NATIVE_READY_DESCRIPTOR_UNAVAILABLE"));
    }

    #[test]
    fn windows_prepare_accepts_the_declared_native_ready_shape() {
        native_readiness_gate(&json!({
            "readiness": {
                "contract": "unone.native-ready.v1",
                "stdout_prefix": "UNONE_NATIVE_READY ",
                "emission": "once_after_first_render_ok_true",
                "requires_surface": true,
                "headless": "never_emits"
            }
        }))
        .unwrap();
    }
}

#[cfg(test)]
mod llms_tests {
    #[test]
    fn text_atlas_readme_link_has_a_bundled_guide() {
        let files=super::authoring_files();
        let readme=files.iter().find(|(path,_)|*path=="README.md").unwrap().1;
        assert!(readme.contains("](docs/ui-text-atlas.md)"));
        let guide=files.iter().find(|(path,_)|*path=="docs/ui-text-atlas.md").unwrap().1;
        assert!(guide.contains("ui_text_atlas_size") && guide.contains("dedicated_text_bytes_estimate"));
        assert!(super::llms_txt().contains("](docs/ui-text-atlas.md)"));
    }
    #[test]
    fn llms_txt_lists_the_tools_and_every_bundled_guide_once() {
        let text = super::llms_txt();
        assert!(text.starts_with("# Unone SDK\n\n> "));
        assert!(text.contains("`game find \"<need>\"`") && text.contains("`game api search"));
        for (path, _) in super::authoring_files().into_iter().filter(|(path, _)| path.ends_with(".md")) {
            assert_eq!(text.matches(&format!("]({path})")).count(), 1, "{path}");
        }
        let lighting = text.lines().find(|line| line.contains("](docs/lighting.md)")).unwrap();
        assert!(lighting.starts_with("- [Lighting](docs/lighting.md): A scene can light its 3D content"), "{lighting}");
        let summary = &lighting[lighting.find("): ").unwrap() + 3..];
        assert!(!summary.contains("]("), "link targets are dropped from summaries: {summary}");
    }
}
