//! `api.assets.imageGroups`: requests the game makes and the state the host
//! reports stay outside World. See docs/web-image-assets.md#game-requests.
use serde_json::{Value, json};
use std::fs;
use unone_engine::{EngineRuntime, HostProject, ImageGroupRequest, InputFrame, observation_digest};

// Start preloads the town; each update promotes it, reads it back and keeps
// the same observation a game without image groups would.
const TOWN: &str = r#"
return {start=function(api)
    api.assets.imageGroups.preload('town')
end,update=function(api)
    local g = api.assets.imageGroups
    if api.input.isDown('Enter') then g.load('town') end
    if api.input.isDown('Leave') then g.unload('town') end
    local s = g.status('town')
    api.observation.set('state', s.state)
    api.observation.set('requested', s.requested or 'none')
    api.observation.set('ready', s.ready)
    api.observation.set('total', s.total)
    api.observation.set('bytes', s.bytes)
    api.observation.set('error', s.error or 'none')
    api.observation.set('frame_seen', true)
end}"#;

const PLAIN: &str = r#"return {start=function(api) end, update=function(api) api.observation.set('frame_seen', true) end}"#;

fn load(script: &str, groups: &[&str], host: bool) -> Result<EngineRuntime, Box<unone_engine::Diagnostic>> {
    let mut payload = json!({"config":{"name":"image-groups","entry_script":"main.luau"},"script":script});
    if !groups.is_empty() { payload["image_groups"] = json!(groups); }
    if host { payload["image_group_host"] = json!(true); }
    HostProject::parse(&serde_json::to_vec(&payload).unwrap())?.into_runtime(42)
}

fn report(state: &str, ready: u32, error: Option<&str>) -> InputFrame {
    let mut receipt = json!({"name":"town","state":state,"total":3,"ready":ready,"bytes":ready as u64 * 4096});
    if let Some(error) = error { receipt["error"] = json!(error); }
    serde_json::from_value(json!({"presentation_resources":{"image_groups":[receipt]}})).unwrap()
}

fn observed(runtime: &EngineRuntime, key: &str) -> Value { runtime.semantic_observations()[key].clone() }

#[test]
fn the_host_sees_the_held_groups_and_status_follows_its_reports() {
    let mut game = load(TOWN, &["town", "map"], true).unwrap();
    let plan = game.image_group_plan_since(None);
    assert_eq!(plan.revision, 1, "Game.start's preload is already in the plan");
    assert_eq!(plan.groups.unwrap()["town"], ImageGroupRequest::Preload);
    game.tick().unwrap();
    assert_eq!(observed(&game, "state"), "idle", "nothing reported yet");
    assert_eq!(observed(&game, "requested"), "preload");
    game.tick_with_input(&report("loading", 1, None)).unwrap();
    assert_eq!((observed(&game, "state"), observed(&game, "ready").as_f64()), (json!("loading"), Some(1.)));
    game.tick().unwrap();
    assert_eq!(observed(&game, "state"), "loading", "the last report holds until the next one");
    let mut enter = report("ready", 3, None);
    enter.actions.insert("Enter".into(), true);
    game.tick_with_input(&enter).unwrap();
    assert_eq!((observed(&game, "state"), observed(&game, "requested")), (json!("ready"), json!("load")));
    assert_eq!(observed(&game, "bytes").as_f64(), Some(12288.));
    let plan = game.image_group_plan_since(Some(1));
    assert_eq!((plan.revision, plan.groups.unwrap()["town"]), (2, ImageGroupRequest::Load));
    game.set_input("Enter", true);
    game.tick().unwrap();
    assert_eq!(game.image_group_plan_since(Some(2)).groups, None, "a repeated load changes nothing");
    game.set_input("Enter", false);
    game.set_input("Leave", true);
    game.tick().unwrap();
    let plan = game.image_group_plan_since(Some(2));
    assert!(plan.groups.unwrap().is_empty(), "unload drops the group from the plan");
    game.tick_with_input(&report("error", 0, Some("IMAGE_ASSET_GROUP_BUDGET: town"))).unwrap();
    assert_eq!((observed(&game, "state"), observed(&game, "error")), (json!("error"), json!("IMAGE_ASSET_GROUP_BUDGET: town")));
}

#[test]
fn requests_and_reports_never_change_world_or_its_digest() {
    let mut with_groups = load(TOWN, &["town"], true).unwrap();
    let mut without = load(PLAIN, &["town"], true).unwrap();
    for frame in 0..6 {
        let input = if frame % 2 == 0 { report("loading", 1, None) } else { InputFrame::default() };
        let a = with_groups.tick_with_input(&input).unwrap();
        let b = without.tick().unwrap();
        // Only the observations a game chose to publish differ; strip them.
        let strip = |mut s: unone_engine::WorldSnapshot| { s.observations.clear(); s };
        assert_eq!(observation_digest(&strip(a)).unwrap(), observation_digest(&strip(b)).unwrap(), "frame {frame}");
    }
}

