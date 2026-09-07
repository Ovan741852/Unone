use super::*;
use std::fs;
use tempfile::{TempDir, tempdir};

const SCRIPT: &str = r#"--!strict
local Game = {}
function Game.start(api: any)
    api.ui.setRoot({ kind = "screen", id = "screen", node = "Screen", children = {
        { kind = "text", id = "score", text = "Score", rect = { x = 0, y = 0, width = 20, height = 10 } }
    } })
end
function Game.update(api: any, dt: number)
    local p = api.entity.getPosition("player")
    if api.input.isDown("Right") then p.x += 1 end
    api.entity.setPosition("player", p)
    if api.input.isDown("Crash") then error("deliberate bug after mutation") end
    if api.input.isDown("RemoveUi") then
        api.ui.setRoot({ kind = "screen", id = "screen", node = "Screen", children = {
            { kind = "text", id = "replacement", text = "Other", rect = { x = 0, y = 0, width = 20, height = 10 } }
        } })
    end
end
return Game
"#;

fn fixture() -> TempDir {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join("project.unone.json"),
        r#"{
        "name":"DeveloperTest", "entry_script":"main.luau", "main_scene":"scene.json",
        "systems":{"spine":true,"effekseer":true}
    }"#,
    )
    .unwrap();
    fs::write(dir.path().join("main.luau"), SCRIPT).unwrap();
    fs::write(
        dir.path().join("scene.json"),
        r#"{"entities":[{
        "id":"player", "name":"Player", "transform":{"x":0,"y":0}
    }]}"#,
    )
    .unwrap();
    dir
}

fn ok(protocol: &mut DeveloperProtocol, dir: &Path, request: Value) -> Value {
    let result = protocol.execute_json(dir, request);
    assert!(result.ok, "{:?}", result.diagnostics);
    result.value.unwrap()
}
fn open(protocol: &mut DeveloperProtocol, dir: &Path) -> Value {
    ok(protocol, dir, json!({"command":"open", "seed":7}))
}
fn position(x: f64) -> Value {
    json!({"selector":{"kind":"entity","id":"player"}, "change":{"op":"set_position","position":{"x":x,"y":0}}})
}

#[test]
fn snapshots_and_watch_follow_the_same_runtime_without_ticking_on_reads() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    let stepped = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":0,"frames":3,"input":{"actions":{"Right":true}}}),
    );
    assert_eq!(
        stepped["snapshot"]["entities"]["player"]["transform"]["x"],
        3.0
    );
    let watch_request = json!({"command":"watch","session":id,"after":opened["cursor"],"selector":{"kind":"entity","id":"player"},"paths":["/transform/x"]});
    let watched = ok(&mut protocol, dir.path(), watch_request.clone());
    assert_eq!(watched["current"]["snapshot"]["/transform/x"], 3.0);
    assert_eq!(watched["frame"], 3);
    assert_eq!(watched["entries"].as_array().unwrap().len(), 3);
    assert_eq!(watched, ok(&mut protocol, dir.path(), watch_request));
    let empty = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"watch","session":id,"after":watched["next_cursor"]}),
    );
    assert!(empty["entries"].as_array().unwrap().is_empty());
}

#[test]
fn enact_dry_run_atomic_failure_and_revision_conflict_do_not_mutate() {
    let dir = fixture();
    let scene_before = fs::read(dir.path().join("scene.json")).unwrap();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    let preview = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"dry_run":true,"operations":[position(10.0)]}),
    );
    assert_eq!(preview["revision"], 0);
    assert_eq!(preview["changes"][0]["after"], 10.0);
    let mut missing = position(3.0);
    missing["selector"]["id"] = json!("missing");
    let failed = protocol.execute_json(dir.path(), json!({"command":"enact","session":id,"expected_revision":0,"operations":[position(10.0),missing]}));
    assert!(!failed.ok);
    let unchanged = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"snapshot","session":id}),
    );
    assert_eq!(unchanged, opened);
    let applied = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[position(10.0)]}),
    );
    assert_eq!(applied["revision"], 1);
    let stale = protocol.execute_json(
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[position(20.0)]}),
    );
    assert_eq!(stale.diagnostics[0].code, "REVISION_CONFLICT");
    assert_eq!(
        fs::read(dir.path().join("scene.json")).unwrap(),
        scene_before
    );
}

