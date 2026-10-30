#[cfg(feature = "dev-tools")]
use std::fmt::Display;
use std::{collections::BTreeMap, path::Path};

use serde_json::{Map, Value};

use crate::{
    diagnostics::{Diagnostic, SourceLocation},
    world::{SceneEntity, SceneFile, validate_scale3d, validate_transform2d, validate_vec3},
};

#[derive(Debug, Clone, Copy)]
enum SceneSourceKind {
    #[cfg_attr(not(feature = "dev-tools"), allow(dead_code))]
    Disk,
    HostPayload,
    Typed,
}

#[derive(Debug, Clone, Copy)]
struct SceneSource<'a> {
    kind: SceneSourceKind,
    file: Option<&'a Path>,
}

impl<'a> SceneSource<'a> {
    #[cfg(feature = "dev-tools")]
    fn disk(file: &'a Path) -> Self {
        Self {
            kind: SceneSourceKind::Disk,
            file: Some(file),
        }
    }

    fn host_payload() -> SceneSource<'static> {
        SceneSource {
            kind: SceneSourceKind::HostPayload,
            file: None,
        }
    }

    fn typed() -> SceneSource<'static> {
        SceneSource {
            kind: SceneSourceKind::Typed,
            file: None,
        }
    }
}

/// Parse and validate a host-provided scene fragment.
///
/// The caller is expected to keep the outer host envelope as `RawValue` until
/// this function is called. Parse errors therefore report line and column
/// relative to the original scene fragment, not to a reconstructed payload.
pub fn parse_scene_fragment(text: &str) -> Result<SceneFile, Box<Diagnostic>> {
    parse_and_validate(text, SceneSource::host_payload())
}

#[cfg(feature = "dev-tools")]
pub(crate) fn parse_scene_file(text: &str, path: &Path) -> Result<SceneFile, Box<Diagnostic>> {
    parse_and_validate(text, SceneSource::disk(path))
}

pub(crate) fn validate_typed_scene(scene: &SceneFile) -> Result<(), Box<Diagnostic>> {
    validate_scene(scene, SceneSource::typed())
}

#[cfg(feature = "dev-tools")]
pub(crate) fn scene_read_failed(path: &Path, error: impl Display) -> Box<Diagnostic> {
    with_scene_context(
        Box::new(Diagnostic::error(
            "SCENE_READ_FAILED",
            "Failed to read the main scene",
            format!("{}: {}", path.display(), error),
        )),
        SceneSource::disk(path),
        None,
        None,
        None,
    )
}

fn parse_and_validate(text: &str, source: SceneSource<'_>) -> Result<SceneFile, Box<Diagnostic>> {
    let scene = serde_json::from_str::<SceneFile>(text).map_err(|error| {
        let line = nonzero_location(error.line());
        let column = nonzero_location(error.column());
        let explanation = match source.file {
            Some(path) => format!("{}: {}", path.display(), error),
            None => {
                format!("The host payload scene fragment is not valid Unone scene JSON: {error}")
            }
        };
        with_scene_context(
            Box::new(Diagnostic::error(
                "SCENE_INVALID",
                "The main scene is not valid Unone scene JSON",
                explanation,
            )),
            source,
            line,
            column,
            None,
        )
    })?;
    validate_scene(&scene, source)?;
    Ok(scene)
}

