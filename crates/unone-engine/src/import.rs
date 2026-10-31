//! Import preparation: before a host reads or packs a project's assets, every
//! asset that declares `import` gets its file produced by the named importer
//! from read-only sources. Importers are project Luau modules (registered in
//! project.unone.json `import.importers`), so a game adds source formats
//! without engine changes; the engine owns file access, typing, caching,
//! encoding products into engine formats and provenance. Results are cached by
//! everything that determines them, so an unchanged project costs only hashing.
//! See docs/import-pipeline.md.
use crate::{AssetSpec, Diagnostic, ImportPortType, ImportValue, ProjectConfig};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};

const CACHE_DIR: &str = ".unone/import-cache";
/// Machine-local import root paths: {"<root>": "<directory>"}; never committed.
pub const LOCAL_ROOTS_FILE: &str = ".unone/import-roots.json";
pub const PROVENANCE_FILE: &str = ".unone/import-provenance.json";

#[derive(Debug, Default, Serialize)]
pub struct ImportReport {
    pub imports: usize,
    pub ran: usize,
    pub cached: usize,
    pub written: usize,
    pub unchanged: usize,
    /// Assets kept as they are because a root they read is not on this machine.
    pub unverified: Vec<String>,
}

fn error(code: &str, message: impl Into<String>) -> Box<Diagnostic> {
    Box::new(Diagnostic::error(code, "Asset import failed", message.into()))
}
fn sha256(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

/// A relative path that stays inside its root.
fn contained(root: &Path, relative: &str) -> Result<PathBuf, Box<Diagnostic>> {
    let path = Path::new(relative);
    if relative.is_empty() || path.is_absolute() || path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(error("IMPORT_PATH_INVALID", format!("'{relative}' must be a relative path without '..'")));
    }
    Ok(root.join(path))
}

fn value_hash(value: &ImportValue) -> String {
    let mut hasher = Sha256::new();
    match value {
        ImportValue::Bytes(bytes) => { hasher.update(b"bytes\0"); hasher.update(bytes); }
        ImportValue::Image { width, height, rgba } => {
            hasher.update(b"image\0"); hasher.update(width.to_le_bytes()); hasher.update(height.to_le_bytes()); hasher.update(rgba);
        }
        ImportValue::Json(value) => { hasher.update(b"json\0"); hasher.update(value.to_string().as_bytes()); }
    }
    format!("{:x}", hasher.finalize())
}

/// Products become files in engine formats: images as RGBA PNG, JSON as JSON
/// text, bytes as they are.
fn encode(value: &ImportValue) -> Result<Vec<u8>, Box<Diagnostic>> {
    match value {
        ImportValue::Bytes(bytes) => Ok(bytes.clone()),
        ImportValue::Json(value) => serde_json::to_vec_pretty(value).map_err(|e| error("IMPORT_ENCODE_FAILED", e.to_string())),
        ImportValue::Image { width, height, rgba } => {
            let mut bytes = Vec::new();
            let mut encoder = png::Encoder::new(&mut bytes, *width, *height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::High);
            encoder.write_header().and_then(|mut writer| writer.write_image_data(rgba))
                .map_err(|e| error("IMPORT_ENCODE_FAILED", e.to_string()))?;
            Ok(bytes)
        }
    }
}

// The cache keeps each product's data beside a description of its type.
fn cache_store(dir: &Path, outputs: &BTreeMap<String, ImportValue>) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut meta = serde_json::Map::new();
    for (port, value) in outputs {
        let (kind, data) = match value {
            ImportValue::Bytes(bytes) => (json!({"type": "bytes"}), bytes.clone()),
            ImportValue::Image { width, height, rgba } => (json!({"type": "image", "width": width, "height": height}), rgba.clone()),
            ImportValue::Json(value) => (json!({"type": "json"}), value.to_string().into_bytes()),
        };
        std::fs::write(dir.join(format!("{port}.bin")), data)?;
        meta.insert(port.clone(), kind);
    }
    std::fs::write(dir.join("meta.json"), Value::Object(meta).to_string())
}
fn cache_load(dir: &Path) -> Option<BTreeMap<String, ImportValue>> {
    let meta: BTreeMap<String, Value> = serde_json::from_slice(&std::fs::read(dir.join("meta.json")).ok()?).ok()?;
    let mut outputs = BTreeMap::new();
    for (port, kind) in meta {
        let data = std::fs::read(dir.join(format!("{port}.bin"))).ok()?;
        outputs.insert(port, match kind["type"].as_str()? {
            "bytes" => ImportValue::Bytes(data),
            "image" => ImportValue::Image { width: kind["width"].as_u64()? as u32, height: kind["height"].as_u64()? as u32, rgba: data },
            "json" => ImportValue::Json(serde_json::from_slice(&data).ok()?),
            _ => return None,
        });
    }
    Some(outputs)
}

