//! File-level updates for the version 1 export.json inventory.
//! Hosts verify bytes, fetch missing data and activate the new generation.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Deserialize)]
struct Inventory {
    version: u32,
    files: Vec<File>,
}

#[derive(Deserialize, Serialize)]
struct File {
    path: String,
    bytes: u64,
    sha256: String,
}

impl Inventory {
    fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(self.version == 1, "unsupported export inventory version");
        let mut paths = HashSet::new();
        for file in &self.files {
            anyhow::ensure!(
                !file.path.contains(['\\', ':', '\0'])
                    && file.path.split('/').all(|part| !matches!(part, "" | "." | "..")),
                "invalid export path {:?}", file.path
            );
            anyhow::ensure!(
                paths.insert(file.path.as_str()) && file.sha256.len() == 64
                    && file.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "invalid or duplicate export entry {:?}", file.path
            );
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct Source<'a> {
    inventory: usize,
    path: &'a str,
}

#[derive(Serialize)]
struct Step<'a> {
    #[serde(flatten)]
    file: File,
    reuse: Option<Source<'a>>,
}

/// Compare one or more installed inventories against a requested generation.
/// Reuse is a candidate, identified by its inventory index and original path.
/// A host must verify the candidate's size and hash before using it.
pub fn plan(next_json: &str, installed_json: &[&str]) -> anyhow::Result<serde_json::Value> {
    let next: Inventory = serde_json::from_str(next_json)?;
    next.validate()?;
    let installed: Vec<Inventory> = installed_json
        .iter()
        .map(|json| {
            let inventory: Inventory = serde_json::from_str(json)?;
            inventory.validate()?;
            Ok(inventory)
        })
        .collect::<anyhow::Result<_>>()?;
    let mut candidates = HashMap::new();
    for (inventory, old) in installed.iter().enumerate() {
        for file in &old.files {
            candidates.entry((file.sha256.as_str(), file.bytes)).or_insert((inventory, file.path.as_str()));
        }
    }
    let mut download_bytes = 0u64;
    let mut reuse_bytes = 0u64;
    let mut files = Vec::with_capacity(next.files.len());
    for file in next.files {
        let reuse = candidates.get(&(file.sha256.as_str(), file.bytes))
            .map(|&(inventory, path)| Source { inventory, path });
        let total = if reuse.is_some() { &mut reuse_bytes } else { &mut download_bytes };
        *total = total.checked_add(file.bytes).ok_or_else(|| anyhow::anyhow!("export size overflow"))?;
        files.push(Step { file, reuse });
    }
    Ok(serde_json::json!({ "version": 1, "download_bytes": download_bytes, "reuse_bytes": reuse_bytes, "files": files }))
}

#[cfg(test)]
mod tests {
    use super::plan;
    use serde_json::json;

    #[test]
    fn plans_renames_changes_additions_and_removals() {
        let common = "a".repeat(64);
        let changed = "b".repeat(64);
        let old = json!({"version":1,"files":[
            {"path":"content/old.png","bytes":900,"sha256":common},
            {"path":"content/game","bytes":15,"sha256":common},
            {"path":"content/removed","bytes":2,"sha256":common}
        ]}).to_string();
        let new = json!({"version":1,"files":[
            {"path":"content/new.png","bytes":900,"sha256":common},
            {"path":"content/game","bytes":15,"sha256":changed},
            {"path":"content/added","bytes":12,"sha256":common}
        ]}).to_string();
        let result = plan(&new, &[&old]).unwrap();
        assert_eq!(result["download_bytes"], 27);
        assert_eq!(result["reuse_bytes"], 900);
        assert_eq!(result["files"][0]["reuse"], json!({"inventory":0,"path":"content/old.png"}));
        assert!(result["files"][1]["reuse"].is_null());
        assert_eq!(result["files"].as_array().unwrap().len(), 3);
        assert_eq!(plan(&new, &[]).unwrap()["download_bytes"], 927);
    }

    #[test]
    fn rejects_invalid_inventory_entries() {
        let digest = "a".repeat(64);
        for path in ["../escape", "/absolute", "content//bad", "C:/absolute", "content\\x"] {
            let file = json!({"path":path,"bytes":1,"sha256":digest});
            assert!(plan(&json!({"version":1,"files":[file]}).to_string(), &[]).is_err());
        }
        let file = json!({"path":"content/game","bytes":1,"sha256":digest});
        assert!(plan(&json!({"version":1,"files":[file,file]}).to_string(), &[]).is_err());
        assert!(plan(r#"{"version":2,"files":[]}"#, &[]).is_err());
    }
}
