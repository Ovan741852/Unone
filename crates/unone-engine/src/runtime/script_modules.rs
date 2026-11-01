//! Game script modules: `require("./path")` between the entry script and the
//! `.luau` files beside it.
//!
//! A module is named by its path relative to the entry script's directory,
//! '/'-separated, with its extension ("world/terrain.luau"). `require` takes a
//! path relative to the requiring file ("./terrain", "../shared/math"); the
//! `.luau` extension is implied and `x/init.luau` answers for `x`. Paths never
//! leave the script directory. Each module runs once per VM, under its own
//! chunk name so errors point at its file and line, and must return one value.
//! A cycle is an error, not a half-initialized table.
use mlua::{Lua, RegistryKey, Value};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

/// Module sources keyed by their path relative to the entry script's directory.
pub type ScriptModuleSources = BTreeMap<String, String>;

/// What `require` loads: module source, or production bytecode precompiled at
/// export (see `crate::script_bytecode`), keyed alike.
#[derive(Clone)]
pub(crate) enum ScriptModules {
    Source(Rc<ScriptModuleSources>),
    Bytecode(Rc<BTreeMap<String, Vec<u8>>>),
}

impl ScriptModules {
    fn resolve(&self, from: &str, path: &str) -> Result<String, String> {
        match self {
            Self::Source(sources) => resolve(sources, from, path),
            Self::Bytecode(chunks) => resolve(chunks, from, path),
        }
    }
    fn chunk(&self, key: &str) -> (&[u8], mlua::ChunkMode) {
        match self {
            Self::Source(sources) => (sources[key].as_bytes(), mlua::ChunkMode::Text),
            Self::Bytecode(chunks) => (&chunks[key], mlua::ChunkMode::Binary),
        }
    }
}

/// Most modules a game may ship; a directory with more is a mistake.
pub const MAX_SCRIPT_MODULES: usize = 4096;

/// Every `.luau` file under the entry script's directory except the entry
/// itself; hidden files and directories are skipped.
#[cfg(feature = "dev-tools")]
pub fn read_from_disk(entry: &std::path::Path) -> Result<ScriptModuleSources, Box<crate::Diagnostic>> {
    let failed = |message: String| Box::new(crate::Diagnostic::error("SCRIPT_MODULE_READ_FAILED", "Unable to read script modules", message));
    let root = entry.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let root = if root.as_os_str().is_empty() { std::path::PathBuf::from(".") } else { root };
    let entry_name = entry.file_name();
    let mut modules = ScriptModuleSources::new();
    let mut pending = vec![(root.clone(), String::new())];
    while let Some((dir, prefix)) = pending.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| failed(format!("{}: {e}", dir.display())))?;
        for item in entries {
            let item = item.map_err(|e| failed(format!("{}: {e}", dir.display())))?;
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let kind = item.file_type().map_err(|e| failed(format!("{}: {e}", item.path().display())))?;
            if kind.is_dir() {
                pending.push((item.path(), format!("{prefix}{name}/")));
            } else if name.ends_with(".luau") && !(prefix.is_empty() && Some(item.file_name().as_os_str()) == entry_name) {
                let source = std::fs::read_to_string(item.path()).map_err(|e| failed(format!("{}: {e}", item.path().display())))?;
                modules.insert(format!("{prefix}{name}"), source);
                if modules.len() > MAX_SCRIPT_MODULES {
                    return Err(failed(format!("more than {MAX_SCRIPT_MODULES} .luau files under {}", root.display())));
                }
            }
        }
    }
    Ok(modules)
}

/// Path, modification time and size of every module beside the entry, so a
/// watching host reloads when any of them changes.
#[cfg(feature = "dev-tools")]
pub fn stamp(entry: &std::path::Path) -> Vec<(std::path::PathBuf, Option<std::time::SystemTime>, u64)> {
    let root = match entry.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir.to_path_buf(),
        _ => std::path::PathBuf::from("."),
    };
    let mut files = Vec::new();
    let mut pending = vec![root];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for item in entries.flatten() {
            let path = item.path();
            if item.file_name().to_string_lossy().starts_with('.') || path == entry {
                continue;
            }
            let Ok(metadata) = item.metadata() else { continue };
            if metadata.is_dir() {
                pending.push(path);
            } else if path.extension().is_some_and(|e| e == "luau") {
                files.push((path, metadata.modified().ok(), metadata.len()));
            }
        }
    }
    files.sort();
    files
}

/// The module a relative path names from the module `from`, without extension
/// handling: "a/b.luau" + "../c" -> "c".
fn join(from: &str, path: &str) -> Result<String, String> {
    if !(path.starts_with("./") || path.starts_with("../")) {
        return Err(format!("SCRIPT_REQUIRE_PATH: require paths start with ./ or ../, got {path:?}"));
    }
    if path.contains('\\') || path.contains(':') || path.ends_with('/') {
        return Err(format!("SCRIPT_REQUIRE_PATH: {path:?} is not a relative module path"));
    }
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for segment in path.split('/') {
        match segment {
            "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(format!("SCRIPT_REQUIRE_PATH: {path:?} leaves the script directory"));
                }
            }
            "" => return Err(format!("SCRIPT_REQUIRE_PATH: {path:?} has an empty segment")),
            name => parts.push(name),
        }
    }
    Ok(parts.join("/"))
}

