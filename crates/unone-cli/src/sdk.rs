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
    let source_evidence=json!({"sdk_root":root,"cli":{"path":safe(&root,&m.cli)?,"sha256":hash(&fs::read(safe(&root,&m.cli)?)?)},"templates":{"path":safe(&root,&m.templates)?,"files":m.files.iter().filter(|f|f.path.starts_with(&format!("{}/",m.templates))).collect::<Vec<_>>()},"runtimes":sources,"plugins":"separately discovered; not pinned or compatibility-certified by sdk.json; run plugin list/inspect/test"});
    let mut report =
        json!({"version":m.version,"engine_version":m.engine_version,"host":m.host,"verified":true,"runtimes":m.runtimes,"content":"shared-luau-and-declared-assets","targets":crate::hosts::inspect_targets()})
    ;
    report["sources"]=source_evidence;
    Ok(report)
}
pub fn export(
    project: &Path,
    output: &Path,
    explicit: Option<&Path>,
    target: &str,
    id: Option<&str>,
    development: bool,
) -> Result<Value> {
    let host = crate::hosts::require_exportable(target)?;
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
            r.target == host.id
                && r.variant == variant
                && id.is_none_or(|id| id == r.id)
                && systems.iter().all(|s| r.compiled_systems.contains(s))
        })
        .collect();
    candidates.sort_by(|a, b| a.bytes.cmp(&b.bytes).then(a.id.cmp(&b.id)));
    let selected=candidates.first().context("SDK_RUNTIME_UNAVAILABLE: no matching target/variant/systems; run game sdk inspect --json and install a compatible runtime pack")?;
    let runtime_root = safe(&root, &selected.path)?;
    let mut result = match host.packager {
        "web-directory" => crate::export::web_with_templates(
            project,
            output,
            Some(&runtime_root),
            development,
            &safe(&root, &m.templates)?,
        )?,
        "native-directory" | "native-activity-apk" => {
            native_export(project, output, &root, &runtime_root, host, development)?
        }
        _ => bail!(
            "SDK_TARGET_UNSUPPORTED: {}; {}",
            host.id,
            host.note
        ),
    };
    result["sdk_selection"] = json!({"target":host.id,"family":host.family,"runtime_id":selected.id,"variant":variant,"engine_version":m.engine_version});
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
        assert!(
            export(root.path(), &out, None, "android-webview", None, false)
                .unwrap_err()
                .to_string()
                .contains("WebView")
        );
        assert!(!out.exists());
    }
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
    crate::hosts::native_wgpu_export_gate(
        &settings,
        crate::hosts::load_presentation(project)?.as_ref(),
    )?;
    crate::export::append_presentation(project, &mut files)?;
    let metadata: Value = serde_json::from_slice(&fs::read(runtime.join("runtime.json"))?)?;
    for asset in assets["assets"].as_array().context("ASSETS_INVALID")? {
        ensure!(
            ["mesh3d", "texture2d"].contains(&asset["kind"].as_str().unwrap_or("")),
            "NATIVE_DECODER_UNAVAILABLE: {}",
            asset["kind"]
        );
        if asset["kind"] == "texture2d" {
            // This gate admits UI sources. Mesh references are validated by the
            // player separately; SVG here does not imply a mesh texture decoder.
            let source=asset["source"].as_str().unwrap_or("").to_ascii_lowercase();
            ensure!(source.ends_with(".png") || (source.ends_with(".svg") && metadata["ui"]["images"].as_array().is_some_and(|v|v.iter().any(|x|x=="svg-static"))),
                "NATIVE_TEXTURE_FORMAT_UNSUPPORTED: {}; SVG UI requires a runtime advertising ui.images=svg-static; use a matching runtime or PNG companion",asset["source"]);
        }
    }
    let runtime_files = runtime_files(&metadata)?;
    if host.id == "windows" {
        for (name, _) in &runtime_files {
            files.push((name.clone(), fs::read(safe(runtime, name)?)?));
        }
    }
    let report = json!({"version":1,"project":config.name,"target":host.id,"family":host.family,"profile":"release","renderer":host.renderer,"presentation":host.presentation,"dev_tools":false,"preview_tools":false,"files":files.iter().map(|(p,b)|json!({"path":p,"bytes":b.len(),"sha256":hash(b)})).collect::<Vec<_>>()});
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
        br#"{"seed":42,"frames":0,"warmup":60,"headless":false,"fixed_tick":false}"#,
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
