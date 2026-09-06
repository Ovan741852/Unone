use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

fn path_text(path: &Path) -> String {
    path.display().to_string()
}

fn cli_project_init(root: &Path, name: &str) -> (bool, Value) {
    let root = path_text(root);
    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .args([
            "--project",
            root.as_str(),
            "--json",
            "project",
            "init",
            "--name",
            name,
        ])
        .output()
        .expect("project init CLI should start");
    let payload = serde_json::from_slice(&output.stdout)
        .expect("project init CLI should emit EngineResult JSON");
    (output.status.success(), payload)
}

fn cli_run(root: &Path, input_sequence: &Path) -> (bool, Value) {
    let root = path_text(root);
    let input_sequence = path_text(input_sequence);
    let output = Command::new(env!("CARGO_BIN_EXE_game"))
        .args([
            "--project",
            root.as_str(),
            "--json",
            "run",
            "--frames",
            "1",
            "--input-sequence",
            input_sequence.as_str(),
        ])
        .output()
        .expect("run CLI should start");
    let payload = serde_json::from_slice(&output.stdout).expect("run CLI should emit JSON");
    (output.status.success(), payload)
}

fn mcp_call(root: &Path, name: &str, arguments: Value) -> (bool, Value) {
    let root = path_text(root);
    let mut child = Command::new(env!("CARGO_BIN_EXE_game"))
        .args(["--project", root.as_str(), "mcp"])
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
                "clientInfo": {"name": "authoring-transport-contract", "version": "1"}
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
                "name": name,
                "arguments": arguments
            }
        }),
    ];
    let input = messages
        .iter()
        .map(|message| serde_json::to_string(message).expect("MCP message should serialize"))
        .collect::<Vec<_>>()
        .join("\n");
    {
        let mut stdin = child.stdin.take().expect("MCP stdin should be available");
        stdin
            .write_all(format!("{input}\n").as_bytes())
            .expect("MCP request should be written");
    }

    let output = child
        .wait_with_output()
        .expect("MCP server should finish after stdin closes");
    assert!(
        output.status.success(),
        "MCP process failed: {}",
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
        .find(|response| response.get("id").and_then(Value::as_i64) == Some(2))
        .expect("MCP tool response should be present");
    let tool_result = &tool_response["result"];
    let is_error = tool_result["isError"]
        .as_bool()
        .expect("MCP tool result should report isError");
    let text = tool_result["content"][0]["text"]
        .as_str()
        .expect("MCP tool result should contain serialized EngineResult");
    let payload = serde_json::from_str(text).expect("MCP tool text should contain EngineResult");
    (is_error, payload)
}

fn assert_init_success(result: &Value, root: &Path, name: &str) {
    assert_eq!(result["ok"], true);
    assert_eq!(result["value"]["project"], name);
    assert_eq!(
        result["value"]["root"],
        path_text(&fs::canonicalize(root).unwrap())
    );
    assert_eq!(result["value"]["workflow_scope"], "new_unmodified_scaffold");
    assert_eq!(result["diagnostics"], json!([]));

    let mut expected_effects = vec![
        ("created_directory", path_text(&root.join("scenes"))),
        (
            "created_file",
            path_text(&root.join("scenes/main.scene.json")),
        ),
        ("created_directory", path_text(&root.join("scripts"))),
        ("created_file", path_text(&root.join("scripts/main.luau"))),
        ("created_directory", path_text(&root.join("tests"))),
        (
            "created_file",
            path_text(&root.join("tests/bootstrap-idle.test.json")),
        ),
        (
            "created_file",
            path_text(&root.join("tests/bootstrap-input.test.json")),
        ),
        ("created_file", path_text(&root.join("project.unone.json"))),
    ];
    expected_effects.sort_by(|left, right| left.1.cmp(&right.1));
    let expected_effects = expected_effects
        .into_iter()
        .map(|(kind, path)| format!("{kind}:{path}"))
        .collect::<Vec<_>>();
    assert_eq!(result["effects"], json!(expected_effects));

    let expected_files = [
        ("project.unone.json", "project_config"),
        ("scenes/main.scene.json", "main_scene"),
        ("scripts/main.luau", "entry_script"),
        ("tests/bootstrap-idle.test.json", "bootstrap_idle_test"),
        ("tests/bootstrap-input.test.json", "bootstrap_input_test"),
    ];
    let files = result["value"]["files"]
        .as_array()
        .expect("init result should list files");
    assert_eq!(files.len(), expected_files.len());
    for ((path, role), file) in expected_files.iter().zip(files) {
        let path = *path;
        let role = *role;
        assert_eq!(file["path"], path);
        assert_eq!(file["role"], role);
        assert!(root.join(path).is_file(), "missing init file {path}");
    }

    let config: Value = serde_json::from_str(
        &fs::read_to_string(root.join("project.unone.json")).expect("init config should exist"),
    )
    .expect("init config should be JSON");
    assert_eq!(config["entry_script"], "scripts/main.luau");
    assert_eq!(config["main_scene"], "scenes/main.scene.json");
    assert_eq!(
        config["test_files"],
        json!([
            "tests/bootstrap-idle.test.json",
            "tests/bootstrap-input.test.json"
        ])
    );

    let actions = result["value"]["suggested_next_actions"]
        .as_array()
        .expect("init result should list next actions");
    assert_eq!(actions.len(), 4);
    for (index, action) in actions.iter().enumerate() {
        assert_eq!(action["executable"], "game");
        assert_eq!(action["argv"][0], "--project");
        assert_eq!(
            action["argv"][1],
            path_text(&fs::canonicalize(root).unwrap())
        );
        assert_eq!(action["argv"][2], "--json");
        assert_eq!(
            action["prerequisites"],
            if index == 0 {
                json!([])
            } else {
                json!([index - 1])
            }
        );
        assert!(!action["reason"].as_str().unwrap_or_default().is_empty());
    }
}

