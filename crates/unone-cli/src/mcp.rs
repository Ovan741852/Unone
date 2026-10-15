use std::{
    io::{self, BufRead, Write},
    path::Path,
    process::ExitCode,
};

use anyhow::Result;
use serde_json::{Map, Value, json};
use unone_engine::{
    AssetSpec, BundleManager, Diagnostic, EngineResult, EngineRuntime, InputFrame, api_describe,
    api_search_result, asset_usages, describe_asset, init_asset_manifest, init_project, inspect_assets,
    inspect_assets_strict, inspect_project, inspect_systems, pack_project, platform_capabilities,
    read_asset, search_systems, set_system,
};

const LATEST_PROTOCOL_VERSION: &str = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];

#[derive(Default)]
struct ProtocolState {
    initialize_seen: bool,
    initialized: bool,
    protocol_version: Option<String>,
    developer: unone_engine::DeveloperProtocol,
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
                if name == "unone_session" {
                    tool_result(state.developer.execute_json(project, arguments))
                } else {
                    call_tool(project, name, &arguments)
                },
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
        "unone_session",
        "unone_plugin_list",
        "unone_plugin_inspect",
        "unone_plugin_call",
        "unone_project_inspect",
        "unone_project_init",
        "unone_project_sync",
        "unone_project_prepare_inspect",
        "unone_asset_inspect",
        "unone_asset_describe",
        "unone_asset_usages",
        "unone_asset_read",
        "unone_asset_init",
        "unone_verify",
        "unone_perf",
        "unone_replay_diff",
        "unone_replay_fingerprint",
        "unone_replay_describe",
        "unone_replay_scenario",
        "unone_ui_preview",
        "unone_systems_list",
        "unone_systems_search",
        "unone_systems_set",
        "unone_platform_capabilities",
        "unone_platform_snapshot",
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
            "unone_session",
            "Control, observe and diagnose a persistent developer session",
            "Open one headless runtime per connection. Snapshot selects stable entity/UI ids and JSON pointers. Step applies keyboard/pointer input for 1..600 deterministic ticks. Journal reads bounded history; watch polls incremental filtered changes without ticking (use next_cursor, honor lost_events). Enact previews or atomically applies transient typed edits between ticks using expected_revision; it never saves authoring files. Perf exposes measured runtime phase costs, counts and memory for AI analysis, not an automatic bottleneck verdict; rendering/transport are excluded. Recording exports inputs/edits and expected digests; replay reruns them independently and reports the first divergence. A script failure freezes mutations but preserves inspection and recording. Close releases the session. This does not attach to a separately running browser/native preview.",
            unone_engine::developer_request_schema(),
            false,
            false,
        ),
        tool(
            "unone_plugin_list",
            "List optional plugins",
            "Discover installed AI-facing plugins from the project and engine package. Plugins are optional; use their declared tools only when the capability is needed.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_plugin_inspect",
            "Inspect an optional plugin",
            "Read one plugin manifest, capabilities, permissions, and AI-facing tool schemas without starting the plugin process.",
            object_schema(json!({
                "properties": {
                    "id": {"type": "string", "description": "Plugin id, for example org.unone.blender."}
                },
                "required": ["id"]
            })),
            true,
            true,
        ),
        tool(
            "unone_plugin_call",
            "Call an optional plugin tool",
            "Call one declared plugin tool through the versioned Unone plugin protocol. The plugin runs out of process and returns structured JSON; it may create staged artifacts but must not silently mutate the game.",
            object_schema(json!({
                "properties": {
                    "id": {"type": "string", "description": "Plugin id."},
                    "tool": {"type": "string", "description": "Tool name from unone_plugin_inspect."},
                    "input": {"type": "object", "description": "Tool-specific JSON object."}
                },
                "required": ["id", "tool"]
            })),
            false,
            false,
        ),
        tool(
            "unone_project_inspect",
            "Inspect project",
            "Read the current Unone project configuration, entry script, scene, tests, and bundle configuration. No files are modified.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_project_sync",
            "Synchronize project content",
            "Run the engine-owned pack → verify → bundle activation workflow as one operation. The result preserves pack, verify, and activation reports; a failed verify never activates a new generation. This does not install plugins, contact a network, or execute arbitrary commands.",
            object_schema(json!({})),
            false,
            false,
        ),
        tool(
            "unone_project_prepare_inspect",
            "Inspect preview target readiness",
            "Read-only target/runtime/system/presentation preflight for the Web or Windows project-prepare handoff. It never packs, activates, exports, or creates an output directory; use project prepare after this check when a new generation is authorized.",
            object_schema(json!({
                "properties": {
                    "target": {"type": "string", "enum": ["web", "windows"]},
                    "runtime_id": {"type": "string", "description": "Optional trusted SDK runtime id."},
                    "development": {"type": "boolean", "default": false}
                },
                "required": ["target"]
            })),
            true,
            true,
        ),
        tool(
            "unone_project_init",
            "Initialize project scaffold",
            "Create a seven-file official-player starter: project config, strict Luau script, scene with declarative particles, player presentation, authoring instructions, and idle/input tests. Root must be new or truly empty, including no .git or plan file; links and parent traversal are rejected. May create missing parent directories. Returns actual files/effects and next actions for the unmodified starter; no implicit pack/install. Partial failure reports created files/directories without deleting them; retry does not resume or overwrite. Starter tests are not game acceptance.",
            object_schema(json!({
                "properties": {
                    "name": {"type": "string", "description": "Project name written to project.unone.json."}
                },
                "required": ["name"]
            })),
            false,
            false,
        ),
        tool(
            "unone_asset_inspect",
            "Inspect asset references",
            "Compare main-scene asset references with the game-owned asset manifest, source files, and declared bundle ids. Static inspection does not discover assets selected dynamically by Luau. Set strict=true for a failing handoff/release gate; use unone_asset_describe for one asset's authoring, active, and publication workflow.",
            object_schema(json!({
                "properties": {
                    "strict": {"type": "boolean", "default": false, "description": "Turn unresolved static references and missing files into ok=false."}
                }
            })),
            true,
            true,
        ),
        tool(
            "unone_asset_describe",
            "Describe one asset workflow",
            "Read one asset's authoring files, legacy static main-scene references, project-wide usages evidence, native-local publication freshness and next actions. usages distinguishes syntactic references, literal/template candidates and unresolved dynamic sites; it never proves runtime completeness or safe deletion. Read-only; no scripts executed.",
            object_schema(json!({
                "properties": {
                    "id": {"type": "string", "description": "Declared asset id, for example asset://characters/hero."}
                },
                "required": ["id"]
            })),
            true,
            true,
        ),
        tool(
            "unone_asset_usages",
            "Find asset usages across project sources",
            "Read-only bounded Luau/Lua and JSON source index with files, line/column or JSON pointer, source hashes, syntactic asset fields, literal/template candidates, same-file aliases and project-wide unresolved dynamic sites. Optional id accepts a declared asset id or primary source path; omit for the complete index. Generated/dependency/test directories are excluded and the scan scope/issues are explicit. No script execution, no reachability proof, no safe-delete inference.",
            object_schema(json!({"properties":{"id":{"type":"string","minLength":1,"description":"Declared asset id or primary source path. Omit for all assets."}}})),
            true,
            true,
        ),
        tool(
            "unone_asset_read",
            "Read a declared asset",
            "Resolve one declared asset id from the project's active bundle generation and report its verified size and sha256. The engine verifies bundle and archive entry integrity only; decoding, texture upload, download policy and cache quota stay in each host. Provide output to also write the verified bytes to a file.",
            object_schema(json!({
                "properties": {
                    "file": {"type": "string", "description": "Read one declared companion file (from the asset's files list) instead of the asset source."},
                    "id": {"type": "string", "description": "Declared asset id, for example asset://characters/hero."},
                    "output": {"type": "string", "description": "Optional path that receives the verified asset bytes."}
                },
                "required": ["id"]
            })),
            false,
            false,
        ),
        tool(
            "unone_asset_init",
            "Initialize asset manifest",
            "Create an empty version-1 asset manifest or add one explicit asset declaration. This writes only inside the current game project; it never creates or guesses source files.",
            object_schema(json!({
                "properties": {
                    "output": {"type": "string", "description": "Optional manifest path relative to the project root."},
                    "files": {"type": "array", "items": {"type": "string"}, "description": "Companion project-relative sources this asset cannot be used without, such as a Spine atlas and its texture pages."},
                    "id": {"type": "string", "description": "Stable asset id; provide with source to append a declaration."},
                    "source": {"type": "string", "description": "Project-relative source path; provide with id."},
                    "kind": {"type": "string", "enum": unone_engine::SUPPORTED_ASSET_KINDS, "default": "texture2d"},
                    "bundle": {"type": "string", "default": "content"}
                }
            })),
            false,
            false,
        ),
        tool(
            "unone_verify",
            "Run every gate",
            "Run all four gates a game must pass — Luau types, strict asset declarations, screen layout structure, and the deterministic tests — and return one verdict with what each step found. Every step runs even after one fails, so a caller sees the whole picture instead of only the first break. Each step names the single command that reproduces it. Prefer this over running the gates one at a time.",
            object_schema(json!({"properties": {}})),
            true,
            true,
        ),
        tool(
            "unone_perf",
            "Measure frame cost",
            "Run the project and report where a frame's time goes: script, physics and observe phases with their share, mean/median/p95 frame time, the slowest frame, how many frames missed the fixed timestep budget, the Luau heap size, and what a frame contained. Timings are wall clock and never enter the observation digest, so measuring cannot change what a run means. It reports numbers and never a verdict: fast enough depends on a target the engine does not know.",
            object_schema(json!({
                "properties": {
                    "frames": {"type": "integer", "minimum": 1, "default": 600, "description": "Frames to measure; more frames make the percentiles meaningful."},
                    "seed": {"type": "integer", "minimum": 0, "default": 42}
                }
            })),
            true,
            true,
        ),
        tool(
            "unone_replay_diff",
            "Find what a change altered",
            "Replay a recording made by `game replay record` against the project as it is now, and report the first frame that stops matching plus every field that differs there, as dotted paths into the observation. A changed digest only says something differs; this says which frame and which field. Recordings hold no wall-clock timing, so a slower machine never shows up as a difference.",
            object_schema(json!({
                "properties": {
                    "baseline": {"type": "string", "description": "Path to a recording file written by game replay record."}
                },
                "required": ["baseline"]
            })),
            true,
            true,
        ),
        tool(
            "unone_ui_preview",
            "Draw the UI as text",
            "Run the project, then draw the published UI tree as a character grid and report structural layout problems: nodes that overlap, and text that cannot fit the box it declares. An AI author cannot see the screen, and every other gate passes while controls sit on top of each other, so read this before claiming a screen is done. It reports structure only and says nothing about whether the screen looks good. Set strict=true for a failing gate.",
            object_schema(json!({
                "properties": {
                    "frames": {"type": "integer", "minimum": 0, "default": 1, "description": "Frames to run before drawing."},
                    "seed": {"type": "integer", "minimum": 0, "default": 42},
                    "cols": {"type": "integer", "minimum": 16, "maximum": 400, "description": "Grid columns; defaults to 96."},
                    "rows": {"type": "integer", "minimum": 8, "maximum": 200, "description": "Grid rows; defaults to 48."},
                    "strict": {"type": "boolean", "default": false, "description": "Turn layout findings into ok=false."}
                    ,"overlap_policy":{"type":"object","description":"version:1, screens:{screen:[{behind,front,reason}]}; only earlier background images may be exempted."}
                }
            })),
            true,
            true,
        ),
        tool(
            "unone_systems_list",
            "List engine systems",
            "Report every engine system, whether this project runs it, and whether that came from the project config or the engine default. Use it before assuming a capability exists: a system marked not_implemented has a contract but no engine or host implementation.",
            object_schema(json!({"properties": {}})),
            true,
            true,
        ),
        tool(
            "unone_systems_search",
            "Search engine systems",
            "Find systems by meaning, for example 物理 or 存檔, so a game can decide what it does not need. Returns what each system provides, what disabling it changes, and when a game would disable it.",
            object_schema(json!({
                "properties": {
                    "meaning": {"type": "string", "description": "What the game needs or wants to drop."}
                },
                "required": ["meaning"]
            })),
            true,
            true,
        ),
        tool(
            "unone_systems_set",
            "Switch an engine system",
            "Turn one system on or off in the game's own project.unone.json. Unknown ids, systems the runtime requires, and systems with no implementation are rejected with a semantic error instead of being written silently.",
            object_schema(json!({
                "properties": {
                    "id": {"type": "string", "description": "System id, for example physics2d."},
                    "enabled": {"type": "boolean", "description": "true to enable, false to disable."}
                },
                "required": ["id", "enabled"]
            })),
            false,
            false,
        ),
        tool(
            "unone_platform_capabilities",
            "Inspect platform capabilities",
            "Report verified native/Web capabilities and explicitly pending host work. Do not infer a pending platform from a compile-only result.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool("unone_replay_fingerprint", "Fingerprint headless replay target",
            "Hash a private snapshot of declared project assets and Luau sources plus the actual CLI binary. Use this explicit target for replay scenario; no game execution.", object_schema(json!({"properties":{}})), true, true),
        tool("unone_replay_describe", "Learn the replay contract",
            "Return embedded usage, reproduction/result schemas and a real Luau adapter example. No repository checkout or Viewer required.",object_schema(json!({"properties":{}})),true,true),
        tool("unone_replay_scenario", "Replay a versioned scenario",
            "Run a request JSON in an isolated worker. Checks fingerprints, offline scenario schema and complete inputs; returns reproduced/not_reproduced/incompatible/incomplete/execution_failed plus independent regression verdicts, profiler and optional memory samples. Headless start captures only; no checkpoint restoration. Does not change source capture or production save.",
            object_schema(json!({"properties":{"request":{"type":"string","description":"Path to request JSON; see docs/diagnostics-replay.md"}},"required":["request"]})), true, true),
        tool(
            "unone_platform_snapshot",
            "Snapshot current AI capabilities",
            "Aggregate the current platform, runtime, renderer, and plugin capability states with explicit verified/partial/pending status, limitations, evidence, and minimal examples. This is read-only and does not start plugins or probe a renderer.",
            object_schema(json!({})),
            true,
            true,
        ),
        tool(
            "unone_api_search",
            "Search engine API by meaning",
            "Find the smallest public engine API matching a natural-language need. Pass meaning=\"\" to list the complete public engine API index. A non-empty no-match search remains successful and explains how to inspect primitives and systems before assuming an engine capability is missing; inspect value.suggested_next_actions for structured executable/argv, with project-dependent actions bound to this caller project or marked not ready. Results include purpose, when_not_to_use, side effects, frame semantics, errors, and examples.",
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
            "Verify either one requested bundle id or all manifest bundles and their dependencies, then activate one new generation. Use id alone or with all=false, or use all=true without id; omit both and id with all=true are semantic errors. A failed verify leaves the previous active generation intact.",
            object_schema(json!({
                "oneOf": [
                    {
                        "required": ["id"],
                        "properties": {"all": {"const": false}}
                    },
                    {
                        "required": ["all"],
                        "properties": {"all": {"const": true}},
                        "not": {"required": ["id"]}
                    }
                ],
                "properties": {
                    "id": {"type": "string", "description": "Bundle id from the project manifest; choose this or all=true."},
                    "all": {"type": "boolean", "description": "Set true to select every bundle; omit it or set false when selecting id."}
                },
                "additionalProperties": false
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
    let mut schema = json!({"type": "object", "additionalProperties": false});
    if let (Some(base), Some(extra_object)) = (schema.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_object {
            base.insert(key.clone(), value.clone());
        }
    }
    schema
}

fn call_tool(project: &Path, name: &str, arguments: &Value) -> Value {
    // The advertised property set is also the accepted property set. Never
    // silently discard a misspelled argument before calling the typed engine.
    if let Some(definition) = tool_definitions().iter().find(|definition| definition["name"] == name)
        && let Some(arguments) = arguments.as_object() {
        let empty = Map::new();
        let properties = definition["inputSchema"].get("properties").and_then(Value::as_object).unwrap_or(&empty);
        if let Some(key) = arguments.keys().find(|key| !properties.contains_key(*key)) {
            let mut diagnostic = Diagnostic::error("MCP_ARGUMENT_UNKNOWN", "Unknown tool argument", format!("Tool '{name}' does not accept '{key}'"));
            diagnostic.facts = json!({"tool":name,"field":key,"accepted_fields":properties.keys().collect::<Vec<_>>()});
            return argument_error(diagnostic);
        }
    }
    match name {
        "unone_plugin_list" => tool_result(crate::plugins::list(project)),
        "unone_plugin_inspect" => match required_string(arguments, "id") {
            Ok(id) => tool_result(crate::plugins::inspect(project, &id)),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_plugin_call" => {
            let id = match required_string(arguments, "id") {
                Ok(id) => id,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let tool = match required_string(arguments, "tool") {
                Ok(tool) => tool,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let input = arguments.get("input").cloned().unwrap_or_else(|| json!({}));
            if !input.is_object() {
                return argument_error(Diagnostic::error(
                    "MCP_ARGUMENT_INVALID",
                    "Tool argument has the wrong type",
                    "arguments.input must be an object.",
                ));
            }
            tool_result(crate::plugins::call(project, &id, &tool, input))
        }
        "unone_project_inspect" => tool_result(inspect_project(project)),
        "unone_project_sync" => tool_result(crate::sync::sync_project(project)),
        "unone_project_prepare_inspect" => {
            let target = match required_string(arguments, "target") {
                Ok(target) => target,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let runtime_id = match optional_string(arguments, "runtime_id") {
                Ok(runtime_id) => runtime_id,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let development = match optional_bool(arguments, "development", false) {
                Ok(development) => development,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            tool_result(crate::prepare::project_preflight(
                project,
                None,
                &target,
                runtime_id.as_deref(),
                development,
            ))
        }
        "unone_project_init" => match required_string(arguments, "name") {
            Ok(name) => tool_result(init_project(project, &name)),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_asset_inspect" => match optional_bool(arguments, "strict", false) {
            Ok(strict) => tool_result(if strict {
                inspect_assets_strict(project)
            } else {
                inspect_assets(project)
            }),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_asset_describe" => match required_string(arguments, "id") {
            Ok(id) => tool_result(describe_asset(project, &id)),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_asset_usages" => match optional_string(arguments, "id") {
            Ok(id) => tool_result(asset_usages(project, id.as_deref())),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_asset_read" => {
            let id = match required_string(arguments, "id") {
                Ok(id) => id,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let output = match optional_string(arguments, "output") {
                Ok(output) => output,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let file = match optional_string(arguments, "file") {
                Ok(file) => file,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            tool_result(read_asset(
                project,
                &id,
                file.as_deref(),
                output.as_deref().map(std::path::Path::new),
            ))
        }
        "unone_verify" => tool_result(unone_engine::verify(project)),
        "unone_perf" => {
            let frames = match optional_u64(arguments, "frames", 600) {
                Ok(frames) => frames,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let seed = match optional_u64(arguments, "seed", 42) {
                Ok(seed) => seed,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let mut runtime = match EngineRuntime::load_with_seed(project, seed) {
                Ok(runtime) => runtime,
                Err(diagnostic) => {
                    return tool_result(EngineResult::<serde_json::Value>::failure(*diagnostic));
                }
            };
            let run = runtime.run(frames, seed);
            match run.value {
                Some(report) => tool_result(EngineResult::success(report.performance)),
                None => {
                    let mut result = EngineResult::<serde_json::Value>::failure(Diagnostic::error(
                        "PERF_RUN_FAILED",
                        "The requested frames did not complete, so no measurement is available",
                        "Use game run or game verify to find the runtime problem first.",
                    ));
                    result.diagnostics.extend(run.diagnostics);
                    tool_result(result)
                }
            }
        }
        "unone_replay_fingerprint" => tool_result(crate::diagnostics_replay::fingerprint_result(project)),
        "unone_replay_describe" => tool_result(EngineResult::success(crate::diagnostics_replay::describe())),
        "unone_replay_scenario" => match required_string(arguments, "request") {
            Ok(path) => tool_result(crate::diagnostics_replay::run(project, Path::new(&path))),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_replay_diff" => match required_string(arguments, "baseline") {
            Ok(baseline) => match unone_engine::read_recording(Path::new(&baseline)) {
                Ok(recording) => tool_result(unone_engine::diff_run(project, &recording)),
                Err(diagnostic) => {
                    tool_result(EngineResult::<serde_json::Value>::failure(*diagnostic))
                }
            },
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_ui_preview" => {
            let frames = match optional_u64(arguments, "frames", 1) {
                Ok(frames) => frames,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let seed = match optional_u64(arguments, "seed", 42) {
                Ok(seed) => seed,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let cols =
                match optional_u64(arguments, "cols", unone_engine::DEFAULT_LAYOUT_COLS as u64) {
                    Ok(cols) => cols as usize,
                    Err(diagnostic) => return argument_error(*diagnostic),
                };
            let rows =
                match optional_u64(arguments, "rows", unone_engine::DEFAULT_LAYOUT_ROWS as u64) {
                    Ok(rows) => rows as usize,
                    Err(diagnostic) => return argument_error(*diagnostic),
                };
            let strict = match optional_bool(arguments, "strict", false) {
                Ok(strict) => strict,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            tool_result(ui_preview(project, frames, seed, cols, rows, strict, arguments.get("overlap_policy")))
        }
        "unone_systems_list" => tool_result(inspect_systems(project)),
        "unone_systems_search" => match required_string(arguments, "meaning") {
            Ok(meaning) => {
                let matches = search_systems(&meaning);
                tool_result(EngineResult::success(unone_engine::SystemSearchReport {
                    query: meaning,
                    matches,
                }))
            }
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_systems_set" => {
            let id = match required_string(arguments, "id") {
                Ok(id) => id,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let enabled = match required_bool(arguments, "enabled") {
                Ok(enabled) => enabled,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            tool_result(set_system(project, &id, enabled))
        }
        "unone_asset_init" => {
            let output = match optional_string(arguments, "output") {
                Ok(output) => output,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let id = match optional_string(arguments, "id") {
                Ok(id) => id,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let source = match optional_string(arguments, "source") {
                Ok(source) => source,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let kind = match optional_string(arguments, "kind") {
                Ok(kind) => kind.unwrap_or_else(|| "texture2d".to_string()),
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let bundle = match optional_string(arguments, "bundle") {
                Ok(bundle) => bundle.unwrap_or_else(|| "content".to_string()),
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let files = match optional_string_array(arguments, "files") {
                Ok(files) => files,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            let new_asset = match (id, source) {
                (None, None) => None,
                (Some(id), Some(source)) => Some(AssetSpec {
                    id,
                    source,
                    kind,
                    bundle,
                    files,
                    encoding: None,
                }),
                _ => {
                    return argument_error(Diagnostic::error(
                        "ASSET_INIT_ARGUMENT_INVALID",
                        "asset init requires id and source together",
                        "Adding an asset declaration requires both id and source; without either, asset init only creates an empty manifest.",
                    ));
                }
            };
            tool_result(init_asset_manifest(
                project,
                output.as_deref().map(Path::new),
                new_asset,
            ))
        }
        "unone_platform_capabilities" => tool_result(platform_capabilities()),
        "unone_platform_snapshot" => tool_result(crate::capabilities::snapshot(project)),
        "unone_api_search" => match required_string(arguments, "meaning") {
            Ok(meaning) => tool_result(api_search_result(project, &meaning)),
            Err(diagnostic) => argument_error(*diagnostic),
        },
        "unone_api_describe" => match required_string(arguments, "name") {
            Ok(name) => match api_describe(&name) {
                Some(descriptor) => tool_result(EngineResult::success(descriptor)),
                None => {
                    let mut diagnostic = Diagnostic::error(
                        "API_NOT_FOUND",
                        "No such Engine API",
                        format!(
                            "The public API has no '{}'; use unone_api_search to find available capabilities.",
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
        "unone_bundle_install" => {
            let (id, all) = match bundle_install_arguments(arguments) {
                Ok(selection) => selection,
                Err(diagnostic) => return argument_error(*diagnostic),
            };
            match BundleManager::from_project(project) {
                Ok(manager) => tool_result(manager.install_selected(id.as_deref(), all)),
                Err(diagnostic) => tool_result(EngineResult::<Value>::failure(*diagnostic)),
            }
        }
        _ => unreachable!("tool name checked before dispatch"),
    }
}

fn bundle_install_arguments(
    arguments: &Value,
) -> Result<(Option<String>, bool), Box<Diagnostic>> {
    let id = optional_string(arguments, "id")?;
    let all = optional_bool(arguments, "all", false)?;
    Ok((id, all))
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
                    "input_sequence is not a valid array of input frames",
                    error.to_string(),
                ));
            }
        },
    };

    if action.is_some() && input_sequence.is_some() {
        return argument_error(Diagnostic::error(
            "MCP_ARGUMENT_CONFLICT",
            "Tool arguments conflict",
            "arguments.action and arguments.input_sequence cannot both be provided; choose one input mode.",
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
            "A required tool argument is missing",
            format!("Provide arguments.{name} (string)."),
        ))
    })
}

fn optional_string(arguments: &Value, name: &str) -> Result<Option<String>, Box<Diagnostic>> {
    match arguments.get(name) {
        None => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "Tool argument has the wrong type",
            format!("arguments.{name} must be a string."),
        ))),
    }
}

fn optional_bool(arguments: &Value, name: &str, default: bool) -> Result<bool, Box<Diagnostic>> {
    match arguments.get(name) {
        None => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "Tool argument has the wrong type",
            format!("arguments.{name} must be a boolean."),
        ))),
    }
}

/// Run the project and report its UI layout, so a caller can read the screen.
fn ui_preview(
    project: &Path,
    frames: u64,
    seed: u64,
    cols: usize,
    rows: usize,
    strict: bool,
    overlap_policy: Option<&serde_json::Value>,
) -> EngineResult<unone_engine::LayoutReport> {
    let mut runtime = match EngineRuntime::load_with_seed(project, seed) {
        Ok(runtime) => runtime,
        Err(diagnostic) => return EngineResult::failure(*diagnostic),
    };
    let run = runtime.run(frames, seed);
    if !run.ok {
        let mut result = EngineResult::<unone_engine::LayoutReport>::failure(Diagnostic::error(
            "UI_PREVIEW_RUN_FAILED",
            "The requested frames did not complete, so there is no UI tree to draw",
            "Use game run or game check to find the runtime problem first.",
        ));
        result.diagnostics.extend(run.diagnostics);
        return result;
    }
    let Some(tree) = runtime.observe().ui else {
        return EngineResult::failure(Diagnostic::error(
            "UI_TREE_NOT_PUBLISHED",
            "The game has not published a UI tree",
            format!("After {frames} frames the observation still has no ui; the game must call api.ui.setRoot first."),
        ));
    };
    let mut report = unone_engine::inspect_layout(&tree, cols, rows);
    if let Some(policy)=overlap_policy
        && let Err(error)=unone_engine::apply_overlap_policy(&mut report,policy) {
            return EngineResult::failure(Diagnostic::error("UI_OVERLAP_POLICY_INVALID","Unsafe or stale overlap policy",error));
        }
    let findings = report.findings.clone();
    let mut result = EngineResult::success(report);
    for finding in &findings {
        let mut diagnostic = if strict {
            Diagnostic::error(
                finding.code.clone(),
                "The UI layout has structural findings",
                finding.detail.clone(),
            )
        } else {
            Diagnostic::warning(
                finding.code.clone(),
                "The UI layout has structural findings",
                finding.detail.clone(),
            )
        };
        diagnostic.facts = json!({"nodes": finding.nodes});
        diagnostic.suggested_actions.push(unone_engine::ActionSuggestion {
            action: "resolve_layout_finding".to_string(),
            description: finding.resolution.clone(),
            command: Some("game ui preview --strict".to_string()),
        });
        result.diagnostics.push(diagnostic);
    }
    if strict && !findings.is_empty() {
        result.ok = false;
    }
    result
}

fn optional_string_array(arguments: &Value, name: &str) -> Result<Vec<String>, Box<Diagnostic>> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    Box::new(Diagnostic::error(
                        "MCP_ARGUMENT_INVALID",
                        "Tool argument has the wrong type",
                        format!("Every item in arguments.{name} must be a string."),
                    ))
                })
            })
            .collect(),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "Tool argument has the wrong type",
            format!("arguments.{name} must be an array of strings."),
        ))),
    }
}

fn required_bool(arguments: &Value, name: &str) -> Result<bool, Box<Diagnostic>> {
    match arguments.get(name) {
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) | None => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "Tool argument has the wrong type",
            format!("arguments.{name} must be a boolean and cannot be omitted."),
        ))),
    }
}

fn optional_u64(arguments: &Value, name: &str, default: u64) -> Result<u64, Box<Diagnostic>> {
    match arguments.get(name) {
        None => Ok(default),
        Some(Value::Number(value)) => value.as_u64().ok_or_else(|| {
            Box::new(Diagnostic::error(
                "MCP_ARGUMENT_INVALID",
                "Tool argument has the wrong type",
                format!("arguments.{name} must be a non-negative integer."),
            ))
        }),
        Some(_) => Err(Box::new(Diagnostic::error(
            "MCP_ARGUMENT_INVALID",
            "Tool argument has the wrong type",
            format!("arguments.{name} must be a non-negative integer."),
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
    use super::{
        ProtocolState, bundle_install_arguments, call_tool, handle_message, tool_definitions,
    };
    use serde_json::json;
    use std::{fs, path::Path};
    use tempfile::tempdir;

    #[test]
    fn advertised_argument_contract_rejects_typos_including_no_argument_tools() {
        for name in ["unone_run", "unone_systems_list", "unone_project_inspect"] {
            let reply = super::call_tool(Path::new("."), name, &json!({"typo":true}));
            assert_eq!(reply["isError"],true,"{reply}");
            let result: serde_json::Value = serde_json::from_str(reply["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(result["diagnostics"][0]["code"],"MCP_ARGUMENT_UNKNOWN","{reply}");
        }
    }

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
        assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), tool_definitions().len());
    }

    #[test]
    fn platform_snapshot_tool_executes_and_returns_the_snapshot_shape() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("project.unone.json"),
            r#"{"name":"McpSnapshot","entry_script":"main.luau"}"#,
        )
        .unwrap();
        fs::write(dir.path().join("main.luau"), "return {}\n").unwrap();

        let reply = call_tool(dir.path(), "unone_platform_snapshot", &json!({}));
        assert_eq!(reply["isError"], false, "{reply}");
        let result: serde_json::Value =
            serde_json::from_str(reply["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(result["value"]["schema_version"], 1);
        assert!(result["value"]["renderers"].is_array());
        assert!(result["value"]["project_systems"].is_object());
    }

    #[test]
    fn prepare_inspect_rejects_non_desktop_targets_without_touching_the_project() {
        let dir = tempdir().unwrap();
        let reply = call_tool(
            dir.path(),
            "unone_project_prepare_inspect",
            &json!({"target": "android-x86_64"}),
        );
        assert_eq!(reply["isError"], true, "{reply}");
        let result: serde_json::Value =
            serde_json::from_str(reply["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(result["value"]["schema"], "unone.project-prepare-preflight.v1");
        assert_eq!(
            result["diagnostics"][0]["code"],
            "PROJECT_PREPARE_TARGET_UNSUPPORTED"
        );
        assert!(!dir.path().join(".unone").exists());
    }

    #[test]
    fn tool_definitions_are_deterministic_and_semantic() {
        let tools = tool_definitions();
        let names: Vec<&str> = tools
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(names.first(), Some(&"unone_session"));
        assert_eq!(names.last(), Some(&"unone_bundle_install"));
        assert!(names.contains(&"unone_asset_describe"));
        assert!(names.contains(&"unone_asset_usages"));
        let usages = tools.iter().find(|tool| tool["name"] == "unone_asset_usages").unwrap();
        assert_eq!(usages["annotations"]["readOnlyHint"], true);
        assert!(names.contains(&"unone_project_sync"));
        assert!(names.contains(&"unone_project_prepare_inspect"));
        assert!(names.contains(&"unone_platform_snapshot"));
        let plugin_list = tools.iter().find(|tool| tool["name"] == "unone_plugin_list").unwrap();
        assert!(plugin_list["description"].as_str().unwrap().contains("optional"));
        let project_init = tools.iter().find(|tool| tool["name"] == "unone_project_init").unwrap();
        assert_eq!(project_init["annotations"]["readOnlyHint"], false);
        let asset_init = tools.iter().find(|tool| tool["name"] == "unone_asset_init").unwrap();
        assert_eq!(asset_init["inputSchema"]["type"], "object");
        assert_eq!(
            asset_init["inputSchema"]["properties"]["kind"]["enum"]
                .as_array()
                .unwrap()
                .len(),
            unone_engine::SUPPORTED_ASSET_KINDS.len()
        );
        let prepare = tools
            .iter()
            .find(|tool| tool["name"] == "unone_project_prepare_inspect")
            .unwrap();
        assert_eq!(prepare["annotations"]["readOnlyHint"], true);
        assert_eq!(
            prepare["inputSchema"]["properties"]["target"]["enum"],
            json!(["web", "windows"])
        );
        let bundle_install = tools
            .iter()
            .find(|tool| tool["name"] == "unone_bundle_install")
            .unwrap();
        assert_eq!(
            bundle_install["inputSchema"]["oneOf"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(bundle_install["inputSchema"].get("required").is_none());
        assert_eq!(
            bundle_install["inputSchema"]["oneOf"][0]["properties"]["all"]["const"],
            false
        );
        assert_eq!(
            bundle_install["inputSchema"]["oneOf"][1]["properties"]["all"]["const"],
            true
        );
        assert_eq!(
            bundle_install["inputSchema"]["properties"]["all"]["type"],
            "boolean"
        );
        assert!(
            bundle_install["inputSchema"]["properties"]["all"]
                .get("const")
                .is_none()
        );
    }

    #[test]
    fn unknown_method_returns_json_rpc_error() {
        let mut state = ProtocolState {
            initialize_seen: true,
            initialized: true,
            protocol_version: Some("2025-11-25".to_string()),
            developer: unone_engine::DeveloperProtocol::default(),
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

    #[test]
    fn bundle_install_arguments_keep_id_false_and_all_false_meanings() {
        assert_eq!(
            bundle_install_arguments(&json!({"id": "content"})).unwrap(),
            (Some("content".to_string()), false)
        );
        assert_eq!(
            bundle_install_arguments(&json!({"id": "content", "all": false})).unwrap(),
            (Some("content".to_string()), false)
        );
        assert_eq!(
            bundle_install_arguments(&json!({"all": true})).unwrap(),
            (None, true)
        );
        assert_eq!(
            bundle_install_arguments(&json!({"all": false})).unwrap(),
            (None, false)
        );
    }

    #[test]
    fn bundle_install_arguments_reject_wrong_types() {
        for arguments in [json!({"id": 7}), json!({"all": "yes"})] {
            let error = bundle_install_arguments(&arguments).unwrap_err();
            assert_eq!(error.code, "MCP_ARGUMENT_INVALID");
        }
    }
}
