//! Durable storage for the opaque `api.save` payload. The game owns its schema,
//! versioning and migration; this host adapter only restores and persists JSON.
use serde_json::{Value, json, value::RawValue};
use std::{fs, io::Write, path::{Path, PathBuf}, rc::Rc};
use unone_engine::{EngineRuntime, HostProject};

pub(crate) const CONTRACT: &str = "unone.native-save.v1";

pub(crate) fn declaration() -> Value {
    json!({"contract":CONTRACT, "argument":"--save",
        "format":"UTF-8 JSON of the api.save payload; an absent file means no save",
        "windows":"%APPDATA%/Unone/<project name>/save.json",
        "android":"<NativeActivity internal data path>/save.json",
        "other_desktop":"$XDG_DATA_HOME (or ~/.local/share)/Unone/<project name>/save.json",
        "project_name_encoding":"%XX UTF-8 bytes for % < > : \" / \\ | ? *, controls, a trailing dot/space and the first letter of a device name",
        "restore":"before_game_start", "persist":"after_game_start_and_each_successful_tick_when_the_encoding_changes",
        "write":"synced_sibling_temp_file_then_rename",
        "disabled_by":["--input-sequence","--headless","--frames N>0","--seconds S>0",
            "--freeze-simulation","--prewarm-ticks N>0","--capture-dir","systems.save=false"],
        "explicit_path":"--save also enables headless and bounded runs; rejected with --input-sequence",
        "unreadable":"NATIVE_SAVE_READ_FAILED / NATIVE_SAVE_CORRUPT fail startup before Game.start"})
}

/// Platform storage root. It is resolved only when persistence is enabled, so
/// replay and measurement runs never require a per-user data directory.
pub(crate) enum Store {
    /// `<root>/<project name>/save.json` in a per-user desktop directory.
    PerProject(PathBuf),
    /// `<dir>/save.json` in an app-private directory such as Android's.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    App(PathBuf),
    Unavailable(String),
}

impl Store {
    pub(crate) fn desktop() -> Self {
        #[cfg(target_os = "windows")]
        let (root, needed) = (std::env::var_os("APPDATA").map(PathBuf::from), "APPDATA");
        #[cfg(not(target_os = "windows"))]
        let (root, needed) = (std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))),
            "XDG_DATA_HOME or HOME");
        match root.filter(|path| path.is_absolute()) {
            Some(root) => Self::PerProject(root.join("Unone")),
            None => Self::Unavailable(format!("{needed} is not an absolute directory")),
        }
    }

    fn path(self, project: &str) -> Result<PathBuf, String> {
        match self {
            Self::PerProject(root) => Ok(root.join(directory_name(project)?).join("save.json")),
            Self::App(dir) => Ok(dir.join("save.json")),
            Self::Unavailable(why) => Err(format!("NATIVE_SAVE_LOCATION_UNAVAILABLE: {why}; Fix: pass --save <path>")),
        }
    }
}

/// Injective, portable directory name for an arbitrary project name.
fn directory_name(name: &str) -> Result<String, String> {
    let last = name.chars().count().checked_sub(1).ok_or(
        "NATIVE_SAVE_PROJECT_NAME_EMPTY: config.name selects the default save directory; Fix: name the project or pass --save <path>")?;
    let mut out = String::with_capacity(name.len());
    for (index, c) in name.chars().enumerate() {
        if c == '%' || c.is_control() || "<>:\"/\\|?*".contains(c) || (index == last && matches!(c, '.' | ' ')) {
            for byte in c.to_string().bytes() { out.push_str(&format!("%{byte:02X}")); }
        } else {
            out.push(c);
        }
    }
    let stem = out.split('.').next().unwrap_or_default().to_ascii_uppercase();
    let numbered = stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.as_bytes()[3].is_ascii_digit();
    if numbered || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        out = format!("%{:02X}{}", out.as_bytes()[0], &out[1..]);
    }
    if out.encode_utf16().count() > 255 {
        return Err("NATIVE_SAVE_PROJECT_NAME_TOO_LONG: the encoded config.name exceeds 255 UTF-16 units; Fix: shorten the name or pass --save <path>".into());
    }
    Ok(out)
}

/// One run's save adapter. A disabled adapter never touches the filesystem.
pub(crate) struct SaveFile {
    path: Option<PathBuf>,
    /// Path origin when enabled, otherwise the reason persistence is off.
    source: &'static str,
    restored: Option<Value>,
    restored_bytes: Option<usize>,
    /// Encoding known to be on disk; an absent file is equivalent to `null`.
    disk: Rc<RawValue>,
    /// Last runtime encoding compared with `disk`. Unchanged ticks reuse the
    /// runtime's cached encoding, so they cost one pointer comparison.
    seen: Option<Rc<RawValue>>,
    writes: u64,
}

