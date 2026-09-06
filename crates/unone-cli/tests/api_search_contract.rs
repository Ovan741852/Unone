use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

fn cli_search(query: &str) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_game"))
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

fn mcp_search(query: &str) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_game"))
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

#[test]
fn cli_and_mcp_unpacked_results_have_parity_for_no_match_and_full_index() {
    for query in ["攻擊", ""] {
        assert_eq!(
            cli_search(query),
            mcp_search(query),
            "CLI and MCP EngineResult mismatch for query {query:?}"
        );
    }
}

#[test]
fn no_match_contract_has_fixed_facts_and_discovery_actions() {
    let result = cli_search("攻擊");

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
    assert_eq!(
        result["diagnostics"][0]["suggested_actions"][0]["command"],
        "game api search \"\" --json"
    );
    assert_eq!(
        result["diagnostics"][0]["suggested_actions"][1]["command"],
        "game systems list --json"
    );
}

#[test]
fn empty_query_returns_the_full_index_without_empty_warning() {
    let result = cli_search("");

    assert_eq!(result["ok"], true);
    assert!(!result["value"]["matches"].as_array().unwrap().is_empty());
    assert_eq!(result["diagnostics"], json!([]));
}
