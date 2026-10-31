pub(crate) const WEB_FILES: &[&str] = &[
        "player/main.js",
        "renderer/three.js",
        "renderer/mesh.js",
        "renderer/projected.js",
        "renderer/ui-image-batch-prefix.js",
        "renderer/ui-gpu.js",
        "renderer/mesh-entities.js",
        "renderer/geometry3d.js",
        "renderer/data-textures.js",
        "renderer/world-curvature.js",
        "renderer/projected-frame-shaders.js",
        "renderer/projected-frame-material.js",
        "renderer/projected-frame-draws.js",
        "renderer/projected-frame-target-query.js",
        "renderer/projected-frame-target.js",
        "renderer/projected-frame-pass.js",
        "renderer/projected-frame-profile.js",
        "renderer/projected-frame-gouraud-profile.js",
        "renderer/projected-frame-validator.js",
        "renderer/projected-frame-policy.js",
        "renderer/projected-frame-publication.js",
        "shared/projected-frame.mjs",
        "shared/projected-frame-material.mjs",
        "renderer/projected-raster.js",
        "renderer/projected-raster-target.js",
        "renderer/projected-raster-shaders.js",
        "renderer/projected-raster-policy.js",
        "renderer/projected-raster-capability.js",
        "renderer/startup-presentation-state.js",
        "renderer/projected-raster-validator.js",
        "renderer/projected-raster-profile.js",
        "renderer/projected-raster-profile-expected.js",
        "renderer/renderer-clear-lifecycle.js",
        "shared/startup-presentation.mjs",
        "shared/player-completion.mjs",
        "shared/retained-image-generation.mjs",
        "shared/save-publication.mjs",
        "shared/player-seed.mjs",
        "shared/ui-tree-publication.mjs",
        "shared/world-field-publication.mjs",
        "renderer/presentation3d.js",
        "shared/projected-geometry.js",
        "shared/projected-base64.js",
        "renderer/instances3d.js",
        "renderer/bloom.js",
        "renderer/bloom-timer.js",
        "renderer/effekseer.js",
        "renderer/particles.js",
        "renderer/vfx.js",
        "renderer/vfx-contract.js",
        "renderer/vfx-batch.js",
        "renderer/vfx-player.js",
        "renderer/vfx-native.js",
        "renderer/shader-materials.js",
        "renderer/sprite-cells.js",
        "renderer/sprite-resources.js",
        "renderer/sprite-presentation.js",
        "renderer/texture-cache-policy.js",
        "shared/ui-tree.js",
        "shared/canvas-ui.mjs",
        "shared/ui-text-input.mjs",
        "shared/ui-cursor.mjs",
        "shared/ui-style.mjs",
        "shared/ui-presentation.mjs",
        "shared/ui-image-batch.mjs",
        "shared/ui-scroll.mjs",
        "shared/ui-contract.mjs",
        "shared/ui-geometry.mjs",
        "shared/host-input.js",
        "shared/player-input.js",
        "shared/ordered-physical-events.mjs",
        "shared/ordered-physical-queue.mjs",
        "shared/ordered-physical-router.mjs",
        "shared/physical-input.js",
        "shared/webgpu-snapshot.js",
        "shared/heightfields.js",
        "shared/audio-playback.js",
        "shared/asset-encoding.js",
        "shared/image-dimensions.mjs",
        "shared/load-project.js",
        "shared/fixed-step-scheduler.mjs",
        "shared/async-scheduler.mjs",
        "shared/runtime-core.mjs",
        "shared/sprite-resource-host.mjs",
        "shared/spatial-host.mjs",
        "shared/spatial-metrics.mjs",
        "shared/spatial-gpu.mjs",
        "shared/spatial.wgsl",
        "shared/runtime-backend.mjs",
        "shared/runtime-worker.js",
        "shared/job-pool.mjs",
        "shared/job-binary.mjs",
        "shared/job-worker.js",
        "shared/instance-transfer.mjs",
        "shared/presentation-interpolation.mjs",
        "shared/renderer-selection.mjs",
        "shared/raster-diagnostics.mjs",
        "shared/profile-window.js",
        "vendor/three/three.player.min.js",
        "vendor/three/three.webgpu.js",
        "vendor/three/three.core.js",
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
    // Select compatibility before reading/executing authored game content or
    // creating output, just as portable SDK selection does. A source exporter
    // must not pair a new package declaration with a stale cached runtime.
    let (package_config, _) = unone_engine::ProjectPaths::discover(project)
        .map_err(|error| anyhow::anyhow!(error.explanation))?;
    validate_runtime_packages(&package_config.runtime_packages, &manifest)?;
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
    // Validate the configuration actually serialized into this export as well,
    // in case authoring files changed after the early compatibility preflight.
    validate_runtime_packages(&config.runtime_packages, &manifest)?;
    files.extend(content);
    // Production players load the entry script precompiled with their exact
    // compiler settings; development players keep source for hot reload.
    if !development {
        precompile_entry_script(&mut files, &manifest)?;
    }
    let compiled = manifest["compiled_systems"].as_array()
        .context("RUNTIME_CAPABILITIES_MISSING: rebuild the runtime with scripts/build-web-live.ps1 -Player -Project <project-directory>")?;
    for id in settings.enabled_ids() {
        ensure!(
            compiled.iter().any(|entry| entry.as_str() == Some(&id)),
            "SYSTEM_NOT_COMPILED: runtime does not contain {id}; rebuild with scripts/build-web-live.ps1 -Player -Project {} and pass its directory using --runtime",
            project.display()
        );
    }
    let presentation = append_presentation(project, &mut files)?;
    files.push((
        "runtime/runtime.json".into(),
        serde_json::to_vec(&manifest)?,
    ));
    for &path in WEB_FILES {
        if (path == "shared/profile-window.js" && !development)
            || (path == "shared/audio-playback.js" && !settings.is_enabled("audio"))
            || (path == "shared/ui-tree.js" && !settings.is_enabled("ui"))
            || (path == "shared/canvas-ui.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-text-input.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-cursor.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-style.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-presentation.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-image-batch.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-scroll.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-contract.mjs" && !settings.is_enabled("ui"))
            || (path == "shared/ui-geometry.mjs" && !settings.is_enabled("ui"))
            || (path == "renderer/ui-gpu.js" && !settings.is_enabled("ui"))
            // VFX presentation statically imports particles even with simulation disabled.
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
                    "import { createParticleRenderer } from \"./particles.js?build=particle-texture-colorbins-v1\";",
                    "const createParticleRenderer = () => ({draw(){}, clear(){}, contextLost(_retire){}, dispose(){}, count:0,debugBatches:[],metrics:()=>({groups:0,capacity:0,instance_buffer_bytes:0,compactions:0})});",
                )?;
            }
            if !settings.is_enabled("effekseer") {
                text = replace_required(
                    text,
                    "import {createEffects} from './effekseer.js';",
                    "const createEffects = async () => null;",
                )?;
            }
            if !settings.is_enabled("ui") {
                text = replace_required(text, "import {createGpuUi} from './ui-gpu.js';", "const createGpuUi = () => null;")?;
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
                    "import {createCanvasUi,loadPresentationFonts} from '../shared/canvas-ui.mjs';",
                    "const disabledUiCompleted = Object.freeze({status:'completed'}); const createCanvasUi = () => ({draw:()=>disabledUiCompleted,ready:async()=>{},pointer(){return false},hitTest(){return null},releaseAll(){},setFont(){},report:()=>({backend:'disabled',nodes:0,render_regions:0,assets:[],diagnostics:[]})}); const loadPresentationFonts = async () => {};",
                )?;
                text = replace_required(text,
                    "import {createUiTextInputHost} from '../shared/ui-text-input.mjs';",
                    "const createUiTextInputHost = () => ({draw:s=>s,pointer:()=>false,routeKey:()=>false,setExternalInput(){},suspend(){},dispose(){}});")?;
                text = replace_required(text,
                    "import {createUiCursorHost,loadCursorImage} from '../shared/ui-cursor.mjs';",
                    "const createUiCursorHost = () => ({update:()=>disabledUiCompleted,ready:async()=>{},dispose(){},report:()=>({kind:'default'})}); const loadCursorImage = async () => null;")?;
                text = replace_required(text,
                    "import {createUiScrollHost} from '../shared/ui-scroll.mjs';",
                    "const createUiScrollHost = () => ({draw:s=>s,pointer:()=>false,routeKey:()=>false,routeWheel:()=>false,setExternalInput(){},cancel(){},dispose(){}});")?;
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
                    "const next=serializedSavePayload(snapshot);if(next!==saved){localStorage.setItem(key,next);saved=next;}",
                    "",
                )?;
                text = replace_required(
                    text,
                    "try{saved=localStorage.getItem(key);project.restored_save=JSON.parse(saved??'null');}catch(error){throw new Error(`SAVE_READ_FAILED: ${error.message}`);}",
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
        files.push(("content/asset-usages.json".into(), serde_json::to_vec(&development_asset_usage_index(project, &config)?)?));
        for path in ["main.js", "api.js", "asset-usages.js", "panel.js", "panel.css"] {
            files.push((
                format!("web/developer/{path}"),
                fs::read(repo.join("web/developer").join(path))?,
            ));
        }
    }
    if settings.is_enabled("effekseer") || assets["assets"]
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
    let module_dependencies=crate::web_dependencies::validate(&files)?;
    let (release_root,index)=seal_web_generation(&mut files,&index)?;
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
    let report = json!({"version":1,"project":config.name,"release_root":release_root,"module_dependencies_checked":module_dependencies,"cache_policy":{"index.html":"no-cache, must-revalidate","releases/":"public, max-age=31536000, immutable","deployment":"publish complete generation before index; retain old generations for open clients","legacy_aliases":"unversioned files retained for existing CLI inspection tools; browser entry uses only release_root"},"enabled_systems":settings.enabled_ids(),"compiled_systems":compiled,"profile":"release","variant":if development {"development"} else {"production"},"dev_tools":false,"preview_tools":development,"renderer_mode":presentation.renderer_mode,"renderer_module":presentation.renderer_module,"renderer":if presentation.renderer_mode == crate::hosts::RendererMode::Official {"three-webgl"} else {"custom-module"},"total_bytes":files.iter().map(|f|f.1.len()).sum::<usize>(),"files":files.iter().map(|(p,b)|json!({"path":p,"bytes":b.len(),"sha256":digest(b)})).collect::<Vec<_>>()});
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

