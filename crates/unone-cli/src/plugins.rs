//! AI-facing optional plugin discovery and invocation.
//!
//! Plugins are deliberately kept outside `unone-engine`.  The engine owns the
//! deterministic runtime; a plugin is a separately installed process that
//! speaks the same JSON result contract.  This keeps Blender, 2D inspectors,
//! importers, and future authoring tools optional without creating a second
//! engine API.

use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use unone_engine::{Diagnostic, EngineResult};

pub const PLUGIN_API: &str = "unone.plugin.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginEntry {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginTool {
    pub name: String,
    #[serde(default)]
    pub title: Option<String>,
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub api: String,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub entry: PluginEntry,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub tools: Vec<PluginTool>,
}

#[derive(Debug, Clone)]
struct PluginRecord {
    root: PathBuf,
    manifest_path: PathBuf,
    manifest: PluginManifest,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub root: String,
    pub capabilities: Vec<String>,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginListReport {
    pub plugins: Vec<PluginSummary>,
    pub searched_roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginInspection {
    pub root: String,
    pub manifest_path: String,
    pub manifest: PluginManifest,
}

pub fn list(project: &Path) -> EngineResult<PluginListReport> {
    let roots = search_roots(project);
    let (records, diagnostics) = discover_records(&roots);
    let plugins = records
        .iter()
        .map(|record| PluginSummary {
            id: record.manifest.id.clone(),
            name: record.manifest.name.clone(),
            version: record.manifest.version.clone(),
            root: record.root.display().to_string(),
            capabilities: record.manifest.capabilities.clone(),
            tools: record
                .manifest
                .tools
                .iter()
                .map(|tool| tool.name.clone())
                .collect(),
        })
        .collect();
    let mut result = EngineResult::success(PluginListReport {
        plugins,
        searched_roots: roots
            .iter()
            .map(|root| root.display().to_string())
            .collect(),
    });
    result.diagnostics.extend(diagnostics);
    result
}

pub fn inspect(project: &Path, id: &str) -> EngineResult<PluginInspection> {
    match find_record(project, id) {
        Ok(record) => EngineResult::success(PluginInspection {
            root: record.root.display().to_string(),
            manifest_path: record.manifest_path.display().to_string(),
            manifest: record.manifest,
        }),
        Err(diagnostic) => EngineResult::failure(diagnostic),
    }
}

pub fn test(project: &Path, id: &str) -> EngineResult<Value> {
    call(project, id, "plugin.test", json!({}))
}

pub fn call(project: &Path, id: &str, tool: &str, input: Value) -> EngineResult<Value> {
    let project_root = fs::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
    let record = match find_record(project, id) {
        Ok(record) => record,
        Err(diagnostic) => return EngineResult::failure(diagnostic),
    };
    if !record
        .manifest
        .tools
        .iter()
        .any(|candidate| candidate.name == tool)
        && tool != "plugin.test"
    {
        let mut diagnostic = Diagnostic::error(
            "PLUGIN_TOOL_NOT_FOUND",
            "插件沒有宣告這個工具",
            format!(
                "插件 '{}' 沒有公開工具 '{}'。先執行 plugin inspect 查看 tools。",
                id, tool
            ),
        );
        diagnostic.facts = json!({
            "plugin": id,
            "tool": tool,
            "available": record.manifest.tools.iter().map(|item| &item.name).collect::<Vec<_>>(),
        });
        return EngineResult::failure(diagnostic);
    }

    let request = json!({
        "protocol": PLUGIN_API,
        "action": "call",
        "plugin": id,
        "tool": tool,
        "project": project_root.display().to_string(),
        "input": input,
    });
    let mut command = Command::new(&record.manifest.entry.command);
    command
        .args(&record.manifest.entry.args)
        .current_dir(&record.root)
        .env("UNONE_PROJECT_ROOT", &project_root)
        .env("UNONE_PLUGIN_ID", id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let mut diagnostic = Diagnostic::error(
                "PLUGIN_PROCESS_START_FAILED",
                "無法啟動插件",
                format!("{}：{}", record.manifest.entry.command, error),
            );
            diagnostic.facts = json!({
                "plugin": id,
                "root": record.root,
                "command": record.manifest.entry.command,
                "args": record.manifest.entry.args,
            });
            return EngineResult::failure(diagnostic);
        }
    };
    let payload = match serde_json::to_vec(&request) {
        Ok(payload) => payload,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PLUGIN_REQUEST_SERIALIZE_FAILED",
                "無法建立插件請求",
                error.to_string(),
            ));
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin
            .write_all(&payload)
            .and_then(|_| stdin.write_all(b"\n"))
        {
            let _ = child.kill();
            return EngineResult::failure(Diagnostic::error(
                "PLUGIN_REQUEST_WRITE_FAILED",
                "無法傳送插件請求",
                error.to_string(),
            ));
        }
    }
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PLUGIN_PROCESS_WAIT_FAILED",
                "無法等待插件完成",
                error.to_string(),
            ));
        }
    };
    if !output.status.success() {
        let mut diagnostic = Diagnostic::error(
            "PLUGIN_PROCESS_FAILED",
            "插件執行失敗",
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        );
        diagnostic.facts = json!({
            "plugin": id,
            "tool": tool,
            "status": output.status.code(),
            "stdout": String::from_utf8_lossy(&output.stdout),
            "stderr": String::from_utf8_lossy(&output.stderr),
        });
        return EngineResult::failure(diagnostic);
    }
    let stdout_text = String::from_utf8_lossy(&output.stdout);
    let Some(line) = stdout_text
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
    else {
        return EngineResult::failure(Diagnostic::error(
            "PLUGIN_RESPONSE_EMPTY",
            "插件沒有回傳 JSON",
            "插件 stdout 必須至少回傳一行 JSON；除錯文字請寫到 stderr。",
        ));
    };
    let response = match serde_json::from_str::<Value>(line) {
        Ok(response) => response,
        Err(error) => {
            let mut diagnostic = Diagnostic::error(
                "PLUGIN_RESPONSE_INVALID",
                "插件回傳的不是有效 JSON",
                error.to_string(),
            );
            diagnostic.facts = json!({
                "plugin": id,
                "tool": tool,
                "stdout": String::from_utf8_lossy(&output.stdout),
            });
            return EngineResult::failure(diagnostic);
        }
    };
    if response.get("ok").and_then(Value::as_bool) == Some(false) {
        if let Some(diagnostics) = response
            .get("diagnostics")
            .cloned()
            .and_then(|raw| serde_json::from_value::<Vec<Diagnostic>>(raw).ok())
        {
            if let Some(first) = diagnostics.first().cloned() {
                let mut result = EngineResult::failure(first);
                result.diagnostics.extend(diagnostics.into_iter().skip(1));
                return result;
            }
        }
        let mut diagnostic = Diagnostic::error(
            "PLUGIN_TOOL_FAILED",
            "插件工具回報失敗",
            "插件結果沒有提供可定位的 diagnostics。",
        );
        diagnostic.facts = json!({"plugin": id, "tool": tool, "response": response});
        return EngineResult::failure(diagnostic);
    }
    let mut result = EngineResult::success(
        response
            .get("value")
            .cloned()
            .unwrap_or_else(|| response.clone()),
    );
    if let Some(diagnostics) = response
        .get("diagnostics")
        .cloned()
        .and_then(|raw| serde_json::from_value::<Vec<Diagnostic>>(raw).ok())
    {
        result.diagnostics = diagnostics;
    }
    if let Some(effects) = response.get("effects").and_then(Value::as_array) {
        result
            .effects
            .extend(effects.iter().filter_map(Value::as_str).map(str::to_string));
    }
    result
        .effects
        .push(format!("plugin {}:{} completed", id, tool));
    result
}