#[test]
fn outside_a_managing_host_requests_are_validated_and_status_reads_unsupported() {
    let mut game = load(TOWN, &["town"], false).unwrap();
    game.tick().unwrap();
    assert_eq!((observed(&game, "state"), observed(&game, "requested")), (json!("unsupported"), json!("preload")));
    // A replay's recorded reports still win.
    game.tick_with_input(&report("ready", 3, None)).unwrap();
    assert_eq!(observed(&game, "state"), "ready");
}

#[test]
fn an_unknown_group_fails_where_the_game_asks_for_it() {
    let typo = load(&TOWN.replace("preload('town')", "preload('towm')"), &["town", "map"], true).err().unwrap();
    assert!(typo.explanation.contains("IMAGE_GROUP_UNKNOWN: 'towm' is not a group in player.image-assets.json. Declared: [map, town]"), "{}", typo.explanation);
    let none = load(TOWN, &[], true).err().unwrap();
    assert!(none.explanation.contains("the project declares no image groups"), "{}", none.explanation);
    let invalid = load(PLAIN, &["town", "town"], true).err().unwrap();
    assert_eq!(invalid.code, "IMAGE_PLAN_INVALID");
}

#[test]
fn individual_texture_selectors_share_both_api_names_and_validate_the_manifest() {
    let id = "竹".repeat(682) + "ab";
    let script = r#"return {start=function(api)
        local old, new = api.assets.imageGroups, api.assets.imagePreloads
        assert(old == new)
        local art = string.rep("竹", 682) .. "ab"
        new.setOwner("scene", {town="preload", [art]="load"})
        assert(old.owners(art).scene == "load")
        assert(not pcall(function() new.setOwner("scene", {unknown="load"}) end))
        assert(old.status(art).requested == "load")
    end, update=function(api)
        local art = string.rep("竹", 682) .. "ab"
        local old, new = api.assets.imageGroups, api.assets.imagePreloads
        local s = new.status(art)
        api.observation.set("state", s.state)
        if s.state == "error" then old.retry(art) end
        if s.state == "ready" then old.releaseOwner("scene") end
    end}"#;
    let mut payload = json!({"config":{"name":"streams","entry_script":"main.luau"},"script":script,
        "image_groups":["town"],"image_streams":[id],"image_group_host":true,"asset_catalog":[{"id":id,"kind":"texture2d"}]});
    let run = |payload: &Value| HostProject::parse(&serde_json::to_vec(payload).unwrap()).unwrap().into_runtime(42);
    let mut runtime = run(&payload).unwrap();
    let plan = runtime.image_group_plan_since(None);
    assert_eq!(plan.groups.unwrap(), [("town".into(), ImageGroupRequest::Preload), (id.clone(), ImageGroupRequest::Load)].into());
    let frame = |state: &str, ready| serde_json::from_value(json!({"presentation_resources":{"image_groups":[
        {"name":id,"state":state,"total":1,"ready":ready,"bytes":4}
    ]}})).unwrap();
    runtime.tick_with_input(&frame("error", 0)).unwrap();
    assert_eq!(runtime.image_group_plan_since(Some(plan.revision)).retries, vec![id.clone()]);
    runtime.tick_with_input(&frame("ready", 1)).unwrap();
    assert_eq!(observed(&runtime, "state"), json!("ready"));
    assert!(runtime.image_group_plan_since(None).groups.unwrap().is_empty());
    payload["image_streams"] = json!(["art"]);
    for catalog in [json!([]), json!([{"id":"art","kind":"audio"}]), json!([{"id":"different","kind":"texture2d"}])] {
        payload["asset_catalog"] = catalog;
        assert_eq!(run(&payload).err().unwrap().code, "IMAGE_PLAN_INVALID");
    }
}

