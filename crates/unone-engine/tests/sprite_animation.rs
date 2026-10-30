use unone_engine::EngineRuntime;

fn game(source: &str, scene: Option<serde_json::Value>) -> EngineRuntime {
    let scene = scene.map(|scene| serde_json::from_value(scene).unwrap());
    EngineRuntime::load_source("sprite-animation", "main.luau", source, scene).unwrap()
}

fn frame_of(runtime: &EngineRuntime, id: &str) -> u32 {
    runtime.observe().entities[id].sprite.as_ref().unwrap().frame
}

fn frames(runtime: &mut EngineRuntime, id: &str, ticks: usize) -> Vec<u32> {
    (0..ticks)
        .map(|_| runtime.tick().unwrap().entities[id].sprite.as_ref().unwrap().frame)
        .collect()
}

fn failure(call: &str) -> String {
    let runtime = game(
        &format!(
            r#"
return {{start=function(api)
    local hero = api.entity.spawn("hero", {{sprite={{asset="texture://hero", sheet={{columns=4, rows=2}}}}}})
    local plain = api.entity.spawn("plain", {{sprite={{asset="texture://plain"}}}})
    local ok, err = pcall(function() {call} end)
    assert(not ok, "expected a failure")
    api.observation.set("error", tostring(err))
end, update=function() end}}
"#
        ),
        None,
    );
    runtime.semantic_observations()["error"].as_str().unwrap().to_string()
}

#[test]
fn a_scene_clip_steps_cells_on_the_fixed_tick_from_the_first_observation() {
    let mut runtime = game(
        "return {start=function(api) end, update=function(api) end}",
        Some(serde_json::json!({"entities": [{
            "id": "bird",
            "sprite": {"asset": "texture://bird", "sheet": {"columns": 4, "rows": 1}},
            "sprite_animation": {"frames": [0, 1, 2, 3], "fps": 15}
        }]})),
    );
    // 15 fps at 60 ticks per second holds each cell for 4 observations.
    assert_eq!(frame_of(&runtime, "bird"), 0);
    assert_eq!(frames(&mut runtime, "bird", 16), [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 0]);
}

#[test]
fn a_clip_played_during_update_shows_its_first_cell_without_skipping_it() {
    let mut runtime = game(
        r#"
local hero
return {start=function(api)
    hero = api.entity.spawn("hero", {sprite={asset="texture://hero", sheet={columns=8, rows=1}, frame=7}})
end, update=function(api)
    -- Called every update for the current state: it must not restart.
    api.entity.playSpriteAnimation(hero, {frames={2,3,4}, fps=60, loop=false})
    local frame, finished = api.entity.getSpriteFrame(hero)
    api.observation.set("frame", frame)
    api.observation.set("finished", finished)
end}
"#,
        None,
    );
    assert_eq!(frame_of(&runtime, "hero"), 7);
    assert_eq!(frames(&mut runtime, "hero", 5), [2, 3, 4, 4, 4]);
    let observations = runtime.semantic_observations();
    assert_eq!((observations["frame"].as_f64(), observations["finished"].as_bool()), (Some(4.0), Some(true)));
}

#[test]
fn set_sprite_frame_stops_a_clip_and_lets_the_same_clip_restart() {
    let mut runtime = game(
        r#"
local hero
local IDLE = {frames={0,1,2,3}, fps=30}
local ATTACK = {frames={4,5}, fps=30, loop=false}
local tick = 0
return {start=function(api)
    hero = api.entity.spawn("hero", {sprite={asset="texture://hero", sheet={columns=4, rows=2}}, sprite_animation=IDLE})
end, update=function(api)
    tick += 1
    if tick == 3 or tick == 9 then
        api.entity.setSpriteFrame(hero, 6)
    end
    if tick >= 3 and tick < 12 then
        api.entity.playSpriteAnimation(hero, ATTACK)
    elseif tick >= 12 then
        api.entity.playSpriteAnimation(hero, IDLE)
    end
end}
"#,
        None,
    );
    // Idle from the spawn in start: 30 fps holds each cell for 2 ticks.
    // Tick 3 stops it and starts the attack; tick 9 restarts the same attack.
    assert_eq!(
        frames(&mut runtime, "hero", 14),
        [0, 1, 4, 4, 5, 5, 5, 5, 4, 4, 5, 0, 0, 1]
    );
}

