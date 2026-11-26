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

#[test]
fn deferred_lifecycle_is_one_request_per_attempt_and_validates_the_entire_receipt_set() {
    use serde_json::json;
    let script=r#"
        local id="data://intro"
        local tick=0
        return {
            start=function(api)
                assert(api.assets.status(id).state=="idle")
                assert(not pcall(api.assets.load,id))
                api.assets.request(id)
                api.assets.request(id)
            end,
            update=function(api)
                tick+=1
                local status=api.assets.status(id)
                api.observation.set("state",status.state)
                if tick==1 then
                    assert(status.state=="loading")
                    api.assets.release(id)
                    api.assets.request(id)
                elseif tick==2 then
                    assert(status.state=="failed" and status.error)
                    api.assets.request(id)
                elseif tick==3 then
                    local buffer1=api.assets.load(id)
                    assert(buffer.tostring(buffer1)=="abc" and api.bytes.isFrozen(buffer1))
                    assert(rawequal(api.assets.load(id),buffer1))
                    api.assets.release(id)
                    assert(buffer.tostring(buffer1)=="abc" and api.assets.status(id).state=="idle")
                    assert(not pcall(api.assets.load,id))
                end
            end,
        }
    "#;
    let mut runtime=host(script,json!([{"id":"data://intro","source":"intro.bin","loader":"bytes","on_demand":true}]),&[]).unwrap();
    let input=|rows| serde_json::from_value(json!({"data_assets":rows})).unwrap();
    let plan=runtime.data_asset_request_plan(9,0).unwrap();
    assert_eq!(plan["requests"],json!([{"id":"data://intro","request":1}]));
    assert!(runtime.data_asset_request_plan(9,plan["revision"].as_u64().unwrap() as u32).is_none());
    runtime.tick_with_input(&input(json!([]))).unwrap();
    assert!(runtime.reserve_deferred_bytes(1,3).is_none());
    let failed=|request|json!({"id":"data://intro","request":request,"state":"failed"});
    assert!(runtime.tick_with_input(&input(json!([failed(1)]))).unwrap_err().explanation.contains("REQUEST_MISMATCH"));
    runtime.tick_with_input(&input(json!([failed(2)]))).unwrap();
    let ptr=runtime.reserve_deferred_bytes(3,3).unwrap();
    unsafe {std::ptr::copy_nonoverlapping(b"abc".as_ptr(),ptr,3)};
    let ready=|hash:&str|json!({"id":"data://intro","state":"ready","request":3,"sha256":hash});
    let sha="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert!(runtime.tick_with_input(&input(json!([ready(&"0".repeat(64))]))).unwrap_err().explanation.contains("HASH_MISMATCH"));
    let mixed=input(json!([ready(sha),{"id":"data://unknown","state":"failed","request":56}]));
    assert!(runtime.tick_with_input(&mixed).unwrap_err().explanation.contains("REQUEST_MISMATCH"));
    assert_eq!(runtime.current_frame(),2);
    runtime.tick_with_input(&input(json!([ready(sha)]))).unwrap();
    assert_eq!(runtime.semantic_observations()["state"],"ready");
    assert_eq!(runtime.data_asset_request_plan(9,0).unwrap()["requests"],json!([]));
}

