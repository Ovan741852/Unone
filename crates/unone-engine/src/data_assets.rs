//! Data assets: manifest entries of kind "data" that game Luau reads through
//! `api.assets.load`. The host delivers each declared asset's bytes before
//! Game.start; the runtime decodes them lazily with the loader the manifest
//! names (built-in "bytes", "text", "json", or one a game registers).
use crate::Diagnostic;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// Loaders the engine provides. Games add others with `api.assets.registerLoader`.
pub const BUILTIN_DATA_LOADERS: &[&str] = &["bytes", "text", "json"];

/// One data asset a project declares: where the host finds its bytes and which
/// loader turns them into a Luau value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct DataAssetDecl {
    pub id: String,
    /// Project-relative path; exports serve it under `content/`.
    pub source: String,
    /// The manifest's `encoding.decoder`, or "bytes" without an encoding.
    pub loader: String,
}

/// Declared data assets and the bytes the host delivered for them.
#[derive(Debug, Default)]
pub(crate) struct DataAssets {
    decls: BTreeMap<String, DataAssetDecl>,
    bytes: HashMap<String, Vec<u8>>,
}

impl DataAssets {
    /// Every declaration needs bytes and every delivery a declaration, so a
    /// host that forgets an asset fails at load instead of mid-game.
    pub(crate) fn new(
        decls: Vec<DataAssetDecl>,
        mut delivered: BTreeMap<String, Vec<u8>>,
    ) -> Result<Self, Box<Diagnostic>> {
        let mut assets = Self::default();
        for decl in decls {
            if !valid_loader_name(&decl.loader) {
                return Err(error(
                    "ASSET_LOADER_INVALID",
                    format!("Data asset '{}' names loader '{}'; use 1-64 characters of a-z, 0-9, '.', '_' or '-'.", decl.id, decl.loader),
                ));
            }
            let Some(bytes) = delivered.remove(&decl.id) else {
                return Err(error(
                    "ASSET_DATA_MISSING",
                    format!("Data asset '{}' ({}) is declared but the host delivered no bytes for it.", decl.id, decl.source),
                ));
            };
            assets.bytes.insert(decl.id.clone(), bytes);
            if let Some(previous) = assets.decls.insert(decl.id.clone(), decl) {
                return Err(error("ASSET_MANIFEST_DUPLICATE_ID", format!("Data asset '{}' is declared twice.", previous.id)));
            }
        }
        if let Some(id) = delivered.keys().next() {
            return Err(error(
                "ASSET_DATA_UNDECLARED",
                format!("The host delivered bytes for '{id}', which is not a declared data asset."),
            ));
        }
        Ok(assets)
    }

    pub(crate) fn decl(&self, id: &str) -> Option<&DataAssetDecl> {
        self.decls.get(id)
    }

    pub(crate) fn decls(&self) -> impl Iterator<Item = &DataAssetDecl> {
        self.decls.values()
    }

    /// The bytes for a first decode. Shipped players hand them over and keep
    /// nothing, so a decoded asset is held once; development builds keep a
    /// copy so a hot-reloaded VM or a replaced loader can decode again.
    pub(crate) fn take(&mut self, id: &str) -> Option<Vec<u8>> {
        if cfg!(feature = "preview-tools") {
            self.bytes.get(id).cloned()
        } else {
            self.bytes.remove(id)
        }
    }
}

pub(crate) fn valid_loader_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-'))
}

fn error(code: &str, explanation: String) -> Box<Diagnostic> {
    Box::new(Diagnostic::error(code, "Invalid data asset", explanation))
}

/// Declarations and bytes for a project on disk, read from its asset manifest.
#[cfg(feature = "dev-tools")]
pub(crate) fn read_from_project(
    paths: &crate::project::ProjectPaths,
) -> Result<(Vec<DataAssetDecl>, BTreeMap<String, Vec<u8>>), Box<Diagnostic>> {
    if paths.asset_manifest.is_none() {
        return Ok(Default::default());
    }
    let manifest = crate::asset::load_declared_manifest(paths)?;
    let mut decls = Vec::new();
    let mut bytes = BTreeMap::new();
    for asset in manifest.assets.iter().filter(|asset| asset.kind == "data") {
        let decl = decl_for(asset);
        let path = crate::project::resolve_project_path(&paths.root, &asset.source)?;
        let data = std::fs::read(&path).map_err(|e| {
            error("ASSET_DATA_READ_FAILED", format!("Data asset '{}': {}: {e}", asset.id, path.display()))
        })?;
        bytes.insert(asset.id.clone(), data);
        decls.push(decl);
    }
    Ok((decls, bytes))
}

/// The declaration a manifest entry of kind "data" produces.
#[cfg(feature = "dev-tools")]
pub fn decl_for(asset: &crate::AssetSpec) -> DataAssetDecl {
    DataAssetDecl {
        id: asset.id.clone(),
        source: asset.source.clone(),
        loader: asset.encoding.as_ref().map_or_else(|| "bytes".to_string(), |e| e.decoder.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decl(id: &str, loader: &str) -> DataAssetDecl {
        DataAssetDecl { id: id.into(), source: format!("data/{id}"), loader: loader.into() }
    }

    #[test]
    fn declarations_and_deliveries_must_match_exactly() {
        let one = |id: &str| BTreeMap::from([(id.to_string(), vec![1u8])]);
        assert!(DataAssets::new(vec![decl("data://a", "json")], one("data://a")).is_ok());
        assert_eq!(DataAssets::new(vec![decl("data://a", "json")], BTreeMap::new()).unwrap_err().code, "ASSET_DATA_MISSING");
        assert_eq!(DataAssets::new(vec![], one("data://a")).unwrap_err().code, "ASSET_DATA_UNDECLARED");
        assert_eq!(DataAssets::new(vec![decl("data://a", "Bad Name")], one("data://a")).unwrap_err().code, "ASSET_LOADER_INVALID");
    }
}