#[test]
fn edits_cover_camera_ui_animation_and_effect_handles_and_rollback_together() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    let operations = json!([
        {"selector":{"kind":"scene"},"change":{"op":"set_camera","position":{"x":2,"y":3},"zoom":2}},
        {"selector":{"kind":"ui","id":"score"},"change":{"op":"set_text","text":"100"}},
        {"selector":{"kind":"entity","id":"player"},"change":{"op":"play_animation","animation":"idle","asset":"asset://hero"}},
        {"selector":{"kind":"scene"},"change":{"op":"spawn_effect","asset":"asset://spark","position":{"x":0,"y":0}}}
    ]);
    let preview = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"dry_run":true,"operations":operations}),
    );
    assert_eq!(preview["results"][3]["handle"], "effect-1");
    let applied = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":operations}),
    );
    assert_eq!(applied["results"][3]["handle"], "effect-1");
    let snapshot = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"snapshot","session":id}),
    );
    assert_eq!(snapshot["snapshot"]["ui"]["children"][0]["text"], "100");
    assert_eq!(snapshot["snapshot"]["camera"]["zoom"], 2.0);
    assert_eq!(
        snapshot["snapshot"]["entities"]["player"]["animation"]["animation"],
        "idle"
    );
    let failed = protocol.execute_json(dir.path(), json!({"command":"enact","session":id,"expected_revision":1,"operations":[
        {"selector":{"kind":"effect","handle":"effect-1"},"change":{"op":"stop_effect"}},
        {"selector":{"kind":"scene"},"change":{"op":"set_camera","position":{"x":50,"y":0},"zoom":0}}
    ]}));
    assert!(!failed.ok);
    assert_eq!(
        snapshot,
        ok(
            &mut protocol,
            dir.path(),
            json!({"command":"snapshot","session":id})
        )
    );
}

#[test]
fn mixed_inputs_and_enact_round_trip_and_expose_first_divergence() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[position(10.0)]}),
    );
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":1,"frames":4,"input":{"actions":{"Right":true}}}),
    );
    let recording = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"recording","session":id}),
    );
    let replayed = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"replay","recording":recording}),
    );
    assert_eq!(replayed["identical"], true);
    assert_eq!(
        replayed["world"]["entities"]["player"]["transform"]["x"],
        14.0
    );
    fs::write(
        dir.path().join("main.luau"),
        SCRIPT.replace("p.x += 1", "p.x += 2"),
    )
    .unwrap();
    let diverged = protocol.execute_json(
        dir.path(),
        json!({"command":"replay","recording":recording}),
    );
    assert_eq!(diverged.diagnostics[0].code, "REPLAY_DIVERGED");
    assert_eq!(diverged.diagnostics[0].facts["command_index"], 1);
    assert_eq!(diverged.diagnostics[0].facts["tick_index"], 0);
}

#[test]
fn failure_freezes_mutations_but_preserves_partial_state_and_reproduction() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    let failed = protocol.execute_json(dir.path(), json!({"command":"step","session":id,"expected_revision":0,"frames":4,"input":{"actions":{"Right":true,"Crash":true}}}));
    assert!(!failed.ok);
    let snapshot = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"snapshot","session":id}),
    );
    assert_eq!(snapshot["faulted"], true);
    assert_eq!(snapshot["frame"], 0);
    assert_eq!(
        snapshot["snapshot"]["entities"]["player"]["transform"]["x"],
        1.0
    );
    let blocked = protocol.execute_json(
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":1,"operations":[position(0.0)]}),
    );
    assert_eq!(blocked.diagnostics[0].code, "SESSION_FAULTED");
    let journal = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"journal","session":id,"after":0}),
    );
    assert!(
        journal["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["kind"] == "runtime_failed")
    );
    let recording = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"recording","session":id}),
    );
    let replayed = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"replay","recording":recording}),
    );
    assert_eq!(replayed["reproduced_failure"], true);
}