fn validate_scene(scene: &SceneFile, source: SceneSource<'_>) -> Result<(), Box<Diagnostic>> {
    if let Some(physics) = &scene.physics3d {
        physics.validate(scene).map_err(|message|scene_error(source,"SCENE_PHYSICS3D_INVALID","Invalid 3D physics",message))?;
    }
    if scene.shader_materials.len() > crate::shader::MAX_SHADER_MATERIALS {
        return Err(scene_error(source, "SHADER_DEFINITION_INVALID", "Too many shader materials", "At most 64 materials may be declared"));
    }
    for (id, definition) in &scene.shader_materials {
        if !crate::shader::valid_identifier(id) {
            return Err(scene_error(source, "SHADER_DEFINITION_INVALID", "Invalid shader material id", "Shader material IDs must be ASCII identifiers of at most 64 bytes"));
        }
        definition.validate().map_err(|message| scene_error(source, "SHADER_DEFINITION_INVALID", "Invalid shader material", message))?;
    }
    for entity in &scene.entities {
        if let Some(material) = &entity.shader_material
            && (entity.sprite.is_none() || !scene.shader_materials.contains_key(material))
        {
            return Err(scene_error(source, "SHADER_MATERIAL_REFERENCE_INVALID", "Invalid shader assignment", format!("Entity '{}' needs a sprite and a declared shader material '{}'", entity.id, material)));
        }
    }
    for (id, definition) in &scene.particle_effects {
        if id.trim().is_empty() {
            return Err(scene_error(
                source,
                "PARTICLE_DEFINITION_INVALID",
                "Empty particle id",
                "Particle IDs must not be blank",
            ));
        }
        definition.validate().map_err(|message| {
            scene_error(
                source,
                "PARTICLE_DEFINITION_INVALID",
                "Invalid particle definition",
                message,
            )
        })?;
    }
    if scene.camera.zoom <= 0.0 || !scene.camera.zoom.is_finite() {
        return Err(scene_error(
            source,
            "SCENE_CAMERA_INVALID",
            "Camera2D zoom is invalid",
            "Camera2D zoom must be a finite number greater than 0.",
        ));
    }

    if let Some(camera3d) = &scene.camera3d {
        if let Err(diagnostic) = validate_vec3(camera3d.position, "Camera3D position") {
            return Err(with_scene_context(diagnostic, source, None, None, None));
        }
        if let Err(diagnostic) = validate_vec3(camera3d.target, "Camera3D target") {
            return Err(with_scene_context(diagnostic, source, None, None, None));
        }
        if !(1.0..179.0).contains(&camera3d.fov_degrees) || !camera3d.fov_degrees.is_finite() {
            return Err(scene_error(
                source,
                "SCENE_CAMERA3D_INVALID",
                "Camera3D fov_degrees is invalid",
                "Camera3D fov_degrees must be a finite number greater than 1 and less than 179.",
            ));
        }
    }

    let mut entity_ids = BTreeMap::new();
    for (index, entity) in scene.entities.iter().enumerate() {
        if entity.id.trim().is_empty() {
            let mut diagnostic = scene_error(
                source,
                "SCENE_ENTITY_ID_INVALID",
                "scene entity id is invalid",
                "Every scene entity id must be a non-blank string; the engine does not trim or rewrite ids.",
            );
            add_fact(
                &mut diagnostic,
                "entity_id",
                Value::String(entity.id.clone()),
            );
            add_fact(&mut diagnostic, "index", Value::from(index as u64));
            set_json_pointer(&mut diagnostic, format!("/entities/{index}/id"));
            return Err(diagnostic);
        }
        if let Some(first_index) = entity_ids.insert(entity.id.as_str(), index) {
            let mut diagnostic = scene_error(
                source,
                "SCENE_ENTITY_ID_DUPLICATE",
                "scene entity id is duplicated",
                "Entity ids must be unique within a scene; the engine does not silently overwrite an earlier entity.",
            );
            add_fact(
                &mut diagnostic,
                "entity_id",
                Value::String(entity.id.clone()),
            );
            add_fact(&mut diagnostic, "index", Value::from(index as u64));
            add_fact(
                &mut diagnostic,
                "first_index",
                Value::from(first_index as u64),
            );
            set_json_pointer(&mut diagnostic, format!("/entities/{index}/id"));
            return Err(diagnostic);
        }

        validate_entity(entity, source)?;
    }

    Ok(())
}