fn find_record(project: &Path, id: &str) -> Result<PluginRecord, Diagnostic> {
    let roots = search_roots(project);
    let (records, diagnostics) = discover_records(&roots);
    if let Some(record) = records.into_iter().find(|record| record.manifest.id == id) {
        return Ok(record);
    }
    let mut diagnostic = Diagnostic::error(
        "PLUGIN_NOT_FOUND",
        "找不到指定插件",
        format!("沒有找到插件 '{}'；先執行 plugin list 查看已安裝插件。", id),
    );
    diagnostic.facts = json!({
        "plugin": id,
        "searched_roots": roots,
        "manifest_diagnostics": diagnostics,
    });
    diagnostic
        .suggested_actions
        .push(unone_engine::ActionSuggestion {
            action: "plugin_list".to_string(),
            description: "列出目前專案與引擎可發現的插件。".to_string(),
            command: Some("game plugin list --json".to_string()),
        });
    Err(diagnostic)
}

fn search_roots(project: &Path) -> Vec<PathBuf> {
    let mut roots = vec![project.join(".unone/plugins"), project.join("plugins")];
    if let Some(paths) = env::var_os("UNONE_PLUGIN_PATHS") {
        roots.extend(env::split_paths(&paths));
    }
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../plugins"));
    let mut unique = Vec::new();
    for root in roots {
        let absolute = if root.is_absolute() {
            root
        } else {
            project.join(root)
        };
        let absolute = fs::canonicalize(&absolute).unwrap_or(absolute);
        if !unique
            .iter()
            .any(|existing: &PathBuf| existing == &absolute)
        {
            unique.push(absolute);
        }
    }
    unique
}