#[test]
fn journal_overflow_is_explicit_and_pagination_does_not_skip_events() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    for revision in [0, 600] {
        ok(
            &mut protocol,
            dir.path(),
            json!({"command":"step","session":id,"expected_revision":revision,"frames":600,"input":{"actions":{"Right":true}}}),
        );
    }
    let page = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"journal","session":id,"after":0,"limit":10}),
    );
    assert_eq!(page["lost_events"], true);
    assert_eq!(page["entries"].as_array().unwrap().len(), 10);
    let next = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"journal","session":id,"after":page["next_cursor"],"limit":10}),
    );
    assert_eq!(next["lost_events"], false);
    assert_eq!(
        next["entries"][0]["sequence"].as_u64().unwrap(),
        page["next_cursor"].as_u64().unwrap() + 1
    );
    let wrong = protocol.execute_json(
        dir.path(),
        json!({"command":"journal","session":"old-session","after":0}),
    );
    assert_eq!(wrong.diagnostics[0].code, "SESSION_MISMATCH");
}

#[test]
fn watch_reports_removed_ui_selection_instead_of_losing_the_removal_event() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":0,"input":{"actions":{"RemoveUi":true}}}),
    );
    let watched = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"watch","session":id,"after":opened["cursor"],"selector":{"kind":"ui","id":"score"}}),
    );
    assert_eq!(watched["current"]["selection_exists"], false);
    assert!(!watched["entries"].as_array().unwrap().is_empty());
}

#[test]
fn perf_is_read_only_and_reports_measurements_without_a_bottleneck_verdict() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":0,"frames":5}),
    );
    let before = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"snapshot","session":id}),
    );
    let perf = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"perf","session":id}),
    );
    assert_eq!(perf["performance"]["frames"], 5);
    assert_eq!(perf["performance"]["phases"].as_array().unwrap().len(), 3);
    assert!(perf.get("bottleneck").is_none());
    assert_eq!(
        before,
        ok(
            &mut protocol,
            dir.path(),
            json!({"command":"snapshot","session":id})
        )
    );
}

#[test]
fn disabled_systems_and_invalid_selectors_are_rejected_before_batch_commit() {
    let dir = fixture();
    let config_path = dir.path().join("project.unone.json");
    let mut config: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    config["systems"]["effekseer"] = json!(false);
    fs::write(config_path, config.to_string()).unwrap();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    let rejected = protocol.execute_json(dir.path(), json!({"command":"enact","session":id,"expected_revision":0,"operations":[position(2.0),
        {"selector":{"kind":"scene"},"change":{"op":"spawn_effect","asset":"asset://spark","position":{"x":0,"y":0}}}
    ]}));
    assert_eq!(rejected.diagnostics[0].code, "SYSTEM_DISABLED");
    assert_eq!(
        opened,
        ok(
            &mut protocol,
            dir.path(),
            json!({"command":"snapshot","session":id})
        )
    );
    let invalid = protocol.execute_json(
        dir.path(),
        json!({"command":"snapshot","session":id,"paths":["/does-not-exist"]}),
    );
    assert_eq!(invalid.diagnostics[0].code, "SELECTOR_NOT_FOUND");
}

#[test]
fn reopening_invalidates_old_session_identity_and_preserves_no_transient_edits() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[position(9.0)]}),
    );
    let duplicate = protocol.execute_json(dir.path(), json!({"command":"open"}));
    assert_eq!(duplicate.diagnostics[0].code, "SESSION_EXISTS");
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"close","session":id}),
    );
    let reopened = open(&mut protocol, dir.path());
    assert_ne!(reopened["session"], *id);
    assert_eq!(
        reopened["snapshot"]["entities"]["player"]["transform"]["x"],
        0.0
    );
    let stale = protocol.execute_json(dir.path(), json!({"command":"snapshot","session":id}));
    assert_eq!(stale.diagnostics[0].code, "SESSION_MISMATCH");
}

