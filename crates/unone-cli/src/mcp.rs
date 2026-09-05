use std::{
    io::{self, BufRead, Write},
    path::Path,
    process::ExitCode,
};

use anyhow::Result;
use serde_json::{Map, Value, json};
use unone_engine::{
    BundleManager, Diagnostic, EngineResult, EngineRuntime, InputFrame, api_describe, api_search,
    inspect_assets, inspect_project, pack_project, platform_capabilities,
};

const LATEST_PROTOCOL_VERSION: &str = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];

#[derive(Debug, Default)]
struct ProtocolState {
    initialize_seen: bool,
    initialized: bool,
    protocol_version: Option<String>,
}

pub fn serve(project: &Path) -> Result<ExitCode> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let mut line = String::new();
    let mut state = ProtocolState::default();

    loop {
        line.clear();
        if input.read_line(&mut line)? == 0 {
            break;
        }
        let line = line.trim_start_matches('\u{feff}');
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(line) {
            Ok(message) => handle_message(message, project, &mut state),
            Err(error) => Some(error_response(
                None,
                -32700,
                "Parse error",
                json!({"error": error.to_string()}),
            )),
        };
        if let Some(response) = response {
            serde_json::to_writer(&mut output, &response)?;
            output.write_all(b"\n")?;
            output.flush()?;
        }
    }

    Ok(ExitCode::SUCCESS)
}

fn handle_message(message: Value, project: &Path, state: &mut ProtocolState) -> Option<Value> {
    let Some(object) = message.as_object() else {
        return Some(error_response(
            None,
            -32600,
            "Invalid Request",
            json!({"reason": "MCP stdio message must be a JSON object"}),
        ));
    };
    let id = object.get("id").cloned();
    if let Some(request_id) = &id
        && !(request_id.is_string() || request_id.is_number())
    {
        return Some(error_response(
            None,
            -32600,
            "Invalid Request",
            json!({"reason": "request id must be a string or number"}),
        ));
    }
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        return Some(error_response(
            id.as_ref(),
            -32600,
            "Invalid Request",
            json!({"reason": "request method is required"}),
        ));
    };

    match method {
        "initialize" => {
            let request_id = id.as_ref()?;
            let Some(params) = object.get("params").and_then(Value::as_object) else {
                return Some(error_response(
                    Some(request_id),
                    -32602,
                    "Invalid params",
                    json!({"reason": "initialize.params must be an object"}),
                ));
            };
            let Some(requested_version) = params.get("protocolVersion").and_then(Value::as_str)
            else {
                return Some(error_response(
                    Some(request_id),
                    -32602,
                    "Invalid params",
                    json!({"reason": "initialize.params.protocolVersion is required"}),
                ));
            };
            let negotiated_version = if SUPPORTED_PROTOCOL_VERSIONS.contains(&requested_version) {
                requested_version
            } else {
                LATEST_PROTOCOL_VERSION
            };
            state.initialize_seen = true;
            state.initialized = false;
            state.protocol_version = Some(negotiated_version.to_string());
            Some(success_response(
                request_id,
                json!({
                    "protocolVersion": negotiated_version,
                    "capabilities": {"tools": {"listChanged": false}},
                    "serverInfo": {
                        "name": "unone",
                        "title": "Unone AI-native game engine",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "instructions": "Use the unone_* tools to inspect, run, test, and diagnose the current game project. Results contain structured EngineResult JSON; prefer diagnostics, facts, likely_causes, suggested_actions, world state, and observation_digest over screenshots."
                }),
            ))
        }
        "notifications/initialized" => {
            if state.initialize_seen {
                state.initialized = true;
            }
            None
        }
        "ping" => id
            .as_ref()
            .map(|request_id| success_response(request_id, json!({}))),
        "tools/list" => {
            if !state.initialized {
                return id.as_ref().map(|request_id| {
                    error_response(
                        Some(request_id),
                        -32002,
                        "Server not initialized",
                        json!({"next": "send notifications/initialized after initialize"}),
                    )
                });
            }
            id.as_ref().map(|request_id| {
                success_response(request_id, json!({"tools": tool_definitions()}))
            })
        }
        "tools/call" => {
            if !state.initialized {
                return id.as_ref().map(|request_id| {
                    error_response(
                        Some(request_id),
                        -32002,
                        "Server not initialized",
                        json!({"next": "send notifications/initialized after initialize"}),
                    )
                });
            }
            let request_id = id.as_ref()?;
            let Some(params) = object.get("params").and_then(Value::as_object) else {
                return Some(error_response(
                    Some(request_id),
                    -32602,
                    "Invalid params",
                    json!({"reason": "tools/call.params must be an object"}),
                ));
            };
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(error_response(
                    Some(request_id),
                    -32602,
                    "Invalid params",
                    json!({"reason": "tools/call.params.name is required"}),
                ));
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            if !arguments.is_object() {
                return Some(error_response(
                    Some(request_id),
                    -32602,
                    "Invalid params",
                    json!({"reason": "tools/call.params.arguments must be an object"}),
                ));
            }
            if !tool_names().contains(&name) {
                return Some(error_response(
                    Some(request_id),
                    -32602,
                    "Unknown tool",
                    json!({"tool": name, "available": tool_names()}),
                ));
            }
            Some(success_response(
                request_id,
                call_tool(project, name, &arguments),
            ))
        }
        _ if id.is_some() => Some(error_response(
            id.as_ref(),
            -32601,
            "Method not found",
            json!({"method": method}),
        )),
        _ => None,
    }
}

