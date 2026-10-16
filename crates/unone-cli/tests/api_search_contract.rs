use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

fn cli_search(project_root: &Path, query: &str) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .arg("--project")
        .arg(project_root)
        .args(["--json", "api", "search", query])
        .output()
        .expect("CLI api search should start");
    assert!(
        output.status.success(),
        "CLI api search failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("CLI should emit EngineResult JSON")
}

fn cli_search_from_cwd(current_dir: &Path, project_arg: &Path, query: &str) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .arg("--project")
        .arg(project_arg)
        .args(["--json", "api", "search", query])
        .current_dir(current_dir)
        .output()
        .expect("CLI api search should start");
    assert!(
        output.status.success(),
        "CLI api search failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("CLI should emit EngineResult JSON")
}

fn mcp_search(project_root: &Path, query: &str) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_game"))
        .arg("--project")
        .arg(project_root)
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("MCP server should start");
    let messages = [
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "api-search-contract", "version": "1"}
            }
        }),
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }),
        json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "unone_api_search",
                "arguments": {"meaning": query}
            }
        }),
    ];
    let input = messages
        .iter()
        .map(|message| serde_json::to_string(message).expect("MCP message should serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    child
        .stdin
        .take()
        .expect("MCP stdin should be available")
        .write_all(format!("{input}\n").as_bytes())
        .expect("MCP request should be written");

    let output = child
        .wait_with_output()
        .expect("MCP server should finish after stdin closes");
    assert!(
        output.status.success(),
        "MCP search failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let responses = String::from_utf8(output.stdout)
        .expect("MCP stdout should be UTF-8")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<Value>(line).expect("MCP response should be JSON"))
        .collect::<Vec<_>>();
    let tool_response = responses
        .iter()
        .find(|response| response.get("id") == Some(&json!(2)))
        .expect("MCP tool response should be present");
    let text = tool_response["result"]["content"][0]["text"]
        .as_str()
        .expect("MCP tool response should contain serialized EngineResult");
    serde_json::from_str(text).expect("MCP tool text should contain EngineResult JSON")
}

fn unique_fixture_root(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "unone api search {label} 測試 {} {nonce}",
        std::process::id()
    ));
    assert!(root.is_absolute());
    assert!(root.to_string_lossy().contains(' '));
    root
}

fn init_fixture(project_root: &Path, name: &str) {
    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .arg("--project")
        .arg(project_root)
        .args(["--json", "project", "init", "--name", name])
        .output()
        .expect("project init should start");
    assert!(
        output.status.success(),
        "project init failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value =
        serde_json::from_slice(&output.stdout).expect("project init should emit JSON");
    assert_eq!(result["ok"], true, "project init result: {result}");
}

fn set_physics2d(project_root: &Path, enabled: bool) {
    let config_path = project_root.join("project.unone.json");
    let mut config: Value = serde_json::from_str(
        &fs::read_to_string(&config_path).expect("fixture project config should be readable"),
    )
    .expect("fixture project config should be JSON");
    config["systems"] = json!({"physics2d": enabled});
    fs::write(
        config_path,
        serde_json::to_vec_pretty(&config).expect("fixture project config should serialize"),
    )
    .expect("fixture project config should be writable");
}

fn suggested_action<'a>(result: &'a Value, action: &str) -> &'a Value {
    result["value"]["suggested_next_actions"]
        .as_array()
        .expect("API search report should contain suggested_next_actions")
        .iter()
        .find(|candidate| candidate["action"] == action)
        .unwrap_or_else(|| panic!("missing suggested action {action:?} in {result}"))
}

fn action_argv(action: &Value) -> Vec<String> {
    action["argv"]
        .as_array()
        .expect("ready action should contain argv")
        .iter()
        .map(|argument| {
            argument
                .as_str()
                .expect("structured argv entries should be strings")
                .to_string()
        })
        .collect()
}

fn assert_action_readiness(action: &Value) {
    let ready = action["ready"]
        .as_bool()
        .expect("suggested action should declare ready");
    if ready {
        assert!(action["executable"].is_string());
        assert!(action["argv"].is_array());
        assert!(action["diagnostic"].is_null());
    } else {
        assert!(action["executable"].is_null());
        assert!(action["argv"].is_null());
        assert!(action["diagnostic"].is_object());
    }
}