fn normalize_init_root(result: &Value, root: &Path) -> (Value, Vec<String>) {
    let root_text = path_text(&fs::canonicalize(root).unwrap());
    let mut normalized = result.clone();
    let mut fields = vec!["/value/root".to_string()];
    assert_eq!(
        normalized.pointer("/value/root").and_then(Value::as_str),
        Some(root_text.as_str())
    );
    *normalized.pointer_mut("/value/root").unwrap() = json!("<ROOT>");

    let actions = normalized["value"]["suggested_next_actions"]
        .as_array_mut()
        .expect("init result should list next actions");
    for (index, action) in actions.iter_mut().enumerate() {
        let argv = action["argv"]
            .as_array_mut()
            .expect("next action should list argv");
        let project_index = argv
            .iter()
            .position(|argument| argument == "--project")
            .map(|index| index + 1)
            .expect("next action should declare --project");
        assert_eq!(argv[project_index], root_text);
        argv[project_index] = json!("<ROOT>");
        fields.push(format!(
            "/value/suggested_next_actions/{index}/argv/{project_index}"
        ));
    }

    let effects = normalized["effects"]
        .as_array_mut()
        .expect("init result should list effects");
    for (index, effect) in effects.iter_mut().enumerate() {
        let effect_text = effect
            .as_str()
            .expect("init effect should be a string")
            .to_string();
        let (kind, path) = effect_text
            .split_once(':')
            .expect("init effect should contain its kind and path");
        assert!(
            matches!(kind, "created_directory" | "created_file"),
            "unexpected init effect kind: {kind}"
        );
        assert!(
            path.starts_with(&root_text),
            "init effect path should be rooted at the project root: {effect_text}"
        );
        let normalized_effect = format!("{kind}:<ROOT>{}", &path[root_text.len()..]);
        *effect = json!(normalized_effect);
        fields.push(format!("/effects/{index}"));
    }
    (normalized, fields)
}

fn fresh_child(parent: &Path, stem: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after the Unix epoch")
        .as_nanos();
    let base = format!("unone-authoring-transport-{}-{stamp}", std::process::id());
    let path = parent.join(format!("{base}-{stem}"));
    assert!(
        !path.exists(),
        "test path unexpectedly exists: {}",
        path.display()
    );
    path
}