#[test]
fn named_owners_replace_atomically_share_promote_and_release_independently() {
    let script = r#"return {start=function(api)
        local g=api.assets.imageGroups
        g.preload("town")
        g.setOwner("npc",{town="load",map="preload"})
        g.setOwner("story",{town="preload"})
        assert(g.status("town").requested=="load")
        assert(not pcall(function() g.setOwner("npc",{town="preload",typo="load"}) end))
        assert(not pcall(function() g.setOwner("npc",{town="unload"}) end))
        assert(not pcall(function() g.setOwner("",{}) end))
        assert(g.owners("town").npc=="load" and g.owners("map").npc=="preload")
        local copy=g.owners("town"); copy.npc=nil
        assert(g.owners("town").npc=="load")
        g.unload("town")
    end,update=function(api)
        local g=api.assets.imageGroups
        if api.input.isDown("Retry") then g.retry("town") end
        if api.input.isDown("Close") then
            g.releaseOwner("npc");g.releaseOwner("npc")
            assert(g.owners("town").story=="preload" and g.owners("map").npc==nil)
        end
        if api.input.isDown("End") then g.setOwner("story",{}) end
        if api.input.isDown("Fault") then g.setOwner("broken",{map="load"});error("rollback") end
    end}"#;
    let mut game = load(script, &["town","map"], true).unwrap();
    let plan = game.image_group_plan_since(None);
    assert_eq!(plan.revision, 2);
    assert_eq!(plan.groups.unwrap()["town"], ImageGroupRequest::Load);
    let mut failed = report("error", 0, Some("transient"));
    failed.actions.insert("Retry".into(), true);
    game.tick_with_input(&failed).unwrap();
    let retried = game.image_group_plan_since(Some(2));
    assert_eq!(retried.retries, vec!["town"]);
    assert_eq!(retried.groups.unwrap()["town"], ImageGroupRequest::Load);
    game.set_input("Retry", false);
    game.set_input("Close", true);
    game.tick().unwrap();
    let closed = game.image_group_plan_since(Some(retried.revision));
    assert!(closed.retries.is_empty());
    assert_eq!(closed.groups.unwrap(), [("town".into(),ImageGroupRequest::Preload)].into());
    game.set_input("Close", false);
    game.set_input("Fault", true);
    assert!(game.tick().is_err());
    assert_eq!(game.image_group_plan_since(None).groups.unwrap().len(), 1);
    game.set_input("Fault", false);
    game.set_input("End", true);
    game.tick().unwrap();
    assert!(game.image_group_plan_since(None).groups.unwrap().is_empty());
}

#[test]
fn malformed_reports_are_refused_before_the_tick() {
    let mut game = load(TOWN, &["town"], true).unwrap();
    let mut bad = report("ready", 3, None);
    bad.presentation_resources.image_groups[0].ready = 9;
    let error = game.tick_with_input(&bad).unwrap_err();
    assert!(error.explanation.contains("INPUT_PRESENTATION_INVALID"), "{}", error.explanation);
    assert_eq!(game.observe().frame, 0);
    // A report for a group the script does not declare is ignored.
    let stray: InputFrame = serde_json::from_value(json!({"presentation_resources":{"image_groups":[{"name":"elsewhere","state":"ready","total":1,"ready":1,"bytes":4}]}})).unwrap();
    game.tick_with_input(&stray).unwrap();
    assert_eq!(observed(&game, "state"), "idle");
}

#[test]
fn owners_can_select_more_than_128_individual_textures_but_only_128_owners_can_hold_them() {
    let ids: Vec<_> = (1..=129).map(|i| format!("art-{i}")).collect();
    let catalog: Vec<_> = ids.iter().map(|id| json!({"id":id,"kind":"texture2d"})).collect();
    let script = r#"return {start=function(api)
        local g, desired = api.assets.imagePreloads, {}
        for i=1,129 do desired["art-" .. i] = "preload" end
        g.setOwner("large", desired)
        for i=1,127 do g.setOwner("owner-"..i, {["art-1"]="load"}) end
        local ok, err = pcall(function() g.setOwner("one-too-many", {["art-2"]="load"}) end)
        assert(not ok and string.find(tostring(err), "IMAGE_GROUP_OWNER_LIMIT"))
        assert(g.owners("art-2")["one-too-many"] == nil)
        g.releaseOwner("owner-127")
        g.setOwner("replacement", {["art-2"]="load"})
    end, update=function(api) end}"#;
    let payload = json!({"config":{"name":"owners","entry_script":"main.luau"},"script":script,"image_streams":ids,"asset_catalog":catalog});
    let game = HostProject::parse(&serde_json::to_vec(&payload).unwrap()).unwrap().into_runtime(42).unwrap();
    let held = game.image_group_plan_since(None).groups.unwrap();
    assert_eq!(held.len(), 129);
    assert_eq!(held["art-2"], ImageGroupRequest::Load);
}

#[test]
fn tools_read_the_group_names_from_the_projects_image_plan() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("scripts")).unwrap();
    fs::write(root.join("project.unone.json"), json!({"name":"plan","entry_script":"scripts/main.luau"}).to_string()).unwrap();
    fs::write(root.join("scripts/main.luau"), TOWN).unwrap();
    let error = EngineRuntime::load_with_seed(root, 1).err().unwrap();
    assert!(error.explanation.contains("declares no image groups"), "{}", error.explanation);
    fs::write(root.join("player.image-assets.json"), json!({"version":1,"groups":{"town":["image://town"]},"startup":[]}).to_string()).unwrap();
    let mut game = EngineRuntime::load_with_seed(root, 1).unwrap();
    game.tick().unwrap();
    assert_eq!(observed(&game, "state"), "unsupported", "check, run and test hold no images");
    fs::write(root.join("player.image-assets.json"), r#"{"groups":[]}"#).unwrap();
    assert_eq!(EngineRuntime::load_with_seed(root, 1).err().unwrap().code, "IMAGE_PLAN_INVALID");
}