impl SaveFile {
    fn disabled(reason: &'static str) -> Self {
        Self { path: None, source: reason, restored: None, restored_bytes: None,
            disk: raw("null".into()), seen: None, writes: 0 }
    }

    /// Decide this run's policy and read the existing save before Game.start.
    pub(crate) fn open(settings: &crate::Settings, store: Store, project: &HostProject) -> Result<Self, String> {
        let replay = settings.input_sequence.is_some();
        if replay && settings.save.is_some() {
            return Err("NATIVE_SAVE_REPLAY_CONFLICT: --save cannot be combined with --input-sequence; replay never reads or writes saves so digests stay reproducible".into());
        }
        let save_system = unone_engine::SystemSettings::from_config(&project.config)
            .map_err(|error| error.explanation)?.is_enabled("save");
        let measurement = settings.headless || settings.frames > 0 || settings.measure_seconds > 0.
            || settings.freeze_simulation || settings.prewarm_ticks > 0 || settings.capture_dir.is_some();
        let (path, source) = if replay {
            return Ok(Self::disabled("input_replay"));
        } else if !save_system {
            return Ok(Self::disabled("save_system_disabled"));
        } else if let Some(path) = &settings.save {
            (path.clone(), "argument")
        } else if measurement {
            return Ok(Self::disabled("measurement"));
        } else {
            (store.path(&project.config.name)?, "platform_default")
        };
        if path.file_name().is_none() {
            return Err(format!("NATIVE_SAVE_PATH_INVALID: {} does not name a file", path.display()));
        }
        let (restored, restored_bytes, disk) = match read(&path)? {
            // The runtime caches the same serializer's output, so an unchanged
            // restore compares equal and is not rewritten.
            Some((value, bytes)) => {
                let disk = raw(serde_json::to_string(&value).map_err(|error| error.to_string())?);
                (Some(value), Some(bytes), disk)
            }
            None => (None, None, raw("null".into())),
        };
        Ok(Self { path: Some(path), source, restored, restored_bytes, disk, seen: None, writes: 0 })
    }

    pub(crate) fn take_restored(&mut self) -> Option<Value> {
        self.restored.take()
    }

    /// Write only when the committed encoding differs from the file.
    pub(crate) fn persist(&mut self, runtime: &EngineRuntime) -> Result<(), String> {
        let Some(path) = &self.path else { return Ok(()) };
        let current = runtime.serialized_save_payload();
        let unchanged = match (&current, &self.seen) {
            (Some(a), Some(b)) => Rc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        };
        if unchanged { return Ok(()); }
        let next = current.clone().unwrap_or_else(|| raw("null".into()));
        if next.get() != self.disk.get() {
            write_atomic(path, next.get())?;
            self.disk = next;
            self.writes += 1;
        }
        self.seen = current;
        Ok(())
    }

    pub(crate) fn report(&self) -> Value {
        match &self.path {
            Some(path) => json!({"contract":CONTRACT, "enabled":true, "path":path.display().to_string(),
                "source":self.source, "restored":self.restored_bytes.is_some(),
                "restored_bytes":self.restored_bytes, "writes":self.writes,
                "last_write_bytes":(self.writes > 0).then(|| self.disk.get().len())}),
            None => json!({"contract":CONTRACT, "enabled":false, "path":null, "disabled_reason":self.source}),
        }
    }
}

fn raw(text: String) -> Rc<RawValue> {
    Rc::from(RawValue::from_string(text).expect("serializer output is valid JSON"))
}

fn read(path: &Path) -> Result<Option<(Value, usize)>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!(
            "NATIVE_SAVE_READ_FAILED: {}: {error}; the game was not started; Fix: restore read access or move the file aside to start a new save",
            path.display())),
    };
    let value = serde_json::from_slice(&bytes).map_err(|error| format!(
        "NATIVE_SAVE_CORRUPT: {}: {error}; the game was not started and the file is untouched; Fix: repair the JSON or move the file aside to start a new save",
        path.display()))?;
    Ok(Some((value, bytes.len())))
}