fn discover_records(roots: &[PathBuf]) -> (Vec<PluginRecord>, Vec<Diagnostic>) {
    let mut records = Vec::new();
    let mut diagnostics = Vec::new();
    for root in roots {
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let plugin_root = if path.is_dir() { path } else { continue };
            let manifest_path = plugin_root.join("plugin.json");
            if !manifest_path.is_file() {
                continue;
            }
            match fs::read_to_string(&manifest_path)
                .map_err(|error| format!("{}：{}", manifest_path.display(), error))
                .and_then(|text| {
                    serde_json::from_str::<PluginManifest>(&text)
                        .map_err(|error| format!("{}：{}", manifest_path.display(), error))
                }) {
                Ok(manifest) => {
                    if let Err(diagnostic) = validate_manifest(&manifest) {
                        diagnostics.push(diagnostic);
                    } else if records
                        .iter()
                        .any(|record: &PluginRecord| record.manifest.id == manifest.id)
                    {
                        diagnostics.push(Diagnostic::warning(
                            "PLUGIN_ID_DUPLICATE",
                            "發現重複插件 id",
                            format!("插件 '{}' 出現多次；保留先發現的版本。", manifest.id),
                        ));
                    } else {
                        records.push(PluginRecord {
                            root: plugin_root,
                            manifest_path,
                            manifest,
                        });
                    }
                }
                Err(error) => diagnostics.push(Diagnostic::warning(
                    "PLUGIN_MANIFEST_INVALID",
                    "插件 manifest 無法讀取",
                    error,
                )),
            }
        }
    }
    records.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
    (records, diagnostics)
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), Diagnostic> {
    if manifest.api != PLUGIN_API {
        return Err(Diagnostic::error(
            "PLUGIN_API_UNSUPPORTED",
            "插件 protocol 版本不支援",
            format!("需要 {}，實際是 {}。", PLUGIN_API, manifest.api),
        ));
    }
    if manifest.id.trim().is_empty() || manifest.entry.command.trim().is_empty() {
        return Err(Diagnostic::error(
            "PLUGIN_MANIFEST_INVALID",
            "插件 manifest 缺少必要欄位",
            "id 和 entry.command 不能是空字串。",
        ));
    }
    Ok(())
}