fn assert_all_action_readiness(result: &Value) {
    for action in result["value"]["suggested_next_actions"]
        .as_array()
        .expect("API search report should contain suggested_next_actions")
    {
        assert_action_readiness(action);
    }
}

#[test]
fn cli_and_mcp_unpacked_results_have_parity_for_no_match_and_full_index() {
    let project_root = unique_fixture_root("parity");
    for query in [
        "攻擊",
        "",
        "position",
        "explosion",
        "粒子特效",
        "particle.play",
        "Effekseer explosion",
    ] {
        assert_eq!(
            cli_search(&project_root, query),
            mcp_search(&project_root, query),
            "CLI and MCP EngineResult mismatch for query {query:?}"
        );
    }
}

#[test]
fn visual_search_guides_cli_and_mcp_to_native_particle_authoring() {
    let project_root = unique_fixture_root("visual discovery");
    for query in ["explosion", "thruster fire", "粒子特效"] {
        let result = cli_search(&project_root, query);
        assert_eq!(result, mcp_search(&project_root, query));
        assert_eq!(result["ok"], true);
        assert_eq!(result["diagnostics"], json!([]));
        let matches = result["value"]["matches"].as_array().unwrap();
        assert_eq!(matches[0]["name"], "particle.play");
        assert!(
            matches[0]["when_to_use"]
                .as_str()
                .unwrap()
                .contains("/web/particle-lab/")
        );
        assert!(
            matches[0]["related_apis"]
                .as_array()
                .unwrap()
                .contains(&json!("effect.spawn"))
        );
        assert!(matches.iter().any(|api| api["name"] == "effect.spawn"));
        assert!(matches.iter().all(|api| {
            let name = api["name"].as_str().unwrap();
            name.starts_with("particle.") || name.starts_with("effect.")
        }));
    }
}

#[test]
fn typography_search_guides_cli_and_mcp_to_the_same_official_ui_contract() {
    let project_root = unique_fixture_root("ui typography discovery");
    for query in [
        "font size",
        "text alignment",
        "border padding",
        "card background",
        "component overlap",
        "reusable card backgrounds",
        "background_for",
        "ancestor background scope",
        "卡片背景",
        "元件重疊",
        "如何處理元件重疊",
        "字體 字級 排版 樣式",
        "font_size",
        "font_family",
        "text_align",
        "letter_spacing",
        "border_radius",
    ] {
        let result = cli_search(&project_root, query);
        assert_eq!(result, mcp_search(&project_root, query));
        assert_eq!(result["ok"], true);
        assert_eq!(result["diagnostics"], json!([]));
        let entry = &result["value"]["matches"][0];
        assert_eq!(entry["name"], "ui.setRoot");
        assert!(
            entry["when_to_use"]
                .as_str()
                .unwrap()
                .contains("docs/ui-styling.md")
        );
        assert!(
            entry["parameters"][0]["meaning"]
                .as_str()
                .unwrap()
                .contains("font_size=2")
        );
        assert!(
            entry["when_to_use"]
                .as_str()
                .unwrap()
                .contains("background_for={component=id}")
        );
        assert!(
            entry["parameters"][0]["meaning"]
                .as_str()
                .unwrap()
                .contains("Exact-pair v1")
        );
        assert!(
            entry["related_apis"]
                .as_array()
                .unwrap()
                .contains(&json!("ui.getViewport"))
        );
    }
    assert_eq!(
        cli_search(&project_root, "responsive")["value"]["matches"][0]["name"],
        "ui.getViewport"
    );
}

