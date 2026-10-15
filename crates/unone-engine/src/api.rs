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
    if let Some(exact) = descriptors()
        .into_iter()
        .find(|api| api.name.eq_ignore_ascii_case(&normalized))
    {
        return vec![exact];
    }
    // Intent aliases are scoped to a capability family: searching for "fire"
    // should discover particle authoring, not every API containing "Fire a ...".
    // All meaningful terms must match so natural-language filler does not turn
    // a multi-word request into an unrelated OR search.
    let words: Vec<&str> = normalized
        .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '.'))
        .filter(|word| !word.is_empty())
        .collect();
    if words.is_empty() {
        return Vec::new();
    }
    let terms: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| !is_search_filler(word))
        .collect();
    let terms = if terms.is_empty() { &words } else { &terms };
    let mut ranked: Vec<_> = descriptors()
        .into_iter()
        .filter_map(|descriptor| {
            if descriptor.name.eq_ignore_ascii_case(&normalized) {
                return Some((1000, descriptor));
            }
            let score = terms.iter().try_fold(0, |total, term| {
                search_term_score(&descriptor, term).map(|score| total + score)
            })?;
            Some((score, descriptor))
        })
        .collect();
    ranked.sort_by(|(a, _), (b, _)| b.cmp(a));
    ranked
        .into_iter()
        .map(|(_, descriptor)| descriptor)
        .collect()
}

fn is_search_filler(word: &str) -> bool {
    matches!(
        word,
        "a" | "an"
            | "and"
            | "api"
            | "can"
            | "change"
            | "adjust"
            | "do"
            | "for"
            | "how"
            | "i"
            | "in"
            | "is"
            | "make"
            | "my"
            | "need"
            | "of"
            | "the"
            | "please"
            | "set"
            | "to"
            | "use"
            | "using"
            | "want"
            | "with"
    )
}

