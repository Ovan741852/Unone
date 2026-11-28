//! Index and read individual files in an installed Unone bundle generation.
use crate::{R, safe};
use serde::Deserialize;
use std::{
    collections::BTreeMap, fs::{self, File}, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf},
};
#[derive(Deserialize)]
struct BundleManifest {
    version: u32,
    bundles: Vec<BundleSpec>,
}

#[derive(Deserialize)]
struct BundleSpec {
    id: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Deserialize)]
struct Index {
    manifest: BundleManifest,
    paths: BTreeMap<String, String>,
    startup: Vec<String>,
}

pub(crate) struct BundlePackage {
    cache: PathBuf,
    specs: BTreeMap<String, BundleSpec>,
    paths: BTreeMap<String, String>,
    archives: BTreeMap<String, Archive>,
}

impl BundlePackage {
    pub(crate) fn open(generation: &Path, cache: PathBuf) -> R<(Self, Vec<String>)> {
        let index: Index = serde_json::from_slice(&fs::read(generation.join("bundles.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if index.manifest.version != 1 || index.manifest.bundles.is_empty() {
            return Err("NATIVE_BUNDLE_INDEX_INVALID".into());
        }
        let mut specs = BTreeMap::new();
        for spec in index.manifest.bundles {
            if spec.sha256.len() != 64 || !spec.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                || specs.insert(spec.id.clone(), spec).is_some() {
                return Err("NATIVE_BUNDLE_INDEX_INVALID".into());
            }
        }
        if index.paths.iter().any(|(path, id)| !path.starts_with("content/") || !safe(path) || !specs.contains_key(id))
            || index.startup.iter().any(|path| !index.paths.contains_key(path)) {
            return Err("NATIVE_BUNDLE_INDEX_INVALID".into());
        }
        Ok((Self { cache, specs, paths: index.paths, archives: BTreeMap::new() }, index.startup))
    }

    pub(crate) fn read(&mut self, path: &str) -> R<Vec<u8>> {
        let id = self.paths.get(path).ok_or_else(|| format!("NATIVE_FILE_MISSING: {path}"))?;
        // Opening an archive reads only its header. Payload files are read by range.
        let archive = match self.archives.entry(id.clone()) {
            std::collections::btree_map::Entry::Occupied(hit) => hit.into_mut(),
            std::collections::btree_map::Entry::Vacant(slot) => {
                let spec = &self.specs[id];
                slot.insert(Archive::open(self.cache.join(format!("{}.bundle", spec.sha256)), spec.size_bytes)?)
            }
        };
        archive.read(path)
    }
}

#[derive(Deserialize)]
struct ArchiveHeader {
    version: u32,
    files: Vec<ArchiveEntry>,
}

#[derive(Deserialize)]
struct ArchiveEntry {
    path: String,
    offset: u64,
    size_bytes: u64,
}

struct Archive {
    file: File,
    entries: BTreeMap<String, (u64, usize)>,
}

impl Archive {
    fn open(path: PathBuf, expected_bytes: u64) -> R<Self> {
        const MAGIC: &[u8] = b"UNONE-BUNDLE-1\n";
        const PREFIX_LEN: usize = MAGIC.len() + 4;
        let mut file = File::open(&path).map_err(|e| format!("NATIVE_BUNDLE_MISSING: {}: {e}", path.display()))?;
        let invalid = || format!("NATIVE_BUNDLE_INVALID: {}", path.display());
        if file.metadata().map_err(|e| e.to_string())?.len() != expected_bytes {
            return Err(invalid());
        }
        let mut prefix = [0; PREFIX_LEN];
        file.read_exact(&mut prefix).map_err(|_| invalid())?;
        if !prefix.starts_with(MAGIC) { return Err(invalid()); }
        let header_len = u32::from_le_bytes(prefix[MAGIC.len()..].try_into().unwrap());
        let payload = PREFIX_LEN as u64 + u64::from(header_len);
        if header_len > 32 * 1024 * 1024 || payload > expected_bytes { return Err(invalid()); }
        let mut header = vec![0; header_len as usize];
        file.read_exact(&mut header).map_err(|_| invalid())?;
        let header: ArchiveHeader = serde_json::from_slice(&header).map_err(|_| invalid())?;
        if header.version != 1 { return Err(invalid()); }
        let mut entries = BTreeMap::new();
        for entry in header.files {
            let offset = payload.checked_add(entry.offset).ok_or_else(&invalid)?;
            let end = offset.checked_add(entry.size_bytes).ok_or_else(&invalid)?;
            let len = usize::try_from(entry.size_bytes).map_err(|_| invalid())?;
            if !safe(&entry.path) || end > expected_bytes || entries.insert(entry.path, (offset, len)).is_some() {
                return Err(invalid());
            }
        }
        Ok(Self { file, entries })
    }

    fn read(&mut self, path: &str) -> R<Vec<u8>> {
        let &(offset, len) = self.entries.get(path).ok_or_else(|| format!("NATIVE_FILE_MISSING: {path}"))?;
        let mut bytes = vec![0; len];
        self.file.seek(SeekFrom::Start(offset)).and_then(|_| self.file.read_exact(&mut bytes))
            .map_err(|e| format!("NATIVE_BUNDLE_READ_FAILED: {path}: {e}"))?;
        // PackageLoader verifies these bytes against the generation inventory before use.
        Ok(bytes)
    }
}