#[test]
fn shared_component_search_has_cli_mcp_parity_and_typed_package_guidance() {
    let project_root = unique_fixture_root("official ui package discovery");
    for query in [
        "UI package",
        "shared components",
        "reusable components",
        "component styling",
        "button component",
        "card component",
        "官方UI套件",
        "共用元件",
        "共用 UI 元件",
        "共用UI元件",
        "共用UI組件",
        "UI元件",
        "共享UI组件",
        "主題樣式",
    ] {
        let result = cli_search(&project_root, query);
        assert_eq!(result, mcp_search(&project_root, query), "{query}");
        assert_eq!(result["ok"], true);
        assert_eq!(result["diagnostics"], json!([]));
        let matches = result["value"]["matches"].as_array().unwrap();
        let entry = &matches[0];
        assert_eq!(entry["name"], "ui.components.create", "{query}");
        assert!(
            matches
                .iter()
                .any(|api| api["name"] == "ui.components.info")
        );
        assert!(
            matches
                .iter()
                .all(|api| api["name"].as_str().unwrap().starts_with("ui."))
        );
        assert!(
            entry["when_to_use"]
                .as_str()
                .unwrap()
                .contains("docs/ui-components.md")
        );
        assert!(entry["when_to_use"].as_str().unwrap().contains("0.1.0"));
        assert!(
            entry["returns"]
                .as_str()
                .unwrap()
                .contains("UiComponentKit")
        );
        assert_eq!(entry["parameters"][0]["type_name"], "UiComponentsTheme?");
        assert!(
            entry["parameters"][0]["meaning"]
                .as_str()
                .unwrap()
                .contains("flattened UiPlacement")
        );
        assert!(
            entry["parameters"][0]["meaning"]
                .as_str()
                .unwrap()
                .contains("background_for={component=id}")
        );
        assert!(
            entry["when_not_to_use"]
                .as_str()
                .unwrap()
                .contains("Themes, content, state, actions and geometry belong to project Luau")
        );
    }
    let version = cli_search(&project_root, "UI package version");
    assert_eq!(version, mcp_search(&project_root, "UI package version"));
    assert_eq!(version["value"]["matches"][0]["name"], "ui.components.info");
    assert!(
        version["value"]["matches"][0]["when_to_use"]
            .as_str()
            .unwrap()
            .contains("Available without a runtime_packages declaration")
    );
    for query in [
        "ui.components.info",
        "ui.components.create",
        "ui.components.composeStyle",
        "ui.components.id",
    ] {
        let result = cli_search(&project_root, query);
        assert_eq!(result, mcp_search(&project_root, query));
        let matches = result["value"]["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["name"], query);
    }
    let index = cli_search(&project_root, "");
    let matches = index["value"]["matches"].as_array().unwrap();
    assert!(
        !matches
            .iter()
            .any(|api| api["name"] == "ui.components.button" || api["name"] == "ui.component")
    );
    for query in [
        "entity size",
        "physics3d overlap",
        "ECS元件",
        "UI package unfindable",
    ] {
        let result = cli_search(&project_root, query);
        assert_eq!(result, mcp_search(&project_root, query));
        let matches = result["value"]["matches"].as_array().unwrap();
        if query == "entity size" {
            assert!(
                matches
                    .iter()
                    .any(|api| api["name"] == "entity.getTransform2D")
            );
        } else if query == "physics3d overlap" {
            assert!(
                matches
                    .iter()
                    .any(|api| api["name"].as_str().unwrap().starts_with("physics3d."))
            );
        } else {
            assert!(matches.is_empty(), "{query}");
        }
    }
}

#[test]
fn no_match_contract_has_fixed_facts_and_discovery_actions() {
    let project_root = unique_fixture_root("no-match");
    let result = cli_search(&project_root, "攻擊");

    assert_eq!(result["ok"], true);
    assert_eq!(result["value"]["query"], "攻擊");
    assert_eq!(result["value"]["matches"], json!([]));
    assert_eq!(result["diagnostics"].as_array().unwrap().len(), 1);
    assert_eq!(result["diagnostics"][0]["code"], "API_SEARCH_EMPTY");
    assert_eq!(
        result["diagnostics"][0]["facts"],
        json!({
            "search_scope": "public_engine_api",
            "query": "攻擊",
            "match_count": 0,
        })
    );
    assert_eq!(
        result["diagnostics"][0]["suggested_actions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(
        result["diagnostics"][0]["suggested_actions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|action| action["command"].is_null())
    );

    let full_index = suggested_action(&result, "search_api_index");
    assert_all_action_readiness(&result);
    assert_eq!(full_index["ready"], true);
    assert_eq!(full_index["executable"], "game");
    assert!(
        action_argv(full_index)
            .iter()
            .any(|argument| argument.is_empty())
    );

    let systems = suggested_action(&result, "list_systems");
    assert_eq!(systems["ready"], false);
    assert!(systems["executable"].is_null());
    assert!(systems["argv"].is_null());
    assert!(
        systems["reason"]
            .as_str()
            .is_some_and(|reason| !reason.is_empty())
    );
    assert!(systems["diagnostic"].is_object());
}

#[test]
fn empty_query_returns_the_full_index_without_empty_warning() {
    let project_root = unique_fixture_root("empty");
    let result = cli_search(&project_root, "");

    assert_eq!(result["ok"], true);
    assert!(!result["value"]["matches"].as_array().unwrap().is_empty());
    assert_eq!(result["diagnostics"], json!([]));
    assert_eq!(result["value"]["suggested_next_actions"], json!([]));
}

#[test]
fn systems_action_is_bound_to_the_caller_project_across_cwds() {
    let target_root = unique_fixture_root("target project");
    let unrelated_root = unique_fixture_root("unrelated project");
    init_fixture(&target_root, "target-project");
    init_fixture(&unrelated_root, "unrelated-project");
    set_physics2d(&target_root, false);
    set_physics2d(&unrelated_root, true);

    for query in ["攻擊", "", "position"] {
        assert_eq!(
            cli_search(&target_root, query),
            mcp_search(&target_root, query),
            "CLI/MCP results must match for the same target project and query {query:?}"
        );
    }
    let cli_result = cli_search(&target_root, "攻擊");

    let systems_action = suggested_action(&cli_result, "list_systems");
    assert_all_action_readiness(&cli_result);
    assert_eq!(systems_action["ready"], true);
    assert_eq!(systems_action["executable"], "game");
    let argv = action_argv(systems_action);
    assert_eq!(argv.first().map(String::as_str), Some("--project"));
    assert_eq!(
        fs::canonicalize(&argv[1]).expect("emitted project root should exist"),
        fs::canonicalize(&target_root).expect("target fixture root should exist")
    );

    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .args(&argv)
        .current_dir(&unrelated_root)
        .output()
        .expect("emitted systems argv should start from an unrelated cwd");
    assert!(
        output.status.success(),
        "emitted systems argv failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let systems_result: Value =
        serde_json::from_slice(&output.stdout).expect("systems command should emit JSON");
    assert_eq!(systems_result["ok"], true);
    assert_eq!(systems_result["value"]["project"], "target-project");
    let physics2d = systems_result["value"]["systems"]
        .as_array()
        .expect("systems report should contain systems")
        .iter()
        .find(|system| system["id"] == "physics2d")
        .expect("systems report should include physics2d");
    assert_eq!(physics2d["enabled"], false);
    assert_eq!(physics2d["source"], "project");
}

#[test]
fn nonexistent_project_keeps_search_global_and_blocks_only_systems_action() {
    let missing_root = unique_fixture_root("missing project");
    assert!(!missing_root.exists());

    let no_match = cli_search(&missing_root, "攻擊");
    let mcp_no_match = mcp_search(&missing_root, "攻擊");
    assert_eq!(no_match, mcp_no_match, "CLI/MCP blocked action must match");
    assert_eq!(no_match["ok"], true);
    assert_all_action_readiness(&no_match);

    let full_index = suggested_action(&no_match, "search_api_index");
    assert_eq!(full_index["ready"], true);
    assert!(
        action_argv(full_index)
            .iter()
            .any(|argument| argument.is_empty())
    );
    let systems = suggested_action(&no_match, "list_systems");
    assert_eq!(systems["ready"], false);
    assert!(systems["executable"].is_null());
    assert!(systems["argv"].is_null());
    assert_eq!(systems["reason"], systems["diagnostic"]["explanation"]);
    assert!(systems["diagnostic"]["code"].is_string());

    let full_query = cli_search(&missing_root, "");
    assert_eq!(full_query["ok"], true);
    assert_eq!(full_query["diagnostics"], json!([]));
    assert_eq!(full_query["value"]["suggested_next_actions"], json!([]));
    assert!(
        !full_query["value"]["matches"]
            .as_array()
            .expect("full index should contain matches")
            .is_empty()
    );
}

#[test]
fn invalid_project_keeps_matching_and_full_index_global_but_blocks_no_match_systems() {
    let invalid_root = unique_fixture_root("invalid project");
    fs::create_dir_all(&invalid_root).expect("invalid fixture root should be creatable");
    fs::write(
        invalid_root.join("project.unone.json"),
        br#"{"name":"invalid-project","systems":{"not-a-real-system":true}}"#,
    )
    .expect("invalid fixture config should be writable");

    for query in ["", "position"] {
        let result = cli_search(&invalid_root, query);
        assert_eq!(result["ok"], true);
        assert_eq!(result["diagnostics"], json!([]));
        assert_eq!(result["value"]["suggested_next_actions"], json!([]));
        assert!(
            !result["value"]["matches"]
                .as_array()
                .expect("global search should return a match array")
                .is_empty()
        );
    }

    let result = cli_search(&invalid_root, "攻擊");
    assert_eq!(result["ok"], true);
    assert_eq!(result["diagnostics"][0]["code"], "API_SEARCH_EMPTY");
    assert_all_action_readiness(&result);
    let systems = suggested_action(&result, "list_systems");
    assert_eq!(systems["ready"], false);
    assert_eq!(systems["diagnostic"]["code"], "SYSTEM_UNKNOWN");
    assert_eq!(systems["reason"], systems["diagnostic"]["explanation"]);
}

#[test]
fn full_index_action_executes_with_a_true_empty_query_from_an_unrelated_cwd() {
    let search_root = unique_fixture_root("full index missing project");
    let unrelated_cwd = unique_fixture_root("full index unrelated cwd");
    fs::create_dir_all(&unrelated_cwd).expect("unrelated cwd should be creatable");

    let no_match = cli_search(&search_root, "攻擊");
    let full_index = suggested_action(&no_match, "search_api_index");
    assert_action_readiness(full_index);
    assert_eq!(full_index["ready"], true);
    assert_eq!(full_index["executable"], "game");
    let argv = action_argv(full_index);
    assert_eq!(
        argv,
        vec![
            "api".to_string(),
            "search".to_string(),
            String::new(),
            "--json".to_string(),
        ]
    );

    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .args(&argv)
        .current_dir(&unrelated_cwd)
        .output()
        .expect("emitted full-index argv should start from an unrelated cwd");
    assert!(
        output.status.success(),
        "emitted full-index argv failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let full_result: Value =
        serde_json::from_slice(&output.stdout).expect("full-index command should emit JSON");
    assert_eq!(full_result["ok"], true);
    assert_eq!(full_result["value"]["query"], "");
    assert_eq!(full_result["diagnostics"], json!([]));
    assert_eq!(full_result["value"]["suggested_next_actions"], json!([]));
    assert!(
        !full_result["value"]["matches"]
            .as_array()
            .expect("full-index result should contain matches")
            .is_empty()
    );
}

#[test]
fn relative_caller_project_is_canonicalized_before_systems_argv_runs_elsewhere() {
    let game_a = unique_fixture_root("game A 相對 project");
    let game_b = unique_fixture_root("game B unrelated project");
    init_fixture(&game_a, "game-a");
    init_fixture(&game_b, "game-b");
    set_physics2d(&game_a, false);
    set_physics2d(&game_b, true);

    let result = cli_search_from_cwd(&game_a, Path::new("."), "攻擊");
    assert_eq!(result["ok"], true);
    let systems_action = suggested_action(&result, "list_systems");
    assert_action_readiness(systems_action);
    assert_eq!(systems_action["ready"], true);
    let argv = action_argv(systems_action);
    assert_eq!(argv.first().map(String::as_str), Some("--project"));
    assert_eq!(
        fs::canonicalize(&argv[1]).expect("emitted project root should exist"),
        fs::canonicalize(&game_a).expect("game A root should exist")
    );

    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .args(&argv)
        .current_dir(&game_b)
        .output()
        .expect("emitted systems argv should start from game B cwd");
    assert!(
        output.status.success(),
        "emitted systems argv failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let systems_result: Value =
        serde_json::from_slice(&output.stdout).expect("systems command should emit JSON");
    assert_eq!(systems_result["ok"], true);
    assert_eq!(systems_result["value"]["project"], "game-a");
    let physics2d = systems_result["value"]["systems"]
        .as_array()
        .expect("systems report should contain systems")
        .iter()
        .find(|system| system["id"] == "physics2d")
        .expect("systems report should include physics2d");
    assert_eq!(physics2d["enabled"], false);
    assert_eq!(physics2d["source"], "project");
}