/// Replace the file with a fully synced sibling, so an interrupted write leaves
/// the previous or the new save and never a torn one.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let fail = |error: std::io::Error| format!("NATIVE_SAVE_WRITE_FAILED: {}: {error}", path.display());
    if let Some(dir) = path.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        fs::create_dir_all(dir).map_err(fail)?;
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    let temp = path.with_file_name(name);
    let mut file = fs::File::create(&temp).map_err(fail)?;
    file.write_all(text.as_bytes()).and_then(|()| file.sync_all()).map_err(fail)?;
    drop(file);
    fs::rename(&temp, path).map_err(fail)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, systems: Value) -> HostProject {
        HostProject::parse(&serde_json::to_vec(&json!({"config":{"name":name,"entry_script":"main.luau","systems":systems},
            "script":"return {start=function(api) end,update=function(api) end}"})).unwrap()).unwrap()
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("unone-native-save-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn project_names_map_to_distinct_portable_directories() {
        for (name, expected) in [("Dragon Tycoon 3", "Dragon Tycoon 3"), ("繁中遊戲", "繁中遊戲"),
            ("a:b/c\\d", "a%3Ab%2Fc%5Cd"), ("100%", "100%25"), ("end.", "end%2E"), ("end ", "end%20"),
            ("con", "%63on"), ("NUL.save", "%4EUL.save"), ("COM1", "%43OM1"), ("Console", "Console"),
            ("..", ".%2E"), ("tab\there", "tab%09here")] {
            assert_eq!(directory_name(name).unwrap(), expected, "{name}");
        }
        assert_ne!(directory_name("a:").unwrap(), directory_name("a%3A").unwrap());
        assert!(directory_name("").unwrap_err().contains("NATIVE_SAVE_PROJECT_NAME_EMPTY"));
        assert!(directory_name(&"x".repeat(256)).unwrap_err().contains("NATIVE_SAVE_PROJECT_NAME_TOO_LONG"));
    }

    #[test]
    fn replay_measurement_and_disabled_systems_never_touch_storage() {
        let unavailable = || Store::Unavailable("test store must not be resolved".into());
        let open = |settings: crate::Settings, systems| SaveFile::open(&settings, unavailable(), &project("p", systems));
        for (settings, reason) in [
            (crate::Settings { input_sequence: Some("inputs.json".into()), ..Default::default() }, "input_replay"),
            (crate::Settings { headless: true, ..Default::default() }, "measurement"),
            (crate::Settings { frames: 1, ..Default::default() }, "measurement"),
            (crate::Settings { measure_seconds: 1., ..Default::default() }, "measurement"),
            (crate::Settings { freeze_simulation: true, ..Default::default() }, "measurement"),
            (crate::Settings { prewarm_ticks: 1, ..Default::default() }, "measurement"),
            (crate::Settings { capture_dir: Some("frames".into()), ..Default::default() }, "measurement"),
        ] {
            let report = open(settings, json!({})).unwrap().report();
            assert_eq!(report["enabled"], false);
            assert_eq!(report["disabled_reason"], reason);
        }
        let explicit = crate::Settings { save: Some("never-read.json".into()), ..Default::default() };
        assert_eq!(open(explicit, json!({"save":false})).unwrap().report()["disabled_reason"], "save_system_disabled");
        let conflict = crate::Settings { save: Some("save.json".into()), input_sequence: Some("inputs.json".into()), ..Default::default() };
        assert!(open(conflict, json!({})).err().unwrap().starts_with("NATIVE_SAVE_REPLAY_CONFLICT"));
        // Ordinary play needs the platform store and fails loudly without it.
        assert!(open(Default::default(), json!({})).err().unwrap().starts_with("NATIVE_SAVE_LOCATION_UNAVAILABLE"));
    }

    #[test]
    fn platform_stores_select_per_project_and_app_private_files() {
        let dir = scratch("stores");
        let play = crate::Settings::default();
        let desktop = SaveFile::open(&play, Store::PerProject(dir.join("Unone")), &project("Idle: Tycoon", json!({}))).unwrap();
        assert_eq!(desktop.path.as_deref(), Some(dir.join("Unone").join("Idle%3A Tycoon").join("save.json").as_path()));
        assert_eq!(desktop.report()["source"], "platform_default");
        let android = SaveFile::open(&play, Store::App(dir.join("files")), &project("ignored", json!({}))).unwrap();
        assert_eq!(android.path.as_deref(), Some(dir.join("files").join("save.json").as_path()));
        assert!(!dir.join("Unone").exists() && !dir.join("files").exists(), "opening never creates directories");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn corrupt_or_unreadable_saves_fail_instead_of_starting_fresh() {
        let dir = scratch("corrupt");
        let path = dir.join("save.json");
        let explicit = crate::Settings { save: Some(path.clone()), ..Default::default() };
        for bytes in [b"".as_slice(), b"{\"count\":", b"{} trailing"] {
            fs::write(&path, bytes).unwrap();
            let error = SaveFile::open(&explicit, Store::Unavailable(String::new()), &project("p", json!({}))).err().unwrap();
            assert!(error.starts_with("NATIVE_SAVE_CORRUPT"), "{error}");
            assert_eq!(fs::read(&path).unwrap(), bytes, "a corrupt save is left for repair");
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        let error = SaveFile::open(&explicit, Store::Unavailable(String::new()), &project("p", json!({}))).err().unwrap();
        assert!(error.starts_with("NATIVE_SAVE_READ_FAILED"), "{error}");
        fs::remove_dir_all(dir).unwrap();
    }
}
