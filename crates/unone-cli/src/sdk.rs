//! Portable distribution and target dispatch; contains no gameplay policy.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
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
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Runtime {
    id: String,
    target: String,
    variant: String,
    path: String,
    compiled_systems: Vec<String>,
    bytes: u64,
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
    ensure!(hash(&fs::read(std::env::current_exe()?)?) == hash(&fs::read(safe(root,&m.cli)?)?), "SDK_CLI_MISMATCH: use the CLI supplied with this SDK");
    let mut ids = BTreeSet::new();
    for runtime in &m.runtimes {
        ensure!(ids.insert(&runtime.id), "SDK_RUNTIME_DUPLICATE");
        ensure!(
            runtime.target == "web"
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
        for key in ["javascript", "wasm"] {
            let name = r[key].as_str().context("SDK_RUNTIME_FILE_INVALID")?;
            let path = format!("{}/{name}", runtime.path);
            ensure!(
                paths.contains(&path.to_lowercase()),
                "SDK_RUNTIME_FILE_UNLISTED"
            );
            let b = fs::read(safe(root, &path)?)?;
            ensure!(
                r[format!("{key}_sha256")] == hash(&b),
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
    Ok(
        json!({"version":m.version,"engine_version":m.engine_version,"host":m.host,"verified":true,"runtimes":m.runtimes,"targets":[{"id":"web","status":"supported","packager":"web-directory","toolchain":"none"},{"id":"android","status":"not_implemented","requires":["android host template","SDK","signing"]},{"id":"ios","status":"not_implemented","requires":["iOS runtime","Xcode/macOS","signing"]},{"id":"windows","status":"not_implemented","requires":["standalone native player","runtime dependencies"]}]}),
    )
}
pub fn export(
    project: &Path,
    output: &Path,
    explicit: Option<&Path>,
    target: &str,
    id: Option<&str>,
    development: bool,
) -> Result<Value> {
    ensure!(
        target == "web",
        "SDK_TARGET_UNSUPPORTED: {target}; run game sdk inspect --json to list implemented packagers"
    );
    let root = root(explicit)?;
    let m = load(&root)?;
    let (config, _) = unone_engine::ProjectPaths::discover(project)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    let systems = unone_engine::SystemSettings::from_config(&config)
        .map_err(|e| anyhow::anyhow!(e.explanation))?
        .enabled_ids();
    let variant = if development {
        "development"
    } else {
        "production"
    };
    let mut candidates: Vec<_> = m
        .runtimes
        .iter()
        .filter(|r| {
            r.target == target
                && r.variant == variant
                && id.is_none_or(|id| id == r.id)
                && systems.iter().all(|s| r.compiled_systems.contains(s))
        })
        .collect();
    candidates.sort_by(|a, b| a.bytes.cmp(&b.bytes).then(a.id.cmp(&b.id)));
    let selected=candidates.first().context("SDK_RUNTIME_UNAVAILABLE: no matching target/variant/systems; run game sdk inspect --json and install a compatible runtime pack")?;
    let mut result = crate::export::web_with_templates(
        project,
        output,
        Some(&safe(&root, &selected.path)?),
        development,
        &safe(&root, &m.templates)?,
    )?;
    result["sdk_selection"] = json!({"target":target,"runtime_id":selected.id,"variant":variant,"engine_version":m.engine_version});
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
    for name in template_files() {
        files.push((
            format!("templates/web/{name}"),
            fs::read(safe(source, &format!("web/{name}"))?)?,
        ));
    }
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
        let id = format!("web-{variant}-{i}");
        let path = format!("runtimes/{id}");
        let mut size = 0;
        for key in ["javascript", "wasm"] {
            let name = r[key].as_str().context("SDK_RUNTIME_FILE_MISSING")?;
            let data = fs::read(safe(dir, name)?)?;
            ensure!(
                r[format!("{key}_sha256")] == hash(&data),
                "SDK_RUNTIME_HASH_MISMATCH"
            );
            size += data.len() as u64;
            files.push((format!("{path}/{name}"), data));
        }
        entries.push(Runtime {
            id,
            target: "web".into(),
            variant: variant.into(),
            path: path.clone(),
            compiled_systems: serde_json::from_value(r["compiled_systems"].clone())?,
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
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn traversal_and_unknown_manifest_keys_fail() {
        let root = tempfile::tempdir().unwrap();
        for path in ["../a", "/a", "C:/a", "a\\b", "a/../b"] {
            assert!(safe(root.path(), path).is_err());
        }
        assert!(serde_json::from_value::<Manifest>(json!({"typo":1})).is_err());
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
    }
}