fn tool_names() -> Vec<&'static str> {
    vec![
        "unone_project_inspect",
        "unone_asset_inspect",
        "unone_platform_capabilities",
        "unone_api_search",
        "unone_api_describe",
        "unone_check",
        "unone_run",
        "unone_test",
        "unone_observe",
        "unone_bundle_pack",
        "unone_bundle_inspect",
        "unone_bundle_install",
    ]
}

fn tool_definitions() -> Vec<Value> {
    vec![
        tool(
            "unone_project_inspect",
            "Inspect project",
            "Read the current Unone project configuration, entry script, scene, tests, and bundle configuration. No files are modified.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_asset_inspect",
            "Inspect asset references",
            "Compare main-scene sprite and mesh3d asset references with the game-owned asset manifest, source files, and declared bundle ids. Static inspection does not discover assets selected dynamically by Luau.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_platform_capabilities",
            "Inspect platform capabilities",
            "Report verified native/Web capabilities and explicitly pending host work. Do not infer a pending platform from a compile-only result.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_api_search",
            "Search engine API by meaning",
            "Find the smallest public engine API matching a natural-language need. Results include purpose, when_not_to_use, side effects, frame semantics, errors, and examples.",
            object_schema(json!({
                "properties": {
                    "meaning": {"type": "string", "description": "Natural-language intent, such as move an entity or read pointer input."}
                },
                "required": ["meaning"]
            })),
            true,
            true,
        ),
        tool(
            "unone_api_describe",
            "Describe engine API",
            "Return semantic metadata for one public engine API, including common errors and related APIs.",
            object_schema(json!({
                "properties": {
                    "name": {"type": "string", "description": "API name, for example entity.setPosition."}
                },
                "required": ["name"]
            })),
            true,
            true,
        ),
        tool(
            "unone_check",
            "Check Luau project",
            "Run the project contract check; set types=true to also run the pinned official luau-analyze adapter.",
            object_schema(json!({
                "properties": {
                    "types": {"type": "boolean", "default": false}
                }
            })),
            true,
            true,
        ),
        tool(
            "unone_run",
            "Run deterministic game frames",
            "Run the current project headlessly and return world state, semantic trace, diagnostics, and observation_digest. Use input_sequence for explicit actions and world-space pointer replay.",
            object_schema(json!({
                "properties": {
                    "frames": {"type": "integer", "minimum": 0, "default": 60},
                    "seed": {"type": "integer", "minimum": 0, "default": 42},
                    "action": {"type": "string", "description": "One semantic action held for the run."},
                    "input_sequence": {
                        "type": "array",
                        "description": "Per-frame objects with actions and optional world-space pointer.",
                        "items": {"type": "object"}
                    }
                }
            })),
            true,
            true,
        ),
        tool(
            "unone_test",
            "Run game tests",
            "Run the project's deterministic test manifests and return every case, failure, digest, and semantic diagnostic.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_observe",
            "Observe initial world",
            "Load the project and return the initial semantic world snapshot. Use run for a post-simulation observation.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_bundle_pack",
            "Pack project bundles",
            "Generate the minimal project/script/scene bundle manifest, update project.unone.json, and return content hashes and the manifest version.",
            object_schema(json!({
                "properties": {
                    "output": {"type": "string", "description": "Optional manifest path relative to the project root."}
                }
            })),
            false,
            false,
        ),
        tool(
            "unone_bundle_inspect",
            "Inspect bundle state",
            "Read manifest, source/cache verification, available content, active generation, and active bundle hashes.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_bundle_install",
            "Install and activate bundle",
            "Verify the requested local bundle and dependencies, stage them, and activate a new generation. A failed verify leaves the previous active generation intact.",
            object_schema(json!({
                "properties": {
                    "id": {"type": "string", "description": "Bundle id from the project manifest."}
                },
                "required": ["id"]
            })),
            false,
            false,
        ),
    ]
}

