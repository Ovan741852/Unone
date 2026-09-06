use std::path::Path;

use serde::Serialize;

use crate::diagnostics::{ActionSuggestion, Diagnostic, EngineResult};
use crate::{project::ProjectPaths, systems::SystemSettings};

#[derive(Debug, Clone, Serialize)]
pub struct ApiParameter {
    pub name: String,
    pub type_name: String,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiDescriptor {
    pub name: String,
    pub category: String,
    pub purpose: String,
    pub when_to_use: String,
    pub when_not_to_use: String,
    pub parameters: Vec<ApiParameter>,
    pub returns: String,
    pub side_effects: Vec<String>,
    pub frame_semantics: String,
    pub common_errors: Vec<String>,
    pub example: String,
    pub related_apis: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiSearchReport {
    pub query: String,
    pub matches: Vec<ApiDescriptor>,
    pub suggested_next_actions: Vec<ApiSearchAction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApiSearchAction {
    pub action: String,
    pub ready: bool,
    pub executable: Option<String>,
    pub argv: Option<Vec<String>>,
    pub reason: String,
    pub diagnostic: Option<Diagnostic>,
}

/// The canonical Luau type contract for the engine API.
///
/// `project init` inlines this into a new entry script and `game api typings`
/// writes it into an existing project. A test asserts it covers every API in
/// the index below, so a new capability cannot ship without its type.
pub fn typings() -> &'static str {
    include_str!("engine.d.luau")
}

pub fn search(query: &str) -> Vec<ApiDescriptor> {
    let normalized = query.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return descriptors();
    }
    let terms: Vec<&str> = normalized.split_whitespace().collect();
    descriptors()
        .into_iter()
        .filter(|descriptor| {
            let searchable = format!(
                "{} {} {} {}",
                descriptor.name, descriptor.category, descriptor.purpose, descriptor.when_to_use
            )
            .to_ascii_lowercase();
            terms.iter().any(|term| searchable.contains(term))
        })
        .collect()
}

/// Search the public engine API and attach the shared no-match guidance.
///
/// An empty query is intentionally a complete index request. A non-empty
/// query with no matches is still a successful search: gameplay verbs may be
/// game-owned composition rather than a missing engine primitive.
pub fn api_search_result(
    project_root: impl AsRef<Path>,
    query: &str,
) -> EngineResult<ApiSearchReport> {
    let matches = search(query);
    let mut result = EngineResult::success(ApiSearchReport {
        query: query.to_string(),
        matches,
        suggested_next_actions: Vec::new(),
    });

    if !query.trim().is_empty()
        && result
            .value
            .as_ref()
            .is_some_and(|report| report.matches.is_empty())
    {
        let mut diagnostic = Diagnostic::warning(
            "API_SEARCH_EMPTY",
            "No matching Engine API found",
            "This search did not match a public Engine API; the gameplay verb may be game-owned composition, so no match does not prove the engine lacks the capability. Inspect the complete API index and systems first, then decide whether a new engine capability is actually needed.",
        );
        diagnostic.facts = serde_json::json!({
            "search_scope": "public_engine_api",
            "query": query,
            "match_count": 0,
        });
        diagnostic.suggested_actions = vec![
            ActionSuggestion {
                action: "search_api_index".to_string(),
                description: "Use the structured executable/argv for action=search_api_index in value.suggested_next_actions to list the complete Engine API index."
                    .to_string(),
                command: None,
            },
            ActionSuggestion {
                action: "list_systems".to_string(),
                description: "Use the structured executable/argv for action=list_systems in value.suggested_next_actions; it is bound to this caller project and remains not ready if the project is unavailable."
                    .to_string(),
                command: None,
            },
        ];
        if let Some(report) = result.value.as_mut() {
            report.suggested_next_actions = suggested_next_actions(project_root.as_ref());
        }
        result.diagnostics.push(diagnostic);
    }

    result
}

fn suggested_next_actions(project_root: &Path) -> Vec<ApiSearchAction> {
    let full_index = ApiSearchAction {
        action: "search_api_index".to_string(),
        ready: true,
        executable: Some("game".to_string()),
        argv: Some(vec![
            "api".to_string(),
            "search".to_string(),
            String::new(),
            "--json".to_string(),
        ]),
        reason: "Query the complete public Engine API index; this query does not need project context.".to_string(),
        diagnostic: None,
    };

    let systems = match ProjectPaths::discover(project_root) {
        Ok((config, paths)) => match SystemSettings::from_config(&config) {
            Ok(_) => {
                let canonical_project = paths.root.to_string_lossy().into_owned();
                ApiSearchAction {
                    action: "list_systems".to_string(),
                    ready: true,
                    executable: Some("game".to_string()),
                    argv: Some(vec![
                        "--project".to_string(),
                        canonical_project,
                        "--json".to_string(),
                        "systems".to_string(),
                        "list".to_string(),
                    ]),
                    reason: "List the systems actually enabled for this caller project; argv is bound to the canonical project root."
                        .to_string(),
                    diagnostic: None,
                }
            }
            Err(diagnostic) => blocked_systems_action(*diagnostic),
        },
        Err(diagnostic) => blocked_systems_action(*diagnostic),
    };

    vec![full_index, systems]
}

fn blocked_systems_action(diagnostic: Diagnostic) -> ApiSearchAction {
    ApiSearchAction {
        action: "list_systems".to_string(),
        ready: false,
        executable: None,
        argv: None,
        reason: diagnostic.explanation.clone(),
        diagnostic: Some(diagnostic),
    }
}

pub fn describe(name: &str) -> Option<ApiDescriptor> {
    descriptors()
        .into_iter()
        .find(|descriptor| descriptor.name.eq_ignore_ascii_case(name.trim()))
}

fn descriptors() -> Vec<ApiDescriptor> {
    vec![
        descriptor(
            "entity.spawn",
            "world",
            "Create a new Entity without a Sprite.",
            "When a game object must be created dynamically at runtime.",
            "For objects that always exist in the scene, prefer putting them in the scene source.",
            vec![parameter(
                "name",
                "string",
                "The Entity display name and base name for its id.",
            )],
            "string: the unique Entity id that was created.",
            vec!["Modify Rust-owned world state"],
            "The Entity can be used immediately in the same script update; its id remains valid until the world is rebuilt.",
            vec!["An empty name uses entity", "A duplicate name receives a suffix such as _2 or _3"],
            "local id = api.entity.spawn(\"enemy\")",
            vec!["entity.getPosition", "entity.setPosition"],
        ),
        descriptor(
            "entity.despawn",
            "world",
            "Remove an Entity and all of its components.",
            "When an object is defeated, destroyed, or leaves the level.",
            "Do not replace removal with moving the object off-screen: its rigid body still participates in collisions and still consumes a physics integration.",
            vec![parameter("id", "string", "The Entity id to remove.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "Takes effect immediately in the same update; contacts for that Entity in the current frame are removed as well.",
            vec!["The Entity does not exist"],
            "api.entity.despawn(\"pig_a\")",
            vec!["entity.spawn", "entity.setSpriteVisible"],
        ),
        descriptor(
            "entity.setSpriteVisible",
            "world",
            "Show or hide an Entity's Sprite while retaining the Entity itself.",
            "When an object must be temporarily hidden while retaining its position, rigid body, or state.",
            "This does not affect collisions: an invisible rigid body still collides. Use entity.despawn for complete removal.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter("visible", "boolean", "true to show, false to hide."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "The next observation reflects the new value in sprite.visible.",
            vec!["The Entity does not exist", "The Entity has no Sprite"],
            "api.entity.setSpriteVisible(\"pig_a\", false)",
            vec!["entity.despawn"],
        ),
        descriptor(
            "entity.getPosition",
            "world",
            "Read an Entity's current 2D Transform position.",
            "When game rules need to use the current position.",
            "Do not use it in place of scene or prefab source data.",
            vec![parameter("id", "string", "An existing Entity id.")],
            "Vec2: x and y values of type number.",
            vec!["Read Rust-owned world state"],
            "Returns the current value from the start of this update; a read after setPosition reflects the new value on the next read.",
            vec!["A missing Entity id returns LUAU_RUNTIME_ERROR"],
            "local position = api.entity.getPosition(\"player\")",
            vec!["entity.setPosition"],
        ),
        descriptor(
            "entity.setPosition",
            "world",
            "Update an Entity's 2D Transform position.",
            "When Luau game rules need to move an object.",
            "Do not maintain a second Transform in each game; that makes observations and rendering disagree.",
            vec![
                parameter("id", "string", "An existing Entity id."),
                parameter("position", "Vec2", "The new x and y coordinates."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned world state"],
            "The update takes effect immediately during the current script call; the world frame increments only after the update completes.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "x/y must be numbers",
            ],
            "api.entity.setPosition(\"player\", { x = 1, y = 0 })",
            vec!["entity.getPosition", "entity.spawn"],
        ),
        descriptor(
            "entity.getTransform2D",
            "world",
            "Read an Entity's complete 2D Transform, including position, radian rotation, and visual scale.",
            "When a 2D Entity's position, facing, and size are needed together.",
            "Do not treat visual scale as the RigidBody2D size; the rigid body declares its own collider.",
            vec![parameter("id", "string", "An existing Entity id.")],
            "Transform2D: position is a Vec2, rotation is in radians, and scale is a positive Vec2.",
            vec!["Read Rust-owned 2D world state"],
            "Returns the 2D transform at call time; it does not create a second transform owned by the game.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
            ],
            "local transform = api.entity.getTransform2D(\"bird\")",
            vec!["entity.setTransform2D", "entity.getPosition"],
        ),
        descriptor(
            "entity.setTransform2D",
            "world",
            "Update an Entity's complete 2D Transform; rotation and scale affect visuals only.",
            "When Luau needs to update a 2D Entity's position, radian rotation, or visual scale together.",
            "Do not use visual scale to change the collider; RigidBody2D radius, mass, velocity, and contact logic remain independent.",
            vec![
                parameter("id", "string", "An existing Entity id."),
                parameter(
                    "transform",
                    "Transform2D",
                    "A complete position and rotation with scale x/y greater than 0.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned 2D visual/world state"],
            "The update takes effect immediately during the current script update; the renderer reads the new visual state from the snapshot, while physics does not read rotation or scale.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "position/rotation must be finite numbers",
                "scale x/y must be greater than 0",
            ],
            "api.entity.setTransform2D(\"bird\", { position = { x = 1, y = 2 }, rotation = 0.5, scale = { x = 1.2, y = 0.8 } })",
            vec!["entity.getTransform2D", "entity.setPosition"],
        ),
        descriptor(
            "entity.getVelocity",
            "physics",
            "Read an Entity's current RigidBody2D velocity.",
            "When game rules need to display, test, or use physical velocity.",
            "For an Entity without a RigidBody2D, declare a physics body in the scene first.",
            vec![parameter("id", "string", "An Entity id with a RigidBody2D.")],
            "Vec2: the current x and y velocity.",
            vec!["Read Rust-owned physics state"],
            "Returns the velocity after the current physics step; changes made during script update are integrated on the next physics step.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "An Entity without a RigidBody2D returns LUAU_RUNTIME_ERROR",
            ],
            "local velocity = api.entity.getVelocity(\"bird\")",
            vec!["entity.setVelocity", "physics.applyImpulse"],
        ),
        descriptor(
            "entity.getTransform3D",
            "world",
            "Read an Entity's 3D Transform, including position, radian Euler rotation, and scale.",
            "When 3D game rules need to use the current object position or orientation.",
            "For a 2D Entity without a Transform3D, declare a 3D transform in the scene. Do not use it in place of game-owned vehicle, character, or combat state.",
            vec![parameter("id", "string", "An Entity id with a Transform3D.")],
            "Transform3D: position, rotation, and scale are all Vec3 values.",
            vec!["Read Rust-owned 3D world state"],
            "Returns the 3D transform from the start of this update; it does not create or copy a game-owned transform.",
            vec![
                "A missing Entity id returns LUAU_RUNTIME_ERROR",
                "An Entity without a Transform3D returns LUAU_RUNTIME_ERROR",
            ],
            "local transform = api.entity.getTransform3D(\"car\")",
            vec!["entity.setTransform3D", "camera3d.getTransform"],
        ),
        descriptor(
            "entity.setTransform3D",
            "world",
            "Update an Entity's 3D Transform.",
            "When Luau game rules need to update a 3D object's position, rotation, or scale.",
            "Do not use it as a substitute for 3D physics; the engine currently provides only a transform primitive, while vehicle dynamics and collision rules remain game-owned until multiple games prove that lower-level capability is needed.",
            vec![
                parameter("id", "string", "An Entity id with a Transform3D."),
                parameter(
                    "transform",
                    "Transform3D",
                    "A complete position and rotation with a positive scale.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned 3D world state"],
            "The update takes effect immediately during the current script update; the renderer reads it after this frame's simulation snapshot.",
            vec![
                "The Entity id is missing or has no Transform3D",
                "position/rotation must be finite Vec3 values",
                "scale x/y/z must be greater than 0",
            ],
            "api.entity.setTransform3D(\"car\", { position = { x = 0, y = 0, z = 2 }, rotation = { x = 0, y = 0.2, z = 0 }, scale = { x = 1, y = 1, z = 2 } })",
            vec!["entity.getTransform3D", "camera3d.setPosition"],
        ),
        descriptor(
            "entity.setVelocity",
            "physics",
            "Set an Entity's RigidBody2D velocity directly.",
            "When a physical velocity must be reset, constrained, or set for a test.",
            "When continuous force is needed; use applyImpulse or a future force API instead.",
            vec![
                parameter("id", "string", "An Entity id with a RigidBody2D."),
                parameter("velocity", "Vec2", "The new x and y velocity."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned physics state"],
            "The setting takes effect immediately during the current script update; the following fixed physics step continues updating it using gravity and collisions.",
            vec![
                "The Entity id is missing or has no RigidBody2D",
                "A static body should not be controlled as a dynamic object",
            ],
            "api.entity.setVelocity(\"bird\", { x = 8, y = 5 })",
            vec!["entity.getVelocity", "physics.applyImpulse"],
        ),
        descriptor(
            "physics.applyImpulse",
            "physics",
            "Apply one instantaneous impulse to a dynamic RigidBody2D.",
            "When a launch, collision reaction, or one-time momentum change is needed.",
            "For continuous per-frame acceleration, do not disguise force as impulse; that would make it timestep-dependent.",
            vec![
                parameter("id", "string", "An Entity id with a dynamic RigidBody2D."),
                parameter(
                    "impulse",
                    "Vec2",
                    "The x and y impulse as a mass-independent change in momentum.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned physics velocity"],
            "Changes velocity immediately during the current script update; gravity, position integration, and collisions run in the fixed physics step after this update.",
            vec![
                "The Entity does not exist or has no RigidBody2D",
                "A static body cannot receive an impulse",
            ],
            "api.physics.applyImpulse(\"bird\", { x = 12, y = 8 })",
            vec!["entity.getVelocity", "entity.setVelocity"],
        ),
        descriptor(
            "camera.getPosition",
            "camera",
            "Read the active Camera2D world position.",
            "When UI or camera-follow logic needs the camera's current position.",
            "Do not treat the camera position as a game character's Transform; characters remain Entities.",
            vec![],
            "Vec2: the camera world position.",
            vec!["Read Rust-owned camera state"],
            "Returns the camera position for the current frame; the renderer uses it on the next draw.",
            vec![],
            "local cameraPosition = api.camera.getPosition()",
            vec!["camera.setPosition", "camera.getZoom"],
        ),
        descriptor(
            "camera.setPosition",
            "camera",
            "Set the active Camera2D world position.",
            "When the camera needs to follow a character or switch the level view.",
            "Do not convert every Entity coordinate to screen coordinates in the game; the renderer uses the camera state.",
            vec![parameter("position", "Vec2", "The new camera world position.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The setting takes effect immediately during the current script update; the next renderer draw reflects the new camera.",
            vec!["x/y must be numbers"],
            "api.camera.setPosition({ x = 4, y = 0 })",
            vec!["camera.getPosition", "camera.setZoom"],
        ),
        descriptor(
            "camera.getZoom",
            "camera",
            "Read the active Camera2D zoom factor.",
            "When the current camera zoom must be displayed or used by camera UI state logic.",
            "Do not use zoom as a substitute for game-world unit conversion; it affects only camera projection.",
            vec![],
            "number: a zoom value greater than 0.",
            vec!["Read Rust-owned camera state"],
            "Returns the current camera zoom; the renderer uses it on the next draw.",
            vec!["The scene zoom must be greater than 0"],
            "local zoom = api.camera.getZoom()",
            vec!["camera.setZoom", "camera.getPosition"],
        ),
        descriptor(
            "camera.setZoom",
            "camera",
            "Set the active Camera2D zoom factor.",
            "When the visible range must be adjusted for a level or game mode.",
            "Do not pass 0, a negative number, or NaN; invalid values are rejected to avoid an uninterpretable projection.",
            vec![parameter("zoom", "number", "A zoom factor greater than 0.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The setting takes effect immediately during the current script update; the next renderer draw reflects the new zoom.",
            vec!["zoom must be a finite number greater than 0"],
            "api.camera.setZoom(1.25)",
            vec!["camera.getZoom", "camera.setPosition"],
        ),
        descriptor(
            "animation.play",
            "presentation",
            "Select the skeletal animation clip to play for an Entity.",
            "When a character or object needs skeletal animation; the engine stores only semantic state and the host's Spine runtime performs playback.",
            "Do not use it for game-rule timing; the engine does not evaluate bones, meshes, or blending, and does not report whether playback has finished.",
            vec![
                parameter("id", "string", "The target Entity id."),
                parameter("name", "string", "The animation clip name defined by the Spine asset."),
                parameter(
                    "options",
                    "table?",
                    "Optional asset, loop, and speed; if asset is omitted, use the animation asset declared by the scene.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Entity animation state"],
            "Repeating the same asset/name/loop/speed does not restart playback; started_frame changes only when the clip changes.",
            vec![
                "The Entity does not exist",
                "The animation name is empty",
                "speed is not a finite number greater than 0",
                "No scene-declared asset exists and the call did not provide an asset",
                "system 'spine' is not enabled",
            ],
            "api.animation.play(\"reel-1\", \"spin\", {loop = true, speed = 1.5})",
            vec!["animation.stop", "effect.spawn"],
        ),
        descriptor(
            "animation.stop",
            "presentation",
            "Clear an Entity's skeletal animation state.",
            "When the host should stop playback and remove the Entity's animation.",
            "It does not delete the Entity or restore the default animation declared by the scene.",
            vec![parameter("id", "string", "The target Entity id.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Entity animation state"],
            "The Entity's animation field is absent from the next observation.",
            vec!["The Entity does not exist", "system 'spine' is not enabled"],
            "api.animation.stop(\"reel-1\")",
            vec!["animation.play"],
        ),
        descriptor(
            "effect.spawn",
            "presentation",
            "Create an effect instance in world coordinates and return its handle.",
            "When a one-shot presentation such as a win, explosion, or hit is needed; the engine stores only a semantic event, while the host's Effekseer runtime simulates and renders it.",
            "Do not use it to carry game-rule results; effects do not affect world state, and the engine neither simulates particles nor determines whether an effect has finished.",
            vec![
                parameter("asset", "string", "The effect asset id."),
                parameter(
                    "options",
                    "table?",
                    "Optional x, y, scale, and rotation; defaults are the origin, scale 1, and rotation 0.",
                ),
            ],
            "string: the handle for this effect instance, usable with effect.stop.",
            vec!["Modify Rust-owned effect list"],
            "The handle is assigned by creation order within a run, so identical inputs produce the same handle.",
            vec![
                "asset is empty",
                "scale is not a finite number greater than 0",
                "position or rotation is not finite",
                "More than 256 effects are live at once",
                "system 'effekseer' is not enabled",
            ],
            "local handle = api.effect.spawn(\"effekseer://win\", {x = 0.0, y = 1.0})",
            vec!["effect.stop", "animation.play"],
        ),
        descriptor(
            "effect.stop",
            "presentation",
            "Remove an effect instance.",
            "When a looping effect must end early or presentation must be cleared during a scene change.",
            "The engine does not remove effects automatically; the game still decides when to stop a one-shot effect after playback.",
            vec![parameter(
                "handle",
                "string",
                "The handle returned by effect.spawn.",
            )],
            "boolean: whether an instance was actually removed.",
            vec!["Modify Rust-owned effect list"],
            "The effects in the next observation no longer include this handle.",
            vec!["system 'effekseer' is not enabled"],
            "api.effect.stop(handle)",
            vec!["effect.spawn"],
        ),
        descriptor(
            "audio.play",
            "presentation",
            "Fire a one-shot sound and return its handle.",
            "When something happened that should be heard once: a button press, a reel stopping, a win. The engine records the request as world state; the host decodes and mixes it.",
            "Do not use it for music or anything that should keep playing: a one-shot exists only for the frame it was fired, and the engine never learns when the clip finished. Use audio.loop for that.",
            vec![
                parameter("asset", "string", "The audio asset id."),
                parameter(
                    "options",
                    "table?",
                    "Optional volume (0-1), speed (>0), category, and x/y for a positional sound. Defaults are volume 1, speed 1, no category, not positional.",
                ),
            ],
            "string: the handle for this request, useful for matching it up in a trace.",
            vec!["Modify Rust-owned audio event list"],
            "The event appears in exactly one observation, the one for the frame it was fired, and is gone from the next. Handles are assigned by call order within a run, so identical inputs produce identical handles.",
            vec![
                "asset is empty",
                "volume is not between 0 and 1",
                "speed is not a finite number greater than 0",
                "position is not finite",
                "system 'audio' is not enabled",
            ],
            "api.audio.play(\"sfx://reel-stop\", {category = \"sfx\"})",
            vec!["audio.loop", "audio.stop"],
        ),
        descriptor(
            "audio.loop",
            "presentation",
            "Start a looping sound and return the handle that stops it.",
            "When a sound should keep playing until the game says otherwise: background music, an engine hum, an ambience bed. It stays in the observation, so a reload or a late-joining host knows what should be playing.",
            "Do not use it for one-shots; a loop that nothing stops plays forever, and the engine refuses more than 64 live loops rather than growing without bound.",
            vec![
                parameter("asset", "string", "The audio asset id."),
                parameter(
                    "options",
                    "table?",
                    "Same options as audio.play, plus entity to attach the loop to an entity: the engine then keeps the loop on that entity's position and stops it when the entity is gone. The category is what applies the project's exclusive and fade rules.",
                ),
            ],
            "string: the handle for this loop, required by audio.stop.",
            vec!["Modify Rust-owned audio loop list", "Stop other loops in an exclusive category"],
            "Starting a loop in an exclusive category begins stopping the ones already in it, honouring their fade_out_frames. A fade is counted in frames by the engine, so it ends on the same frame in every replay.",
            vec![
                "asset is empty",
                "volume is not between 0 and 1",
                "speed is not a finite number greater than 0",
                "More than 64 loops are live at once",
                "system 'audio' is not enabled",
            ],
            "local music = api.audio.loop(\"music://lobby\", {category = \"bgm\"})",
            vec!["audio.stop", "audio.stopAll", "audio.play"],
        ),
        descriptor(
            "audio.stop",
            "presentation",
            "Stop one looping sound.",
            "When a loop should end: leaving a screen, finishing a round, muting an ambience.",
            "It does not stop a one-shot; a one-shot is already over as far as the engine is concerned. It also does not mean the sound is immediately silent: with fade_out_frames the loop stays in the observation, marked fading_out, until the fade ends.",
            vec![parameter(
                "handle",
                "string",
                "The handle returned by audio.loop.",
            )],
            "boolean: whether a loop was actually playing under that handle.",
            vec!["Modify Rust-owned audio loop list"],
            "Without a fade the loop leaves the observation immediately. With one it stays for exactly fade_out_frames more frames, and a second stop on the same handle reports false.",
            vec!["system 'audio' is not enabled"],
            "api.audio.stop(music)",
            vec!["audio.loop", "audio.stopAll"],
        ),
        descriptor(
            "audio.stopAll",
            "presentation",
            "Stop every looping sound.",
            "At a hard boundary where nothing should carry over: a scene change, a restart, a return to the title screen.",
            "Do not use it to stop one track; that loses the ones the game meant to keep. Category fades still apply, so this is not an instant silence.",
            vec![],
            "number: how many loops were playing.",
            vec!["Modify Rust-owned audio loop list"],
            "Each stopped loop honours its own category fade, exactly as if audio.stop had been called on it.",
            vec!["system 'audio' is not enabled"],
            "api.audio.stopAll()",
            vec!["audio.stop", "audio.loop"],
        ),
        descriptor(
            "audio.pause",
            "presentation",
            "Pause one looping sound without losing it.",
            "A pause menu, a cutscene, a lost window focus: the loop should stop making noise but still be there, still where it was in its fade, ready to carry on.",
            "Do not use it to end a sound; a paused loop still counts against the 64 live loops and still needs a stop. It has no meaning for a one-shot, which is already over.",
            vec![parameter("handle", "string", "The handle returned by audio.loop.")],
            "boolean: whether the loop changed state (false if it was already paused or the handle is unknown).",
            vec!["Modify Rust-owned audio loop list"],
            "A paused loop does not advance through its fade: its phase deadline moves with it, so resuming continues from exactly where it stopped.",
            vec!["system 'audio' is not enabled"],
            "api.audio.pause(music)",
            vec!["audio.resume", "audio.pauseAll", "audio.stop"],
        ),
        descriptor(
            "audio.resume",
            "presentation",
            "Resume one paused loop.",
            "When the pause is over and playback should continue from where it stopped.",
            "It does not restart the loop from the beginning, and it does nothing to a loop that was stopped rather than paused.",
            vec![parameter("handle", "string", "The handle returned by audio.loop.")],
            "boolean: whether the loop changed state.",
            vec!["Modify Rust-owned audio loop list"],
            "Any fade continues from the frame it was paused on, not from now.",
            vec!["system 'audio' is not enabled"],
            "api.audio.resume(music)",
            vec!["audio.pause", "audio.resumeAll"],
        ),
        descriptor(
            "audio.pauseAll",
            "presentation",
            "Pause every looping sound.",
            "The pause menu. One call, and nothing has to remember which loops were playing.",
            "Do not use it as a scene change; stopped and paused are different, and everything paused here is still live.",
            vec![],
            "number: how many loops changed state.",
            vec!["Modify Rust-owned audio loop list"],
            "Every paused loop holds its place in its fade, so resuming restores the mix exactly.",
            vec!["system 'audio' is not enabled"],
            "api.audio.pauseAll()",
            vec!["audio.resumeAll", "audio.pause"],
        ),
        descriptor(
            "audio.resumeAll",
            "presentation",
            "Resume every paused loop.",
            "Leaving the pause menu.",
            "It does not start anything that was stopped, only what was paused.",
            vec![],
            "number: how many loops changed state.",
            vec!["Modify Rust-owned audio loop list"],
            "Each loop continues from the frame it was paused on.",
            vec!["system 'audio' is not enabled"],
            "api.audio.resumeAll()",
            vec!["audio.pauseAll"],
        ),
        descriptor(
            "audio.setMasterVolume",
            "presentation",
            "Set the master bus level.",
            "The overall volume slider on a settings screen.",
            "It is not a mute switch with a memory: setting 0 forgets the previous level, so a game that wants mute-and-restore remembers the old value itself.",
            vec![parameter("volume", "number", "0 to 1.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned audio mix"],
            "The mix is published in the observation as soon as it leaves its declared default, so a replay reproduces the same levels and a test can assert them. The host multiplies source volume by category level by master level.",
            vec!["volume is not between 0 and 1", "system 'audio' is not enabled"],
            "api.audio.setMasterVolume(0.8)",
            vec!["audio.getMasterVolume", "audio.setCategoryVolume"],
        ),
        descriptor(
            "audio.getMasterVolume",
            "presentation",
            "Read the master bus level.",
            "Drawing the settings screen the game just changed.",
            "It does not report what the player actually hears; the operating system and the player's own volume are not the engine's to know.",
            vec![],
            "number: the current master level.",
            vec![],
            "Reads the value the game last set, or 1.0.",
            vec!["system 'audio' is not enabled"],
            "local level = api.audio.getMasterVolume()",
            vec!["audio.setMasterVolume"],
        ),
        descriptor(
            "audio.setCategoryVolume",
            "presentation",
            "Set one category's bus level.",
            "The separate music and effects sliders every settings screen has. The category is the game's own name for a group of sounds; the level applies to every sound in it.",
            "It does not change the volume a sound was started with; that is the source's own level and the two multiply, the same way a mixer group works.",
            vec![
                parameter("category", "string", "The category name."),
                parameter("volume", "number", "0 to 1."),
            ],
            "(): no additional data on success.",
            vec!["Modify Rust-owned audio mix"],
            "Takes effect on the next observation and is published with it. A category the project never declared may still be set; it starts at 1.0.",
            vec![
                "category is empty",
                "volume is not between 0 and 1",
                "system 'audio' is not enabled",
            ],
            "api.audio.setCategoryVolume(\"bgm\", 0.4)",
            vec!["audio.getCategoryVolume", "audio.setMasterVolume"],
        ),
        descriptor(
            "audio.getCategoryVolume",
            "presentation",
            "Read one category's bus level.",
            "Drawing a settings slider at the position the game left it.",
            "It does not tell you whether anything in that category is playing.",
            vec![parameter("category", "string", "The category name.")],
            "number: the current level, or the project's declared default, or 1.0.",
            vec![],
            "Reads the value the game last set for that category.",
            vec!["system 'audio' is not enabled"],
            "local level = api.audio.getCategoryVolume(\"bgm\")",
            vec!["audio.setCategoryVolume"],
        ),
        descriptor(
            "input.isDown",
            "input",
            "Query whether an action is down in the current frame.",
            "When player or test input needs to drive game rules.",
            "Do not read platform keyboard key codes in game logic; platform input should first be mapped to an action.",
            vec![parameter(
                "action",
                "string",
                "A game-defined semantic action, such as Right.",
            )],
            "boolean: whether the action is down now.",
            vec!["Read the current frame's input snapshot"],
            "The result is stable during the same update; a headless test can inject fixed input using the same action name.",
            vec!["An unknown action name is treated as false"],
            "if api.input.isDown(\"Right\") then ... end",
            vec!["entity.setPosition"],
        ),
        descriptor(
            "input.getPointerPosition",
            "input",
            "Read the pointer position converted to world space by the platform adapter.",
            "When game rules need a drag, aim, click, or touch position.",
            "Do not process screen pixels, device scale, or platform coordinates in Luau; that is the platform adapter's responsibility.",
            vec![],
            "Vec2: the pointer's current world position.",
            vec!["Read the current frame's pointer snapshot"],
            "The result is stable during the same update; a headless test can inject a world-space pointer directly.",
            vec![],
            "local pointer = api.input.getPointerPosition()",
            vec!["input.isPointerDown", "camera.getPosition"],
        ),
        descriptor(
            "input.getScreenPointerPosition",
            "input",
            "Read the pointer position converted by the platform adapter into normalized 0..100 × 0..100 logical UI space.",
            "When the game must hit-test a declarative UI button or map a touch position into its own UI design space.",
            "Do not process screen pixels, device scale, DPI, or safe area in Luau; the host should normalize them into 0..100 cross-platform logical UI coordinates first.",
            vec![],
            "Vec2: the pointer's current normalized 0..100 logical screen/UI position.",
            vec!["Read the current frame's screen-space pointer snapshot"],
            "The result is stable during the same update; a headless test can inject screen_position directly, and world position is the explicit fallback when it is absent.",
            vec![],
            "local pointer = api.input.getScreenPointerPosition()",
            vec!["input.isPointerDown", "input.getPointerPosition"],
        ),
        descriptor(
            "input.isPointerDown",
            "input",
            "Query whether the primary pointer/touch is down in the current frame.",
            "When game rules need to detect the start of a drag, continued aiming, or release timing.",
            "Do not treat it as a platform-specific mouse button or touch id; the platform adapter first aggregates multi-touch input into an explicit game action.",
            vec![],
            "boolean: whether the primary pointer is down.",
            vec!["Read the current frame's pointer snapshot"],
            "The result is stable during the same update; if a sequence provides no pointer frame, treat it as released to avoid sticky input.",
            vec![],
            "if api.input.isPointerDown() then ... end",
            vec!["input.getPointerPosition", "input.isDown"],
        ),
        descriptor(
            "random.nextFloat",
            "random",
            "Get a deterministic [0, 1) floating-point value determined by the project run seed.",
            "When sampling, making probability checks, or using replayable game randomness.",
            "Do not use it for true secure randomness, and do not treat the result as fixed across different seeds.",
            vec![],
            "number: greater than or equal to 0 and less than 1.",
            vec!["Consume seeded runtime random state"],
            "The same runtime, seed, and call order produce the same result; changing the call order changes the subsequent sequence.",
            vec![],
            "local chance = api.random.nextFloat()",
            vec!["random.nextInt"],
        ),
        descriptor(
            "random.nextInt",
            "random",
            "Get a deterministic inclusive integer determined by the project run seed.",
            "When sampling an index, generating a die result, or using replayable integer randomness.",
            "Do not use it for security, money movement, or passwords; min must not exceed max.",
            vec![
                parameter("min", "integer", "The smallest returned value, inclusive."),
                parameter("max", "integer", "The largest returned value, inclusive."),
            ],
            "integer: between min and max, inclusive.",
            vec!["Consume seeded runtime random state"],
            "The result is returned immediately in the current update; the same seed, input, and call order are replayable.",
            vec!["min greater than max returns LUAU_RUNTIME_ERROR"],
            "local slot = api.random.nextInt(1, 3)",
            vec!["random.nextFloat"],
        ),
        descriptor(
            "observation.set",
            "observation",
            "Publish the game's current serializable semantic state for observation by AI, tests, and the host.",
            "When dialogue ViewModels, combat results, random results, or other game state must be readable by headless, Web, or mobile hosts.",
            "Do not treat it as a second copy of gameplay state, and do not publish large unchanged assets or telemetry every frame.",
            vec![
                parameter(
                    "key",
                    "string",
                    "A non-empty stable observation name, such as view_model.",
                ),
                parameter(
                    "value",
                    "ObservationValue",
                    "A serializable string, number, boolean, null, object, or array.",
                ),
            ],
            "(): no additional data on success.",
            vec!["Replace the latest game observation for the specified key"],
            "The value updates immediately within the same update; the next observe, run report, and test assertion see the latest value. Only the last publication for each key is retained.",
            vec![
                "An empty key returns LUAU_RUNTIME_ERROR",
                "A value containing a function, userdata, cyclic table, non-finite number, or non-contiguous array key returns LUAU_RUNTIME_ERROR",
            ],
            "api.observation.set(\"view_model\", { screen = \"dialogue\", node = \"intro\" })",
            vec!["log", "input.isDown"],
        ),
        descriptor(
            "ui.setRoot",
            "ui",
            "Publish the minimal declarative UI tree composed by the game for observation by the host renderer, AI, and tests. Both design-space axes are 0..100 and **y points up**: y=0 is the bottom of the screen, y=100 is the top, and rects grow upward from y.",
            "When a Web or native host must display a text/button screen composed from the game's ViewModel.",
            "Do not treat it as a complete UI framework; it contains no layout engine, binding registry, platform widgets, input routing, or game rules. The ViewModel, content, action meaning, and flow remain game-owned.",
            vec![parameter(
                "root",
                "UiTree",
                "A screen root with flat text/button children, 0..100 normalized logical rects, and button actions.",
            )],
            "(): no additional data on success.",
            vec!["Replace the game-owned UI tree for the current frame"],
            "The latest tree is immediately visible in observe, the run report, test assertions, and Web/native host snapshots; the engine validates only schema, coordinates, and count limits.",
            vec![
                "root kind must be screen",
                "child kind currently supports only text and button",
                "node ids must be unique, and rects must contain finite values greater than 0 within the 0..100 design space",
            ],
            "api.ui.setRoot({ kind = \"screen\", id = \"dialogue\", node = \"intro\", children = {} })",
            vec!["observation.set", "input.getScreenPointerPosition"],
        ),
        descriptor(
            "save.set",
            "save",
            "Publish the game's current serializable save payload for the host to persist.",
            "When the game schema must be saved at an explicit checkpoint.",
            "Do not write every frame, and do not use an observation or platform file path as a save API.",
            vec![parameter(
                "value",
                "SaveValue",
                "A game-defined serializable save payload; the engine does not interpret its schema.",
            )],
            "(): no additional data on success.",
            vec!["Replace the save payload currently pending host persistence"],
            "After the call, the host can read the latest payload through the runtime/platform adapter; the payload survives a script reload.",
            vec![
                "A value containing a function, userdata, cyclic table, non-finite number, or non-contiguous array key returns LUAU_RUNTIME_ERROR",
            ],
            "api.save.set({ version = 1, node = \"kind\" })",
            vec!["save.get"],
        ),
        descriptor(
            "save.get",
            "save",
            "Read the save payload injected by the host or most recently saved by the game.",
            "When the game schema must be restored after game startup.",
            "Do not treat the save payload as per-frame gameplay state; after loading, the game decides its version and migration.",
            vec![],
            "SaveValue or nil: returns nil when no payload is present.",
            vec!["Read the current save payload"],
            "Readable immediately within the same runtime; the host can inject a JSON payload before the first tick. The engine does not perform schema migration for the game.",
            vec!["The adapter reports a diagnostic when the host payload is not valid JSON"],
            "local payload = api.save.get()",
            vec!["save.set"],
        ),
        descriptor(
            "log",
            "diagnostics",
            "Write a semantic script trace for observation by AI, tests, and development records.",
            "When important game events must be recorded or a script branch must be verified.",
            "Do not emit large amounts of output every frame; high-frequency data belongs in observation state.",
            vec![parameter(
                "message",
                "string",
                "An event description understandable to people and AI.",
            )],
            "(): no additional data on success.",
            vec!["Add one script_log trace event"],
            "The event uses the world frame at call time; the run report retains only the semantic trace and does not create per-frame noise.",
            vec!["Excessive logging increases observation output size"],
            "api.log(\"player_started\")",
            vec!["entity.getPosition", "input.isDown"],
        ),
        descriptor(
            "camera3d.getTransform",
            "camera",
            "Read the Camera3D position, target, and field of view declared by the scene.",
            "When game-owned camera-follow logic needs the current 3D camera position or target.",
            "For a 2D scene without a Camera3D; do not treat the camera transform as vehicle or Entity gameplay state.",
            vec![],
            "Camera3DTransform: position, target, and fovDegrees.",
            vec!["Read Rust-owned camera state"],
            "Returns the Camera3D for the current update; the host renderer uses it on the next draw.",
            vec!["The current scene has no Camera3D"],
            "local camera = api.camera3d.getTransform()",
            vec!["camera3d.setPosition", "camera3d.setTarget"],
        ),
        descriptor(
            "camera3d.setPosition",
            "camera",
            "Update the Camera3D world position.",
            "When the game must implement a car-follow, replay, or scene-camera strategy.",
            "Do not hard-code racing-game or other game-specific camera-follow rules in the engine.",
            vec![parameter(
                "position",
                "Vec3",
                "The new Camera3D world position.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Camera3D state"],
            "The update takes effect immediately during the current script update; the renderer uses it on the next draw.",
            vec!["The current scene has no Camera3D", "x/y/z must be finite numbers"],
            "api.camera3d.setPosition({ x = 0, y = 3, z = 8 })",
            vec!["camera3d.getTransform", "camera3d.setTarget"],
        ),
        descriptor(
            "camera3d.setTarget",
            "camera",
            "Update the world target watched by the Camera3D.",
            "When the game must control a 3D camera aimed at a vehicle, track, or other gameplay target.",
            "Do not add game-specific tracking, smoothing, or camera-shake strategies to the engine.",
            vec![parameter("target", "Vec3", "The new Camera3D world target.")],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Camera3D state"],
            "The update takes effect immediately during the current script update; the renderer uses it on the next draw.",
            vec!["The current scene has no Camera3D", "x/y/z must be finite numbers"],
            "api.camera3d.setTarget({ x = 0, y = 0, z = 0 })",
            vec!["camera3d.getTransform", "camera3d.setPosition"],
        ),
    ]
}

fn parameter(name: &str, type_name: &str, meaning: &str) -> ApiParameter {
    ApiParameter {
        name: name.to_string(),
        type_name: type_name.to_string(),
        meaning: meaning.to_string(),
    }
}

#[allow(clippy::too_many_arguments)]
fn descriptor(
    name: &str,
    category: &str,
    purpose: &str,
    when_to_use: &str,
    when_not_to_use: &str,
    parameters: Vec<ApiParameter>,
    returns: &str,
    side_effects: Vec<&str>,
    frame_semantics: &str,
    common_errors: Vec<&str>,
    example: &str,
    related_apis: Vec<&str>,
) -> ApiDescriptor {
    ApiDescriptor {
        name: name.to_string(),
        category: category.to_string(),
        purpose: purpose.to_string(),
        when_to_use: when_to_use.to_string(),
        when_not_to_use: when_not_to_use.to_string(),
        parameters,
        returns: returns.to_string(),
        side_effects: side_effects.into_iter().map(str::to_string).collect(),
        frame_semantics: frame_semantics.to_string(),
        common_errors: common_errors.into_iter().map(str::to_string).collect(),
        example: example.to_string(),
        related_apis: related_apis.into_iter().map(str::to_string).collect(),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{api_search_result, descriptors, search, typings};

    #[test]
    fn empty_query_is_the_complete_index_without_empty_warning() {
        let result = api_search_result(Path::new("missing-project"), "");
        let report = result.value.expect("search should return a report");

        assert!(result.ok);
        assert!(result.diagnostics.is_empty());
        assert_eq!(report.query, "");
        assert_eq!(report.matches.len(), search("").len());
        assert!(!report.matches.is_empty());
        assert!(report.suggested_next_actions.is_empty());
    }

    #[test]
    fn no_match_keeps_success_and_has_fixed_discovery_guidance() {
        let result = api_search_result(Path::new("missing-project"), "攻擊");
        let report = result
            .value
            .as_ref()
            .expect("search should return a report");
        let diagnostic = result
            .diagnostics
            .first()
            .expect("no-match search should explain the next step");

        assert!(result.ok);
        assert_eq!(report.query, "攻擊");
        assert!(report.matches.is_empty());
        assert_eq!(diagnostic.code, "API_SEARCH_EMPTY");
        assert!(matches!(
            diagnostic.severity,
            crate::diagnostics::DiagnosticSeverity::Warning
        ));
        assert_eq!(
            diagnostic.facts,
            serde_json::json!({
                "search_scope": "public_engine_api",
                "query": "攻擊",
                "match_count": 0,
            })
        );
        assert!(diagnostic.explanation.contains("game-owned composition"));
        assert_eq!(diagnostic.suggested_actions.len(), 2);
        assert_eq!(
            diagnostic
                .suggested_actions
                .iter()
                .map(|action| action.action.as_str())
                .collect::<Vec<_>>(),
            vec!["search_api_index", "list_systems"]
        );
        assert!(
            diagnostic
                .suggested_actions
                .iter()
                .all(|action| action.command.is_none())
        );

        assert_eq!(report.suggested_next_actions.len(), 2);
        let full_index = &report.suggested_next_actions[0];
        assert_eq!(full_index.action, "search_api_index");
        assert!(full_index.ready);
        assert_eq!(full_index.executable.as_deref(), Some("game"));
        assert_eq!(
            full_index.argv.as_ref().expect("full index should have argv"),
            &vec![
                "api".to_string(),
                "search".to_string(),
                String::new(),
                "--json".to_string(),
            ]
        );

        let systems = &report.suggested_next_actions[1];
        assert_eq!(systems.action, "list_systems");
        assert!(!systems.ready);
        assert!(systems.executable.is_none());
        assert!(systems.argv.is_none());
        assert!(!systems.reason.is_empty());
        assert!(systems.diagnostic.is_some());
    }

    #[test]
    fn matching_query_keeps_existing_search_results_without_diagnostic() {
        let result = api_search_result(Path::new("missing-project"), "position");

        assert!(result.ok);
        assert!(
            !result
                .value
                .as_ref()
                .expect("search should return a report")
                .matches
                .is_empty()
        );
        assert!(result.diagnostics.is_empty());
        assert!(
            result
                .value
                .as_ref()
                .expect("search should return a report")
                .suggested_next_actions
                .is_empty()
        );
    }

    /// Every documented API must have a Luau type, or `check --types` silently
    /// stops covering it.
    #[test]
    fn the_type_contract_covers_every_documented_api() {
        let types = typings();
        let mut missing = Vec::new();
        for descriptor in descriptors() {
            let member = descriptor
                .name
                .rsplit_once('.')
                .map(|(_, member)| member.to_string())
                .unwrap_or_else(|| descriptor.name.clone());
            if !types.contains(&format!("{member}:")) {
                missing.push(descriptor.name);
            }
        }
        assert!(missing.is_empty(), "APIs with no Luau type: {missing:?}");
    }
}
