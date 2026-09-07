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

pub fn web(project: &Path, output: &Path, runtime: Option<&Path>) -> Result<Value> {
    ensure!(
        !output.exists(),
        "output already exists: {}",
        output.display()
    );
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let runtime = runtime
        .map(Path::to_path_buf)
        .unwrap_or_else(|| repo.join("artifacts/player-runtime"));
    let manifest: Value = serde_json::from_slice(&fs::read(runtime.join("runtime.json"))?)?;
    ensure!(
        manifest["profile"] == "release" && manifest["dev_tools"] == false,
        "requires release player without dev-tools"
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
        }
        files.push((format!("runtime/{name}"), bytes));
    }
    let (config, _) = unone_engine::ProjectPaths::discover(project)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    let scene: Value = if let Some(path) = &config.main_scene {
        serde_json::from_slice(&fs::read(inside(project, path)?)?)?
    } else {
        Value::Null
    };
    let payload = json!({"project":config.name,"script":fs::read_to_string(inside(project,&config.entry_script)?)?,"scene":scene,"systems":config.systems,"audio":config.audio});
    // Exercise the exact player ingestion contract before creating any output.
    unone_engine::HostProject::parse(&serde_json::to_vec(&payload)?)
        .map_err(|e| anyhow::anyhow!(e.explanation))?
        .into_runtime(42)
        .map_err(|e| anyhow::anyhow!(e.explanation))?;
    for entity in scene["entities"].as_array().into_iter().flatten() {
        if let Some(mesh) = entity["mesh3d"]["asset"].as_str() {
            ensure!(
                ["mesh://primitive/box", "mesh://primitive/sphere"].contains(&mesh),
                "PLAYER_DECODER_UNAVAILABLE: mesh {mesh}; convert to a supported renderer asset before exporting"
            );
        }
    }
    let assets = if let Some(path) = &config.asset_manifest {
        let assets: unone_engine::AssetManifest =
            serde_json::from_slice(&fs::read(inside(project, path)?)?)?;
        ensure!(assets.version == 1, "unsupported asset manifest version");
        for asset in &assets.assets {
            if !["texture2d", "audio"].contains(&asset.kind.as_str()) {
                bail!("PLAYER_DECODER_UNAVAILABLE: {} ({})", asset.id, asset.kind);
            }
            for path in std::iter::once(&asset.source).chain(&asset.files) {
                files.push((format!("content/{path}"), fs::read(inside(project, path)?)?));
            }
        }
        serde_json::to_value(assets)?
    } else {
        json!({"version":1,"assets":[]})
    };
    files.push(("content/project.json".into(), serde_json::to_vec(&payload)?));
    files.push(("content/assets.json".into(), serde_json::to_vec(&assets)?));
    files.push((
        "runtime/runtime.json".into(),
        serde_json::to_vec(&manifest)?,
    ));
    for path in [
        "player/main.js",
        "renderer/three.js",
        "renderer/particles.js",
        "shared/ui-tree.js",
        "shared/host-input.js",
        "shared/webgpu-snapshot.js",
        "shared/audio-playback.js",
        "shared/asset-encoding.js",
        "shared/fixed-step-scheduler.mjs",
        "vendor/three/three.module.js",
        "vendor/three/three.core.js",
    ] {
        files.push((
            format!("web/{path}"),
            fs::read(repo.join("web").join(path))?,
        ));
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
    let report = json!({"version":1,"project":config.name,"profile":"release","dev_tools":false,"renderer":"three-webgl","total_bytes":files.iter().map(|f|f.1.len()).sum::<usize>(),"files":files.iter().map(|(p,b)|json!({"path":p,"bytes":b.len(),"sha256":digest(b)})).collect::<Vec<_>>()});
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
    fn rejects_parent_paths_and_existing_output() {
        let dir = tempfile::tempdir().unwrap();
        assert!(inside(dir.path(), "../secret").is_err());
        assert!(
            web(dir.path(), dir.path(), None)
                .unwrap_err()
                .to_string()
                .contains("already exists")
        );
    }
}