#[test]
fn native_deferred_reads_only_after_request_and_records_the_exact_receipt() {
    use serde_json::json;
    let dir=tempfile::tempdir().unwrap();
    let root=dir.path();
    std::fs::write(root.join("project.unone.json"),br#"{"name":"deferred","entry_script":"main.luau","asset_manifest":"assets.json"}"#).unwrap();
    std::fs::write(root.join("assets.json"),json!({"version":1,"assets":[{
        "id":"data://movie","kind":"data","source":"movie.bin","bundle":"content",
        "encoding":{"format":"raw","mime":"application/octet-stream","decoder":"bytes","on_demand":true}
    }]}).to_string()).unwrap();
    std::fs::write(root.join("main.luau"),r#"
        local id="data://movie"
        return {start=function() end,update=function(api)
            local s=api.assets.status(id).state
            api.observation.set("state",s)
            if s=="idle" or s=="failed" then api.assets.request(id) end
            if s=="ready" then api.observation.set("content",buffer.tostring(api.assets.load(id))) end
        end}
    "#).unwrap();
    let mut r=EngineRuntime::load(root).unwrap();
    r.tick().unwrap(); // File is still absent.
    assert_eq!(r.last_data_receipts().unwrap().len(),0);
    r.tick().unwrap();
    assert_eq!(r.semantic_observations()["state"],"failed");
    std::fs::write(root.join("movie.bin"),b"abc").unwrap();
    let hold=serde_json::from_value(json!({"data_assets":[]})).unwrap();
    r.tick_with_input(&hold).unwrap();
    assert_eq!(r.semantic_observations()["state"],"loading");
    r.tick().unwrap();
    assert_eq!(r.semantic_observations()["content"],"abc");
    let recording=unone_engine::record_run(root,4,42,&[]).value.unwrap();
    let tape=serde_json::to_value(&recording).unwrap();
    assert_eq!(tape["input_sequence"][0]["data_assets"],json!([]));
    assert_eq!(tape["input_sequence"][1]["data_assets"][0]["request"],1);
    assert_eq!(tape["input_sequence"][1]["data_assets"][0]["sha256"],"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert!(unone_engine::diff_run(root,&recording).value.unwrap().identical);
    std::fs::write(root.join("movie.bin"),b"abd").unwrap();
    let changed=unone_engine::diff_run(root,&recording);
    assert!(!changed.ok && changed.diagnostics[0].explanation.contains("HASH_MISMATCH"));
}

#[test]
fn developer_recording_replays_the_receipt_on_a_failed_tick() {
    use serde_json::json;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::write(root.join("project.unone.json"), json!({
        "name": "debug-data", "entry_script": "main.luau", "asset_manifest": "assets.json"
    }).to_string()).unwrap();
    std::fs::write(root.join("assets.json"), json!({"version":1,"assets":[{
        "id":"data://reel","kind":"data","source":"reel.bin","bundle":"content",
        "encoding":{"format":"raw","mime":"application/octet-stream","decoder":"bytes","on_demand":true}
    }]}).to_string()).unwrap();
    std::fs::write(root.join("main.luau"), r#"
        local id = "data://reel"
        return {start = function() end, update = function(api)
            local state = api.assets.status(id).state
            if state == "idle" then api.assets.request(id) end
            if state == "failed" then error("reel unavailable") end
        end}
    "#).unwrap();
    let mut protocol = unone_engine::DeveloperProtocol::default();
    let open = protocol.execute_json(root, json!({"command":"open"})).value.unwrap();
    let session = &open["session"];
    let step = protocol.execute_json(root, json!({"command":"step","session":session,
        "expected_revision":open["revision"],"frames":4}));
    assert!(!step.ok);
    let mut recording = protocol.execute_json(root, json!({"command":"recording","session":session})).value.unwrap();
    let command = &recording["commands"][0];
    assert_eq!(command["data_assets"], json!([[], [{"state":"failed","id":"data://reel","request":1}]]));
    assert_eq!(command["digests"].as_array().unwrap().len(), 2);
    std::fs::write(root.join("reel.bin"), b"available only at replay").unwrap();
    let replay = protocol.execute_json(root, json!({"command":"replay","recording":recording}));
    assert_eq!(replay.value.unwrap()["identical"], true);
    recording["commands"][0].as_object_mut().unwrap().remove("data_assets");
    let missing = protocol.execute_json(root, json!({"command":"replay","recording":recording}));
    assert_eq!(missing.diagnostics[0].code, "DEFERRED_DATA_TAPE_MISSING");
}