/// `${NAME}` expands an environment variable; an unset one leaves no match.
fn expand(text: &str) -> Option<String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        let end = rest[start..].find('}')? + start;
        out.push_str(&rest[..start]);
        out.push_str(&std::env::var(&rest[start + 2..end]).ok()?);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// Where each declared root is on this machine: the local file, then the
/// UNONE_IMPORT_ROOT_<NAME> variable, then the first existing candidate.
fn resolve_roots(project: &Path, config: &crate::ImportConfig) -> BTreeMap<String, Option<PathBuf>> {
    let local: BTreeMap<String, String> = std::fs::read(project.join(LOCAL_ROOTS_FILE)).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    config.roots.iter().map(|(name, root)| {
        let variable = format!("UNONE_IMPORT_ROOT_{}", name.to_ascii_uppercase().replace('-', "_"));
        let found = local.get(name).cloned().or_else(|| std::env::var(variable).ok()).into_iter()
            .chain(root.candidates.iter().filter_map(|c| expand(c)))
            .map(PathBuf::from).find(|path| path.is_dir());
        (name.clone(), found)
    }).collect()
}

enum Input<'a> { Root { root: &'a str, path: &'a str }, Asset(&'a str) }
fn parse_input(text: &str) -> Result<Input<'_>, Box<Diagnostic>> {
    if let Some(id) = text.strip_prefix("asset:") { return Ok(Input::Asset(id)); }
    let (root, path) = text.split_once(':').filter(|(r, p)| !r.is_empty() && !p.is_empty())
        .ok_or_else(|| error("IMPORT_INPUT_INVALID", format!("'{text}' must be <root>:<path> or asset:<id>")))?;
    Ok(Input::Root { root, path })
}

struct Importer { module: String, module_sha256: String, source: String, node: String, definition: crate::ImportNodeDefinition }

