pub(crate) const WEB_FILES: &[&str] = &[
        "player/main.js",
        "renderer/three.js",
        "renderer/mesh.js",
        "renderer/instances3d.js",
        "renderer/bloom.js",
        "renderer/effekseer.js",
        "renderer/particles.js",
        "shared/ui-tree.js",
        "shared/canvas-ui.mjs",
        "shared/host-input.js",
        "shared/webgpu-snapshot.js",
        "shared/audio-playback.js",
        "shared/asset-encoding.js",
        "shared/load-project.js",
        "shared/fixed-step-scheduler.mjs",
        "shared/async-scheduler.mjs",
        "shared/runtime-core.mjs",
        "shared/runtime-backend.mjs",
        "shared/runtime-worker.js",
        "shared/job-pool.mjs",
        "shared/job-binary.mjs",
        "shared/job-worker.js",
        "shared/instance-transfer.mjs",
        "shared/presentation-interpolation.mjs",
        "shared/profile-window.js",
        "vendor/three/three.player.min.js",
        "vendor/three/LICENSE",
        "vendor/rapier/LICENSE",
    ];
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

use unone_engine::MeshAsset as StaticMesh;
#[derive(serde::Deserialize,serde::Serialize)]
#[serde(default,deny_unknown_fields)]
struct JobPolicy { mode: JobMode, max_workers: u8, memory_budget_mb: u16 }
impl Default for JobPolicy {fn default()->Self{Self{mode:JobMode::Auto,max_workers:2,memory_budget_mb:128}}}
#[derive(serde::Deserialize,serde::Serialize)]
#[serde(rename_all="snake_case")]
enum JobMode {Auto,Inline,Workers}
#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(default, deny_unknown_fields)]
struct PresentationSettings {
    ui: PresentationUi,
    bloom: bool,
    show_performance: bool,
    runtime_backend: RuntimeBackend,
    job_policy: JobPolicy,
    interpolation: bool,
    interpolate_instances: Vec<String>,
}
#[derive(Default,serde::Deserialize,serde::Serialize)]
#[serde(default,deny_unknown_fields)]
struct PresentationUi {font_source:Option<String>,font_family:Option<String>}
#[derive(Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeBackend {
    #[default]
    Main,
    Worker,
}
fn inside(root: &Path, relative: &str) -> Result<PathBuf> {
    ensure!(
        !Path::new(relative).is_absolute() && !relative.split(['/', '\\']).any(|p| p == ".."),
        "unsafe content path: {relative}"
    );
    let path = root
        .join(relative)
        .canonicalize()
        .with_context(|| format!("missing content: {relative}"))?;
    ensure!(
        path.starts_with(root.canonicalize()?),
        "content escapes project: {relative}"
    );
    Ok(path)
}

fn replace_required(text: String, old: &str, new: &str) -> Result<String> {
    ensure!(
        text.matches(old).count() == 1,
        "PLAYER_MODULE_CONTRACT_CHANGED: expected exactly one {old}"
    );
    Ok(text.replacen(old, new, 1))
}

pub fn web(
    project: &Path,
    output: &Path,
    runtime: Option<&Path>,
    development: bool,
) -> Result<Value> {
    ensure!(!output.exists(), "output already exists: {}", output.display());
    let root = crate::sdk::template_root(None)?;
    web_with_templates(project, output, runtime, development, &root)
}