fn tool(
    name: &str,
    title: &str,
    description: &str,
    input_schema: Value,
    read_only: bool,
    idempotent: bool,
) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": input_schema,
        "annotations": {
            "readOnlyHint": read_only,
            "idempotentHint": idempotent,
            "openWorldHint": false
        }
    })
}

fn object_schema(extra: Value) -> Value {
    let mut schema = json!({"type": "object"});
    if let (Some(base), Some(extra_object)) = (schema.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_object {
            base.insert(key.clone(), value.clone());
        }
    }
    schema
}

fn call_tool(project: &Path, name: &str, arguments: &Value) -> Value {
    match name {
        "unone_project_inspect" => tool_result(inspect_project(project)),
        "unone_asset_inspect" => tool_result(inspect_assets(project)),
        "unone_platform_capabilities" => tool_result(platform_capabilities()),
        "unone_api_search" => match required_string(arguments, "meaning") {
            Ok(meaning) => {
                let matches = api_search(&meaning);
                let mut result = EngineResult::success(unone_engine::ApiSearchReport {
                    query: meaning,
                    matches,
                });
                if result
                    .value
                    .as_ref()
                    .is_some_and(|report| report.matches.is_empty())
                {
                    result.diagnostics.push(Diagnostic::warning(
                        "API_SEARCH_EMPTY",
                        "沒有找到符合語意的 Engine API",
                        "搜尋只涵蓋目前公開的最小 API；請改用更具體的動詞或先查看 project inspect。",
                    ));
                }
                tool_result(result)
            }
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_api_describe" => match required_string(arguments, "name") {
            Ok(name) => match api_describe(&name) {
                Some(descriptor) => tool_result(EngineResult::success(descriptor)),
                None => {
                    let mut diagnostic = Diagnostic::error(
                        "API_NOT_FOUND",
                        "找不到指定的 Engine API",
                        format!(
                            "目前公開 API 沒有 '{}'；先使用 unone_api_search 查詢可用能力。",
                            name
                        ),
                    );
                    diagnostic.facts = json!({"name": name});
                    argument_error(diagnostic)
                }
            },
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_check" => match optional_bool(arguments, "types", false) {
            Ok(types) => tool_result(if types {
                EngineRuntime::check_with_types(project)
            } else {
                EngineRuntime::check(project)
            }),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_run" => run_tool(project, arguments),
        "unone_test" => tool_result(EngineRuntime::run_tests(project)),
        "unone_observe" => match EngineRuntime::load(project) {
            Ok(runtime) => tool_result(EngineResult::success(runtime.observe())),
            Err(diagnostic) => tool_result(EngineResult::<Value>::failure(*diagnostic)),
        },
        "unone_bundle_pack" => match optional_string(arguments, "output") {
            Ok(output) => tool_result(pack_project(project, output.as_deref().map(Path::new))),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_bundle_inspect" => match BundleManager::from_project(project) {
            Ok(manager) => tool_result(manager.inspect()),
            Err(diagnostic) => tool_result(EngineResult::<Value>::failure(*diagnostic)),
        },
        "unone_bundle_install" => match required_string(arguments, "id") {
            Ok(id) => match BundleManager::from_project(project) {
                Ok(manager) => tool_result(manager.install(&id)),
                Err(diagnostic) => tool_result(EngineResult::<Value>::failure(*diagnostic)),
            },
            Err(diagnostic) => argument_error(*diagnostic),
        },
        _ => unreachable!("tool name checked before dispatch"),
    }
}

fn run_tool(project: &Path, arguments: &Value) -> Value {
    let frames = match optional_u64(arguments, "frames", 60) {
        Ok(frames) => frames,
        Err(diagnostic) => return argument_error(*diagnostic),
    };
    let seed = match optional_u64(arguments, "seed", 42) {
        Ok(seed) => seed,
        Err(diagnostic) => return argument_error(*diagnostic),
    };
    let action = match optional_string(arguments, "action") {
        Ok(action) => action,
        Err(diagnostic) => return argument_error(*diagnostic),
    };
    let input_sequence = match arguments.get("input_sequence") {
        None => None,
        Some(value) => match serde_json::from_value::<Vec<InputFrame>>(value.clone()) {
            Ok(sequence) => Some(sequence),
            Err(error) => {
                return argument_error(Diagnostic::error(
                    "INPUT_SEQUENCE_INVALID",
                    "input_sequence 不是有效的 input frame 陣列",
                    error.to_string(),
                ));
            }
        },
    };

    if action.is_some() && input_sequence.is_some() {
        return argument_error(Diagnostic::error(
            "MCP_ARGUMENT_CONFLICT",
            "工具參數互相衝突",
            "arguments.action 與 arguments.input_sequence 不能同時提供；請選擇單一輸入模式。",
        ));
    }

    let mut runtime = match EngineRuntime::load_with_seed(project, seed) {
        Ok(runtime) => runtime,
        Err(diagnostic) => return tool_result(EngineResult::<Value>::failure(*diagnostic)),
    };
    if let Some(sequence) = input_sequence {
        return tool_result(runtime.run_with_input_sequence(frames, seed, &sequence));
    }
    if let Some(action) = action {
        runtime.set_input(action, true);
    }
    tool_result(runtime.run(frames, seed))
}

fn required_string(arguments: &Value, name: &str) -> Result<String, Box<Diagnostic>> {
    optional_string(arguments, name)?.ok_or_else(|| {
        Box::new(Diagnostic::error(
            "MCP_ARGUMENT_REQUIRED",
            "缺少必要的工具參數",
            format!("請提供 arguments.{name}（string）。"),
        ))
    })
}

fn optional_string(arguments: &Value, name: &str) -> Result<Option<String>, Box<Diagnostic>> {
    match arguments.get(name) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "工具參數型別錯誤",
            format!("arguments.{name} 必須是 string。"),
        ))),
    }
}