#[test]
fn project_init_and_pointer_input_transport_contract() {
    let parent = fs::canonicalize(std::env::temp_dir()).expect("temp parent should exist");
    let root_cli = fresh_child(&parent, "空白 根甲");
    let root_mcp = fresh_child(&parent, "空白 根乙");
    let input_dir = fresh_child(&parent, "輸入資料");
    assert!(
        root_cli
            .file_name()
            .map(|name| name.to_string_lossy().contains(' '))
            .unwrap_or(false)
    );
    assert!(
        root_mcp
            .file_name()
            .map(|name| name.to_string_lossy().contains(' '))
            .unwrap_or(false)
    );
    fs::create_dir(&root_cli).expect("CLI root should be an empty Unicode directory");
    fs::create_dir(&root_mcp).expect("MCP root should be an empty Unicode directory");
    fs::create_dir(&input_dir).expect("input directory should be created");

    let (cli_success_status, cli_success) = cli_project_init(&root_cli, "transport-starter");
    assert!(cli_success_status);
    assert_init_success(&cli_success, &root_cli, "transport-starter");

    let (mcp_success_is_error, mcp_success) = mcp_call(
        &root_mcp,
        "unone_project_init",
        json!({"name": "transport-starter"}),
    );
    assert!(!mcp_success_is_error);
    assert_init_success(&mcp_success, &root_mcp, "transport-starter");

    let (normalized_cli, cli_normalized_fields) = normalize_init_root(&cli_success, &root_cli);
    let (normalized_mcp, mcp_normalized_fields) = normalize_init_root(&mcp_success, &root_mcp);
    assert_eq!(
        cli_normalized_fields,
        vec![
            "/value/root",
            "/value/suggested_next_actions/0/argv/1",
            "/value/suggested_next_actions/1/argv/1",
            "/value/suggested_next_actions/2/argv/1",
            "/value/suggested_next_actions/3/argv/1",
            "/effects/0",
            "/effects/1",
            "/effects/2",
            "/effects/3",
            "/effects/4",
            "/effects/5",
            "/effects/6",
            "/effects/7",
        ]
    );
    assert_eq!(cli_normalized_fields, mcp_normalized_fields);
    assert_eq!(
        normalized_cli, normalized_mcp,
        "only the recorded root fields may differ between successful transports"
    );

    let (cli_repeat_status, cli_repeat) = cli_project_init(&root_cli, "transport-starter");
    assert!(!cli_repeat_status);
    assert_eq!(cli_repeat["ok"], false);
    assert!(cli_repeat["value"].is_null());
    assert!(!cli_repeat["diagnostics"].as_array().unwrap().is_empty());

    let (mcp_repeat_is_error, mcp_repeat) = mcp_call(
        &root_cli,
        "unone_project_init",
        json!({"name": "transport-starter"}),
    );
    assert!(mcp_repeat_is_error);
    assert_eq!(mcp_repeat["ok"], false);
    assert!(mcp_repeat["value"].is_null());
    assert_eq!(cli_repeat, mcp_repeat);

    let valid_input = input_dir.join("pointer-valid.json");
    let extra_input = input_dir.join("pointer-extra.json");
    fs::write(
        &valid_input,
        r#"[{"pointer":{"position":{"x":0.25,"y":0.75}}}]"#,
    )
    .expect("valid pointer input should be written");
    fs::write(
        &extra_input,
        r#"[{"pointer":{"position":{"x":0.25,"y":0.75,"z":0.0}}}]"#,
    )
    .expect("invalid pointer input should be written");

    let (cli_valid_status, cli_valid) = cli_run(&root_cli, &valid_input);
    assert!(cli_valid_status);
    assert_eq!(cli_valid["ok"], true);

    let (mcp_valid_is_error, mcp_valid) = mcp_call(
        &root_cli,
        "unone_run",
        json!({
            "frames": 1,
            "seed": 42,
            "input_sequence": [{"pointer": {"position": {"x": 0.25, "y": 0.75}}}]
        }),
    );
    assert!(!mcp_valid_is_error);
    assert_eq!(mcp_valid["ok"], true);

    let (cli_extra_status, cli_extra) = cli_run(&root_cli, &extra_input);
    assert!(!cli_extra_status);
    assert_eq!(cli_extra["ok"], false);
    assert!(cli_extra["value"].is_null());
    assert!(!cli_extra["diagnostics"].as_array().unwrap().is_empty());

    let (mcp_extra_is_error, mcp_extra) = mcp_call(
        &root_cli,
        "unone_run",
        json!({
            "frames": 1,
            "seed": 42,
            "input_sequence": [{"pointer": {"position": {"x": 0.25, "y": 0.75, "z": 0.0}}}]
        }),
    );
    assert!(mcp_extra_is_error);
    assert_eq!(mcp_extra["ok"], false);
    assert!(mcp_extra["value"].is_null());
    assert!(!mcp_extra["diagnostics"].as_array().unwrap().is_empty());
}