pub fn web_with_templates(project: &Path, output: &Path, runtime: Option<&Path>, development: bool, repo: &Path) -> Result<Value> {
    ensure!(
        !output.exists(),
        "output already exists: {}",
        output.display()
    );
    let runtime = runtime.map(Path::to_path_buf).unwrap_or_else(|| {
        project.join(if development {
            "dist/player-development-runtime"
        } else {
            "dist/player-runtime"
        })
    });
    let manifest: Value = serde_json::from_slice(&fs::read(runtime.join("runtime.json")).with_context(|| format!("Build this project runtime first: powershell -File scripts/build-web-live.ps1 -Player -Project \"{}\"{}; or pass --runtime <directory>", project.display(), if development { " -Development" } else { "" }))?)?;
    ensure!(
        manifest["profile"] == "release"
            && manifest["dev_tools"] == false
            && manifest["preview_tools"].as_bool().unwrap_or(false) == development,
        "runtime variant mismatch; build -Player (production) or -Player -Development (development)"
    );
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for (field, hash) in [("javascript", "javascript_sha256"), ("wasm", "wasm_sha256")] {
        let name = manifest[field]
            .as_str()
            .context("runtime filename missing")?;
        ensure!(
            Path::new(name).components().count() == 1,
            "invalid runtime filename"
        );
        let bytes = fs::read(inside(&runtime, name)?)?;
        ensure!(
            digest(&bytes) == manifest[hash],
            "runtime hash mismatch: {name}"
        );
        if field == "wasm" {
            ensure!(bytes.starts_with(b"\0asm\x01\0\0\0"), "invalid wasm header");
            for forbidden in [
                ".debug_info",
                "unone_web_reload_script",
                "unone_web_bundle_begin",
            ] {
                ensure!(
                    !bytes
                        .windows(forbidden.len())
                        .any(|v| v == forbidden.as_bytes()),
                    "player contains development section/export: {forbidden}"
                );
            }
            if !development {
                ensure!(
                    !bytes
                        .windows("unone_web_developer_request".len())
                        .any(|v| v == b"unone_web_developer_request"),
                    "production runtime contains developer operation export"
                );
            }
        }
        files.push((format!("runtime/{name}"), bytes));
    }
    let (config, settings, assets, content) = content(project)?;
    files.extend(content);
    let compiled = manifest["compiled_systems"].as_array()
        .context("RUNTIME_CAPABILITIES_MISSING: rebuild the runtime with scripts/build-web-live.ps1 -Player -Project <project-directory>")?;
    for id in settings.enabled_ids() {
        ensure!(
            compiled.iter().any(|entry| entry.as_str() == Some(&id)),
            "SYSTEM_NOT_COMPILED: runtime does not contain {id}; rebuild with scripts/build-web-live.ps1 -Player -Project {} and pass its directory using --runtime",
            project.display()
        );
    }
    let presentation = if project.join("player.presentation.json").exists() {
        serde_json::from_slice::<PresentationSettings>(&fs::read(inside(
            project,
            "player.presentation.json",
        )?)?)?
    } else {
        PresentationSettings::default()
    };
    ensure!(presentation.job_policy.max_workers<=4 && presentation.job_policy.memory_budget_mb<=1024,"JOB_POLICY_INVALID: max_workers must be 0..4 and memory_budget_mb 0..1024");
    if let Some(path)=&presentation.ui.font_source {
        ensure!(presentation.ui.font_family.as_ref().is_some_and(|f|!f.trim().is_empty()),"UI_FONT_FAMILY_REQUIRED: specify the packaged font's family name");
        let name=format!("content/{path}");
        if !files.iter().any(|(p,_)|p==&name){files.push((name,fs::read(inside(project,path)?)?));}
    }
    files.push((
        "content/presentation.json".into(),
        serde_json::to_vec(&presentation)?,
    ));
    files.push((
        "runtime/runtime.json".into(),
        serde_json::to_vec(&manifest)?,
    ));
    for &path in WEB_FILES {
        if (path == "shared/profile-window.js" && !development)
            || (path == "shared/audio-playback.js" && !settings.is_enabled("audio"))
            || (path == "shared/ui-tree.js" && !settings.is_enabled("ui"))
            || (path == "shared/canvas-ui.mjs" && !settings.is_enabled("ui"))
            || (path == "renderer/particles.js" && !settings.is_enabled("particle"))
            || (path == "renderer/effekseer.js" && !settings.is_enabled("effekseer"))
            || (path == "vendor/rapier/LICENSE" && !compiled.iter().any(|v| v == "physics3d"))
        {
            continue;
        }
        let source=repo.join("web").join(path);
        let mut bytes = fs::read(&source).with_context(||format!("PLAYER_TEMPLATE_MISSING: {}; CLI and host templates must come from the same SDK/source revision",source.display()))?;
        if path == "renderer/three.js" {
            let mut text = String::from_utf8(bytes)?;
            if !settings.is_enabled("particle") {
                text = replace_required(
                    text,
                    "import { createParticleRenderer } from \"./particles.js\";",
                    "const createParticleRenderer = () => ({draw(){}, clear(){}, count:0});",
                )?;
            }
            if !settings.is_enabled("effekseer") {
                text = replace_required(
                    text,
                    "import {createEffects} from './effekseer.js';",
                    "const createEffects = async () => null;",
                )?;
            }
            bytes = text.into_bytes();
            bytes = String::from_utf8(bytes)?
                .replace(
                    "../vendor/three/three.module.js",
                    "../vendor/three/three.player.min.js",
                )
                .into_bytes();
        }
        if path == "player/main.js" {
            let mut text = String::from_utf8(bytes)?;
            if !settings.is_enabled("ui") {
                text = replace_required(
                    text,
                    "import {createCanvasUi,loadCanvasFont} from '../shared/canvas-ui.mjs';",
                    "const createCanvasUi = () => ({draw(){},pointer(){return false},releaseAll(){},setFont(){}}); const loadCanvasFont = async () => {};",
                )?;
            }
            if !settings.is_enabled("audio") {
                text = replace_required(
                    text,
                    "import {createAudioPlayback} from '../shared/audio-playback.js';",
                    "const createAudioPlayback = async () => null;",
                )?;
            }
            if !settings.is_enabled("save") {
                text = replace_required(
                    text,
                    "const next=JSON.stringify(snapshot.save_payload);if(next!==saved){localStorage.setItem(key,next);saved=next;}",
                    "",
                )?;
                text = replace_required(
                    text,
                    "try{project.restored_save=JSON.parse(localStorage.getItem(key)??'null');}catch(error){throw new Error(`SAVE_READ_FAILED: ${error.message}`);}",
                    "project.restored_save=null;",
                )?;
            }
            for (marker, code) in [
                (
                    "/* PROFILE_IMPORT */",
                    "import {createProfileWindow} from '../shared/profile-window.js';",
                ),
                (
                    "/* PROFILE_INIT */",
                    "const profileWindow=createProfileWindow();",
                ),
                (
                    "/* PROFILE_FRAME */",
                    "profileWindow.frame(renderMs,{start_ms:began,frame:snapshot.world?.frame??snapshot.frame,paused:frozen});",
                ),
                ("/* PROFILE_INPUT */", "const inputEnd=performance.now();"),
                ("/* PROFILE_TICK_END */", "const tickEnd=performance.now();"),
                ("/* PROFILE_TICK */", ""),
                (
                    "/* PROFILE_POST_TICK */",
                    "const postEnd=performance.now();profileWindow.tick({frame:snapshot.world?.frame??snapshot.frame,start_ms:began,end_ms:postEnd,input_ms:inputEnd-began,wasm_tick_publish_ms:tickEnd-inputEnd,decode_ms:decodeEnd-tickEnd,post_tick_ms:postEnd-decodeEnd});",
                ),
                (
                    "/* PROFILE_WAKE */",
                    "onWake:span=>profileWindow.wake(span),",
                ),
                (
                    "/* PROFILE_ERROR */",
                    "profileWindow.stop({dropped_steps:scheduler?.totalDroppedSteps??0});",
                ),
            ] {
                text = replace_required(text, marker, if development { code } else { "" })?;
            }
            bytes=if development {text.replace("/* DEVELOPER_IMPORT */", "import {createDeveloper} from '../developer/main.js';\nconst developer=createDeveloper();").replace("/* DEVELOPER_CONNECT */", "developer.connect({profileWindow,getSnapshot:()=>snapshot,acceptSnapshot,coreRequest,setTransport,restart,backendReport:()=>backend.report(),getStats:()=>({...lastStats,dropped_steps:scheduler?.totalDroppedSteps??0}),getBoot:()=>metrics,draw,tick:tickOnce,releaseInput:()=>input.releaseAll(),setPaused,getPaused:()=>frozen,setBloom:value=>renderer.setBloom(value),queueInput:frame=>{manualInput=frame;}});")} else {text.replace("/* DEVELOPER_IMPORT */", "").replace("/* DEVELOPER_CONNECT */", "")}.into_bytes();
        }
        files.push((format!("web/{path}"), bytes));
    }
    if development {
        for path in ["main.js", "api.js", "panel.js", "panel.css"] {
            files.push((
                format!("web/developer/{path}"),
                fs::read(repo.join("web/developer").join(path))?,
            ));
        }
    }
    if assets["assets"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["kind"] == "effekseer")
    {
        for name in ["effekseer.js", "effekseer.wasm", "LICENSE"] {
            let path = format!("vendor/effekseer/{name}");
            files.push((
                format!("web/{path}"),
                fs::read(repo.join("web").join(path))?,
            ));
        }
    }
    let index = fs::read_to_string(repo.join("web/player/index.html"))?
        .replace("__RUNTIME_JS__", manifest["javascript"].as_str().unwrap());
    files.push(("index.html".into(), index.into_bytes()));
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
    let mut destinations = std::collections::BTreeSet::new();
    for (path, _) in &files {
        ensure!(
            destinations.insert(path.replace('\\', "/").to_lowercase()),
            "export destination collision: {path}"
        );
    }
    let report = json!({"version":1,"project":config.name,"enabled_systems":settings.enabled_ids(),"compiled_systems":compiled,"profile":"release","variant":if development {"development"} else {"production"},"dev_tools":false,"preview_tools":development,"renderer":"three-webgl","total_bytes":files.iter().map(|f|f.1.len()).sum::<usize>(),"files":files.iter().map(|(p,b)|json!({"path":p,"bytes":b.len(),"sha256":digest(b)})).collect::<Vec<_>>()});
    // All validation and reads finish first. Remove only our newly created tree on write failure.
    fs::create_dir_all(output)?;
    let write = (|| -> Result<()> {
        for (path, bytes) in &files {
            let destination = output.join(path);
            fs::create_dir_all(destination.parent().unwrap())?;
            fs::write(destination, bytes)?;
        }
        fs::write(
            output.join("export.json"),
            serde_json::to_vec_pretty(&report)?,
        )?;
        Ok(())
    })();
    if write.is_err() {
        let _ = fs::remove_dir_all(output);
    }
    write?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mesh_contract_rejects_bad_topology_uvs_and_unknown_fields() {
        let valid = json!({"version":1,"positions":[0,0,0,1,0,0,0,1,0],"uvs":[0,0,1,0,0,1],"indices":[0,1,2],"texture":"texture://test"});
        serde_json::from_value::<StaticMesh>(valid.clone())
            .unwrap()
            .validate()
            .unwrap();
        for (field, value) in [
            ("indices", json!([0, 1, 3])),
            ("uvs", json!([0, 1])),
            ("version", json!(2)),
        ] {
            let mut bad = valid.clone();
            bad[field] = value;
            assert!(
                serde_json::from_value::<StaticMesh>(bad)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        let mut typo = valid;
        typo["postions"] = json!([]);
        assert!(serde_json::from_value::<StaticMesh>(typo).is_err());
    }
    #[test]
    fn rejects_parent_paths_and_existing_output() {
        let dir = tempfile::tempdir().unwrap();
        assert!(inside(dir.path(), "../secret").is_err());
        assert!(
            web(dir.path(), dir.path(), None, false)
                .unwrap_err()
                .to_string()
                .contains("already exists")
        );
    }
}

/// Shared validated host payload and asset bytes for all player exporters.
pub(crate) fn content(project:&Path)->Result<(unone_engine::ProjectConfig,unone_engine::SystemSettings,Value,Vec<(String,Vec<u8>)>)>{
    let mut files=Vec::new();
    let (config, _) = unone_engine::ProjectPaths::discover(project)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    let settings = unone_engine::SystemSettings::from_config(&config)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    let scene: Value = if let Some(path) = &config.main_scene {
        serde_json::from_slice(&fs::read(inside(project, path)?)?)?
    } else {
        Value::Null
    };
    let job_sources: std::collections::BTreeMap<_,_>=config.job_scripts.iter().map(|(id,path)|Ok((id.clone(),fs::read_to_string(inside(project,path)?)?))).collect::<Result<_>>()?;
    let payload = json!({"job_sources":job_sources,"config":config,"script":fs::read_to_string(inside(project,&config.entry_script)?)?,"scene":scene});
    // Exercise the exact player ingestion contract before creating any output.
    unone_engine::HostProject::parse(&serde_json::to_vec(&payload)?)
        .map_err(|e| anyhow::anyhow!(e.explanation))?
        .into_runtime(42)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    let assets = if let Some(path) = &config.asset_manifest {
        let assets: unone_engine::AssetManifest =
            serde_json::from_slice(&fs::read(inside(project, path)?)?)?;
        ensure!(assets.version == 1, "unsupported asset manifest version");
        for asset in &assets.assets {
            if !["texture2d", "audio", "mesh3d", "effekseer"].contains(&asset.kind.as_str()) {
                bail!("PLAYER_DECODER_UNAVAILABLE: {} ({})", asset.id, asset.kind);
            }
            if asset.kind == "effekseer" {
                ensure!(
                    settings.is_enabled("effekseer"),
                    "SYSTEM_DISABLED: effekseer assets require systems.effekseer=true"
                );
                let bytes = fs::read(inside(project, &asset.source)?)?;
                ensure!(
                    bytes.starts_with(b"SKFE")
                        && bytes.get(4..8) == Some(1500_i32.to_le_bytes().as_slice()),
                    "PLAYER_DECODER_UNAVAILABLE: {} requires legacy SKFE 1500 with declared companions",
                    asset.id
                );
                let mut offset = 8usize;
                for _ in 0..6 {
                    let mut integer = || -> Result<usize> {
                        let value = i32::from_le_bytes(
                            bytes
                                .get(offset..offset + 4)
                                .context("EFFEKSEER_INVALID: truncated resource table")?
                                .try_into()?,
                        );
                        offset += 4;
                        ensure!(
                            (0..=4096).contains(&value),
                            "EFFEKSEER_INVALID: resource count/length"
                        );
                        Ok(value as usize)
                    };
                    let count = integer()?;
                    for _ in 0..count {
                        let length = i32::from_le_bytes(
                            bytes
                                .get(offset..offset + 4)
                                .context("EFFEKSEER_INVALID: resource length")?
                                .try_into()?,
                        );
                        offset += 4;
                        ensure!(
                            (1..=4096).contains(&length),
                            "EFFEKSEER_INVALID: resource name"
                        );
                        let raw = bytes
                            .get(offset..offset + length as usize * 2)
                            .context("EFFEKSEER_INVALID: truncated resource name")?;
                        offset += raw.len();
                        let name = String::from_utf16(
                            &raw.chunks_exact(2)
                                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                                .collect::<Vec<_>>(),
                        )?;
                        let name = name.trim_end_matches('\0').replace('\\', "/");
                        ensure!(
                            !name.is_empty() && !name.split('/').any(|p| p == ".."),
                            "EFFEKSEER_INVALID: resource path"
                        );
                        let companion = Path::new(&asset.source)
                            .parent()
                            .unwrap()
                            .join(name)
                            .to_string_lossy()
                            .replace('\\', "/");
                        ensure!(
                            asset.files.contains(&companion),
                            "EFFEKSEER_COMPANION_MISSING: {companion}; declare it in asset.files"
                        );
                        inside(project, &companion)?;
                    }
                }
            }
            if asset.kind == "mesh3d" {
                ensure!(
                    asset.source.ends_with(".mesh.json"),
                    "PLAYER_DECODER_UNAVAILABLE: {} requires .mesh.json conversion",
                    asset.id
                );
                let data: StaticMesh =
                    serde_json::from_slice(&fs::read(inside(project, &asset.source)?)?)?;
                data.validate()?;
                ensure!(
                    assets
                        .assets
                        .iter()
                        .any(|a| a.id == data.texture && a.kind == "texture2d"),
                    "MESH_TEXTURE_MISSING: {}",
                    data.texture
                );
            }
            for path in std::iter::once(&asset.source).chain(&asset.files) {
                files.push((format!("content/{path}"), fs::read(inside(project, path)?)?));
            }
        }
        serde_json::to_value(assets)?
    } else {
        json!({"version":1,"assets":[]})
    };
    for entity in scene["entities"].as_array().into_iter().flatten() {
        if let Some(mesh) = entity["mesh3d"]["asset"].as_str() {
            ensure!(
                ["mesh://primitive/box", "mesh://primitive/sphere"].contains(&mesh)
                    || assets["assets"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|a| a["id"] == mesh && a["kind"] == "mesh3d"),
                "PLAYER_DECODER_UNAVAILABLE: mesh {mesh}; declare a supported mesh asset"
            );
        }
    }
    files.push(("content/project.json".into(), serde_json::to_vec(&payload)?));
    files.push(("content/assets.json".into(), serde_json::to_vec(&assets)?));
    Ok((config,settings,assets,files))
}