fn optional_bool(arguments: &Value, name: &str, default: bool) -> Result<bool, Box<Diagnostic>> {
    match arguments.get(name) {
        None => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "工具參數型別錯誤",
            format!("arguments.{name} 必須是 boolean。"),
        ))),
    }
}

fn optional_u64(arguments: &Value, name: &str, default: u64) -> Result<u64, Box<Diagnostic>> {
    match arguments.get(name) {
        None => Ok(default),
        Some(Value::Number(value)) => value.as_u64().ok_or_else(|| {
            Box::new(Diagnostic::error(
                "MCP_ARGUMENT_INVALID",
                "工具參數型別錯誤",
                format!("arguments.{name} 必須是非負整數。"),
            ))
        }),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "工具參數型別錯誤",
            format!("arguments.{name} 必須是非負整數。"),
        ))),
    }
}

fn argument_error(diagnostic: Diagnostic) -> Value {
    tool_result(EngineResult::<Value>::failure(diagnostic))
}

fn tool_result<T: serde::Serialize>(result: EngineResult<T>) -> Value {
    let is_error = !result.ok;
    let text = serde_json::to_string_pretty(&result)
        .unwrap_or_else(|error| json!({"serialization_error": error.to_string()}).to_string());
    json!({
        "content": [{"type": "text", "text": text}],
        "isError": is_error
    })
}

fn success_response(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn error_response(id: Option<&Value>, code: i64, message: &str, data: Value) -> Value {
    let mut response = Map::new();
    response.insert("jsonrpc".to_string(), json!("2.0"));
    if let Some(id) = id {
        response.insert("id".to_string(), id.clone());
    }
    response.insert(
        "error".to_string(),
        json!({"code": code, "message": message, "data": data}),
    );
    Value::Object(response)
}

#[cfg(test)]
mod tests {
    use super::{ProtocolState, call_tool, handle_message, tool_definitions};
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn initialize_requires_initialized_notification_before_tools() {
        let mut state = ProtocolState::default();
        let initialize = handle_message(
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"}
                }
            }),
            Path::new("."),
            &mut state,
        )
        .unwrap();
        assert_eq!(initialize["result"]["protocolVersion"], "2025-11-25");
        assert!(
            handle_message(
                json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
                Path::new("."),
                &mut state,
            )
            .is_none()
        );
        let listed = handle_message(
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            Path::new("."),
            &mut state,
        )
        .unwrap();
        assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 12);
    }

    #[test]
    fn tool_definitions_are_deterministic_and_semantic() {
        let tools = tool_definitions();
        let names: Vec<&str> = tools
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(names.first(), Some(&"unone_project_inspect"));
        assert_eq!(names.last(), Some(&"unone_bundle_install"));
        assert!(
            tools[0]["description"]
                .as_str()
                .unwrap()
                .contains("No files")
        );
        assert_eq!(tools[5]["inputSchema"]["type"], "object");
    }

    #[test]
    fn unknown_method_returns_json_rpc_error() {
        let mut state = ProtocolState {
            initialize_seen: true,
            initialized: true,
            protocol_version: Some("2025-11-25".to_string()),
        };
        let response = handle_message(
            json!({"jsonrpc": "2.0", "id": "x", "method": "unknown"}),
            Path::new("."),
            &mut state,
        )
        .unwrap();
        assert_eq!(response["error"]["code"], -32601);
    }

    #[test]
    fn run_rejects_conflicting_input_modes_with_semantic_tool_error() {
        let result = call_tool(
            Path::new("."),
            "unone_run",
            &json!({
                "action": "Right",
                "input_sequence": [{"actions": {"Right": true}}]
            }),
        );
        assert_eq!(result["isError"], true);
        let payload: serde_json::Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload["diagnostics"][0]["code"], "MCP_ARGUMENT_CONFLICT");
    }
}