/// The module key `path` resolves to from `from`, given the available modules.
pub fn resolve<T>(sources: &BTreeMap<String, T>, from: &str, path: &str) -> Result<String, String> {
    let base = join(from, path)?;
    let candidates = if base.ends_with(".luau") { vec![base.clone()] } else { vec![format!("{base}.luau"), format!("{base}/init.luau")] };
    candidates.into_iter().find(|key| sources.contains_key(key))
        .ok_or_else(|| format!("SCRIPT_MODULE_NOT_FOUND: {path:?} from {from:?} (looked for {base}.luau and {base}/init.luau)"))
}

struct Loader {
    modules: ScriptModules,
    /// Chunk name -> module key, for every chunk this VM loaded.
    chunks: HashMap<String, String>,
    loaded: HashMap<String, RegistryKey>,
    loading: Vec<String>,
}

fn chunk_key(chunks: &HashMap<String, String>, source: &str) -> Option<String> {
    chunks.get(source).or_else(|| chunks.get(source.trim_start_matches(['@', '=']))).cloned()
}

/// Installs `require` for chunks of this VM. `entry_chunk` is the name the
/// entry script is loaded under and `entry_key` its module key (its file name);
/// a module loads under `chunk_prefix` + its key, e.g. "scripts/world/b.luau".
pub(crate) fn install(lua: &Lua, modules: ScriptModules, entry_chunk: &str, entry_key: &str, chunk_prefix: &str) -> mlua::Result<()> {
    let chunk_prefix = chunk_prefix.to_string();
    let loader = Rc::new(RefCell::new(Loader {
        modules,
        chunks: HashMap::from([(entry_chunk.to_string(), entry_key.to_string())]),
        loaded: HashMap::new(),
        loading: Vec::new(),
    }));
    let require = lua.create_function(move |lua, path: String| {
        let caller = lua.inspect_stack(1, |debug| debug.source().source.map(|s| s.into_owned())).flatten();
        let (key, chunk, modules) = {
            let state = loader.borrow();
            let from = caller.as_deref().and_then(|source| chunk_key(&state.chunks, source))
                .ok_or_else(|| mlua::Error::RuntimeError("SCRIPT_REQUIRE_CALLER: require is called from game script code".into()))?;
            let key = state.modules.resolve(&from, &path).map_err(mlua::Error::RuntimeError)?;
            if let Some(value) = state.loaded.get(&key) {
                return lua.registry_value::<Value>(value);
            }
            if state.loading.contains(&key) {
                let mut cycle = state.loading.clone();
                cycle.push(key.clone());
                return Err(mlua::Error::RuntimeError(format!("SCRIPT_REQUIRE_CYCLE: {}", cycle.join(" -> "))));
            }
            let chunk = format!("{chunk_prefix}{key}");
            (key, chunk, state.modules.clone())
        };
        {
            let mut state = loader.borrow_mut();
            state.chunks.insert(chunk.clone(), key.clone());
            state.loading.push(key.clone());
        }
        // The module may require others, so no borrow is held while it runs.
        // The mode is explicit, as for the entry script.
        let (code, mode) = modules.chunk(&key);
        let result = lua.load(code).set_name(chunk).set_mode(mode).call::<mlua::MultiValue>(());
        loader.borrow_mut().loading.pop();
        let values = result?;
        let value = match values.len() {
            1 if !values[0].is_nil() => values[0].clone(),
            _ => return Err(mlua::Error::RuntimeError(format!("SCRIPT_MODULE_RETURN: {key} must return exactly one non-nil value"))),
        };
        let stored = lua.create_registry_value(value.clone())?;
        loader.borrow_mut().loaded.insert(key, stored);
        Ok(value)
    })?;
    lua.globals().set("require", require)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_resolve_inside_the_script_directory() {
        let sources: ScriptModuleSources = ["a.luau", "world/b.luau", "world/c/init.luau", "shared.luau"]
            .into_iter().map(|k| (k.to_string(), String::new())).collect();
        assert_eq!(resolve(&sources, "main.luau", "./a").unwrap(), "a.luau");
        assert_eq!(resolve(&sources, "main.luau", "./world/b.luau").unwrap(), "world/b.luau");
        assert_eq!(resolve(&sources, "world/b.luau", "./c").unwrap(), "world/c/init.luau");
        assert_eq!(resolve(&sources, "world/b.luau", "../shared").unwrap(), "shared.luau");
        assert_eq!(resolve(&sources, "world/c/init.luau", "../../a").unwrap(), "a.luau");
        for (from, path, code) in [("main.luau", "a", "SCRIPT_REQUIRE_PATH"), ("main.luau", "../a", "SCRIPT_REQUIRE_PATH"),
            ("main.luau", "./x", "SCRIPT_MODULE_NOT_FOUND"), ("main.luau", ".\\a", "SCRIPT_REQUIRE_PATH"), ("main.luau", ".//a", "SCRIPT_REQUIRE_PATH")] {
            assert!(resolve(&sources, from, path).unwrap_err().starts_with(code), "{from} {path}");
        }
    }
}
