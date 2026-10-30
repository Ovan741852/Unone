use std::collections::BTreeMap;
use unone_engine::{EngineRuntime, HostProject};

/// Load through the host contract every platform uses: the JSON payload names
/// the data assets and their loaders; the bytes travel beside it.
fn host(script: &str, decls: serde_json::Value, data: &[(&str, &[u8])]) -> Result<EngineRuntime, String> {
    let payload = serde_json::json!({
        "config": {"name": "data-assets", "entry_script": "main.luau"},
        "script": script,
        "data_assets": decls,
    });
    let data: BTreeMap<String, Vec<u8>> = data.iter().map(|(id, bytes)| (id.to_string(), bytes.to_vec())).collect();
    HostProject::parse(payload.to_string().as_bytes())
        .and_then(|project| project.into_runtime_with_data(42, data))
        .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))
}

fn game(start: &str) -> String {
    format!("return {{start=function(api)\n{start}\nend, update=function() end}}")
}

fn decl(id: &str, loader: &str) -> serde_json::Value {
    serde_json::json!({"id": id, "source": format!("data/{id}"), "loader": loader})
}

#[test]
fn built_in_loaders_decode_once_into_frozen_shared_values() {
    let runtime = host(
        &game(r#"
    local rom = api.assets.load("data://rom")
    assert(typeof(rom) == "buffer" and api.bytes.isFrozen(rom) and buffer.readu32(rom, 0) == 0x04030201)
    assert(rawequal(api.assets.load("data://rom"), rom), "a data asset decodes once")
    assert(not pcall(buffer.writeu8, rom, 0, 9))
    local level = api.assets.load("data://level")
    assert(rawequal(api.assets.load("data://level"), level))
    assert(table.isfrozen(level) and table.isfrozen(level.tiles) and table.isfrozen(level.spawn))
    assert(level.name == "Start" and level.tiles[3] == 7 and level.tiles[2] == nil and #level.spawn == 2)
    assert(level.big == 9007199254740992 and level.ratio == 0.5 and level.empty == nil)
    assert(not pcall(function() level.name = "x" end), "decoded JSON is read-only")
    api.observation.set("text", api.assets.load("data://notes"))
    api.observation.set("level", level.name)
"#),
        serde_json::json!([decl("data://rom", "bytes"), decl("data://level", "json"), decl("data://notes", "text")]),
        &[
            ("data://rom", &[1, 2, 3, 4]),
            ("data://level", br#"{"name":"Start","tiles":[1,null,7],"spawn":[3,4],"big":9007199254740992,"ratio":0.5,"empty":null}"#),
            ("data://notes", "見る\n".as_bytes()),
        ],
    )
    .unwrap();
    let observed = runtime.semantic_observations();
    assert_eq!(observed["text"], "見る\n");
    assert_eq!(observed["level"], "Start");
}

#[test]
fn games_extend_the_pipeline_with_runtime_loaders() {
    let runtime = host(
        &game(r#"
    -- A tiny CSV of numbers: the manifest names "csv", the game supplies it.
    api.assets.registerLoader("csv", function(data, id)
        local rows = {}
        for line in string.gmatch(buffer.tostring(data), "[^\n]+") do
            local row = {}
            for cell in string.gmatch(line, "[^,]+") do table.insert(row, tonumber(cell)) end
            table.insert(rows, row)
        end
        return {id = id, rows = rows, raw = data}
    end)
    local grid = api.assets.load("data://grid")
    assert(rawequal(api.assets.load("data://grid"), grid))
    assert(table.isfrozen(grid) and table.isfrozen(grid.rows[2]) and api.bytes.isFrozen(grid.raw))
    assert(not pcall(function() grid.rows[1][1] = 0 end), "loader results are deep-frozen")
    api.observation.set("cell", grid.rows[2][3])
    api.observation.set("id", grid.id)
"#),
        serde_json::json!([decl("data://grid", "csv")]),
        &[("data://grid", b"1,2,3\n4,5,6\n")],
    )
    .unwrap();
    let observed = runtime.semantic_observations();
    assert_eq!((observed["cell"].as_f64(), observed["id"].as_str()), (Some(6.0), Some("data://grid")));
}

#[test]
fn misuse_fails_with_a_named_reason() {
    let failure = |call: &str, decls: serde_json::Value, data: &[(&str, &[u8])]| {
        let runtime = host(
            &game(&format!("local ok, err = pcall(function() {call} end)\nassert(not ok)\napi.observation.set('error', tostring(err))")),
            decls,
            data,
        )
        .unwrap();
        runtime.semantic_observations()["error"].as_str().unwrap().to_string()
    };
    let cases: Vec<(&str, serde_json::Value, Vec<(&str, &[u8])>, &str)> = vec![
        (r#"api.assets.load("data://missing")"#, serde_json::json!([]), vec![], "ASSET_ID_NOT_DECLARED"),
        (r#"api.assets.load("data://a")"#, serde_json::json!([decl("data://a", "zip")]), vec![("data://a", b"x")], "ASSET_LOADER_UNKNOWN"),
        (r#"api.assets.load("data://a")"#, serde_json::json!([decl("data://a", "json")]), vec![("data://a", b"{\"a\":")], "ASSET_JSON_INVALID"),
        (r#"api.assets.load("data://a")"#, serde_json::json!([decl("data://a", "json")]), vec![("data://a", b"[9007199254740993]")], "not exactly representable"),
        (r#"api.assets.load("data://a")"#, serde_json::json!([decl("data://a", "text")]), vec![("data://a", b"\xff")], "ASSET_TEXT_INVALID"),
        (r#"api.assets.registerLoader("json", function() return 1 end)"#, serde_json::json!([]), vec![], "ASSET_LOADER_RESERVED"),
        (r#"api.assets.registerLoader("Bad Name", function() return 1 end)"#, serde_json::json!([]), vec![], "ASSET_LOADER_INVALID"),
        (
            r#"api.assets.registerLoader("nothing", function() return nil end); api.assets.load("data://a")"#,
            serde_json::json!([decl("data://a", "nothing")]),
            vec![("data://a", b"x")],
            "ASSET_LOADER_RESULT_NIL",
        ),
    ];
    for (call, decls, data, expected) in cases {
        let error = failure(call, decls, &data);
        assert!(error.contains(expected), "{call}: expected {expected} in {error}");
    }
    let missing = host(&game(""), serde_json::json!([decl("data://a", "bytes")]), &[]).err().unwrap();
    assert!(missing.starts_with("ASSET_DATA_MISSING"), "{missing}");
    let undeclared = host(&game(""), serde_json::json!([]), &[("data://a", b"x")]).err().unwrap();
    assert!(undeclared.starts_with("ASSET_DATA_UNDECLARED"), "{undeclared}");
}

#[test]
fn a_project_on_disk_reads_data_assets_from_its_manifest() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join("data")).unwrap();
    std::fs::write(root.join("data/level.json"), br#"{"width":12}"#).unwrap();
    std::fs::write(root.join("main.luau"), game(r#"api.observation.set("width", api.assets.load("data://level").width)"#)).unwrap();
    std::fs::write(root.join("assets.json"), serde_json::to_vec(&serde_json::json!({"version": 1, "assets": [{
        "id": "data://level", "kind": "data", "source": "data/level.json", "bundle": "content",
        "encoding": {"format": "json", "mime": "application/json", "decoder": "json"}
    }]})).unwrap()).unwrap();
    std::fs::write(root.join("project.unone.json"), br#"{"name":"disk data","entry_script":"main.luau","asset_manifest":"assets.json"}"#).unwrap();
    let runtime = EngineRuntime::load(root).unwrap();
    assert_eq!(runtime.semantic_observations()["width"].as_f64(), Some(12.0));
}
