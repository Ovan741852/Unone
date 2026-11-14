//! Rollback checkpoints (docs/rollback.md): run N ticks, roll back K, run them
//! again, and the world matches a straight run, physics, particles, random
//! numbers and the game's own Luau state included.
use serde_json::{Value, json};
use unone_engine::{EngineRuntime, HostProject, InputFrame, TestSelection, observation_digest, parse_input_frame};

/// Everything a checkpoint must carry: 2D and 3D bodies, particles, random
/// numbers, observations and Luau variables (through the state hooks).
const GAME: &str = r#"
local Game = {}
local score = 0
local rolls = {}
local ticks = 0
function Game.start(api)
  api.particle.play("spark", {x=0,y=0,z=0}, 42)
end
function Game.update(api)
  ticks += 1
  score += if api.input.isDown("Jump") then 2 else 1
  table.insert(rolls, api.random.nextFloat())
  if #rolls > 4 then table.remove(rolls, 1) end
  if api.input.wasPressed("Jump") then
    api.physics3d.applyImpulse("ball", {x=1, y=4, z=0.5})
    api.physics.applyImpulse("puck", {x=3, y=1})
  end
  if ticks % 15 == 0 then
    api.particle.play("spark", {x=api.random.nextInt(-3, 3), y=0, z=0})
  end
  api.observation.set("score", score)
  api.observation.set("rolls", rolls)
  api.observation.set("ball", api.entity.getTransform3D("ball").position)
  api.observation.set("puck", api.entity.getPosition("puck"))
end
--@saveState
function Game.saveState(api)
  return {score=score, rolls=table.clone(rolls), ticks=ticks}
end
function Game.loadState(api, state)
  score = state.score
  rolls = table.clone(state.rolls)
  ticks = state.ticks
end
--@end
return Game
"#;