fn development_asset_usage_index(project: &Path, config: &unone_engine::ProjectConfig) -> Result<unone_engine::AssetUsageIndex> {
    if config.asset_manifest.is_some() {
        let usage = unone_engine::asset_usages(project, None);
        ensure!(usage.ok, "ASSET_USAGE_INDEX_FAILED: {:?}", usage.diagnostics);
        return usage.value.context("ASSET_USAGE_INDEX_FAILED: successful scan returned no index");
    }
    Ok(unone_engine::AssetUsageIndex {
        version: 1,
        project_root: fs::canonicalize(project)?.display().to_string(),
        assets: Default::default(), source_files: Vec::new(), references: Vec::new(), unresolved: Vec::new(),
        scope: unone_engine::AssetUsageScope {
            scan_complete: false, runtime_complete: false, excluded_directories: Vec::new(),
            issues: vec!["ASSET_MANIFEST_NOT_CONFIGURED: no declared asset inventory is available; source scanning was not performed.".into()],
            limitations: vec!["This is an empty development-tool index for a project without asset_manifest, not a completed source scan or proof that the game uses no assets.".into(),
                "Published runtime nodes can still provide live asset references. Zero source references never proves safe deletion.".into()],
        },
    })
}

/// Runtime descriptors are compatibility metadata. This gate does not execute
/// the selected WASM and cannot certify its implementation or visual output.
fn validate_runtime_packages(
    required: &std::collections::BTreeMap<String, String>,
    descriptor: &Value,
) -> Result<()> {
    let available = crate::sdk::descriptor_packages(descriptor).context(
        "RUNTIME_PACKAGES_INVALID: runtime.json runtime_packages must be a string-to-string object; rebuild or select a matching runtime and keep project declarations intact",
    )?;
    let missing = crate::sdk::package_version_gaps(required, &available);
    ensure!(missing.is_empty(),
        "RUNTIME_PACKAGE_UNAVAILABLE: runtime.json package mismatches [{}]. Rebuild or select a runtime supporting every required exact package version and pass its directory using --runtime; keep project runtime_packages declarations intact",
        missing.iter().map(|(name, gap)| format!("{name}: expected {}, found {}", gap.expected, gap.found.as_deref().unwrap_or("<missing>"))).collect::<Vec<_>>().join(", ")
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_metadata_gate_uses_generic_exact_versions_and_validates_present_maps() {
        use std::collections::BTreeMap;
        let required = BTreeMap::from([("@example/reusable-controls".into(), "7.4.2".into())]);
        validate_runtime_packages(&required, &json!({"runtime_packages":{"@example/reusable-controls":"7.4.2","@other/library":"2.0.0"}})).unwrap();
        for (descriptor, found) in [
            (json!({}), "<missing>"),
            (json!({"runtime_packages":{}}), "<missing>"),
            (json!({"runtime_packages":{"@example/reusable-controls":"7.4.1"}}), "7.4.1"),
        ] {
            let message = validate_runtime_packages(&required, &descriptor).unwrap_err().to_string();
            assert!(message.contains("RUNTIME_PACKAGE_UNAVAILABLE"));
            assert!(message.contains(&format!("@example/reusable-controls: expected 7.4.2, found {found}")));
            assert!(message.contains("keep project runtime_packages declarations intact"));
        }
        validate_runtime_packages(&BTreeMap::new(), &json!({})).unwrap();
        for descriptor in [
            json!({"runtime_packages":null}),
            json!({"runtime_packages":["@example/reusable-controls"]}),
            json!({"runtime_packages":{"@example/reusable-controls":7}}),
        ] {
            // Explicit malformed metadata is not a legacy descriptor, even if
            // this project happens not to request a package.
            let error = validate_runtime_packages(&BTreeMap::new(), &descriptor).unwrap_err();
            assert!(error.to_string().contains("RUNTIME_PACKAGES_INVALID"));
        }
    }

    fn package_export_fixture(directory: &Path) -> (PathBuf, PathBuf, Value) {
        let runtime = directory.join("runtime");
        fs::create_dir(&runtime).unwrap();
        let javascript = b"// packaging fixture; not an executable runtime";
        let wasm = b"\0asm\x01\0\0\0";
        fs::write(runtime.join("fixture.js"), javascript).unwrap();
        fs::write(runtime.join("fixture.wasm"), wasm).unwrap();
        let descriptor = json!({"profile":"release","dev_tools":false,"preview_tools":false,
            "javascript":"fixture.js","javascript_sha256":digest(javascript),
            "wasm":"fixture.wasm","wasm_sha256":digest(wasm),
            "compiled_systems":unone_engine::SystemSettings::default().enabled_ids()});
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        (runtime, repo, descriptor)
    }

    #[test]
    fn direct_web_export_rejects_package_mismatch_before_loading_game_or_creating_output() {
        let directory = tempfile::tempdir().unwrap();
        let (runtime, repo, mut descriptor) = package_export_fixture(directory.path());
        let required = json!({"@example/reusable-controls":"7.4.2"});
        let project = json!({"name":"package preflight","entry_script":"missing.luau","runtime_packages":required});
        let config = serde_json::to_vec_pretty(&project).unwrap();
        fs::write(directory.path().join("project.unone.json"), &config).unwrap();
        for (index, packages) in [None, Some(json!({"@example/reusable-controls":"7.4.1"})), Some(json!({"@example/reusable-controls":7}))].into_iter().enumerate() {
            descriptor.as_object_mut().unwrap().remove("runtime_packages");
            if let Some(packages) = packages { descriptor["runtime_packages"] = packages; }
            fs::write(runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
            let output = directory.path().join(format!("rejected-{index}"));
            let message = web_with_templates(directory.path(), &output, Some(&runtime), false, &repo).unwrap_err().to_string();
            assert!(message.contains(if index == 2 { "RUNTIME_PACKAGES_INVALID" } else { "RUNTIME_PACKAGE_UNAVAILABLE" }), "{message}");
            assert!(!output.exists());
            assert_eq!(fs::read(directory.path().join("project.unone.json")).unwrap(), config);
        }
    }

    #[test]
    fn direct_web_export_accepts_exact_metadata_and_legacy_projects_without_package_requirements() {
        let directory = tempfile::tempdir().unwrap();
        let (runtime, repo, mut descriptor) = package_export_fixture(directory.path());
        let packages = unone_engine::compiled_runtime_packages(&unone_engine::SystemSettings::default());
        assert!(!packages.is_empty());
        fs::write(directory.path().join("main.luau"), "local Game={}\nfunction Game.start(_api) end\nfunction Game.update(_api,_dt) end\nreturn Game\n").unwrap();
        let config_path = directory.path().join("project.unone.json");
        fs::write(&config_path, serde_json::to_vec(&json!({"name":"exact packages","entry_script":"main.luau","runtime_packages":packages})).unwrap()).unwrap();
        descriptor["runtime_packages"] = serde_json::to_value(&packages).unwrap();
        fs::write(runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let output = directory.path().join("exact");
        web_with_templates(directory.path(), &output, Some(&runtime), false, &repo).unwrap();
        let payload = serde_json::from_slice::<Value>(&fs::read(output.join("content/project.json")).unwrap()).unwrap();
        assert_eq!(payload["config"]["runtime_packages"], serde_json::to_value(&packages).unwrap());
        // A production export ships production bytecode instead of entry source.
        assert!(payload.get("script").is_none());
        let bytecode = fs::read(output.join("content").join(payload["script_bytecode"]["source"].as_str().unwrap())).unwrap();
        assert_eq!(payload["script_bytecode"]["byte_length"], bytecode.len());
        assert!(payload["script_bytecode"]["format"].as_str().unwrap().contains("/o2/t0/"));

        fs::write(&config_path, serde_json::to_vec(&json!({"name":"legacy project","entry_script":"main.luau"})).unwrap()).unwrap();
        descriptor.as_object_mut().unwrap().remove("runtime_packages");
        fs::write(runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let legacy_output = directory.path().join("legacy");
        web_with_templates(directory.path(), &legacy_output, Some(&runtime), false, &repo).unwrap();
        assert!(legacy_output.join("index.html").exists());
    }

    #[test]
    fn actual_official_web_exports_have_complete_static_local_dependency_closure() {
        let dir=tempfile::tempdir().unwrap();let (runtime,repo,descriptor)=package_export_fixture(dir.path());
        fs::write(runtime.join("runtime.json"),serde_json::to_vec(&descriptor).unwrap()).unwrap();
        fs::write(dir.path().join("main.luau"),"return {start=function()end,update=function()end}").unwrap();
        for minimal in [false,true] {
            let systems=if minimal {json!({"ui":false,"particle":false,"effekseer":false,"audio":false,"save":false})}else{json!({})};
            fs::write(dir.path().join("project.unone.json"),serde_json::to_vec(&json!({"name":"dependency closure","entry_script":"main.luau","systems":systems})).unwrap()).unwrap();
            let output=dir.path().join(if minimal {"minimal"}else{"full"});
            let report=web_with_templates(dir.path(),&output,Some(&runtime),false,&repo).unwrap();
            assert_eq!(output.join("web/shared/ui-presentation.mjs").is_file(), !minimal,
                "UI-only presentation dependency follows the enabled UI inventory");
            for name in ["ui-text-input.mjs", "ui-cursor.mjs", "ui-image-batch.mjs"] {
                assert_eq!(output.join("web/shared").join(name).is_file(), !minimal,
                    "disabled UI cannot retain a dangling {name} module");
            }
            for name in ["player-completion.mjs", "retained-image-generation.mjs", "ui-tree-publication.mjs", "world-field-publication.mjs"] {
                assert!(output.join("web/shared").join(name).is_file(),
                    "always-imported host dependency {name} survives the UI-disabled export");
            }
            let player=fs::read_to_string(output.join("web/player/main.js")).unwrap();
            assert_eq!(player.contains("localStorage.setItem"), !minimal,
                "a save-disabled export neither persists nor restores saves");
            let renderer=fs::read_to_string(output.join("web/renderer/three.js")).unwrap();
            assert!(renderer.contains("particles.contextLost(retire);"),
                "actual renderer retains its explicit particle owner lifecycle consumer");
            if minimal {
                assert!(renderer.contains("const createParticleRenderer = () => ({draw(){}, clear(){}, contextLost(_retire){}, dispose(){}"),
                    "disabled particle renderer implements the same context-loss owner contract");
            }
            for name in ["renderer/shader-materials.js", "renderer/instances3d.js", "renderer/bloom.js", "shared/heightfields.js"] {
                assert!(fs::read_to_string(output.join("web").join(name)).unwrap().contains("contextLost(retire)"),
                    "always-included engine owner {name} implements the lifecycle consumer contract");
            }
            let files=report["files"].as_array().unwrap().iter().map(|f|{let path=f["path"].as_str().unwrap();(path.into(),fs::read(output.join(path)).unwrap())}).collect::<Vec<_>>();
            crate::web_dependencies::validate(&files).unwrap();
        }
    }

    #[test]
    fn development_asset_usage_export_without_inventory_is_explicit_and_dependency_complete() {
        let dir = tempfile::tempdir().unwrap();
        let (runtime, repo, mut descriptor) = package_export_fixture(dir.path());
        descriptor["preview_tools"] = json!(true);
        fs::write(runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
        fs::write(dir.path().join("main.luau"), "return {start=function()end,update=function()end}").unwrap();
        fs::write(dir.path().join("project.unone.json"), br#"{"name":"no inventory","entry_script":"main.luau"}"#).unwrap();
        let output = dir.path().join("development");
        let report = web_with_templates(dir.path(), &output, Some(&runtime), true, &repo).unwrap();
        let index_bytes = fs::read(output.join("content/asset-usages.json")).unwrap();
        let index: Value = serde_json::from_slice(&index_bytes).unwrap();
        assert_eq!(index["version"], 1);
        assert_eq!(index["assets"], json!({}));
        for field in ["source_files", "references", "unresolved"] { assert_eq!(index[field], json!([])); }
        assert_eq!(index["scope"]["scan_complete"], false);
        assert_eq!(index["scope"]["runtime_complete"], false);
        assert!(index["scope"]["issues"][0].as_str().unwrap().contains("ASSET_MANIFEST_NOT_CONFIGURED"));
        let release = report["release_root"].as_str().unwrap();
        assert_eq!(fs::read(output.join(release).join("content/asset-usages.json")).unwrap(), index_bytes);
        let files = report["files"].as_array().unwrap().iter().map(|f| {
            let path = f["path"].as_str().unwrap(); (path.into(), fs::read(output.join(path)).unwrap())
        }).collect::<Vec<_>>();
        assert!(crate::web_dependencies::validate(&files).unwrap() > 0);
        descriptor["preview_tools"] = json!(false);
        fs::write(runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
        let production = dir.path().join("production");
        web_with_templates(dir.path(), &production, Some(&runtime), false, &repo).unwrap();
        assert!(!production.join("content/asset-usages.json").exists());
        assert!(!production.join("web/developer").exists());
    }

    #[test]
    fn development_asset_usage_export_with_inventory_preserves_authoritative_scan() {
        let dir = tempfile::tempdir().unwrap();
        let (runtime, repo, mut descriptor) = package_export_fixture(dir.path());
        descriptor["preview_tools"] = json!(true);
        fs::write(runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
        fs::write(dir.path().join("main.luau"), "return {start=function(api) api.observation.set('art','texture://fixture') end,update=function()end}").unwrap();
        fs::write(dir.path().join("project.unone.json"), br#"{"name":"has inventory","entry_script":"main.luau","asset_manifest":"assets.json"}"#).unwrap();
        fs::write(dir.path().join("assets.json"), br#"{"version":1,"assets":[{"id":"texture://fixture","source":"fixture.svg","kind":"texture2d","bundle":"content"}]}"#).unwrap();
        fs::write(dir.path().join("fixture.svg"), br#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#).unwrap();
        let expected = serde_json::to_value(unone_engine::asset_usages(dir.path(), None).value.unwrap()).unwrap();
        let output = dir.path().join("development");
        web_with_templates(dir.path(), &output, Some(&runtime), true, &repo).unwrap();
        let actual: Value = serde_json::from_slice(&fs::read(output.join("content/asset-usages.json")).unwrap()).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(actual["scope"]["scan_complete"], true);
        assert_eq!(actual["assets"]["texture://fixture"], "fixture.svg");
        assert!(!actual["references"].as_array().unwrap().is_empty());
    }

    #[test]
    fn web_generation_pins_all_resources_and_changes_on_any_input() {
        let input=vec![("runtime/core.js".into(),b"js".to_vec()),("runtime/core.wasm".into(),b"wasm".to_vec()),("web/player/main.js".into(),b"host".to_vec()),("content/project.json".into(),b"project".to_vec())];
        let html="<html><head></head></html>";
        let (root,index)=seal_web_generation(&mut input.clone(),html).unwrap();
        assert!(index.contains(&format!("<base href=\"{root}\">")));
        let mut reversed=input.clone();reversed.reverse();assert_eq!(seal_web_generation(&mut reversed,html).unwrap().0,root);
        for i in 0..input.len(){let mut changed=input.clone();changed[i].1.push(1);let (next,_)=seal_web_generation(&mut changed,html).unwrap();assert_ne!(next,root);for (path,bytes) in &input{if path!=&input[i].0{assert!(changed.contains(&(format!("{next}{path}"),bytes.clone())));}}}
        assert_ne!(seal_web_generation(&mut input.clone(),"<head>new</head>").unwrap().0,root);
        assert!(seal_web_generation(&mut input.clone(),"<head><base href='x'></head>").is_err());
    }
    #[test]
    fn both_hosts_package_default_presentation_and_explicit_font() {
        let dir=tempfile::tempdir().unwrap();let mut files=vec![];
        append_presentation(dir.path(),&mut files).unwrap();
        assert_eq!(files[0].0,"content/presentation.json");
        fs::write(dir.path().join("font.ttf"),b"fixture-font-bytes").unwrap();
        fs::write(dir.path().join("player.presentation.json"),br#"{"ui":{"font_source":"font.ttf","font_family":"Fixture"}}"#).unwrap();
        files.clear();append_presentation(dir.path(),&mut files).unwrap();
        assert!(files.iter().any(|(p,b)|p=="content/font.ttf"&&b==b"fixture-font-bytes"));
        fs::write(dir.path().join("player.presentation.json"),br#"{"ui":{"font_source":"font.ttf"}}"#).unwrap();
        assert!(append_presentation(dir.path(),&mut vec![]).err().unwrap().to_string().contains("UI_FONT_FAMILY_REQUIRED"));
    }
    #[test]
    fn shared_font_catalog_packages_faces_rejects_invalid_entries_and_hashes_bytes() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("fonts")).unwrap();
        fs::write(dir.path().join("fonts/regular.ttf"), b"regular-font").unwrap();
        fs::write(dir.path().join("fonts/bold.otf"), b"bold-font").unwrap();
        let catalog = json!({"ui":{"fonts":[
            {"family":"Fixture UI","source":"fonts/regular.ttf"},
            {"family":"Fixture UI","source":"fonts/bold.otf","weight":700}
        ]}});
        fs::write(dir.path().join("player.presentation.json"), serde_json::to_vec(&catalog).unwrap()).unwrap();
        let mut first = vec![];
        append_presentation(dir.path(), &mut first).unwrap();
        assert_eq!(first.iter().filter(|(path,_)|path.starts_with("content/fonts/")).count(),2);
        assert!(first.iter().any(|(path,bytes)|path=="content/fonts/bold.otf"&&bytes==b"bold-font"));
        let html = "<head><title>Font fixture</title></head>";
        let hash = seal_web_generation(&mut first, html).unwrap().0;
        fs::write(dir.path().join("fonts/bold.otf"), b"updated-bold-font").unwrap();
        let mut second = vec![];
        append_presentation(dir.path(), &mut second).unwrap();
        assert_ne!(hash, seal_web_generation(&mut second, html).unwrap().0);
        for (ui, code) in [
            (json!({"fonts":[{"family":"Fixture","source":"fonts/regular.ttf"},{"family":"Fixture","source":"fonts/bold.otf"}]}),"UI_FONT_DUPLICATE"),
            (json!({"fonts":[{"family":"Fixture","source":"fonts/regular.ttf","weight":99}]}),"UI_FONT_WEIGHT_INVALID"),
            (json!({"fonts":[{"family":"Fixture","source":"fonts/regular.woff2"}]}),"UI_FONT_FORMAT_UNSUPPORTED"),
            (json!({"fonts":[{"family":"Fixture","source":"../outside.ttf"}]}),"UI_FONT_PATH_INVALID"),
            (json!({"fonts":[{"family":"Fixture","source":"fonts%2fregular.ttf"}]}),"UI_FONT_PATH_INVALID"),
            (json!({"fonts":[{"family":"","source":"fonts/regular.ttf"}]}),"UI_FONT_FAMILY_INVALID"),
            (json!({"font_source":"fonts/regular.ttf","font_family":"Fixture","fonts":[{"family":"Fixture","source":"fonts/bold.otf"}]}),"UI_FONT_DUPLICATE"),
        ] {
            fs::write(dir.path().join("player.presentation.json"), serde_json::to_vec(&json!({"ui":ui})).unwrap()).unwrap();
            assert!(append_presentation(dir.path(), &mut vec![]).err().unwrap().to_string().contains(code),"expected {code}");
        }
    }
    #[test]
    fn custom_renderer_packaging_is_explicit_safe_and_hashed_with_generation() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("host")).unwrap();
        fs::write(dir.path().join("host/render.mjs"), b"export const createRenderer = () => ({})").unwrap();
        let declaration = |files: Value| json!({"renderer_mode":"custom", "renderer_module":"host/render.mjs", "renderer_files":files});
        fs::write(dir.path().join("player.presentation.json"), serde_json::to_vec(&declaration(json!(["host/render.mjs"]))).unwrap()).unwrap();
        let mut files = vec![];
        let presentation = append_presentation(dir.path(), &mut files).unwrap();
        assert_eq!(presentation.renderer_mode, crate::hosts::RendererMode::Custom);
        assert!(files.iter().any(|(path, _)| path == "content/host/render.mjs"));
        let (root, _) = seal_web_generation(&mut files, "<head></head>").unwrap();
        assert!(files.iter().any(|(path, _)| path == &format!("{root}content/host/render.mjs")));
        for invalid in ["../secret", "C:/secret", "/secret", "host\\render.mjs", "host//render.mjs", "host/./render.mjs", "host/%2e%2e/render.mjs", "render.mjs?query", "render.mjs#fragment"] {
            fs::write(dir.path().join("player.presentation.json"), serde_json::to_vec(&declaration(json!(["host/render.mjs", invalid]))).unwrap()).unwrap();
            assert!(append_presentation(dir.path(), &mut vec![]).is_err(), "{invalid}");
        }
    }
    #[test]
    fn native_export_rejects_shader_declarations_instead_of_dropping_them() {
        let files = |scene: Value| vec![("content/project.json".to_string(), serde_json::to_vec(&json!({"scene":scene})).unwrap())];
        native_shader_gate(&files(json!({}))).unwrap();
        native_shader_gate(&files(json!({"shader_materials":{}}))).unwrap();
        let error = native_shader_gate(&files(json!({"shader_materials":{"glow":{}}}))).unwrap_err();
        assert!(error.to_string().contains("HOST_SHADER_UNSUPPORTED"));
    }
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
pub(crate) fn append_presentation(project:&Path, files:&mut Vec<(String,Vec<u8>)>)->Result<crate::hosts::PresentationSettings> {
    let presentation = crate::hosts::load_presentation(project)?.unwrap_or_default();
    presentation.validate_renderer()?;
    presentation.ui.validate_fonts()?;
    for path in &presentation.renderer_files {
        validate_renderer_file_path(path)?;
        push_unique_content_file(files, format!("content/{path}"), fs::read(inside(project, path)?)?)?;
    }
    for extension in &presentation.render_extensions {
        for path in std::iter::once(&extension.module).chain(&extension.files) {
            validate_renderer_file_path(path)?;
            push_unique_content_file(files, format!("content/{path}"), fs::read(inside(project, path)?)?)?;
        }
    }
    ensure!(presentation.job_policy.max_workers<=4 && presentation.job_policy.memory_budget_mb<=1024,"JOB_POLICY_INVALID: max_workers must be 0..4 and memory_budget_mb 0..1024");
    if let Some(path)=&presentation.ui.font_source {
        append_font(project, path, files)?;
    }
    for face in &presentation.ui.fonts {
        append_font(project, &face.source, files)?;
    }
    push_unique_content_file(files, "content/presentation.json".into(), serde_json::to_vec(&presentation)?)?;
    Ok(presentation)
}

fn append_font(project: &Path, path: &str, files: &mut Vec<(String, Vec<u8>)>) -> Result<()> {
    ensure!(!path.is_empty() && !path.contains(['\\', ':', '%', '?', '#']) && !path.chars().any(char::is_control)
        && !path.starts_with('/') && path.split('/').all(|part| !part.is_empty() && part != "." && part != ".."),
        "UI_FONT_PATH_INVALID: fonts must use safe project-relative forward-slash paths: {path}");
    let bytes = fs::read(inside(project, path)?)?;
    ensure!(!bytes.is_empty(), "UI_FONT_EMPTY: packaged font must not be empty: {path}");
    push_unique_content_file(files, format!("content/{path}"), bytes)
}

fn validate_renderer_file_path(path: &str) -> Result<()> {
    ensure!(!path.is_empty() && !path.contains(['\\', ':', '%', '?', '#']) && !path.chars().any(char::is_control)
        && !path.starts_with('/') && path.split('/').all(|part| !part.is_empty() && part != "." && part != ".."),
        "RENDERER_PATH_INVALID: custom renderer files must use safe project-relative forward-slash paths: {path}");
    Ok(())
}

/// Replaces the payload's entry source with production bytecode served beside
/// it, so the player neither parses source out of JSON nor compiles at load.
fn precompile_entry_script(files: &mut Vec<(String, Vec<u8>)>, manifest: &Value) -> Result<()> {
    let index = files.iter().position(|(path, _)| path == "content/project.json").context("content/project.json missing")?;
    let mut payload: Value = serde_json::from_slice(&files[index].1)?;
    let source = payload.as_object_mut().and_then(|p| p.remove("script")).context("ENTRY_SCRIPT_MISSING")?;
    let native_codegen = manifest["cargo_features"].as_array().is_some_and(|f| f.iter().any(|v| v == "native-codegen"));
    let compiled = unone_engine::compile_production_script(source.as_str().context("ENTRY_SCRIPT_MISSING")?, native_codegen)
        .map_err(|error| anyhow::anyhow!("SCRIPT_COMPILE_FAILED: {error}"))?;
    let decl = unone_engine::ScriptBytecodeDecl { source: "script.luaubc".into(), format: compiled.format, byte_length: compiled.bytes.len() };
    payload["script_bytecode"] = serde_json::to_value(&decl)?;
    let encoded = serde_json::to_vec(&payload)?;
    unone_engine::HostProject::parse(&encoded).map_err(|e| anyhow::anyhow!(e.explanation))?;
    files[index].1 = encoded;
    push_unique_content_file(files, format!("content/{}", decl.source), compiled.bytes)
}

/// Initial engine-owned custom shader API executes on the WebGL2 player only.
/// Native exports must report the gap instead of silently dropping the effect.
pub(crate) fn native_shader_gate(files: &[(String, Vec<u8>)]) -> Result<()> {
    let Some((_, bytes)) = files.iter().find(|(path, _)| path == "content/project.json") else { return Ok(()); };
    let payload: Value = serde_json::from_slice(bytes)?;
    ensure!(payload["scene"]["shader_materials"].as_object().is_none_or(|materials| materials.is_empty()),
        "HOST_SHADER_UNSUPPORTED: scene.shader_materials currently requires the official WebGL2 player; native wgpu custom shaders are not implemented. Export --target web or remove custom shader declarations");
    Ok(())
}

/// The browser loads a closed immutable generation, including transitive imports
/// and the JS/WASM pair. Legacy file aliases remain for CLI consumer compatibility.
fn seal_web_generation(files:&mut Vec<(String,Vec<u8>)>,index:&str)->Result<(String,String)> {
    ensure!(!index.contains("<base"),"PLAYER_BASE_CONFLICT: template must not supply a base element");
    let mut inventory=files.iter().map(|(p,b)|(p.clone(),digest(b))).collect::<Vec<_>>();
    inventory.sort();
    let identity=serde_json::to_vec(&(index,inventory))?;
    let root=format!("releases/{}/",digest(&identity));
    let copies=files.iter().map(|(p,b)|(format!("{root}{p}"),b.clone())).collect::<Vec<_>>();
    files.extend(copies);
    let index=replace_required(index.to_owned(),"<head>",&format!("<head><base href=\"{root}\">"))?;
    Ok((root,index))
}
fn push_unique_content_file(
    files: &mut Vec<(String, Vec<u8>)>,
    path: String,
    bytes: Vec<u8>,
) -> Result<()> {
    if let Some((_, existing)) = files.iter().find(|(existing_path, _)| existing_path == &path) {
        ensure!(
            existing == &bytes,
            "PLAYER_CONTENT_CONFLICT: {path} is referenced with different bytes"
        );
        return Ok(());
    }
    files.push((path, bytes));
    Ok(())
}

#[cfg(test)]
mod content_file_tests {
    use super::push_unique_content_file;

    #[test]
    fn identical_references_are_deduplicated() {
        let mut files = Vec::new();
        push_unique_content_file(&mut files, "content/shared.png".into(), vec![1, 2, 3]).unwrap();
        push_unique_content_file(&mut files, "content/shared.png".into(), vec![1, 2, 3]).unwrap();
        assert_eq!(files.len(), 1);
    }

    #[test]
    fn conflicting_references_are_rejected() {
        let mut files = Vec::new();
        push_unique_content_file(&mut files, "content/shared.png".into(), vec![1, 2, 3]).unwrap();
        let error = push_unique_content_file(&mut files, "content/shared.png".into(), vec![9]);
        assert!(error.is_err());
        assert_eq!(files.len(), 1);
    }
}

type ExportContent = (unone_engine::ProjectConfig, unone_engine::SystemSettings, Value, Vec<(String, Vec<u8>)>);

pub(crate) fn content(project:&Path)->Result<ExportContent>{
    // Imported assets' files are produced before any export reads them.
    unone_engine::prepare_imports(project).map_err(|e| anyhow::anyhow!("{}: {}", e.code, e.explanation))?;
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
    let mut payload = json!({"job_sources":job_sources,"config":config,"script":fs::read_to_string(inside(project,&config.entry_script)?)?,"scene":scene});
    // Data assets travel as content files; the payload only declares them.
    let mut asset_catalog = Vec::new();
    let data_assets: Vec<unone_engine::DataAssetDecl> = match &config.asset_manifest {
        Some(path) => {
            let manifest: unone_engine::AssetManifest = serde_json::from_slice(&fs::read(inside(project, path)?)?)?;
            // Only textures can back sprite resources.
            asset_catalog = manifest.assets.iter().filter(|asset| asset.kind == "texture2d")
                .map(|asset| json!({"id":asset.id,"kind":asset.kind})).collect();
            manifest.assets.iter().filter(|asset| asset.kind == "data").map(unone_engine::data_asset_decl).collect()
        },
        None => Vec::new(),
    };
    let data = data_assets.iter()
        .map(|asset| Ok((asset.id.clone(), fs::read(inside(project, &asset.source)?)?)))
        .collect::<Result<std::collections::BTreeMap<_, _>>>()?;
    if !data_assets.is_empty() {
        payload["data_assets"] = serde_json::to_value(&data_assets)?;
    }
    if !asset_catalog.is_empty() {
        payload["asset_catalog"] = serde_json::to_value(&asset_catalog)?;
    }
    // Exercise the exact player ingestion contract before creating any output.
    unone_engine::HostProject::parse(&serde_json::to_vec(&payload)?)
        .map_err(|e| anyhow::anyhow!(e.explanation))?
        .into_runtime_with_data(42, data)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    // Players derive the catalog from content/assets.json, which they load
    // anyway; shipping a second copy would grow project.json by the manifest.
    if let Some(payload) = payload.as_object_mut() { payload.remove("asset_catalog"); }
    let assets = if let Some(path) = &config.asset_manifest {
        let assets: unone_engine::AssetManifest =
            serde_json::from_slice(&fs::read(inside(project, path)?)?)?;
        ensure!(assets.version == 1, "unsupported asset manifest version");
        for asset in &assets.assets {
            if !["texture2d", "audio", "mesh3d", "effekseer", "data"].contains(&asset.kind.as_str()) {
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
                push_unique_content_file(
                    &mut files,
                    format!("content/{path}"),
                    fs::read(inside(project, path)?)?,
                )?;
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
    push_unique_content_file(
        &mut files,
        "content/project.json".into(),
        serde_json::to_vec(&payload)?,
    )?;
    push_unique_content_file(
        &mut files,
        "content/assets.json".into(),
        serde_json::to_vec(&assets)?,
    )?;
    Ok((config,settings,assets,files))
}