/// Rules for one entity declaration, shared by scene loading and runtime
/// `entity.spawn` components so both paths accept exactly the same data.
fn validate_entity(entity: &SceneEntity, source: SceneSource<'_>) -> Result<(), Box<Diagnostic>> {
    if let Err(diagnostic) = validate_transform2d(
        entity.transform,
        entity.rotation,
        entity.scale,
        &format!("Entity '{}' Transform2D", entity.id),
    ) {
        return Err(with_scene_context(diagnostic, source, None, None, None));
    }
    if let Some(transform3d) = &entity.transform3d {
        if let Err(diagnostic) = validate_vec3(transform3d.position, "Transform3D position") {
            return Err(with_scene_context(diagnostic, source, None, None, None));
        }
        if let Err(diagnostic) = validate_vec3(transform3d.rotation, "Transform3D rotation") {
            return Err(with_scene_context(diagnostic, source, None, None, None));
        }
        if let Err(diagnostic) = validate_scale3d(transform3d.scale) {
            return Err(with_scene_context(diagnostic, source, None, None, None));
        }
    }
    if let Some(mesh3d) = &entity.mesh3d
        && mesh3d.asset.trim().is_empty()
    {
        return Err(scene_error(
            source,
            "SCENE_MESH3D_INVALID",
            "Mesh3D asset is invalid",
            format!("Entity '{}' must provide a Mesh3D asset.", entity.id),
        ));
    }
    if let Some(sprite) = &entity.sprite
        && !sprite_size_valid(sprite)
    {
        return Err(scene_error(
            source,
            "SCENE_SPRITE_INVALID",
            "Sprite size is invalid",
            format!(
                "Entity '{}' Sprite size must have finite x and y values greater than 0.",
                entity.id
            ),
        ));
    }
    if let Some(problem) = entity.sprite.as_ref().and_then(sprite_frame_problem) {
        return Err(scene_error(
            source,
            "SCENE_SPRITE_INVALID",
            "Sprite sheet is invalid",
            format!("Entity '{}' {problem}", entity.id),
        ));
    }
    if let Some(problem) = entity
        .sprite_animation
        .as_ref()
        .and_then(|clip| sprite_animation_problem(entity.sprite.as_ref(), clip))
    {
        return Err(scene_error(
            source,
            "SCENE_SPRITE_ANIMATION_INVALID",
            "Sprite animation is invalid",
            format!("Entity '{}' {problem}", entity.id),
        ));
    }
    if let Some(body) = &entity.rigidbody {
        if body.mass <= 0.0 || !body.mass.is_finite() {
            return Err(scene_error(
                source,
                "SCENE_PHYSICS_INVALID",
                "RigidBody2D mass is invalid",
                format!(
                    "Entity '{}' mass must be a finite number greater than 0.",
                    entity.id
                ),
            ));
        }
        if body.radius <= 0.0 || !body.radius.is_finite() {
            return Err(scene_error(
                source,
                "SCENE_PHYSICS_INVALID",
                "RigidBody2D radius is invalid",
                format!(
                    "Entity '{}' radius must be a finite number greater than 0.",
                    entity.id
                ),
            ));
        }
        if !body.restitution.is_finite() || !(0.0..=1.0).contains(&body.restitution) {
            return Err(scene_error(
                source,
                "SCENE_PHYSICS_INVALID",
                "RigidBody2D restitution is invalid",
                format!(
                    "Entity '{}' restitution must be between 0 and 1.",
                    entity.id
                ),
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_runtime_entity(entity: &SceneEntity) -> Result<(), Box<Diagnostic>> {
    validate_entity(entity, SceneSource::typed())
}

/// Sprite size rule shared with `entity.setSprite`.
pub(crate) fn sprite_size_valid(sprite: &crate::world::SpriteData) -> bool {
    sprite.size.x > 0.0 && sprite.size.y > 0.0 && sprite.size.x.is_finite() && sprite.size.y.is_finite()
}

/// Bounds a sheet so cell numbers and host texture coordinates stay exact.
const MAX_SHEET_CELLS: u64 = 65_536;
/// Bounds a clip, which is copied into every entity that plays it.
const MAX_ANIMATION_FRAMES: usize = 1_024;

/// Sheet and frame rule shared by scenes, `entity.spawn` and `entity.setSprite`.
pub(crate) fn sprite_frame_problem(sprite: &crate::world::SpriteData) -> Option<String> {
    let Some(sheet) = sprite.sheet else {
        return (sprite.frame != 0).then(|| {
            format!("Sprite frame {} needs a sheet; add sheet = {{columns, rows}}.", sprite.frame)
        });
    };
    if sheet.columns == 0 || sheet.rows == 0 || sheet.cells() > MAX_SHEET_CELLS {
        return Some(format!(
            "Sprite sheet must have at least 1 column and 1 row and at most {MAX_SHEET_CELLS} cells, got {}x{}.",
            sheet.columns, sheet.rows
        ));
    }
    (u64::from(sprite.frame) >= sheet.cells()).then(|| {
        format!(
            "Sprite frame {} is outside its {}x{} sheet (cells 0..{}).",
            sprite.frame, sheet.columns, sheet.rows, sheet.cells() - 1
        )
    })
}

/// Clip rule shared by scenes, `entity.spawn` and `entity.playSpriteAnimation`.
pub(crate) fn sprite_animation_problem(
    sprite: Option<&crate::world::SpriteData>,
    clip: &crate::world::SpriteAnimationData,
) -> Option<String> {
    let Some(sheet) = sprite.and_then(|sprite| sprite.sheet) else {
        return Some("needs a Sprite with a sheet = {columns, rows} to animate.".to_string());
    };
    if clip.frames.is_empty() || clip.frames.len() > MAX_ANIMATION_FRAMES {
        return Some(format!(
            "sprite animation frames must list 1 to {MAX_ANIMATION_FRAMES} sheet cells, got {}.",
            clip.frames.len()
        ));
    }
    if let Some(frame) = clip.frames.iter().find(|frame| u64::from(**frame) >= sheet.cells()) {
        return Some(format!(
            "sprite animation frame {frame} is outside its {}x{} sheet (cells 0..{}).",
            sheet.columns, sheet.rows, sheet.cells() - 1
        ));
    }
    (!clip.fps.is_finite() || clip.fps <= 0.0)
        .then(|| format!("sprite animation fps must be a finite number greater than 0, got {}.", clip.fps))
}

fn scene_error(
    source: SceneSource<'_>,
    code: &str,
    summary: &str,
    explanation: impl Into<String>,
) -> Box<Diagnostic> {
    with_scene_context(
        Box::new(Diagnostic::error(code, summary, explanation)),
        source,
        None,
        None,
        None,
    )
}

fn with_scene_context(
    mut diagnostic: Box<Diagnostic>,
    source: SceneSource<'_>,
    line: Option<u32>,
    column: Option<u32>,
    json_pointer: Option<String>,
) -> Box<Diagnostic> {
    let mut facts = match std::mem::replace(&mut diagnostic.facts, Value::Null) {
        Value::Object(facts) => facts,
        _ => Map::new(),
    };
    facts.insert(
        "source_kind".to_string(),
        Value::String(
            match source.kind {
                SceneSourceKind::Disk => "disk_scene",
                SceneSourceKind::HostPayload => "host_payload_scene",
                SceneSourceKind::Typed => "typed_scene",
            }
            .to_string(),
        ),
    );
    facts.insert(
        "location_scope".to_string(),
        Value::String(
            match source.kind {
                SceneSourceKind::Disk => "scene_file",
                SceneSourceKind::HostPayload => "scene_fragment",
                SceneSourceKind::Typed => "typed_value",
            }
            .to_string(),
        ),
    );
    facts.insert(
        "line".to_string(),
        line.map(Value::from).unwrap_or(Value::Null),
    );
    facts.insert(
        "column".to_string(),
        column.map(Value::from).unwrap_or(Value::Null),
    );
    facts.insert(
        "json_pointer".to_string(),
        json_pointer.map(Value::String).unwrap_or(Value::Null),
    );
    facts.insert(
        "pointer_base".to_string(),
        match source.kind {
            SceneSourceKind::HostPayload => Value::String("/scene".to_string()),
            SceneSourceKind::Disk | SceneSourceKind::Typed => Value::Null,
        },
    );
    diagnostic.facts = Value::Object(facts);
    diagnostic.source = source.file.map(|file| SourceLocation {
        file: file.display().to_string(),
        line,
        column,
    });
    diagnostic
}

fn add_fact(diagnostic: &mut Box<Diagnostic>, key: &str, value: Value) {
    diagnostic
        .facts
        .as_object_mut()
        .expect("scene context always stores object facts")
        .insert(key.to_string(), value);
}

fn set_json_pointer(diagnostic: &mut Box<Diagnostic>, pointer: String) {
    diagnostic
        .facts
        .as_object_mut()
        .expect("scene context always stores object facts")
        .insert("json_pointer".to_string(), Value::String(pointer));
}

fn nonzero_location(value: usize) -> Option<u32> {
    (value != 0).then_some(value as u32)
}

#[cfg(all(test, feature = "dev-tools"))]
mod tests {
    use std::{fs, path::Path};

    use tempfile::tempdir;

    use super::{parse_scene_file, parse_scene_fragment, validate_typed_scene};
    use crate::{
        asset::{inspect, read_scene_references},
        asset_workflow::describe_asset,
        bundle::pack_project,
        runtime::EngineRuntime,
        world::{SceneFile, World},
    };

    #[derive(Clone, Copy)]
    struct NegativeSceneFixture {
        name: &'static str,
        text: &'static str,
        code: &'static str,
        json_pointer: Option<&'static str>,
    }

    const NEGATIVE_SCENE_FIXTURES: [NegativeSceneFixture; 5] = [
        NegativeSceneFixture {
            name: "root-typo",
            text: r#"{"entities":[],"typo":true}"#,
            code: "SCENE_INVALID",
            json_pointer: None,
        },
        NegativeSceneFixture {
            name: "deep-vector-typo",
            text: r#"{"entities":[{"id":"player","transform":{"x":0,"y":0,"z":0}}]}"#,
            code: "SCENE_INVALID",
            json_pointer: None,
        },
        NegativeSceneFixture {
            name: "blank-id",
            text: r#"{"entities":[{"id":"  \t"}]}"#,
            code: "SCENE_ENTITY_ID_INVALID",
            json_pointer: Some("/entities/0/id"),
        },
        NegativeSceneFixture {
            name: "duplicate-id",
            text: r#"{"entities":[{"id":"player"},{"id":"player"}]}"#,
            code: "SCENE_ENTITY_ID_DUPLICATE",
            json_pointer: Some("/entities/1/id"),
        },
        NegativeSceneFixture {
            name: "invalid-geometry",
            text: r#"{"entities":[{"id":"player","sprite":{"asset":"asset://player","size":{"x":0,"y":1}}}]}"#,
            code: "SCENE_SPRITE_INVALID",
            json_pointer: None,
        },
    ];

    fn write_consumer_project(
        root: &Path,
        scene: &str,
        with_asset_manifest: bool,
    ) -> crate::project::ProjectPaths {
        fs::create_dir_all(root.join("scripts")).unwrap();
        fs::create_dir_all(root.join("scenes")).unwrap();
        let config = if with_asset_manifest {
            r#"{"name":"scene-matrix","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json","asset_manifest":"assets/manifest.json","bundle_manifest":"bundles/current.json"}"#
        } else {
            r#"{"name":"scene-matrix","entry_script":"scripts/main.luau","main_scene":"scenes/main.scene.json"}"#
        };
        fs::write(root.join("project.unone.json"), config).unwrap();
        fs::write(root.join("scripts/main.luau"), b"return {}\n").unwrap();
        fs::write(root.join("scenes/main.scene.json"), scene).unwrap();
        if with_asset_manifest {
            fs::create_dir_all(root.join("assets")).unwrap();
            fs::create_dir_all(root.join("bundles")).unwrap();
            fs::write(root.join("assets/player.svg"), b"player").unwrap();
            fs::write(
                root.join("assets/manifest.json"),
                br#"{"version":1,"assets":[{"id":"asset://player","source":"assets/player.svg","kind":"texture2d","bundle":"content"}]}"#,
            )
            .unwrap();
            fs::write(
                root.join("bundles/current.json"),
                br#"{"version":1,"bundles":[{"id":"content","version":"1","source":"bundles/content.bundle","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size_bytes":0}]}"#,
            )
            .unwrap();
        }
        crate::project::ProjectPaths::discover(root).unwrap().1
    }

    fn assert_disk_context(
        diagnostic: &crate::diagnostics::Diagnostic,
        fixture: NegativeSceneFixture,
        scene_path: &Path,
    ) {
        assert_eq!(diagnostic.code, fixture.code, "fixture {}", fixture.name);
        assert_eq!(diagnostic.facts["source_kind"], "disk_scene");
        assert_eq!(diagnostic.facts["location_scope"], "scene_file");
        assert!(diagnostic.facts["pointer_base"].is_null());
        let expected_file = scene_path.to_string_lossy();
        assert_eq!(
            diagnostic
                .source
                .as_ref()
                .map(|source| source.file.as_str()),
            Some(expected_file.as_ref())
        );
        if fixture.code == "SCENE_INVALID" {
            assert!(
                diagnostic.facts["line"].is_number(),
                "fixture {}",
                fixture.name
            );
            assert!(
                diagnostic.facts["column"].is_number(),
                "fixture {}",
                fixture.name
            );
        } else {
            assert!(
                diagnostic.facts["line"].is_null(),
                "fixture {}",
                fixture.name
            );
            assert!(
                diagnostic.facts["column"].is_null(),
                "fixture {}",
                fixture.name
            );
        }
        match fixture.json_pointer {
            Some(pointer) => assert_eq!(diagnostic.facts["json_pointer"], pointer),
            None => assert!(diagnostic.facts["json_pointer"].is_null()),
        }
    }

    #[test]
    fn accepts_empty_scene_shapes() {
        assert!(parse_scene_fragment("{}").is_ok());
        assert!(parse_scene_fragment(r#"{"entities":[]}"#).is_ok());
    }

    #[test]
    fn unified_camera_scene_definition_maps_to_the_legacy_host_projection() {
        let scene = parse_scene_fragment(
            r#"{"camera":{"projection":"perspective","position":{"x":0,"y":3,"z":8},"target":{"x":0,"y":0,"z":0},"fovDegrees":55},"entities":[]}"#,
        )
        .unwrap();
        assert_eq!(scene.camera.position, crate::Vec2 { x: 0.0, y: 3.0 });
        assert_eq!(scene.camera3d.as_ref().unwrap().position.z, 8.0);
        assert_eq!(scene.camera3d.as_ref().unwrap().fov_degrees, 55.0);

        let ortho = parse_scene_fragment(
            r#"{"camera":{"projection":"orthographic","position":{"x":4,"y":2,"z":0},"orthographicSize":5},"entities":[]}"#,
        )
        .unwrap();
        assert_eq!(ortho.camera.position, crate::Vec2 { x: 4.0, y: 2.0 });
        assert_eq!(ortho.camera.view_height / ortho.camera.zoom, 5.0);
        assert!(ortho.camera3d.is_none());
    }

    #[test]
    fn canonical_scene_serialization_keeps_one_camera_authoring_shape() {
        let scene = parse_scene_fragment(
            r#"{"camera":{"projection":"perspective","position":{"x":0,"y":3,"z":8},"target":{"x":0,"y":0,"z":0},"fovDegrees":55},"entities":[]}"#,
        )
        .unwrap();
        let encoded = serde_json::to_value(&scene).unwrap();
        assert_eq!(encoded["camera"]["projection"], "perspective");
        assert_eq!(encoded["camera"]["fovDegrees"], 55.0);
        assert!(encoded.get("camera3d").is_none());
        let round_trip = parse_scene_fragment(&encoded.to_string()).unwrap();
        assert_eq!(round_trip.camera3d, scene.camera3d);
    }

    #[test]
    fn omitted_projection_infers_perspective_only_from_3d_fields() {
        let scene = parse_scene_fragment(
            r#"{"camera":{"position":{"x":0,"y":3,"z":8},"target":{"x":0,"y":0,"z":0}},"entities":[]}"#,
        )
        .unwrap();
        assert!(scene.camera3d.is_some());
        let invalid = parse_scene_fragment(
            r#"{"camera":{"projection":"orthographic","target":{"x":0,"y":0,"z":0}},"entities":[]}"#,
        )
        .unwrap_err();
        assert!(invalid.explanation.contains("cannot declare target"));
        let malformed = parse_scene_fragment(
            r#"{"camera":{"projection":3,"position":{"x":0,"y":0}},"entities":[]}"#,
        )
        .unwrap_err();
        assert!(malformed.explanation.contains("projection must be a string"));
    }

    #[test]
    fn rejects_unknown_root_and_deep_vector_fields_with_context() {
        let root = parse_scene_fragment(r#"{"entities":[],"typo":true}"#).unwrap_err();
        assert_eq!(root.code, "SCENE_INVALID");
        assert_eq!(root.facts["source_kind"], "host_payload_scene");
        assert_eq!(root.facts["location_scope"], "scene_fragment");
        assert_eq!(root.facts["pointer_base"], "/scene");
        assert!(root.facts["line"].is_number());
        assert!(root.facts["column"].is_number());
        assert!(root.facts["json_pointer"].is_null());
        assert!(root.source.is_none());
        assert!(root.explanation.contains("unknown field"));

        let deep = parse_scene_fragment(
            r#"{"entities":[{"id":"player","transform":{"x":0,"y":0,"z":0}}]}"#,
        )
        .unwrap_err();
        assert_eq!(deep.code, "SCENE_INVALID");
        assert!(deep.explanation.contains("unknown field"));
        assert_eq!(deep.facts["json_pointer"], serde_json::Value::Null);
    }

    #[test]
    fn disk_parse_keeps_real_filename_and_fragment_locations() {
        let diagnostic = parse_scene_file(
            "{\n  \"entities\": [],\n  \"unknown\": true\n}",
            Path::new("scenes/main.scene.json"),
        )
        .unwrap_err();
        assert_eq!(diagnostic.facts["source_kind"], "disk_scene");
        assert_eq!(diagnostic.facts["location_scope"], "scene_file");
        assert_eq!(diagnostic.facts["line"], 3);
        assert_eq!(
            diagnostic.source.as_ref().unwrap().file,
            "scenes/main.scene.json"
        );
        assert_eq!(diagnostic.source.as_ref().unwrap().line, Some(3));
        assert_eq!(diagnostic.source.as_ref().unwrap().column, Some(11));
    }

    #[test]
    fn rejects_blank_and_duplicate_ids_without_rewriting_ids() {
        let blank = parse_scene_fragment(r#"{"entities":[{"id":"  \t"}]}"#).unwrap_err();
        assert_eq!(blank.code, "SCENE_ENTITY_ID_INVALID");
        assert_eq!(blank.facts["entity_id"], "  \t");
        assert_eq!(blank.facts["index"], 0);
        assert_eq!(blank.facts["json_pointer"], "/entities/0/id");

        let duplicate =
            parse_scene_fragment(r#"{"entities":[{"id":"player"},{"id":"player"}]}"#).unwrap_err();
        assert_eq!(duplicate.code, "SCENE_ENTITY_ID_DUPLICATE");
        assert_eq!(duplicate.facts["entity_id"], "player");
        assert_eq!(duplicate.facts["index"], 1);
        assert_eq!(duplicate.facts["first_index"], 0);
        assert_eq!(duplicate.facts["json_pointer"], "/entities/1/id");
    }

    #[test]
    fn typed_validation_uses_typed_location_without_source_file() {
        let scene: SceneFile = serde_json::from_value(serde_json::json!({
            "entities": [{"id": "player", "sprite": {"asset": "asset://player"}}]
        }))
        .unwrap();
        assert!(validate_typed_scene(&scene).is_ok());

        let duplicate: SceneFile = serde_json::from_value(serde_json::json!({
            "entities": [{"id": "player"}, {"id": "player"}]
        }))
        .unwrap();
        let diagnostic = validate_typed_scene(&duplicate).unwrap_err();
        assert_eq!(diagnostic.code, "SCENE_ENTITY_ID_DUPLICATE");
        assert_eq!(diagnostic.facts["source_kind"], "typed_scene");
        assert_eq!(diagnostic.facts["location_scope"], "typed_value");
        assert!(diagnostic.source.is_none());
    }

    #[test]
    fn shared_vec2_contract_rejects_extra_input_pointer_fields() {
        let result = serde_json::from_value::<crate::project::InputFrame>(serde_json::json!({
            "pointer": {"position": {"x": 1, "y": 2, "z": 3}}
        }));
        assert!(result.is_err());

        let valid = serde_json::from_value::<crate::project::InputFrame>(serde_json::json!({
            "pointer": {"position": {"x": 1, "y": 2}}
        }));
        assert!(valid.is_ok());
    }

    #[test]
    fn typed_id_failure_happens_before_world_mutation() {
        let mut world = World::default();
        let initial: SceneFile = serde_json::from_value(serde_json::json!({
            "entities": [{"id": "existing", "transform": {"x": 2, "y": 3}}]
        }))
        .unwrap();
        world.load_scene_data(initial).unwrap();
        let before = serde_json::to_value(world.snapshot()).unwrap();

        let invalid: SceneFile = serde_json::from_value(serde_json::json!({
            "physics": {"gravity": {"x": 0, "y": -3}},
            "entities": [{"id": "new"}, {"id": "new"}]
        }))
        .unwrap();
        let diagnostic = world.load_scene_data(invalid).unwrap_err();

        assert_eq!(diagnostic.code, "SCENE_ENTITY_ID_DUPLICATE");
        assert_eq!(diagnostic.facts["source_kind"], "typed_scene");
        assert_eq!(diagnostic.facts["json_pointer"], "/entities/1/id");
        assert_eq!(serde_json::to_value(world.snapshot()).unwrap(), before);
    }

    #[test]
    fn all_disk_consumers_reject_the_shared_negative_fixture_matrix() {
        for fixture in NEGATIVE_SCENE_FIXTURES {
            let directory = tempdir().unwrap();
            let paths = write_consumer_project(directory.path(), fixture.text, true);
            let scene_path = paths.main_scene.as_deref().unwrap();

            let mut world = World::default();
            let before = serde_json::to_value(world.snapshot()).unwrap();
            let diagnostic = world.load_scene(scene_path).unwrap_err();
            assert_disk_context(&diagnostic, fixture, scene_path);
            assert_eq!(serde_json::to_value(world.snapshot()).unwrap(), before);

            let diagnostic = read_scene_references(&paths).unwrap_err();
            assert_disk_context(&diagnostic, fixture, scene_path);

            let inspected = inspect(directory.path());
            let diagnostic = inspected
                .diagnostics
                .iter()
                .find(|diagnostic| diagnostic.code == fixture.code)
                .unwrap_or_else(|| panic!("fixture {}: {inspected:?}", fixture.name));
            assert_disk_context(diagnostic, fixture, scene_path);
            assert!(!inspected.ok, "fixture {}", fixture.name);

            let described = describe_asset(directory.path(), "asset://player");
            let diagnostic = described
                .diagnostics
                .iter()
                .find(|diagnostic| diagnostic.code == fixture.code)
                .unwrap_or_else(|| panic!("fixture {}: {described:?}", fixture.name));
            assert_disk_context(diagnostic, fixture, scene_path);
            assert!(
                described
                    .value
                    .as_ref()
                    .expect("describe keeps its report with a reference diagnostic")
                    .references
                    .is_empty(),
                "fixture {}",
                fixture.name
            );

            for with_asset_manifest in [false, true] {
                let pack_directory = tempdir().unwrap();
                let pack_paths = write_consumer_project(
                    pack_directory.path(),
                    fixture.text,
                    with_asset_manifest,
                );
                let config_before =
                    fs::read(pack_directory.path().join("project.unone.json")).unwrap();
                let scene_before =
                    fs::read(pack_directory.path().join("scenes/main.scene.json")).unwrap();

                let packed = pack_project(pack_directory.path(), None);
                assert!(!packed.ok, "fixture {}", fixture.name);
                assert_disk_context(
                    &packed.diagnostics[0],
                    fixture,
                    pack_paths.main_scene.as_deref().unwrap(),
                );
                assert_eq!(
                    fs::read(pack_directory.path().join("project.unone.json")).unwrap(),
                    config_before,
                    "fixture {} with_asset_manifest={with_asset_manifest}",
                    fixture.name
                );
                assert_eq!(
                    fs::read(pack_directory.path().join("scenes/main.scene.json")).unwrap(),
                    scene_before,
                    "fixture {} with_asset_manifest={with_asset_manifest}",
                    fixture.name
                );
                assert!(
                    !pack_directory.path().join("bundles/manifest.json").exists(),
                    "invalid scene must not create pack output: {}",
                    fixture.name
                );
            }
        }
    }

    #[test]
    fn typed_runtime_rejects_semantic_negative_fixture_matrix() {
        for fixture in NEGATIVE_SCENE_FIXTURES
            .iter()
            .copied()
            .filter(|fixture| fixture.code != "SCENE_INVALID")
        {
            let scene: SceneFile = serde_json::from_str(fixture.text).unwrap();
            let diagnostic = match EngineRuntime::load_source(
                format!("typed-{}", fixture.name),
                "main.luau",
                "return {}",
                Some(scene),
            ) {
                Ok(_) => panic!("fixture {} unexpectedly loaded", fixture.name),
                Err(diagnostic) => diagnostic,
            };
            assert_eq!(diagnostic.code, fixture.code, "fixture {}", fixture.name);
            assert_eq!(diagnostic.facts["source_kind"], "typed_scene");
            assert_eq!(diagnostic.facts["location_scope"], "typed_value");
            assert!(diagnostic.source.is_none());
            assert!(diagnostic.facts["line"].is_null());
            assert!(diagnostic.facts["column"].is_null());
            match fixture.json_pointer {
                Some(pointer) => assert_eq!(diagnostic.facts["json_pointer"], pointer),
                None => assert!(diagnostic.facts["json_pointer"].is_null()),
            }
        }
    }
}