#[test]
fn invalid_requests_and_recording_limits_reject_before_mutation() {
    let dir = fixture();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    for request in [
        json!({"command":"step","session":id,"expected_revision":0,"frames":0}),
        json!({"command":"step","session":id,"expected_revision":0,"input":{"action":"Right"}}),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[]}),
        json!({"command":"watch","session":id,"after":0,"paths":["/bad~escape"]}),
        json!({"command":"journal","session":id,"after":0,"limit":257}),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[
            {"selector":{"kind":"ui","id":"score"},"change":{"op":"set_rect","rect":{"x":0,"y":0,"width":10,"height":10,"typo":1}}}
        ]}),
    ] {
        assert!(!protocol.execute_json(dir.path(), request).ok);
        assert_eq!(
            opened,
            ok(
                &mut protocol,
                dir.path(),
                json!({"command":"snapshot","session":id})
            )
        );
    }
    let oversized = protocol.execute_json(dir.path(), json!({"command":"enact","session":id,"expected_revision":0,"operations":[
        {"selector":{"kind":"ui","id":"score"},"change":{"op":"set_text","text":"x".repeat(MAX_REQUEST_BYTES)}}
    ]}));
    assert_eq!(oversized.diagnostics[0].code, "DEVELOPER_REQUEST_TOO_LARGE");
    protocol.session.as_mut().unwrap().recorded_ticks = 60_000;
    let full = protocol.execute_json(
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":0}),
    );
    assert_eq!(full.diagnostics[0].code, "RECORDING_FULL");
    assert_eq!(
        opened,
        ok(
            &mut protocol,
            dir.path(),
            json!({"command":"snapshot","session":id})
        )
    );
}

#[test]
fn watch_preserves_array_shaped_physics_events_without_treating_them_as_deltas() {
    let dir = fixture();
    fs::write(
        dir.path().join("scene.json"),
        r#"{
        "physics":{"ground_y":0}, "entities":[
            {"id":"player","name":"Player","transform":{"x":0,"y":0},"rigidbody":{}},
            {"id":"other","name":"Other","transform":{"x":0.2,"y":0},"rigidbody":{}}
        ]
    }"#,
    )
    .unwrap();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":0}),
    );
    let watched = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"watch","session":id,"after":opened["cursor"],"paths":["/entities/player/transform"]}),
    );
    let entries = watched["entries"].as_array().unwrap();
    for kind in ["contacts", "ground_contacts"] {
        let entry = entries.iter().find(|entry| entry["kind"] == kind).unwrap();
        assert!(!entry["data"].as_array().unwrap().is_empty());
    }
}

#[test]
fn three_dimensional_edits_replay_and_luau_retains_gameplay_ownership() {
    let dir = fixture();
    fs::write(
        dir.path().join("scene.json"),
        r#"{"camera3d":{},"entities":[{"id":"player","transform3d":{}}]}"#,
    )
    .unwrap();
    fs::write(dir.path().join("main.luau"), r#"local Game = {}
function Game.start(api) end
function Game.update(api, dt)
    api.entity.setTransform3D("player", {position={x=1,y=2,z=3},rotation={x=0,y=0,z=0},scale={x=1,y=1,z=1}})
end
return Game"#).unwrap();
    let mut protocol = DeveloperProtocol::default();
    let opened = open(&mut protocol, dir.path());
    let id = &opened["session"];
    ok(
        &mut protocol,
        dir.path(),
        json!({"command":"enact","session":id,"expected_revision":0,"operations":[
            {"selector":{"kind":"entity","id":"player"},"change":{"op":"set_transform3d","transform":{"position":{"x":9,"y":8,"z":7}}}},
            {"selector":{"kind":"scene"},"change":{"op":"set_camera3d","camera":{"fov_degrees":75}}}
        ]}),
    );
    let edited = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"snapshot","session":id}),
    );
    assert_eq!(
        edited["snapshot"]["entities"]["player"]["transform3d"]["position"]["z"],
        7.0
    );
    assert_eq!(edited["snapshot"]["camera3d"]["fov_degrees"], 75.0);
    let stepped = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"step","session":id,"expected_revision":1,"frames":1}),
    );
    assert_eq!(
        stepped["snapshot"]["entities"]["player"]["transform3d"]["position"]["z"],
        3.0
    );
    let recording = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"recording","session":id}),
    );
    let replayed = ok(
        &mut protocol,
        dir.path(),
        json!({"command":"replay","recording":recording}),
    );
    assert_eq!(replayed["identical"], true);
}