#[test]
fn a_sprite_swap_keeps_a_fitting_clip_and_rejects_or_stops_otherwise() {
    let mut runtime = game(
        r#"
local fish
return {start=function(api)
    fish = api.entity.spawn("fish", {sprite={asset="texture://fish/red", sheet={columns=4, rows=1}},
        sprite_animation={frames={0,1,2,3}, fps=30}})
end, update=function(api)
    local frame = api.entity.getSpriteFrame(fish)
    if frame == 2 then
        api.entity.setSprite(fish, {asset="texture://fish/gold", sheet={columns=2, rows=2}, layer=1})
        local ok, err = pcall(api.entity.setSprite, fish, {asset="texture://fish/tiny", sheet={columns=2, rows=1}})
        assert(not ok)
        api.observation.set("error", tostring(err))
    end
end}
"#,
        None,
    );
    assert_eq!(frames(&mut runtime, "fish", 8), [0, 1, 1, 2, 2, 3, 3, 0]);
    let world = runtime.observe();
    let sprite = world.entities["fish"].sprite.as_ref().unwrap();
    assert_eq!((sprite.asset.as_str(), sprite.layer), ("texture://fish/gold", 1));
    assert!(runtime.semantic_observations()["error"].as_str().unwrap().contains("SPRITE_ANIMATION_INVALID"));

    let mut runtime = game(
        r#"
local fish
return {start=function(api)
    fish = api.entity.spawn("fish", {sprite={asset="texture://fish/red", sheet={columns=4, rows=1}},
        sprite_animation={frames={1,2}, fps=60}})
    api.entity.setSprite(fish, {asset="texture://bones"})
    local frame, finished = api.entity.getSpriteFrame(fish)
    api.observation.set("frame", frame)
end, update=function() end}
"#,
        None,
    );
    assert_eq!(runtime.semantic_observations()["frame"].as_f64(), Some(0.0));
    assert_eq!(frames(&mut runtime, "fish", 2), [0, 0]);
}

#[test]
fn sprites_without_a_sheet_observe_exactly_as_before() {
    let runtime = game(
        r#"return {start=function(api) api.entity.spawn("coin", {sprite={asset="texture://coin"}}) end, update=function() end}"#,
        None,
    );
    let sprite = serde_json::to_value(runtime.observe().entities["coin"].sprite.as_ref().unwrap()).unwrap();
    assert_eq!(sprite, serde_json::json!({"asset": "texture://coin", "size": {"x": 1.0, "y": 1.0}, "visible": true, "layer": 0}));
}

#[test]
fn invalid_sheets_frames_and_clips_fail_loudly() {
    let cases = [
        (r#"api.entity.spawn("x", {sprite={asset="a", frame=1}})"#, "needs a sheet"),
        (r#"api.entity.spawn("x", {sprite={asset="a", sheet={columns=0, rows=1}}})"#, "SCENE_SPRITE_INVALID"),
        (r#"api.entity.spawn("x", {sprite={asset="a", sheet={columns=2, rows=1}, frame=2}})"#, "outside its 2x1 sheet"),
        (r#"api.entity.spawn("x", {sprite={asset="a"}, sprite_animation={frames={0}, fps=8}})"#, "SCENE_SPRITE_ANIMATION_INVALID"),
        (r#"api.entity.setSprite(hero, {asset="a", sheet={columns=70000, rows=1}})"#, "at most 65536 cells"),
        (r#"api.entity.setSpriteFrame(plain, 0)"#, "has no sheet"),
        (r#"api.entity.setSpriteFrame(hero, 8)"#, "cells 0..7"),
        (r#"api.entity.setSpriteFrame(hero, 1.5)"#, "SPRITE_FRAME_INVALID"),
        (r#"api.entity.setSpriteFrame(hero, -1)"#, "SPRITE_FRAME_INVALID"),
        (r#"api.entity.playSpriteAnimation(plain, {frames={0}, fps=8})"#, "needs a Sprite with a sheet"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={}, fps=8})"#, "SPRITE_ANIMATION_INVALID"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={0,9}, fps=8})"#, "frame 9 is outside"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={0}, fps=0})"#, "fps must be"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={0}, fps=8, speed=2})"#, "OPTION_UNKNOWN_FIELD"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={0, 1.5}, fps=8})"#, "whole sheet cell numbers"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={0}, fps=8, loop="yes"})"#, "loop must not be a string"),
        (r#"api.entity.playSpriteAnimation(hero, "walk")"#, "SPRITE_ANIMATION_INVALID"),
        (r#"api.entity.playSpriteAnimation(hero, {frames={0}})"#, "missing field `fps`"),
        (r#"api.entity.getSpriteFrame("missing")"#, "does not exist"),
    ];
    for (call, expected) in cases {
        let error = failure(call);
        assert!(error.contains(expected), "{call}: expected '{expected}' in {error}");
    }
}

#[test]
fn cell_rects_match_the_fixture_shared_with_the_web_helper() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../docs/fixtures/sprite-cells.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let sprite: unone_engine::SpriteData = serde_json::from_value(case["sprite"].clone()).unwrap();
        let expected: Vec<f64> = serde_json::from_value(case["rect"].clone()).unwrap();
        let actual = sprite.cell_rect();
        for (actual, expected) in actual.iter().zip(&expected) {
            assert!((f64::from(*actual) - expected).abs() < 1e-6, "{case}: {actual:?}");
        }
    }
}