fn runtime(script: &str) -> Result<EngineRuntime, Box<unone_engine::Diagnostic>> {
    HostProject::parse(
        &serde_json::to_vec(&json!({
            "config": {"name": "rollback-test", "entry_script": "main.luau", "input_actions": ["Jump"], "systems": {"physics3d": true}},
            "script": script,
            "scene": {
                "camera3d": {},
                "physics3d": {
                    "gravity": {"x": 0, "y": -9.81, "z": 0},
                    "bodies": {
                        "ball": {"body_type": "dynamic", "shape": {"kind": "sphere", "radius": 0.35}, "restitution": 0.6},
                        "floor": {"body_type": "static", "shape": {"kind": "box", "half_extents": {"x": 10, "y": 0.5, "z": 10}}}
                    }
                },
                "entities": [
                    {"id": "ball", "transform3d": {"position": {"x": 0, "y": 3, "z": 0}}},
                    {"id": "floor", "transform3d": {"position": {"x": 0, "y": -0.5, "z": 0}}},
                    {"id": "puck", "transform": {"x": -4, "y": 0}, "rigidbody": {"velocity": {"x": 1, "y": 0}, "restitution": 0.5}},
                    {"id": "wall", "transform": {"x": 2, "y": 0}, "rigidbody": {"body_type": "static"}}
                ],
                "particle_effects": {
                    "spark": {
                        "version": 1, "duration_frames": 4,
                        "emitters": [{
                            "id": "sparks", "count": 6, "interval_frames": 1, "lifetime_frames": 20,
                            "spread": {"x": 0.1, "y": 0.1, "z": 0.1},
                            "velocity_min": {"x": -2, "y": 0.5, "z": -2}, "velocity_max": {"x": 2, "y": 3, "z": 2},
                            "gravity": {"x": 0, "y": -4, "z": 0},
                            "size_start": 0.1, "size_end": 0.01,
                            "color_start": [1, 0.6, 0.1, 1], "color_end": [1, 0.1, 0, 0]
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )?
    .into_runtime(42)
}

fn without_hooks(script: &str) -> String {
    let start = script.find("--@saveState").unwrap();
    let end = script.find("--@end").unwrap();
    format!("{}{}", &script[..start], &script[end..])
}

/// The input of tick `frame`: Jump held on a few spans, so predictions of
/// "nothing held" are wrong there.
fn input(frame: u64) -> InputFrame {
    let jump = matches!(frame, 5..=9 | 31..=33 | 70..=90);
    parse_input_frame(json!({"actions": {"Jump": jump}}).to_string().as_bytes()).unwrap()
}

fn digest(runtime: &EngineRuntime) -> String {
    observation_digest(&runtime.observe()).unwrap()
}

fn straight(script: &str, frames: u64) -> Vec<String> {
    let mut runtime = runtime(script).unwrap();
    (0..frames)
        .map(|frame| {
            runtime.tick_with_input(&input(frame)).unwrap();
            digest(&runtime)
        })
        .collect()
}

#[test]
fn rolling_back_before_every_tick_matches_a_straight_run() {
    const FRAMES: u64 = 120;
    let expected = straight(GAME, FRAMES);
    let mut rolled = runtime(GAME).unwrap();
    assert!(rolled.has_state_hooks());
    for frame in 0..FRAMES {
        let before = digest(&rolled);
        let checkpoint = rolled.checkpoint().unwrap();
        assert_eq!(checkpoint.frame(), frame);
        for _ in 0..7 {
            rolled.tick_with_input(&InputFrame::default()).unwrap();
        }
        rolled.restore(&checkpoint).unwrap();
        assert_eq!(digest(&rolled), before, "restoring before tick {} changed the world", frame + 1);
        rolled.tick_with_input(&input(frame)).unwrap();
        assert_eq!(digest(&rolled), expected[frame as usize], "tick {} diverged after a rollback", frame + 1);
    }
    let world = rolled.observe();
    assert!(world.observations["score"].as_f64().unwrap() > FRAMES as f64, "Jump spans count double");
    assert!(!world.particles.is_empty(), "particles survive restores");
    assert!(world.observations["ball"]["y"].as_f64().unwrap() < 2.0, "the ball fell: {}", world.observations["ball"]);
    assert!(world.observations["puck"]["x"].as_f64().unwrap() != -4.0, "the puck moved: {}", world.observations["puck"]);
}

#[test]
fn a_checkpoint_restored_far_later_continues_the_same_way() {
    let expected = straight(GAME, 100);
    let mut rolled = runtime(GAME).unwrap();
    for frame in 0..30 {
        rolled.tick_with_input(&input(frame)).unwrap();
    }
    let checkpoint = rolled.checkpoint().unwrap();
    // One a tick, two while Jump is held (ticks 6 to 10).
    assert_eq!(checkpoint.game_state().unwrap()["score"], json!(30 + 5));
    // Sixty ticks of different input, then back to tick 30.
    for _ in 0..60 {
        let held = parse_input_frame(br#"{"actions":{"Jump":true}}"#).unwrap();
        rolled.tick_with_input(&held).unwrap();
    }
    assert_ne!(digest(&rolled), expected[89]);
    rolled.restore(&checkpoint).unwrap();
    assert_eq!(digest(&rolled), expected[29]);
    for frame in 30..100 {
        rolled.tick_with_input(&input(frame)).unwrap();
        assert_eq!(digest(&rolled), expected[frame as usize], "tick {} after the restore", frame + 1);
    }
}

#[test]
fn without_state_hooks_luau_variables_keep_what_the_rolled_back_ticks_did() {
    let script = without_hooks(GAME);
    let expected = straight(&script, 12);
    let mut rolled = runtime(&script).unwrap();
    assert!(!rolled.has_state_hooks());
    for frame in 0..10 {
        rolled.tick_with_input(&input(frame)).unwrap();
    }
    let checkpoint = rolled.checkpoint().unwrap();
    assert!(checkpoint.game_state().is_none());
    rolled.tick_with_input(&input(10)).unwrap();
    rolled.restore(&checkpoint).unwrap();
    // The engine's state is back (score is an observation the engine copied)...
    assert_eq!(digest(&rolled), expected[9]);
    // ...but `score` in Luau counted the undone tick, so the next tick is off.
    rolled.tick_with_input(&input(10)).unwrap();
    assert_ne!(digest(&rolled), expected[10]);
}

#[test]
fn state_hooks_come_as_a_pair() {
    let only_save = GAME.replace("function Game.loadState(api, state)", "local function unused(api, state)");
    let error = runtime(&only_save).err().expect("a lone saveState must not load");
    assert_eq!(error.code, "GAME_STATE_HOOKS_INCOMPLETE");
    let not_a_function = GAME.replace("return Game\n", "Game.loadState = {}\nreturn Game\n");
    let error = runtime(&not_a_function).err().expect("a table is not a hook");
    assert_eq!(error.code, "GAME_STATE_HOOKS_INCOMPLETE");
    assert!(error.explanation.contains("Game.loadState is a table"), "{}", error.explanation);
}

#[test]
fn saved_state_must_be_plain_data() {
    let script = GAME.replace("return {score=score, rolls=table.clone(rolls), ticks=ticks}", "return {score=score, again=function() end}");
    let rolled = runtime(&script).unwrap();
    let error = rolled.checkpoint().err().expect("a function is not plain data");
    assert_eq!(error.code, "GAME_STATE_INVALID");
}

#[test]
fn spatial_batches_block_checkpoints() {
    let script = r#"
local index
return {
  start = function(api) index = api.spatial.create({{id=1, position={0,0,0}, radius=1}}) end,
  update = function(api) end,
}
"#;
    let rolled = HostProject::parse(
        &serde_json::to_vec(&json!({
            "config": {"name": "rollback-spatial", "entry_script": "main.luau", "systems": {"physics2d": false, "physics3d": false}},
            "script": script,
            "scene": {"entities": []}
        }))
        .unwrap(),
    )
    .unwrap()
    .into_runtime(42)
    .unwrap();
    let error = rolled.checkpoint().err().expect("spatial work is not checkpointed");
    assert_eq!(error.code, "ROLLBACK_UNSUPPORTED");
}

fn test_project(script: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("tests")).unwrap();
    std::fs::write(dir.path().join("main.luau"), script).unwrap();
    std::fs::write(
        dir.path().join("project.unone.json"),
        json!({"name": "rollback-suite", "entry_script": "main.luau", "test_files": ["tests/count.test.json"], "input_actions": ["Jump"],
               "systems": {"physics2d": false, "physics3d": false, "particle": false}})
        .to_string(),
    )
    .unwrap();
    let sequence: Vec<Value> = (0..40).map(|frame| json!({"actions": {"Jump": (10..20).contains(&frame)}})).collect();
    std::fs::write(
        dir.path().join("tests/count.test.json"),
        json!({"name": "count", "frames": 40, "input_sequence": sequence,
               "assertions": [{"observation": {"key": "count", "equals": 50}}]})
        .to_string(),
    )
    .unwrap();
    dir
}

const COUNTER: &str = r#"
local Game = {}
local count = 0
function Game.start(api) end
function Game.update(api)
  count += if api.input.isDown("Jump") then 2 else 1
  api.observation.set("count", count)
end
--@saveState
function Game.saveState(api) return {count=count} end
function Game.loadState(api, state) count = state.count end
--@end
return Game
"#;

#[test]
fn game_test_rollback_passes_a_game_with_hooks_and_names_the_tick_without_them() {
    let rollback = TestSelection { rollback: Some(4), ..Default::default() };
    let hooked = test_project(COUNTER);
    let report = EngineRuntime::run_tests_with(hooked.path(), &rollback).value.unwrap();
    assert!(report.passed, "{:?}", report.cases[0].failures);
    let plain = EngineRuntime::run_tests_with(hooked.path(), &TestSelection::default()).value.unwrap();
    assert_eq!(report.cases[0].observation_digest, plain.cases[0].observation_digest);

    let unhooked = test_project(&without_hooks(COUNTER));
    let report = EngineRuntime::run_tests_with(unhooked.path(), &rollback).value.unwrap();
    assert!(!report.passed);
    let failure = &report.cases[0].failures[0];
    assert!(failure.starts_with("ROLLBACK_DIVERGED: tick 1,"), "{failure}");
    assert!(failure.contains("world.observations.count"), "{failure}");
    assert!(failure.contains("Game.saveState"), "{failure}");
}
