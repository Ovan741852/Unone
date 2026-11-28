//! An optional native delivery view of a completed player export. The original loose files
//! stay available to the Web player and clients that do not implement the bundle protocol.
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use sha2::{Digest, Sha256};
use unone_engine::{BundleManifest, BundleSpec, build_bundle_archive};

const TARGET_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
struct Delivery {
    manifest: BundleManifest,
    paths: BTreeMap<String, String>,
    startup: Vec<String>,
}

fn files(dir: &Path, relative: &str, output: &mut BTreeMap<String, PathBuf>) -> Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("Non-UTF-8 export path"))?;
        ensure!(
            !name.contains('\\') && !name.chars().any(char::is_control),
            "Invalid export filename: {name:?}"
        );
        let name = format!("{relative}/{name}");
        let kind = entry.file_type()?;
        if kind.is_dir() {
            files(&entry.path(), &name, output)?;
        } else if kind.is_file() {
            output.insert(name, entry.path());
        } else {
            bail!("Expected a regular exported file or directory: {name}");
        }
    }
    Ok(())
}

fn category(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "ttf" | "otf" | "woff" | "woff2" => "fonts",
        "wav" | "mp3" | "ogg" | "m4a" | "aac" | "flac" | "opus" => "audio",
        "png" | "jpg" | "jpeg" | "webp" | "svg" | "bmp" | "ktx2" | "basis" | "glb" | "gltf" => {
            "art"
        }
        _ => "bootstrap",
    }
}

fn archive(
    root: &Path,
    group: &str,
    part: usize,
    entries: Vec<(String, Vec<u8>)>,
    out: &mut Delivery,
) -> Result<()> {
    let id = if part == 0 {
        group.to_owned()
    } else {
        format!("{group}-{}", part + 1)
    };
    for (path, _) in &entries {
        out.paths.insert(path.clone(), id.clone());
    }
    let bytes = build_bundle_archive(entries).map_err(anyhow::Error::msg)?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let name = format!("{sha256}.bundle");
    let mut temp = tempfile::NamedTempFile::new_in(root)?;
    temp.write_all(&bytes)?;
    temp.persist(root.join(&name))?;
    out.manifest.bundles.push(BundleSpec {
        id,
        version: sha256.clone(),
        source: format!("unone-bundles/{name}"),
        sha256,
        size_bytes: bytes.len() as u64,
        dependencies: Vec::new(),
    });
    Ok(())
}

pub fn export(package: &Path, requested_startup: &[String]) -> Result<serde_json::Value> {
    let content = package.join("content");
    ensure!(
        fs::symlink_metadata(&content)?.is_dir(),
        "Expected exported content directory"
    );
    let mut content_files = BTreeMap::new();
    files(&content, "content", &mut content_files)?;
    ensure!(
        content_files.contains_key("content/project.json"),
        "Missing content/project.json"
    );
    let mut startup: BTreeSet<_> = requested_startup.iter().cloned().collect();
    for name in &startup {
        ensure!(
            content_files.contains_key(name),
            "Startup file is absent from this export: {name}"
        );
    }
    let mut groups: BTreeMap<&str, Vec<_>> = BTreeMap::new();
    for (name, path) in content_files {
        let class = category(&path);
        if class == "bootstrap" || class == "fonts" {
            startup.insert(name.clone());
        }
        let group = match (class, startup.contains(&name)) {
            ("art", true) => "startup-art",
            ("audio", true) => "startup-audio",
            _ => class,
        };
        groups.entry(group).or_default().push((name, path));
    }
    let root = package.join("unone-bundles");
    fs::create_dir_all(&root)?;
    ensure!(
        fs::symlink_metadata(&root)?.is_dir(),
        "Expected regular unone-bundles directory"
    );
    let mut delivery = Delivery {
        manifest: BundleManifest {
            version: 1,
            bundles: Vec::new(),
        },
        paths: BTreeMap::new(),
        startup: startup.into_iter().collect(),
    };
    for (group, members) in groups {
        let (mut part, mut size, mut entries) = (0, 0, Vec::new());
        for (name, path) in members {
            let bytes = fs::read(&path).with_context(|| format!("Reading {name}"))?;
            let len = bytes.len() as u64;
            if !entries.is_empty() && size + len > TARGET_BYTES {
                archive(
                    &root,
                    group,
                    part,
                    std::mem::take(&mut entries),
                    &mut delivery,
                )?;
                part += 1;
                size = 0;
            }
            size += len;
            entries.push((name, bytes));
        }
        archive(&root, group, part, entries, &mut delivery)?;
    }
    // Commit the manifest last. Every archive referenced by either generation is immutable.
    let mut manifest = tempfile::NamedTempFile::new_in(&root)?;
    serde_json::to_writer_pretty(&mut manifest, &delivery)?;
    manifest.write_all(b"\n")?;
    manifest.persist(root.join("manifest.json"))?;
    Ok(
        serde_json::json!({"manifest":root.join("manifest.json"),"files":delivery.paths.len(),
                          "bundles":delivery.manifest.bundles.len(),"startup":delivery.startup.len()}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_covers_exactly_content_and_can_reuse_unchanged_groups() {
        let package = tempfile::tempdir().unwrap();
        let root = package.path();
        fs::create_dir(root.join("content")).unwrap();
        fs::write(root.join("outside.js"), "web").unwrap();
        for name in [
            "project.json",
            "menu.png",
            "arena.png",
            "score.ogg",
            "ui.ttf",
        ] {
            fs::write(root.join("content").join(name), name).unwrap();
        }
        let startup = vec!["content/menu.png".to_owned()];
        let manifest = root.join("unone-bundles/manifest.json");
        let read =
            || serde_json::from_slice::<serde_json::Value>(&fs::read(&manifest).unwrap()).unwrap();
        export(root, &startup).unwrap();
        let initial = read();
        assert_eq!(initial["paths"].as_object().unwrap().len(), 5);
        assert_eq!(initial["paths"]["content/menu.png"], "startup-art");
        assert_eq!(initial["paths"]["content/arena.png"], "art");
        assert_eq!(
            initial["startup"],
            serde_json::json!(["content/menu.png", "content/project.json", "content/ui.ttf"])
        );
        for spec in initial["manifest"]["bundles"].as_array().unwrap() {
            let path = root.join(spec["source"].as_str().unwrap());
            let bytes = fs::read(path).unwrap();
            assert_eq!(spec["size_bytes"], bytes.len());
            assert_eq!(
                spec["sha256"].as_str().unwrap(),
                format!("{:x}", Sha256::digest(bytes))
            );
        }
        export(root, &startup).unwrap();
        assert_eq!(initial, read());
        fs::write(root.join("content/arena.png"), "revised arena").unwrap();
        export(root, &startup).unwrap();
        let revised = read();
        for (before, after) in initial["manifest"]["bundles"]
            .as_array()
            .unwrap()
            .iter()
            .zip(revised["manifest"]["bundles"].as_array().unwrap())
        {
            assert_eq!(before == after, before["id"] != "art");
        }
        assert!(export(root, &["content/missing.png".into()]).is_err());
        assert_eq!(revised, read());
    }
}