/// Brings every imported asset's file up to date. Projects without imports
/// return at once; a project or manifest that cannot be read is left to the
/// host's own loading, which reports it.
pub fn prepare_imports(project_root: &Path) -> Result<ImportReport, Box<Diagnostic>> {
    let Ok((config, paths)) = crate::ProjectPaths::discover(project_root) else { return Ok(ImportReport::default()) };
    let config: ProjectConfig = config;
    if paths.asset_manifest.is_none() { return Ok(ImportReport::default()); }
    let Ok(manifest) = crate::asset::load_declared_manifest(&paths) else { return Ok(ImportReport::default()) };
    let imported: Vec<&AssetSpec> = manifest.assets.iter().filter(|a| a.import.is_some()).collect();
    let mut report = ImportReport { imports: imported.len(), ..ImportReport::default() };
    if imported.is_empty() { return Ok(report); }
    let root = paths.root.clone();
    let import_config = config.import.clone().unwrap_or_default();
    let mut importers = BTreeMap::new();
    for (name, spec) in &import_config.importers {
        let source = std::fs::read_to_string(contained(&root, &spec.module)?)
            .map_err(|e| error("IMPORTER_MODULE_MISSING", format!("{}: {e}", spec.module)))?;
        let definition = crate::describe_import_nodes(&spec.module, &source).map_err(|e| error("IMPORTER_INVALID", e))?
            .into_iter().find(|n| n.name == spec.node)
            .ok_or_else(|| error("IMPORTER_NODE_MISSING", format!("{} has no node '{}'", spec.module, spec.node)))?;
        importers.insert(name.clone(), Importer { module: spec.module.clone(), module_sha256: sha256(source.as_bytes()), source, node: spec.node.clone(), definition });
    }
    let by_id: BTreeMap<&str, &AssetSpec> = manifest.assets.iter().map(|a| (a.id.as_str(), a)).collect();
    // Wiring: every importer input connected with a matching type.
    let mut dependencies: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for asset in &imported {
        let import = asset.import.as_ref().expect("filtered");
        let deps = dependencies.entry(asset.id.as_str()).or_default();
        if let Some(from) = &import.from {
            if import.importer.is_some() || import.product.is_some() || !import.inputs.is_empty() || !import.params.is_null() {
                return Err(error("IMPORT_DECLARATION_INVALID", format!("asset '{}' copies `from` one file, so it takes no importer, inputs, params or product", asset.id)));
            }
            match parse_input(from)? {
                Input::Root { root: name, .. } if !import_config.roots.contains_key(name) =>
                    return Err(error("IMPORT_ROOT_UNDECLARED", format!("'{}' reads root '{name}'", asset.id))),
                Input::Root { .. } => continue,
                Input::Asset(_) => return Err(error("IMPORT_INPUT_INVALID", format!("asset '{}' `from` must name a file under an import root: <root>:<path>", asset.id))),
            }
        }
        let (Some(importer_name), Some(product_name)) = (&import.importer, &import.product) else {
            return Err(error("IMPORT_DECLARATION_INVALID", format!("asset '{}' import needs `from` (copy one file) or `importer` with `product`", asset.id)));
        };
        let importer = importers.get(importer_name)
            .ok_or_else(|| error("IMPORTER_UNKNOWN", format!("asset '{}' uses unregistered importer '{importer_name}'", asset.id)))?;
        let product = importer.definition.outputs.get(product_name)
            .ok_or_else(|| error("IMPORT_PRODUCT_UNKNOWN", format!("'{importer_name}' produces no '{product_name}'")))?;
        if *product == ImportPortType::Image && asset.kind != "texture2d" {
            return Err(error("IMPORT_PRODUCT_KIND", format!("asset '{}' holds an image product, so its kind must be texture2d", asset.id)));
        }
        for (port, kind) in &importer.definition.inputs {
            let text = import.inputs.get(port).ok_or_else(|| error("IMPORT_INPUT_MISSING", format!("asset '{}' needs input '{port}'", asset.id)))?;
            let given = match parse_input(text)? {
                Input::Root { root: name, .. } => {
                    if !import_config.roots.contains_key(name) { return Err(error("IMPORT_ROOT_UNDECLARED", format!("'{}' reads root '{name}'", asset.id))); }
                    ImportPortType::Bytes
                }
                Input::Asset(id) => {
                    let target = by_id.get(id).ok_or_else(|| error("IMPORT_INPUT_INVALID", format!("'{}' reads unknown asset '{id}'", asset.id)))?;
                    if let Some(other) = &target.import {
                        deps.insert(target.id.as_str());
                        other.importer.as_ref().and_then(|name| importers.get(name))
                            .zip(other.product.as_ref()).and_then(|(i, product)| i.definition.outputs.get(product))
                            .copied().unwrap_or(ImportPortType::Bytes)
                    } else { ImportPortType::Bytes }
                }
            };
            if given != *kind { return Err(error("IMPORT_TYPE_MISMATCH", format!("'{}' input '{port}' needs {kind:?}, gets {given:?}", asset.id))); }
        }
        if let Some(extra) = import.inputs.keys().find(|port| !importer.definition.inputs.contains_key(*port)) {
            return Err(error("IMPORT_INPUT_INVALID", format!("'{}' importer '{importer_name}' has no input '{extra}'", asset.id)));
        }
    }
    let mut order = Vec::new();
    let mut done = BTreeSet::new();
    while order.len() < dependencies.len() {
        let ready: Vec<&str> = dependencies.iter().filter(|(id, deps)| !done.contains(*id) && deps.iter().all(|d| done.contains(d))).map(|(id, _)| *id).collect();
        if ready.is_empty() { return Err(error("IMPORT_CYCLE", "imported assets read each other's products in a cycle")); }
        for id in ready { done.insert(id); order.push(id); }
    }
    let roots = resolve_roots(&root, &import_config);
    let mut reads: BTreeMap<String, (Vec<u8>, String)> = BTreeMap::new();
    let mut runs: BTreeMap<String, BTreeMap<String, ImportValue>> = BTreeMap::new();
    let mut products: BTreeMap<&str, Option<ImportValue>> = BTreeMap::new();
    let mut provenance = BTreeMap::new();
    // A root file, read once however many imports use it; None when its root
    // is not on this machine.
    let mut read_root = |name: &str, path: &str| -> Result<Option<(Vec<u8>, Value)>, Box<Diagnostic>> {
        let Some(dir) = roots[name].as_ref() else { return Ok(None) };
        let key = format!("{name}:{path}");
        if !reads.contains_key(&key) {
            let bytes = std::fs::read(contained(dir, path)?).map_err(|e| error("IMPORT_SOURCE_READ", format!("{key}: {e}")))?;
            let digest = sha256(&bytes);reads.insert(key.clone(), (bytes, digest));
        }
        let (bytes, digest) = &reads[&key];
        Ok(Some((bytes.clone(), json!({"root": name, "path": path, "sha256": digest, "bytes": bytes.len()}))))
    };
    let write_file = |artifact: &Path, bytes: &[u8], report: &mut ImportReport| -> Result<(), Box<Diagnostic>> {
        if std::fs::read(artifact).ok().as_deref() == Some(bytes) { report.unchanged += 1; return Ok(()) }
        if let Some(parent) = artifact.parent() { std::fs::create_dir_all(parent).map_err(|e| error("IMPORT_WRITE_FAILED", e.to_string()))?; }
        std::fs::write(artifact, bytes).map_err(|e| error("IMPORT_WRITE_FAILED", format!("{}: {e}", artifact.display())))?;
        report.written += 1;
        Ok(())
    };
    for id in order {
        let asset = by_id[id];
        let import = asset.import.as_ref().expect("filtered");
        let artifact = contained(&root, &asset.source)?;
        if let Some(from) = &import.from {
            let Input::Root { root: name, path } = parse_input(from)? else { unreachable!("checked while wiring") };
            let Some((bytes, record)) = read_root(name, path)? else {
                if !artifact.is_file() {
                    return Err(error("IMPORT_ROOT_UNAVAILABLE", format!("asset '{id}' needs {name}; name the directory in {LOCAL_ROOTS_FILE} or UNONE_IMPORT_ROOT_<NAME>")));
                }
                report.unverified.push(id.to_string());products.insert(id, None);continue;
            };
            write_file(&artifact, &bytes, &mut report)?;
            provenance.insert(id.to_string(), json!({"source": asset.source, "sha256": sha256(&bytes), "from": record}));
            products.insert(id, Some(ImportValue::Bytes(bytes)));
            continue;
        }
        let importer = &importers[import.importer.as_ref().expect("checked while wiring")];
        let product = import.product.as_ref().expect("checked while wiring");
        let (mut inputs, mut records, mut missing) = (BTreeMap::new(), BTreeMap::new(), None);
        for (port, text) in &import.inputs {
            match parse_input(text)? {
                Input::Root { root: name, path } => {
                    let Some((bytes, record)) = read_root(name, path)? else { missing = Some(name.to_string()); continue };
                    records.insert(port.clone(), record);
                    inputs.insert(port.clone(), ImportValue::Bytes(bytes));
                }
                Input::Asset(other) => {
                    let value = match products.get(other) {
                        Some(Some(value)) => value.clone(),
                        Some(None) => { missing = Some(format!("asset:{other}")); continue }
                        None => ImportValue::Bytes(std::fs::read(contained(&root, &by_id[other].source)?)
                            .map_err(|e| error("IMPORT_SOURCE_READ", format!("asset:{other}: {e}")))?),
                    };
                    records.insert(port.clone(), json!({"asset": other, "sha256": value_hash(&value)}));
                    inputs.insert(port.clone(), value);
                }
            }
        }
        if let Some(missing) = missing {
            // Without its sources the file cannot be checked, only kept.
            if !artifact.is_file() {
                return Err(error("IMPORT_ROOT_UNAVAILABLE", format!("asset '{id}' needs {missing}; name the directory in {LOCAL_ROOTS_FILE} or UNONE_IMPORT_ROOT_<NAME>")));
            }
            report.unverified.push(id.to_string());products.insert(id, None);continue;
        }
        let key = sha256(json!({"module_sha256": importer.module_sha256, "node": importer.node, "params": import.params,
            "inputs": inputs.iter().map(|(p, v)| (p.clone(), value_hash(v))).collect::<BTreeMap<_, _>>()}).to_string().as_bytes());
        if !runs.contains_key(&key) {
            let cache = root.join(CACHE_DIR).join(&key);
            let outputs = match cache_load(&cache) {
                Some(outputs) => { report.cached += 1; outputs }
                None => {
                    let outputs = crate::run_import_node(&importer.module, &importer.source, &importer.node, &inputs, &import.params)
                        .map_err(|e| error("IMPORT_NODE_FAILED", e))?;
                    cache_store(&cache, &outputs).map_err(|e| error("IMPORT_CACHE_FAILED", e.to_string()))?;
                    report.ran += 1;
                    outputs
                }
            };
            runs.insert(key.clone(), outputs);
        }
        let value = runs[&key][product].clone();
        let bytes = encode(&value)?;
        write_file(&artifact, &bytes, &mut report)?;
        provenance.insert(id.to_string(), json!({"source": asset.source, "sha256": sha256(&bytes), "importer": import.importer,
            "module": importer.module, "module_sha256": importer.module_sha256, "node": importer.node, "product": product,
            "params": import.params, "inputs": records, "run": key}));
        products.insert(id, Some(value));
    }
    let text = serde_json::to_string_pretty(&json!({"version": 1, "engine": env!("CARGO_PKG_VERSION"), "assets": provenance}))
        .map_err(|e| error("IMPORT_WRITE_FAILED", e.to_string()))? + "\n";
    let path = root.join(PROVENANCE_FILE);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
        if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
        std::fs::write(&path, text).map_err(|e| error("IMPORT_WRITE_FAILED", e.to_string()))?;
    }
    Ok(report)
}