fn search_term_score(descriptor: &ApiDescriptor, term: &str) -> Option<u32> {
    let ui_style_intent = matches!(
        term,
        "font"
            | "fonts"
            | "typography"
            | "typeface"
            | "font_family"
            | "font_size"
            | "font_weight"
            | "line_height"
            | "letter_spacing"
            | "text_align"
            | "vertical_align"
            | "border_color"
            | "border_width"
            | "border_radius"
            | "text"
            | "label"
            | "labels"
            | "layout"
            | "style"
            | "styles"
            | "styling"
            | "alignment"
            | "align"
            | "wrap"
            | "wrapping"
            | "color"
            | "colour"
            | "background"
            | "border"
            | "borders"
            | "padding"
            | "spacing"
            | "ellipsis"
            | "overflow"
            | "opacity"
            | "rounded"
            | "radius"
            | "weight"
            | "size"
            | "line"
            | "height"
            | "component"
            | "components"
            | "reusable"
            | "shared"
            | "skinning"
            | "control"
            | "controls"
            | "widget"
            | "widgets"
            | "字體"
            | "字体"
            | "字級"
            | "字号"
            | "排版"
            | "樣式"
            | "样式"
            | "文字"
            | "文字換行"
            | "文字换行"
            | "換行"
            | "换行"
            | "對齊"
            | "对齐"
            | "顏色"
            | "颜色"
            | "邊框"
            | "边框"
            | "內距"
            | "内距"
            | "行距"
            | "字距"
            | "共用元件"
            | "元件"
            | "組件"
            | "组件"
            | "共用组件"
            | "共用"
            | "共享"
            | "共用ui元件"
            | "共用ui組件"
            | "共用ui组件"
            | "共享ui元件"
            | "共享ui組件"
            | "共享ui组件"
            | "ui元件"
            | "ui組件"
            | "ui组件"
    ) || [
        "字體",
        "字体",
        "字級",
        "字号",
        "排版",
        "樣式",
        "样式",
        "文字換行",
        "文字换行",
        "對齊",
        "对齐",
        "邊框",
        "边框",
        "內距",
        "内距",
        "共用元件",
        "共用组件",
    ]
    .iter()
    .any(|alias| term.contains(alias));
    if ui_style_intent {
        let ui_score = match descriptor.name.as_str() {
            "ui.setRoot" => Some(200),
            "ui.inspect" => Some(100),
            "ui.getViewport" if term == "layout" || term == "排版" => Some(80),
            _ => None,
        };
        if ui_score.is_some() {
            return ui_score;
        }
        // Shared visual terms may also describe world APIs. Keep those normal
        // matches available: e.g. "entity size" must not become UI-only.
        if !matches!(
            term,
            "color"
                | "colour"
                | "background"
                | "opacity"
                | "radius"
                | "weight"
                | "size"
                | "line"
                | "height"
        ) {
            return None;
        }
    }
    if matches!(
        term,
        "responsive"
            | "viewport"
            | "aspect"
            | "portrait"
            | "landscape"
            | "螢幕比例"
            | "直向"
            | "橫向"
    ) {
        return match descriptor.name.as_str() {
            "ui.getViewport" => Some(200),
            "ui.setRoot" => Some(100),
            _ => None,
        };
    }
    let visual_intent = matches!(
        term,
        "vfx"
            | "effect"
            | "effects"
            | "particle"
            | "particles"
            | "explosion"
            | "explosions"
            | "thruster"
            | "thrusters"
            | "exhaust"
            | "fire"
            | "flame"
            | "flames"
            | "spark"
            | "sparks"
            | "smoke"
            | "trail"
            | "trails"
            | "aura"
            | "auras"
            | "粒子"
            | "特效"
            | "粒子特效"
            | "爆炸"
            | "尾焰"
            | "火焰"
            | "火花"
            | "煙霧"
            | "烟雾"
            | "軌跡"
            | "轨迹"
            | "光環"
            | "光环"
    );
    if visual_intent {
        return if descriptor.name.starts_with("particle.") {
            // Play is the entry point with authoring and preview guidance.
            Some(if descriptor.name == "particle.play" {
                200
            } else {
                150
            })
        } else if descriptor.name.starts_with("effect.") {
            Some(100)
        } else if descriptor.name.starts_with("shader.")
            && matches!(term, "vfx" | "effect" | "effects")
        {
            Some(50)
        } else {
            None
        };
    }
    if term == "effekseer" {
        return descriptor.name.starts_with("effect.").then_some(200);
    }
    [
        (&descriptor.name, 80),
        (&descriptor.category, 60),
        (&descriptor.purpose, 40),
        (&descriptor.when_to_use, 20),
    ]
    .into_iter()
    .find_map(|(text, score)| text.to_ascii_lowercase().contains(term).then_some(score))
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
        reason:
            "Query the complete public Engine API index; this query does not need project context."
                .to_string(),
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
    let mut result = vec![
        descriptor(
            "instances3d.set",
            "presentation",
            "Replace a packed batch of 3D mesh instances.",
            "Render large populations sharing a mesh; gameplay remains in Lua.",
            "Not entities or rigid bodies; no per-instance callbacks or skeletal animation.",
            vec![
                parameter("id", "string", "Stable batch ID, 1..128 bytes"),
                parameter("asset", "string", "Mesh asset ID"),
                parameter(
                    "transforms",
                    "buffer",
                    "40-byte little-endian f32 records: position.xyz, normalized quaternion.xyzw, nonnegative scale.xyz",
                ),
            ],
            "nil",
            vec!["Replace presentation batch atomically"],
            "Copies the buffer once. Identical bytes keep the previous revision. Pose bytes stay in host packed storage and are excluded from observation digests. JSON/Web memory transports attach them only for presentation.",
            vec![
                "Invalid buffer or transform fails",
                "Maximum 262144 instances and 256 batches per world",
            ],
            "api.instances3d.set(\"crowd\", \"mesh://soldier\", transforms)",
            vec!["instances3d.remove"],
        ),
        descriptor(
            "instances3d.remove",
            "presentation",
            "Remove a 3D instance batch.",
            "Release a game-owned presentation batch.",
            "Does not despawn entities.",
            vec![parameter("id", "string", "Existing batch ID")],
            "nil",
            vec!["Remove presentation batch"],
            "Immediate; missing IDs fail.",
            vec!["Unknown ID fails"],
            "api.instances3d.remove(\"crowd\")",
            vec!["instances3d.set"],
        ),
        descriptor(
            "debug.registerTab",
            "debug",
            "Register a development-only tab with stable ID and label.",
            "Expose game-owned test actions to AI and the human development player.",
            "Never use developer tools for required production gameplay. Guard registration with api.debug.enabled.",
            vec![parameter(
                "tab",
                "DebugTab",
                "Exactly {id,label}; see generated debug-tab schema",
            )],
            "nil",
            vec!["Update development-only metadata; callbacks run only when explicitly invoked"],
            "Registration does not advance simulation. Callback invocation is between ticks and is not a Lua-heap transaction.",
            vec![
                "DEVELOPMENT_ONLY",
                "duplicate/unknown ID",
                "invalid callback/value",
            ],
            "if api.debug.enabled then api.debug.registerTab({id=\"qa\",label=\"QA\"}) end",
            vec!["debug.registerTab", "debug.register", "debug.set"],
        ),
        descriptor(
            "debug.register",
            "debug",
            "Register a button/label/checkbox; Lua callback owns the actual game behavior.",
            "Expose game-owned test actions to AI and the human development player.",
            "Never use developer tools for required production gameplay. Guard registration with api.debug.enabled.",
            vec![
                parameter(
                    "control",
                    "DebugControl",
                    "Tagged button/label/checkbox definition; see debug-control schema",
                ),
                parameter(
                    "callback",
                    "function?",
                    "Required for button/checkbox, forbidden for label",
                ),
            ],
            "nil",
            vec!["Update development-only metadata; callbacks run only when explicitly invoked"],
            "Registration does not advance simulation. Callback invocation is between ticks and is not a Lua-heap transaction.",
            vec![
                "DEVELOPMENT_ONLY",
                "duplicate/unknown ID",
                "invalid callback/value",
            ],
            "api.debug.register({id=\"qa.fire\",tab=\"qa\",kind=\"button\",label=\"Fire\"},function() pendingShot=true end)",
            vec!["debug.registerTab", "debug.register", "debug.set"],
        ),
        descriptor(
            "debug.set",
            "debug",
            "Update a registered label string or checkbox boolean without invoking its callback.",
            "Expose game-owned test actions to AI and the human development player.",
            "Never use developer tools for required production gameplay. Guard registration with api.debug.enabled.",
            vec![
                parameter("id", "string", "Registered label or checkbox ID"),
                parameter(
                    "value",
                    "string | boolean",
                    "Label text or checkbox state; does not invoke callback",
                ),
            ],
            "nil",
            vec!["Update development-only metadata; callbacks run only when explicitly invoked"],
            "Registration does not advance simulation. Callback invocation is between ticks and is not a Lua-heap transaction.",
            vec![
                "DEVELOPMENT_ONLY",
                "duplicate/unknown ID",
                "invalid callback/value",
            ],
            "api.debug.set(\"qa.status\",\"Ready\")",
            vec!["debug.registerTab", "debug.register", "debug.set"],
        ),
        descriptor(
            "physics3d.sweepSphere",
            "physics3d",
            "Query the earliest continuous sphere contact along a 3D segment against moving sphere targets.",
            "For fast objects that must not tunnel through colliders between frames.",
            "Velocity, integration, gravity, damage, lifetime and collision response belong to Luau; this query does not move entities.",
            vec![parameter(
                "request",
                "table",
                "Exactly {from:Vec3,to:Vec3,radius:number,targets:{id:string,radius:number,previous_position:Vec3}[]}; target current centers come from their Transform3D. At most 1024 unique targets.",
            )],
            "nil or {id:string,fraction:number,point:Vec3,normal:Vec3}; fraction in [0,1]; lexical id breaks equal-time ties.",
            vec!["Read 3D transforms; no mutation"],
            "Sweeps relative linear motion over the supplied endpoints; initial overlap returns fraction zero. Radii are explicit world units, not inferred from meshes.",
            vec![
                "Invalid or unknown request fields",
                "Target missing Transform3D",
                "Disabled physics3d system",
            ],
            "local hit=api.physics3d.sweepSphere({from=p,to=q,radius=0.1,targets={{id=\"target\",radius=0.5,previous_position=old}}})",
            vec!["entity.getTransform3D", "entity.setTransform3D"],
        ),
        descriptor(
            "shader.setMaterial",
            "shader",
            "Assign a declared custom fragment material to a 2D sprite through the official renderer.",
            "For shader effects, shields, hit flashes, glow, distortion, and custom sprite shading without accessing WebGL. Declare scene.shader_materials first; see docs/shader-materials.md and game schema shader.",
            "WebGL sprite materials only; native and WebGPU must report SHADER_BACKEND_UNSUPPORTED. Use particle APIs for trails, sparks and explosions. Custom shader source is trusted author content, not a security sandbox.",
            vec![
                parameter("entityId", "string", "Entity with a 2D sprite."),
                parameter("materialId", "string", "Key in scene.shader_materials."),
            ],
            "nil",
            vec!["Update the entity material selection"],
            "Selection is deterministic snapshot state; the engine renderer owns GPU compilation and resource lifetime.",
            vec![
                "SHADER_MATERIAL_UNKNOWN",
                "SHADER_TARGET_UNSUPPORTED",
                "SHADER_COMPILE_FAILED (host)",
            ],
            "api.shader.setMaterial(\"ship\", \"shield\")",
            vec!["shader.setUniform", "shader.clearMaterial", "particle.play"],
        ),
        descriptor(
            "shader.setUniform",
            "shader",
            "Update a declared float or vector uniform on a shared shader material.",
            "For game-controlled shader parameters; see docs/shader-materials.md. The material definition declares uniform names, types and initial values.",
            "Does not create resources, change shader source, expose a GPU context or alter gameplay collision. A shared material uniform affects all assigned sprites.",
            vec![
                parameter("materialId", "string", "Declared shader material ID."),
                parameter(
                    "name",
                    "string",
                    "Declared uniform name; unone_ and gl_ prefixes are reserved.",
                ),
                parameter(
                    "value",
                    "number | {number}",
                    "Finite f32-compatible scalar or array of 2, 3 or 4 numbers, retaining its declared width.",
                ),
            ],
            "nil",
            vec!["Update shader material uniform state"],
            "Updates are fixed-tick snapshot state. Built-in unone_time and unone_frame derive from simulation time, not wall time.",
            vec![
                "SHADER_MATERIAL_UNKNOWN",
                "SHADER_UNIFORM_UNKNOWN",
                "SHADER_UNIFORM_INVALID",
                "SHADER_UNIFORM_TYPE",
            ],
            "api.shader.setUniform(\"shield\", \"strength\", 0.75)",
            vec!["shader.setMaterial", "shader.clearMaterial"],
        ),
        descriptor(
            "shader.clearMaterial",
            "shader",
            "Restore a sprite's standard engine material.",
            "When a temporary custom sprite shader should end.",
            "Does not remove the material definition or change its shared uniforms.",
            vec![parameter("entityId", "string", "Entity ID.")],
            "nil",
            vec!["Clear the entity material selection"],
            "The official renderer releases unused custom material resources on its next draw.",
            vec!["ENTITY_UNKNOWN"],
            "api.shader.clearMaterial(\"ship\")",
            vec!["shader.setMaterial"],
        ),
        descriptor(
            "particle.play",
            "particle",
            "Play a seeded native declarative JSON particle definition in the official player.",
            "Default for explosions, thrusters, fire, sparks, smoke, trails and auras. Author scene particle_effects; see docs/native-particles.md and docs/particle.schema.json. Preview exact frames and presets in /web/particle-lab/ (Particle Lab).",
            "Use effect.spawn only for external Effekseer assets; do not replace the renderer to implement ordinary particle effects.",
            vec![
                parameter("effect", "string", "Scene particle_effects key."),
                parameter("position", "Vec3", "World-space emission origin."),
                parameter("seed", "number?", "Seed; defaults to zero."),
            ],
            "string: stoppable instance handle.",
            vec!["Create a runtime particle instance"],
            "Births and motion use fixed 60 Hz frame age; active instances retain their definition after an authoring replacement.",
            vec![
                "Unknown effect",
                "Disabled particle system",
                "Particle capacity exceeded",
            ],
            "local handle = api.particle.play(\"spark\", {x=0,y=0,z=0}, 42)",
            vec![
                "particle.move",
                "particle.finish",
                "particle.play_batch",
                "particle.stats",
                "particle.stop",
                "effect.spawn",
            ],
        ),
        descriptor(
            "particle.move",
            "particle",
            "Move an emitter origin while preserving already-emitted particles in world space.",
            "For flame trails, following a moving troop, or drifting aura emitters.",
            "Does not move existing particles; use particle.stop to cancel immediately.",
            vec![
                parameter("handle", "string", "Handle from particle.play."),
                parameter("position", "Vec3", "New world-space emission origin."),
            ],
            "boolean: false when the handle is unknown or belongs to a static batch.",
            vec!["Record one deterministic emission-origin sample"],
            "Samples are keyed to the current fixed simulation frame. Multiple moves in one frame replace that frame's sample.",
            vec!["Invalid or non-finite position", "Disabled particle system"],
            "api.particle.move(handle, troopPosition)",
            vec!["particle.play", "particle.finish"],
        ),
        descriptor(
            "particle.finish",
            "particle",
            "Stop future births and let existing particles finish their authored lifetime.",
            "For the end of a cast/channel or a trail that should taper out.",
            "Use particle.stop for immediate cancellation.",
            vec![parameter("handle", "string", "Handle from particle.play.")],
            "boolean: whether the handle existed.",
            vec!["Truncate the emitter schedule"],
            "Emission ends on the current frame. Existing particles continue analytically until their individual lifetimes expire.",
            vec!["Disabled particle system"],
            "api.particle.finish(handle)",
            vec!["particle.play", "particle.stop"],
        ),
        descriptor(
            "particle.play_batch",
            "particle",
            "Emit one effect at packed positions using one handle.",
            "For projectile trails and many small bursts.",
            "Gameplay selects positions and visual budgets.",
            vec![
                parameter("effect", "string", "Scene particle_effects key."),
                parameter(
                    "positions",
                    "buffer",
                    "Packed f32le xyz positions; 12 bytes each, 1..4096 records; copied.",
                ),
                parameter(
                    "seed",
                    "number?",
                    "Each position uses seed plus its zero-based index, wrapping u64.",
                ),
            ],
            "string: handle stopping every origin in the batch.",
            vec!["Create a bounded particle batch"],
            "Same fixed-frame lifetime as particle.play. Total 4096-particle reservation and 64-handle limits apply. Invalid calls leave the world unchanged.",
            vec![
                "Unknown effect",
                "Invalid positions",
                "Particle capacity exceeded",
            ],
            "local h = api.particle.play_batch(\"trail\", positions, 42)",
            vec!["particle.stats", "particle.stop"],
        ),
        descriptor(
            "particle.stats",
            "particle",
            "Read particle handle and sample budgets.",
            "For AI diagnostics and game-owned effect budgeting.",
            "Does not reserve capacity or change simulation.",
            vec![],
            "table: active_handles, max_handles, reserved_particles, max_particles, live_particles.",
            vec![],
            "Counts include active batches; live count samples the current frame.",
            vec!["Disabled particle system"],
            "local usage = api.particle.stats()",
            vec!["particle.play_batch"],
        ),
        descriptor(
            "particle.stop",
            "particle",
            "Stop a native particle instance.",
            "To cancel a running effect.",
            "Not for Effekseer handles.",
            vec![parameter("handle", "string", "Handle from particle.play.")],
            "boolean: whether the instance existed.",
            vec!["Remove the runtime instance"],
            "Immediate; a second stop returns false.",
            vec!["Disabled particle system"],
            "api.particle.stop(handle)",
            vec!["particle.play"],
        ),
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
            vec![
                "An empty name uses entity",
                "A duplicate name receives a suffix such as _2 or _3",
            ],
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
            vec!["A missing Entity id returns LUAU_RUNTIME_ERROR"],
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
            vec![parameter(
                "id",
                "string",
                "An Entity id with a RigidBody2D.",
            )],
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
            vec![parameter(
                "id",
                "string",
                "An Entity id with a Transform3D.",
            )],
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
            "camera.getProjection",
            "camera",
            "Read the single active Camera projection mode.",
            "When camera logic needs to know whether the host is framing an orthographic or perspective view.",
            "Do not create separate 2D and 3D camera state in game code; use one camera transform and switch projection explicitly.",
            vec![],
            "'orthographic' or 'perspective'.",
            vec!["Read Rust-owned camera state"],
            "Returns the projection used by the next renderer draw.",
            vec![],
            "local projection = api.camera.getProjection()",
            vec!["camera.setProjection", "camera.getTransform"],
        ),
        descriptor(
            "camera.setProjection",
            "camera",
            "Switch the single active Camera between orthographic and perspective projection.",
            "When a game changes between a 2D-compatible view and a 3D view without creating a second camera.",
            "Do not keep parallel camera objects; projection is a property of the active Camera.",
            vec![parameter(
                "projection",
                "'orthographic' | 'perspective'",
                "The projection to use.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The transform is preserved where possible and the next renderer draw uses the selected projection.",
            vec!["projection must be 'orthographic' or 'perspective'"],
            "api.camera.setProjection('perspective')",
            vec!["camera.getProjection", "camera.setTransform"],
        ),
        descriptor(
            "camera.getTransform",
            "camera",
            "Read the single Camera's 3D transform and projection settings.",
            "When camera-follow or editor logic needs one stable camera shape across 2D and 3D scenes.",
            "Do not infer a second camera from legacy `camera3d`; it is only a compatibility projection of this state.",
            vec![],
            "CameraTransform: projection, position, target, fovDegrees, and orthographicSize.",
            vec!["Read Rust-owned camera state"],
            "Returns the canonical camera state for the current update.",
            vec![],
            "local camera = api.camera.getTransform()",
            vec!["camera.setTransform", "camera.setProjection"],
        ),
        descriptor(
            "camera.setTransform",
            "camera",
            "Set the single Camera's transform and optional projection settings.",
            "When a game needs to move or aim a camera while keeping one camera abstraction for both 2D and 3D.",
            "Do not put game-specific follow, shake, or targeting policy in the engine; pass the resulting transform only.",
            vec![parameter(
                "transform",
                "CameraTransformInput",
                "The 3D position, projection, target, and projection-specific values.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned camera state"],
            "The next renderer draw uses the new camera state; omitted projection keeps the current projection.",
            vec![
                "position coordinates must be finite",
                "perspective requires target",
                "fovDegrees and orthographicSize must be valid when supplied",
            ],
            "api.camera.setTransform({ projection = 'perspective', position = { x = 0, y = 3, z = 8 }, target = { x = 0, y = 0, z = 0 } })",
            vec!["camera.getTransform", "camera.setProjection"],
        ),
        descriptor(
            "camera.getPosition",
            "camera",
            "Compatibility helper: read the active Camera's orthographic x/y position.",
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
            "Compatibility helper: set the active Camera's orthographic x/y position.",
            "When the camera needs to follow a character or switch the level view.",
            "Do not convert every Entity coordinate to screen coordinates in the game; the renderer uses the camera state.",
            vec![parameter(
                "position",
                "Vec2",
                "The new camera world position.",
            )],
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
            "Compatibility helper: read the active Camera's orthographic zoom factor.",
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
            "Compatibility helper: set the active Camera's orthographic zoom factor.",
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
                parameter(
                    "name",
                    "string",
                    "The animation clip name defined by the Spine asset.",
                ),
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
            "Create an external Effekseer effect instance in world coordinates and return its handle.",
            "For existing Effekseer assets; the engine stores the semantic event while the official player's Effekseer runtime simulates and renders it. For native declarative JSON explosions, fire, sparks and trails, prefer particle.play; see docs/native-particles.md and Particle Lab at /web/particle-lab/.",
            "Do not use it to carry game-rule results. This Effekseer API does not simulate its external particles or determine completion; the separate native particle APIs do simulate deterministic particles.",
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
            vec![
                "effect.stop",
                "particle.play",
                "particle.play_batch",
                "animation.play",
            ],
        ),
        descriptor(
            "effect.stop",
            "presentation",
            "Remove an external Effekseer effect instance.",
            "When a looping Effekseer effect must end early or presentation must be cleared during a scene change.",
            "Effekseer instances are not removed automatically; the game decides when to stop them. For native particles use particle.finish or particle.stop, which have authored lifetime semantics.",
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
            vec!["effect.spawn", "particle.finish", "particle.stop"],
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
            vec![
                "Modify Rust-owned audio loop list",
                "Stop other loops in an exclusive category",
            ],
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
            vec![parameter(
                "handle",
                "string",
                "The handle returned by audio.loop.",
            )],
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
            vec![parameter(
                "handle",
                "string",
                "The handle returned by audio.loop.",
            )],
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
            vec![
                "volume is not between 0 and 1",
                "system 'audio' is not enabled",
            ],
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
            "Publish a declarative UI tree with reusable font, typography, alignment, wrapping, RGBA color, padding, background, border and opacity styles. Stage rect axes are 0..100 and y points up: y=0 is the bottom. Scroll helpers use local top-left/y-down content; see docs/ui-scroll.md.",
            "For official Web and native player UI: text, styled buttons, image skins and decorative panels composed from the game's ViewModel. Reuse the existing component tree through Luau helper functions; component is a node kind, not api.ui.component(). Start with docs/ui-styling.md and game schema ui; package fonts in presentation.ui.fonts instead of drawing text with game-owned DOM or GPU code.",
            "No automatic layout, CSS, platform widgets, data binding or game rules. The game authors rectangles, semantic grouping, ViewModels, reusable components, content and action meanings. Styles are local to leaves and never inherited from components. Use ui.getViewport for authored responsive choices.",
            vec![parameter(
                "root",
                "UiScreen",
                "A screen root with text, button, slider, combobox, image, panel, component and scroll_view children. Leaf style supports font_family/font_size/font_weight/line_height/letter_spacing/color/text_align/vertical_align/wrap/overflow/padding/background/border_color/border_width/border_radius/opacity; image and panel allow only box fields. Font sizes, padding, letter spacing and borders use vertical design units (1 unit = 1% viewport height); a styled leaf defaults to font_size=2 and never auto-shrinks. Omit style for legacy text fitting. Optional budget.max_nodes overrides the default (query ui.inspect). Image slice uses source-pixel borders and vertical-unit destination borders; slice replaces fit. Stage rects fit 0..100; scroll content uses non-negative local top-left/y-down coordinates.",
            )],
            "(): no additional data on success.",
            vec!["Replace the game-owned UI tree for the current frame"],
            "The latest validated tree is immediately visible in observations and Web/native host snapshots. Validation covers schema, style bounds, coordinates and node budgets; host glyph metrics are presentation and do not change simulation state.",
            vec![
                "root kind must be screen",
                "child kind supports text, button, slider (action + optional value text), combobox (action + optional selected text + expanded boolean, default false), image (stable asset:// or texture:// id + fit + optional alt), panel (decorative box with optional style, no text/action/children), component (name + children), or scroll_view (prefer the scrollView/virtualList/virtualGrid helpers); skinned controls expose semantic/action nodes inside game-authored component skins; a skinned slider may expose stable track, fill, handler and semantic nodes, while a skinned combobox exposes field, value, arrow, popup and option nodes with selection and popup state controlled by the UI author",
                "node ids must be globally unique; all rects finite, dimensions positive; stage rects fit 0..100, local scroll content uses non-negative x/y with no anchors",
                "UI_STYLE_INVALID: RGBA outside 0..1, out-of-range style values, unsupported typography on image/panel, style inheritance on containers, or wrap=word combined with overflow=ellipsis; unknown fields are structural errors that name the unsupported field",
            ],
            "api.ui.setRoot({kind=\"screen\",id=\"menu\",node=\"settings\",children={{kind=\"text\",id=\"title\",text=\"Settings\",rect={x=10,y=75,width=80,height=12},style={font_size=4,font_weight=700,text_align=\"start\",vertical_align=\"middle\",color={0.9,0.95,1,1}}}}})",
            vec![
                "ui.inspect",
                "ui.getViewport",
                "ui.scrollView",
                "observation.set",
                "input.getScreenPointerPosition",
            ],
        ),
        descriptor(
            "ui.getViewport",
            "ui",
            "Read the host-reported viewport aspect ratio for game-authored responsive UI composition.",
            "Choose portrait or landscape arrangements, readable typography and semantic groups in Luau. See docs/ui-styling.md. The host reports the actual stage aspect; headless callers may set it through the runtime viewport boundary.",
            "This does not choose rectangles, reflow content, add a layout solver or report device pixels. The game owns layout policy; do not use font raster metrics as simulation input.",
            vec![],
            "{aspect:number}; width divided by height.",
            vec!["Read-only host viewport observation"],
            "Reads the current runtime viewport aspect without advancing a frame or mutating the UI tree.",
            vec![],
            "local viewport = api.ui.getViewport(); local compact = viewport.aspect < 1; api.observation.set(\"compact_ui\", compact)",
            vec!["ui.setRoot", "ui.inspect"],
        ),
        descriptor(
            "ui.inspect",
            "ui",
            "Read the actual UI contract, effective node budget, logical/leaf counts, upper bound on render regions and top-level subtree counts.",
            "Before building a large screen or diagnosing UI_NODE_LIMIT; query instead of guessing host limits.",
            "Not GPU timing or texture-memory measurement; render regions are not draw calls. Host diagnostics measure rendering cost.",
            vec![],
            "{contract: UiContract, usage: UiUsage?}; usage is nil before setRoot.",
            vec!["Read-only inspection"],
            "Reports the latest successfully published tree; a failed setRoot preserves it.",
            vec![],
            "local report = api.ui.inspect(); api.observation.set(\"ui_budget\", report)",
            vec!["ui.setRoot"],
        ),
        descriptor(
            "ui.scrollView",
            "ui",
            "Create a reusable scroll_view node with measured local content and clipped rendering/input.",
            "Use for authored finite content. See docs/ui-scroll.md for coordinates, lifecycle and Web host integration.",
            "Not automatic responsive layout or a gameplay loop. Native/legacy DOM hosts currently reject this capability explicitly.",
            vec![parameter(
                "options",
                "UiScrollOptions",
                "id, viewport, content; optional axis, enabled, resetKey, wheelRect. Content rects are local top-left/y-down; only viewport is in its containing space.",
            )],
            "UiNode; insert into ui.setRoot children.",
            vec!["Construct UI node only"],
            "Host scroll does not advance gameplay.",
            vec!["Do not put stage-space rects in content or hand-author contentHeight/maxScroll."],
            "local view = api.ui.scrollView({id='help',viewport={left=10,top=10,width=80,height=80},content={}})",
            vec!["ui.virtualList", "ui.virtualGrid", "ui.setRoot"],
        ),
        descriptor(
            "ui.virtualList",
            "ui",
            "Build only the visible fixed-height rows of a Lua data source.",
            "Long vertical lists; docs/ui-scroll.md defines stable keys and UI-pure renderItem callbacks.",
            "Not variable-height rows; use scrollView for small irregular content.",
            vec![parameter(
                "options",
                "UiVirtualOptions",
                "id, viewport, items, key field/function, rowHeight, renderItem; optional gapY, enabled, resetKey, wheelRect.",
            )],
            "scroll_view UiNode with virtual_items metadata and bounded materialized children.",
            vec!["Register Lua view callback"],
            "Host requests invoke renderItem, never Game.update. Callback must not mutate gameplay or consume RNG.",
            vec![
                "Keys must be unique strings, not positional array indices; return non-empty arrays of local rect nodes.",
            ],
            "local view = api.ui.virtualList({id='rows',viewport={left=10,top=10,width=80,height=80},items=items,key='id',rowHeight=8,renderItem=renderRow})",
            vec!["ui.virtualGrid", "ui.scrollView"],
        ),
        descriptor(
            "ui.virtualGrid",
            "ui",
            "Build a visible fixed-cell vertical grid using the same scroll core as virtualList.",
            "Large icon/item libraries with explicitly authored column count and cell size.",
            "Not masonry, automatic breakpoints or a responsive layout solver.",
            vec![parameter(
                "options",
                "UiVirtualGridOptions",
                "virtualList options plus columns, columnWidth and optional gapX; columns must fit viewport width.",
            )],
            "scroll_view UiNode with virtual_items metadata.",
            vec!["Register Lua view callback"],
            "UI-only visible-window materialization; no simulation step.",
            vec![
                "rowHeight means cell height, excluding gapY; return cell-local nodes without their row/column translation.",
            ],
            "local view = api.ui.virtualGrid({id='icons',viewport={left=10,top=10,width=80,height=80},items=items,key='id',columns=8,columnWidth=9,rowHeight=16,gapX=1,renderItem=renderIcon})",
            vec!["ui.virtualList", "ui.scrollView"],
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
            "Deprecated compatibility alias for camera.getTransform in perspective mode.",
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
            "Deprecated compatibility alias for camera.setTransform position in perspective mode.",
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
            vec![
                "The current scene has no Camera3D",
                "x/y/z must be finite numbers",
            ],
            "api.camera3d.setPosition({ x = 0, y = 3, z = 8 })",
            vec!["camera3d.getTransform", "camera3d.setTarget"],
        ),
        descriptor(
            "camera3d.setTarget",
            "camera",
            "Deprecated compatibility alias for camera.setTransform target in perspective mode.",
            "When the game must control a 3D camera aimed at a vehicle, track, or other gameplay target.",
            "Do not add game-specific tracking, smoothing, or camera-shake strategies to the engine.",
            vec![parameter(
                "target",
                "Vec3",
                "The new Camera3D world target.",
            )],
            "(): no additional data on success.",
            vec!["Modify Rust-owned Camera3D state"],
            "The update takes effect immediately during the current script update; the renderer uses it on the next draw.",
            vec![
                "The current scene has no Camera3D",
                "x/y/z must be finite numbers",
            ],
            "api.camera3d.setTarget({ x = 0, y = 0, z = 0 })",
            vec!["camera3d.getTransform", "camera3d.setPosition"],
        ),
    ];
    result.extend(physics3d_descriptors());
    for (name, purpose, parameters, returns, example) in [
        (
            "jobs.register",
            "Register a game-owned isolated Luau function source during start/onReload.",
            vec![
                parameter(
                    "id",
                    "string",
                    "1..64 ASCII alphanumeric/underscore/hyphen bytes",
                ),
                parameter(
                    "source",
                    "string",
                    "1..16384 bytes; return function(input: buffer): buffer; fresh sandbox VM per execution",
                ),
            ],
            "nil",
            "api.jobs.register('copy', 'return function(input) return input end')",
        ),
        (
            "jobs.submit",
            "Copy one batch input and stage work for next-tick delivery.",
            vec![
                parameter("operation", "string", "Previously registered operation ID"),
                parameter(
                    "input",
                    "buffer",
                    "At most 262144 bytes; caller retains its buffer",
                ),
            ],
            "string job handle",
            "job = api.jobs.submit('copy', input)",
        ),
        (
            "jobs.schedule",
            "Schedule isolated computation with fresh-input and result callbacks in the gameplay VM.",
            vec![
                parameter(
                    "operation",
                    "string",
                    "Operation from project.job_scripts (recommended) or jobs.register",
                ),
                parameter(
                    "options",
                    "table",
                    "every_ticks: integer 1..1000000000; optional times: integer 1..1000000000",
                ),
                parameter(
                    "prepare",
                    "function",
                    "prepare(api, occurrence) returns fresh buffer before update",
                ),
                parameter(
                    "apply",
                    "function",
                    "apply(api, output, occurrence) runs no earlier than the next tick",
                ),
            ],
            "string schedule handle",
            "schedule = api.jobs.schedule('search', {every_ticks=6}, prepareInput, applyTargets)",
        ),
        (
            "jobs.take",
            "Consume one result during a later update, after the job barrier.",
            vec![parameter(
                "handle",
                "string",
                "One-shot handle from jobs.submit",
            )],
            "buffer",
            "local output = api.jobs.take(job) -- next update, never the submission update",
        ),
        (
            "jobs.cancel",
            "Invalidate a not-yet-consumed job and discard its eventual result.",
            vec![parameter(
                "handle",
                "string",
                "Live job handle; late background result is ignored",
            )],
            "nil",
            "api.jobs.cancel(job)",
        ),
        (
            "jobs.reset",
            "Invalidate all job handles for a gameplay reset; keep registered operations.",
            vec![],
            "nil",
            "api.jobs.reset() -- alongside the game's own round reset",
        ),
    ] {
        result.push(descriptor(name,"jobs",purpose,"Independent coarse buffer batches; game rules remain in Luau.",
            "Not shared mutable world or arbitrary WASM modules. Prepare/apply closures stay in the gameplay VM.",parameters,returns,
            vec!["Updates bounded job state; job source/input/delivered output hashes participate in replay snapshots."],
            "Enable systems.jobs. Submit only during update; dispatch after success; join before next update. Native chooses up to two threads; the Web player supports inline or a bounded Worker pool with identical next-tick visibility. Budget/cancellation is cooperative at VM safe points.",
            vec!["Disabled/missing capability, unknown operation, invalid or stale handle, early take, input/output/queue/memory/budget limits fail explicitly."],example,
            vec!["jobs.register","jobs.submit","jobs.schedule","jobs.take","jobs.cancel","jobs.reset"]));
    }
    result
}

fn parameter(name: &str, type_name: &str, meaning: &str) -> ApiParameter {
    ApiParameter {
        name: name.to_string(),
        type_name: type_name.to_string(),
        meaning: meaning.to_string(),
    }
}

fn physics3d_descriptors() -> Vec<ApiDescriptor> {
    [
        ("getBody","id:string","Read immutable authored collider and body settings. Current velocity/pose comes from snapshot; definition_digest avoids repeating large mesh arrays every frame."),
        ("addBody","id:string, body:Body3D (game schema body3d)","Attach a sphere, box, capsule, convex or static trimesh rigid body to an existing Transform3D; shape dimensions are explicit world units."),
        ("removeBody","id:string","Remove a body, its collider and attached joints; leave the entity at its current pose."),
        ("setGravity","value:Vec3","Set scene gravity and wake dynamic bodies."),
        ("setVelocity","id:string, value:Vec3","Set dynamic linear velocity in world units per second."),
        ("setAngularVelocity","id:string, value:Vec3","Set dynamic angular velocity in world radians per second."),
        ("applyImpulse","id:string, value:Vec3","Apply an instantaneous world linear impulse and wake the dynamic body."),
        ("applyTorqueImpulse","id:string, value:Vec3","Apply an instantaneous world angular impulse and wake the dynamic body."),
        ("addForce","id:string, value:Vec3","Add a persistent world force; call clearForces to stop it."),
        ("addTorque","id:string, value:Vec3","Add persistent world torque; call clearForces to stop it."),
        ("clearForces","id:string","Clear persistent force and torque and wake the body."),
        ("teleport","id:string, pose:Pose3D","Set position and XYZ Euler rotation immediately, retain velocity and synchronize Transform3D; no sweep along the teleport path."),
        ("moveKinematic","id:string, pose:Pose3D","Set a kinematic body's next fixed-step pose; the solver derives velocity and pushes dynamic bodies."),
        ("raycast","request:Ray3D (game schema ray3d)","Query the closest collider along from/to using a spatial index; returns nil or id, fraction, point and normal."),
        ("castShape","request:Cast3D (game schema cast3d)","Sweep a convex shape at fixed orientation against indexed colliders; returns nil or id, fraction, world point and outward normal."),
        ("overlap","request:Overlap3D (game schema overlap3d)","Return sorted collider entity IDs intersecting a convex shape. Sensors excluded unless requested."),
        ("snapshot","none","Read 3D gravity, body poses/quaternions/velocities/sleep states, joint definitions and contact lifecycle without advancing time."),
        ("contacts","none","Read last completed step's sorted enter/stay/exit contact and sensor pairs; normal points from a toward b, exit has zero normal/impulse."),
        ("addJoint","id:string, joint:Joint3D (game schema joint3d)","Connect distinct bodies with fixed, spherical or limited revolute joints using local anchors; contacts disabled by default."),
        ("removeJoint","id:string","Remove a joint by ID and wake its connected bodies."),
    ].into_iter().map(|(name,args,purpose)|descriptor(
        &format!("physics3d.{name}"),"physics3d",purpose,
        "For opt-in 3D rigid-body games and AI physics inspection.",
        "Enable systems.physics3d. Gameplay rules, damage and effect selection remain in Lua. Physics owns registered transforms; use teleport/moveKinematic instead of setTransform3D.",
        if args=="none" {vec![]}else{vec![parameter("arguments","typed",args)]},
        match name {"getBody"=>"Body3D","snapshot"=>"Physics3D snapshot or nil","contacts"=>"Collision3D[]","raycast"|"castShape"=>"QueryHit3D or nil","overlap"=>"string[]",_=>"nil"},
        vec![if matches!(name,"getBody"|"snapshot"|"contacts"|"raycast"|"castShape"|"overlap") {"Read physics state; no implicit step"}else{"Change solver configuration/state; no implicit step"}],
        "Fixed 60 Hz, single-threaded Rapier enhanced-determinism. Snapshot is an observation, not a complete resumable solver save. Contacts are read on the following Game.update.",
        vec!["SYSTEM_DISABLED","PHYSICS3D_BODY_MISSING","invalid/unknown fields","PHYSICS3D_OWNERSHIP"],
        "local state = api.physics3d.snapshot()",
        vec!["physics3d.snapshot","physics3d.contacts","physics3d.raycast"]
    )).collect()
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

    use super::{api_search_result, describe, descriptors, search, typings};

    #[test]
    fn typography_and_box_intents_discover_official_ui_authoring() {
        for query in [
            "font",
            "font size",
            "font weight",
            "typography",
            "text alignment",
            "text wrapping",
            "border padding",
            "background color",
            "component styling",
            "reusable components",
            "shared UI controls",
            "how do I change font size",
            "字體",
            "字級 排版 樣式",
            "文字換行",
            "顏色 邊框 內距",
            "共用元件",
            "共用 UI 元件",
            "字體大小與排版",
            "共用UI元件",
            "共用UI組件",
            "UI元件",
            "共享UI组件",
            "font_size",
            "font_family",
            "font_weight",
            "line_height",
            "text_align",
            "vertical_align",
            "letter_spacing",
            "border_color",
            "border_width",
            "border_radius",
            "overflow",
        ] {
            let found = search(query);
            assert_eq!(
                found.first().map(|api| api.name.as_str()),
                Some("ui.setRoot"),
                "{query}"
            );
            assert!(
                found.iter().all(|api| api.name.starts_with("ui.")),
                "{query}"
            );
            assert!(found[0].when_to_use.contains("docs/ui-styling.md"));
            assert!(found[0].related_apis.contains(&"ui.getViewport".to_owned()));
        }
        for query in ["viewport", "responsive", "portrait", "螢幕比例"] {
            assert_eq!(search(query)[0].name, "ui.getViewport", "{query}");
        }
        assert_eq!(search("ui.setRoot").len(), 1);
        assert_eq!(search("ui.getViewport").len(), 1);
        assert!(
            search("ECS元件").is_empty(),
            "UI alias matching must not capture unrelated component queries"
        );
        assert!(
            search("entity size")
                .iter()
                .any(|api| api.name == "entity.getTransform2D")
        );
    }

    #[test]
    fn visual_intents_discover_native_particles_before_external_effects() {
        for query in [
            "vfx",
            "explosion",
            "thruster",
            "fire",
            "sparks",
            "smoke",
            "粒子特效",
            "爆炸",
            "尾焰",
            "how do I make thruster fire?",
        ] {
            let matches = search(query);
            assert_eq!(
                matches.first().map(|api| api.name.as_str()),
                Some("particle.play"),
                "{query}"
            );
            assert_eq!(
                matches
                    .iter()
                    .filter(|api| api.name.starts_with("particle."))
                    .count(),
                6,
                "{query}"
            );
            assert!(
                matches.iter().all(|api| api.name.starts_with("particle.")
                    || api.name.starts_with("effect.")
                    || (query == "vfx" && api.name.starts_with("shader."))),
                "unrelated visual search results for {query}"
            );
            let native_last = matches
                .iter()
                .rposition(|api| api.name.starts_with("particle."))
                .unwrap();
            let external_first = matches
                .iter()
                .position(|api| api.name.starts_with("effect."))
                .unwrap();
            assert!(native_last < external_first, "{query}");
        }
    }

    #[test]
    fn exact_api_and_explicit_effekseer_queries_keep_their_intent() {
        assert_eq!(
            search(" PARTICLE.PLAY ")
                .iter()
                .map(|api| api.name.as_str())
                .collect::<Vec<_>>(),
            vec!["particle.play"]
        );
        assert_eq!(
            search("effect.spawn")
                .iter()
                .map(|api| api.name.as_str())
                .collect::<Vec<_>>(),
            vec!["effect.spawn"]
        );
        let external = search("Effekseer explosion");
        assert!(!external.is_empty());
        assert!(external.iter().all(|api| api.name.starts_with("effect.")));
        // An unrelated word must not broaden the query to every position API.
        assert!(search("unfindable position").is_empty());
        assert!(search("???").is_empty());
    }

    #[test]
    fn generic_effect_words_preserve_explicit_shader_intent() {
        for query in ["shader effects", "custom shader effects", "shader vfx"] {
            let matches = search(query);
            assert!(!matches.is_empty(), "{query}");
            assert_eq!(matches[0].name, "shader.setMaterial", "{query}");
            assert!(
                matches.iter().all(|api| api.name.starts_with("shader.")),
                "{query}"
            );
        }
        // Specific exhaust/impact queries still guide ordinary effect authoring
        // to native particles before the external Effekseer integration.
        assert!(
            search("thruster fire")
                .iter()
                .all(|api| !api.name.starts_with("shader."))
        );
    }

    #[test]
    fn native_and_external_effect_descriptions_explain_authoring_and_ownership() {
        let native = describe("particle.play").unwrap();
        assert!(native.purpose.contains("declarative JSON"));
        assert!(native.when_to_use.contains("docs/native-particles.md"));
        assert!(native.when_to_use.contains("docs/particle.schema.json"));
        assert!(native.when_to_use.contains("/web/particle-lab/"));
        assert!(native.related_apis.contains(&"effect.spawn".to_string()));

        let external = describe("effect.spawn").unwrap();
        assert!(external.purpose.contains("external Effekseer"));
        assert!(external.related_apis.contains(&"particle.play".to_string()));
        assert!(
            external
                .when_not_to_use
                .contains("separate native particle APIs do simulate")
        );
        assert!(
            !external
                .when_not_to_use
                .contains("engine neither simulates particles")
        );
    }

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
        let result = api_search_result(Path::new("missing-project"), "attack");
        let report = result
            .value
            .as_ref()
            .expect("search should return a report");
        let diagnostic = result
            .diagnostics
            .first()
            .expect("no-match search should explain the next step");

        assert!(result.ok);
        assert_eq!(report.query, "attack");
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
                "query": "attack",
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
            full_index
                .argv
                .as_ref()
                .expect("full index should have argv"),
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
