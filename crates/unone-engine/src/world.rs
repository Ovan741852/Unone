#[cfg(feature = "dev-tools")]
use crate::scene::parse_scene_file;
use std::collections::BTreeMap;
#[cfg(feature = "dev-tools")]
use std::{fs, path::Path};

use serde::{Deserialize, Serialize, de::Error as DeError, ser::Error as SerError};

use crate::{
    audio::{AudioBus, AudioEvent, AudioLoop, AudioMix},
    diagnostics::Diagnostic,
    scene::validate_typed_scene,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Default for Vec3 {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }
    }
}

/// The typed 2D transform exposed to Luau.
///
/// Scene and snapshot JSON keep `Entity.transform` as the existing `{x, y}`
/// position and store `rotation`/`scale` as additive sibling fields. The
/// aggregate is only the API shape, so existing position-only scripts keep
/// their current data path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Transform2DData {
    #[serde(default)]
    pub position: Vec2,
    /// Visual Euler rotation in radians. Positive rotation is
    /// counter-clockwise in the engine's y-up world.
    #[serde(default)]
    pub rotation: f64,
    /// Visual scale. Both components must be finite and strictly positive;
    /// mirroring through negative scale is not part of this contract.
    #[serde(default = "default_scale2d")]
    pub scale: Vec2,
}

fn default_scale2d() -> Vec2 {
    Vec2 { x: 1.0, y: 1.0 }
}

impl Default for Transform2DData {
    fn default() -> Self {
        Self {
            position: Vec2::default(),
            rotation: 0.0,
            scale: default_scale2d(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Transform3DData {
    #[serde(default)]
    pub position: Vec3,
    /// Euler rotation in radians. The engine stores the transform; game code
    /// owns the meaning of steering and other gameplay-specific orientation.
    #[serde(default)]
    pub rotation: Vec3,
    #[serde(default = "default_scale3d")]
    pub scale: Vec3,
}

fn default_scale3d() -> Vec3 {
    Vec3 {
        x: 1.0,
        y: 1.0,
        z: 1.0,
    }
}

impl Default for Transform3DData {
    fn default() -> Self {
        Self {
            position: Vec3::default(),
            rotation: Vec3::default(),
            scale: default_scale3d(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Mesh3DData {
    pub asset: String,
    #[serde(default = "default_true")]
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Camera3DData {
    #[serde(default = "default_camera3d_position")]
    pub position: Vec3,
    #[serde(default)]
    pub target: Vec3,
    #[serde(default = "default_camera3d_fov")]
    pub fov_degrees: f64,
}

fn default_camera3d_position() -> Vec3 {
    Vec3 {
        x: 0.0,
        y: 3.0,
        z: 8.0,
    }
}

fn default_camera3d_fov() -> f64 {
    60.0
}

impl Default for Camera3DData {
    fn default() -> Self {
        Self {
            position: default_camera3d_position(),
            target: Vec3::default(),
            fov_degrees: default_camera3d_fov(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "lowercase")]
pub enum RigidBodyType {
    #[default]
    Dynamic,
    Static,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct RigidBody2DData {
    #[serde(default)]
    pub body_type: RigidBodyType,
    #[serde(default = "default_mass")]
    pub mass: f64,
    #[serde(default = "default_radius")]
    pub radius: f64,
    #[serde(default)]
    pub velocity: Vec2,
    #[serde(default)]
    pub restitution: f64,
}

fn default_mass() -> f64 {
    1.0
}

fn default_radius() -> f64 {
    0.5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct PhysicsSettings {
    #[serde(default = "default_gravity")]
    pub gravity: Vec2,
    #[serde(default)]
    pub ground_y: Option<f64>,
    /// Velocity lost per second by every dynamic body, as a fraction.
    ///
    /// Defaults to none, which is what this engine simulated before the field
    /// existed: a body keeps its velocity forever unless something takes it.
    #[serde(default)]
    pub linear_damping: f64,
    /// Horizontal velocity lost per second while a body rests on the ground.
    ///
    /// Without it a landed body slides the length of the level, which silently
    /// turns a miss into a hit.
    #[serde(default)]
    pub ground_friction: f64,
}

fn default_gravity() -> Vec2 {
    Vec2 { x: 0.0, y: -9.8 }
}

impl Default for PhysicsSettings {
    fn default() -> Self {
        Self {
            gravity: default_gravity(),
            ground_y: None,
            linear_damping: 0.0,
            ground_friction: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Camera2DData {
    #[serde(default)]
    pub position: Vec2,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    /// World units visible vertically at zoom 1, centred on `position`.
    ///
    /// Without this a host cannot know how much world a frame shows, so every
    /// host invented its own constant and the same scene framed differently in
    /// each one. The visible height is `view_height / zoom`, and the visible
    /// width is that times the host's viewport aspect.
    #[serde(default = "default_view_height")]
    pub view_height: f64,
}

fn default_zoom() -> f64 {
    1.0
}

/// Matches the scale every host had hard-coded before the field existed, so a
/// scene that says nothing keeps the framing it already had.
fn default_view_height() -> f64 {
    10.0
}

impl Default for Camera2DData {
    fn default() -> Self {
        Self {
            position: Vec2::default(),
            zoom: default_zoom(),
            view_height: default_view_height(),
        }
    }
}

/// The runtime's single source of truth for the active camera.
///
/// Orthographic is deliberately a projection of the same Camera concept, not
/// a second camera object. Projection-specific values live together so
/// switching modes does not throw away FOV or orthographic framing, while the
/// old `Camera2DData`/`Camera3DData` types remain boundary adapters for hosts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CameraProjection {
    Orthographic,
    Perspective,
}

#[derive(Debug, Clone)]
pub(crate) struct CameraState {
    pub(crate) projection: CameraProjection,
    pub(crate) position: Vec3,
    pub(crate) target: Vec3,
    pub(crate) fov_degrees: f64,
    pub(crate) orthographic_size: f64,
}

impl Default for CameraState {
    fn default() -> Self {
        Self {
            projection: CameraProjection::Orthographic,
            position: Vec3::default(),
            target: Vec3 {
                x: 0.0,
                y: 0.0,
                z: -1.0,
            },
            fov_degrees: default_camera3d_fov(),
            orthographic_size: default_view_height(),
        }
    }
}

impl CameraState {
    pub(crate) fn from_orthographic(camera: Camera2DData) -> Self {
        Self {
            projection: CameraProjection::Orthographic,
            position: Vec3 {
                x: camera.position.x,
                y: camera.position.y,
                z: 0.0,
            },
            orthographic_size: camera.view_height / camera.zoom.max(f64::EPSILON),
            ..Self::default()
        }
    }

    pub(crate) fn from_perspective(camera: Camera3DData) -> Self {
        Self {
            projection: CameraProjection::Perspective,
            position: camera.position,
            target: camera.target,
            fov_degrees: camera.fov_degrees,
            ..Self::default()
        }
    }

    pub(crate) fn projection_name(&self) -> &'static str {
        match self.projection {
            CameraProjection::Orthographic => "orthographic",
            CameraProjection::Perspective => "perspective",
        }
    }

    pub(crate) fn orthographic_data(&self) -> Camera2DData {
        Camera2DData {
            position: Vec2 {
                x: self.position.x,
                y: self.position.y,
            },
            zoom: default_view_height() / self.orthographic_size.max(f64::EPSILON),
            view_height: default_view_height(),
        }
    }

    pub(crate) fn perspective_data(&self) -> Camera3DData {
        Camera3DData {
            position: self.position,
            target: self.target,
            fov_degrees: self.fov_degrees,
        }
    }
}

impl Default for Vec2 {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "dev-tools", schemars(deny_unknown_fields))]
pub struct SceneFile {
    #[cfg_attr(feature = "dev-tools", schemars(default))]
    pub physics3d: Option<crate::rigid3d::Physics3DScene>,
    #[cfg_attr(feature = "dev-tools", schemars(default))]
    pub particle_effects: BTreeMap<String, crate::ParticleDefinition>,
    #[cfg_attr(feature = "dev-tools", schemars(default))]
    pub entities: Vec<SceneEntity>,
    #[cfg_attr(feature = "dev-tools", schemars(default))]
    pub physics: PhysicsSettings,
    /// The one authoring entry point for the active camera. Legacy 2D and
    /// split `camera3d` input is still accepted by the custom deserializer,
    /// but the generated schema advertises the unified forms first.
    #[cfg_attr(feature = "dev-tools", schemars(default))]
    #[cfg_attr(feature = "dev-tools", schemars(schema_with = "camera_scene_schema"))]
    pub camera: Camera2DData,
    /// Legacy split perspective storage. New source files should put the
    /// projection in `camera`; this field is accepted only for compatibility
    /// and is intentionally omitted by canonical serialization.
    #[cfg_attr(feature = "dev-tools", schemars(default))]
    pub camera3d: Option<Camera3DData>,
}

impl Serialize for SceneFile {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        // Keep source and job payloads on the same single-camera contract.
        // The in-memory split is an adapter for old hosts, not an authoring
        // shape that should leak back into new files.
        let camera = if let Some(camera) = &self.camera3d {
            serde_json::json!({
                "projection": "perspective",
                "position": camera.position,
                "target": camera.target,
                "fovDegrees": camera.fov_degrees,
            })
        } else {
            serde_json::json!({
                "projection": "orthographic",
                "position": {"x": self.camera.position.x, "y": self.camera.position.y, "z": 0.0},
                "orthographicSize": self.camera.view_height / self.camera.zoom,
            })
        };
        let mut object = serde_json::Map::new();
        if let Some(physics3d) = &self.physics3d {
            object.insert("physics3d".into(), serde_json::to_value(physics3d).map_err(S::Error::custom)?);
        }
        if !self.particle_effects.is_empty() {
            object.insert("particle_effects".into(), serde_json::to_value(&self.particle_effects).map_err(S::Error::custom)?);
        }
        object.insert("entities".into(), serde_json::to_value(&self.entities).map_err(S::Error::custom)?);
        object.insert("physics".into(), serde_json::to_value(&self.physics).map_err(S::Error::custom)?);
        object.insert("camera".into(), camera);
        serde_json::Value::Object(object).serialize(serializer)
    }
}

/// Schema for the scene authoring boundary. `SceneFile` stores the two
/// projection backings internally so existing hosts and snapshots stay
/// stable, but a scene author should only have to reason about one Camera.
#[cfg(feature = "dev-tools")]
fn camera_scene_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
    let legacy = generator.subschema_for::<Camera2DData>();
    let vec2 = generator.subschema_for::<Vec2>();
    let vec3 = generator.subschema_for::<Vec3>();
    let number = serde_json::json!({"type": "number", "format": "double"});
    let mut schema = serde_json::json!({
        "description": "Unified Camera authoring. Use projection=orthographic for 2D framing or projection=perspective for 3D. The legacy {position, zoom, view_height} shape remains accepted.",
        "oneOf": [legacy],
    });
    let one_of = schema
        .get_mut("oneOf")
        .and_then(serde_json::Value::as_array_mut)
        .expect("camera schema oneOf");
    one_of.push(serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "description": "Orthographic projection. `orthographicSize` is the visible world height; `position` may be Vec2 or Vec3 (z is ignored).",
        "properties": {
            "projection": {"const": "orthographic", "type": "string"},
            "position": {"anyOf": [vec2.clone(), vec3.clone()]},
            "orthographicSize": number.clone(),
            "orthographic_size": number.clone(),
            "zoom": number.clone(),
            "view_height": number.clone(),
        }
    }));
    one_of.push(serde_json::json!({
        "type": "object",
        "additionalProperties": false,
        "description": "Perspective projection for 3D scenes.",
        "properties": {
            "projection": {"const": "perspective", "type": "string"},
            "position": vec3,
            "target": vec3,
            "fovDegrees": number.clone(),
            "fov_degrees": number,
        },
        "required": ["target"]
    }));
    schemars::Schema::try_from(schema).expect("valid camera schema")
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SceneFileWire {
    #[serde(default)]
    physics3d: Option<crate::rigid3d::Physics3DScene>,
    #[serde(default)]
    particle_effects: BTreeMap<String, crate::ParticleDefinition>,
    #[serde(default)]
    entities: Vec<SceneEntity>,
    #[serde(default)]
    physics: PhysicsSettings,
    #[serde(default)]
    camera: Option<serde_json::Value>,
    #[serde(default)]
    camera3d: Option<Camera3DData>,
}

impl<'de> Deserialize<'de> for SceneFile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = SceneFileWire::deserialize(deserializer)?;
        let (camera, camera3d) = decode_camera_definition(wire.camera, wire.camera3d)
            .map_err(D::Error::custom)?;
        Ok(Self {
            physics3d: wire.physics3d,
            particle_effects: wire.particle_effects,
            entities: wire.entities,
            physics: wire.physics,
            camera,
            camera3d,
        })
    }
}

/// Accept the old split scene fields while making a single `camera` object the
/// authoring contract. This conversion happens once at the scene boundary;
/// the runtime and all hosts continue with one deterministic active mode.
fn decode_camera_definition(
    value: Option<serde_json::Value>,
    legacy_perspective: Option<Camera3DData>,
) -> Result<(Camera2DData, Option<Camera3DData>), String> {
    let Some(value) = value else {
        return Ok((Camera2DData::default(), legacy_perspective));
    };
    let object = value
        .as_object()
        .ok_or("camera must be an object")?;
    const CAMERA_FIELDS: &[&str] = &[
        "projection",
        "position",
        "target",
        "fovDegrees",
        "fov_degrees",
        "orthographicSize",
        "orthographic_size",
        "zoom",
        "view_height",
    ];
    if let Some(field) = object.keys().find(|field| !CAMERA_FIELDS.contains(&field.as_str())) {
        return Err(format!("camera has unknown field '{field}'"));
    }
    let projection_value = object.get("projection");
    let projection = projection_value.and_then(serde_json::Value::as_str);
    if projection_value.is_some() && projection.is_none() {
        return Err("camera.projection must be a string".into());
    }
    let position = object.get("position").cloned().unwrap_or_else(|| {
        serde_json::json!({"x": 0.0, "y": 0.0})
    });
    let position_object = position
        .as_object()
        .ok_or("camera.position must be an object")?;
    let x = number(position_object.get("x"), "camera.position.x")?;
    let y = number(position_object.get("y"), "camera.position.y")?;
    let z = position_object
        .get("z")
        .map(|value| number(Some(value), "camera.position.z"))
        .transpose()?;
    let has_target = object.contains_key("target");
    let has_fov = object.contains_key("fovDegrees") || object.contains_key("fov_degrees");
    let has_orthographic_size =
        object.contains_key("orthographicSize") || object.contains_key("orthographic_size");
    let has_orthographic_legacy =
        object.contains_key("zoom") || object.contains_key("view_height");
    let unified = projection.is_some()
        || has_target
        || has_fov
        || has_orthographic_size
        || z.is_some();
    if !unified {
        let camera: Camera2DData = serde_json::from_value(value)
            .map_err(|error| format!("legacy camera is invalid: {error}"))?;
        return Ok((camera, legacy_perspective));
    }
    // A target/FOV or a 3D position means perspective when the author omits
    // the discriminator. Orthographic remains the safe default for a 2D
    // position and the old zoom/view-height fields.
    let projection = projection.unwrap_or(if has_target
        || has_fov
        || (z.is_some() && !has_orthographic_size && !has_orthographic_legacy)
    {
        "perspective"
    } else {
        "orthographic"
    });
    match projection {
        "orthographic" => {
            if has_target || has_fov {
                return Err(
                    "orthographic camera cannot declare target or fovDegrees; use projection=perspective"
                        .into(),
                );
            }
            let view_height = object
                .get("view_height")
                .map(|value| number(Some(value), "camera.view_height"))
                .transpose()?
                .unwrap_or(default_view_height());
            let size = object
                .get("orthographicSize")
                .or_else(|| object.get("orthographic_size"))
                .map(|value| number(Some(value), "camera.orthographicSize"))
                .transpose()?
                .unwrap_or(view_height);
            if !size.is_finite() || size <= 0.0 {
                return Err("camera.orthographicSize must be finite and greater than 0".into());
            }
            Ok((
                Camera2DData {
                    position: Vec2 { x, y },
                    zoom: view_height / size,
                    view_height,
                },
                None,
            ))
        }
        "perspective" => {
            if has_orthographic_size || has_orthographic_legacy {
                return Err(
                    "perspective camera cannot declare orthographicSize, zoom, or view_height"
                        .into(),
                );
            }
            let target = object
                .get("target")
                .ok_or("perspective camera requires target")?;
            let target = target
                .as_object()
                .ok_or("camera.target must be an object")?;
            let target = Vec3 {
                x: number(target.get("x"), "camera.target.x")?,
                y: number(target.get("y"), "camera.target.y")?,
                z: number(target.get("z"), "camera.target.z")?,
            };
            let fov_degrees = object
                .get("fovDegrees")
                .or_else(|| object.get("fov_degrees"))
                .map(|value| number(Some(value), "camera.fovDegrees"))
                .transpose()?
                .unwrap_or(default_camera3d_fov());
            Ok((
                Camera2DData {
                    position: Vec2 { x, y },
                    ..Camera2DData::default()
                },
                Some(Camera3DData {
                    position: Vec3 {
                        x,
                        y,
                        z: z.unwrap_or(default_camera3d_position().z),
                    },
                    target,
                    fov_degrees,
                }),
            ))
        }
        other => Err(format!(
            "camera.projection must be 'orthographic' or 'perspective', got '{other}'"
        )),
    }
}

fn number(value: Option<&serde_json::Value>, field: &str) -> Result<f64, String> {
    let value = value
        .and_then(serde_json::Value::as_f64)
        .ok_or_else(|| format!("{field} must be a number"))?;
    if !value.is_finite() {
        return Err(format!("{field} must be finite"));
    }
    Ok(value)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SceneEntity {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub transform: Vec2,
    /// Visual-only 2D rotation in radians around the sprite centre.
    #[serde(default)]
    pub rotation: f64,
    /// Visual-only 2D scale applied to the sprite's declared size.
    #[serde(default = "default_scale2d")]
    pub scale: Vec2,
    #[serde(default)]
    pub transform3d: Option<Transform3DData>,
    #[serde(default)]
    pub sprite: Option<SpriteData>,
    #[serde(default)]
    pub mesh3d: Option<Mesh3DData>,
    #[serde(default)]
    pub rigidbody: Option<RigidBody2DData>,
    #[serde(default)]
    pub animation: Option<AnimationData>,
}

/// Skeletal animation state an entity publishes for a host to play.
///
/// The engine stores which clip is selected and since which frame; it does not
/// evaluate bones, meshes or blending. The only declared asset kind for this
/// today is Spine, and the host owns that runtime.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct AnimationData {
    pub asset: String,
    pub animation: String,
    #[serde(default = "default_true", rename = "loop")]
    pub looping: bool,
    #[serde(default = "default_speed")]
    pub speed: f64,
}

fn default_speed() -> f64 {
    1.0
}

/// A game that leaks effect handles should fail loudly, not grow forever.
const MAX_LIVE_EFFECTS: usize = 256;

/// Two bodies that touched during a physics step.
///
/// The solver already computes all of this and used to discard it, so a game
/// could be told nothing about the collision the engine had just resolved. Ids
/// are ordered, so the same pair reads the same way every frame.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Contact {
    pub a: String,
    pub b: String,
    /// Unit normal pointing from `a` towards `b`.
    pub normal: Vec2,
    /// How far the two overlapped before the solver separated them.
    pub penetration: f64,
    /// Impulse the solver applied along the normal. Zero when the pair was
    /// already separating, which is how a resting stack reads.
    pub impulse: f64,
}

/// One live effect instance the game asked a host to play.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EffectInstance {
    pub handle: String,
    pub asset: String,
    pub position: Vec2,
    pub scale: f64,
    pub rotation: f64,
    /// Frame the effect was spawned on, so a host can start it at the right
    /// point after a reload or a late join.
    pub started_frame: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct SpriteData {
    pub asset: String,
    #[serde(default = "default_sprite_size")]
    pub size: Vec2,
    #[serde(default = "default_true")]
    pub visible: bool,
    /// Painter layer. Lower layers are drawn first; same-layer order is the
    /// ascending entity id, which is the portable tie-break used by hosts.
    #[serde(default)]
    pub layer: i32,
}

fn default_sprite_size() -> Vec2 {
    Vec2 { x: 1.0, y: 1.0 }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct EntitySnapshot {
    pub id: String,
    pub name: String,
    pub transform: Vec2,
    pub rotation: f64,
    pub scale: Vec2,
    pub transform3d: Option<Transform3DData>,
    pub sprite: Option<SpriteData>,
    pub mesh3d: Option<Mesh3DData>,
    pub rigidbody: Option<RigidBodySnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub animation: Option<AnimationSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AnimationSnapshot {
    pub asset: String,
    pub animation: String,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub speed: f64,
    pub started_frame: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RigidBodySnapshot {
    pub body_type: RigidBodyType,
    pub mass: f64,
    pub radius: f64,
    pub velocity: Vec2,
    pub restitution: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jobs: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub instances3d: BTreeMap<String, crate::instances3d::InstanceBatch3D>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub physics3d: Option<crate::rigid3d::Snapshot3D>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub particle_effects: BTreeMap<String, crate::ParticleDefinition>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub particles: Vec<crate::ParticleSnapshot>,
    pub frame: u64,
    pub time_seconds: f64,
    pub camera: Camera2DData,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera3d: Option<Camera3DData>,
    pub entities: BTreeMap<String, EntitySnapshot>,
    pub observations: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<crate::ui::UiTree>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<EffectInstance>,
    /// Bodies that touched each other this frame.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contacts: Vec<Contact>,
    /// Bodies resting on or striking the ground plane this frame.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ground_contacts: Vec<String>,
    /// Sounds the game asked for on this frame.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audio_events: Vec<AudioEvent>,
    /// Loops the host should currently be playing.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audio_loops: Vec<AudioLoop>,
    /// Bus levels, present only once the game has moved one off its declared
    /// default. A game that never touches the mix observes what it always did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_mix: Option<AudioMix>,
}

#[derive(Debug, Clone)]
pub(crate) struct EntityState {
    pub id: String,
    pub name: String,
    pub transform: Vec2,
    pub rotation: f64,
    pub scale: Vec2,
    pub transform3d: Option<Transform3DData>,
    pub sprite: Option<SpriteData>,
    pub mesh3d: Option<Mesh3DData>,
    pub rigidbody: Option<RigidBodyState>,
    pub animation: Option<AnimationState>,
}

#[derive(Debug, Clone)]
pub(crate) struct AnimationState {
    pub asset: String,
    pub animation: String,
    pub looping: bool,
    pub speed: f64,
    pub started_frame: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct RigidBodyState {
    pub body_type: RigidBodyType,
    pub mass: f64,
    pub radius: f64,
    pub velocity: Vec2,
    pub restitution: f64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct World {
    pub instances3d: BTreeMap<String, crate::instances3d::InstanceBatch3D>,
    #[cfg(feature = "physics3d")]
    pub physics3d: Option<crate::rigid3d::PhysicsWorld3D>,
    pub particles: crate::particle::ParticleWorld,
    pub frame: u64,
    pub time_seconds: f64,
    pub entities: BTreeMap<String, EntityState>,
    pub physics: PhysicsSettings,
    /// One active camera. Legacy camera fields are derived only when crossing
    /// the scene/snapshot boundary; they are never independently mutable.
    pub camera_state: CameraState,
    pub effects: Vec<EffectInstance>,
    next_effect_handle: u64,
    /// Contacts from the most recent physics step, rebuilt every frame.
    pub contacts: Vec<Contact>,
    pub ground_contacts: Vec<String>,
    pub audio: AudioBus,
}

impl World {
    #[cfg(feature = "dev-tools")]
    pub fn load_scene(&mut self, path: &Path) -> Result<(), Box<Diagnostic>> {
        let text =
            fs::read_to_string(path).map_err(|err| crate::scene::scene_read_failed(path, err))?;
        let scene = parse_scene_file(&text, path)?;
        self.apply_scene(scene);
        Ok(())
    }

    pub(crate) fn load_scene_data(&mut self, scene: SceneFile) -> Result<(), Box<Diagnostic>> {
        validate_typed_scene(&scene)?;
        self.apply_scene(scene);
        Ok(())
    }

    fn apply_scene(&mut self, scene: SceneFile) {
        self.instances3d.clear();
        #[cfg(feature = "physics3d")]
        let physics3d = scene.physics3d;
        self.particles.definitions = scene.particle_effects;
        self.physics = scene.physics;
        self.camera_state = match scene.camera3d {
            Some(camera) => CameraState::from_perspective(camera),
            None => CameraState::from_orthographic(scene.camera),
        };
        for entity in scene.entities {
            let rigidbody = entity.rigidbody.map(|body| RigidBodyState {
                body_type: body.body_type,
                mass: body.mass,
                radius: body.radius,
                velocity: body.velocity,
                restitution: body.restitution,
            });
            self.entities.insert(
                entity.id.clone(),
                EntityState {
                    id: entity.id,
                    name: entity.name,
                    transform: entity.transform,
                    rotation: entity.rotation,
                    scale: entity.scale,
                    transform3d: entity.transform3d,
                    sprite: entity.sprite,
                    mesh3d: entity.mesh3d,
                    animation: entity.animation.map(|animation| AnimationState {
                        asset: animation.asset,
                        animation: animation.animation,
                        looping: animation.looping,
                        speed: animation.speed,
                        started_frame: self.frame,
                    }),
                    rigidbody,
                },
            );
        }
        #[cfg(feature = "physics3d")]
        {
            self.physics3d = physics3d.map(|scene| {
                let mut physics = crate::rigid3d::PhysicsWorld3D::default();
                physics
                    .set_gravity(scene.gravity)
                    .expect("validated gravity");
                for (id, body) in scene.bodies {
                    let transform = self.entities[&id]
                        .transform3d
                        .as_ref()
                        .expect("validated Transform3D");
                    physics
                        .add(
                            id,
                            body,
                            crate::rigid3d::Pose3D {
                                position: transform.position,
                                rotation: transform.rotation,
                            },
                        )
                        .expect("validated body");
                }
                physics
            });
        }
    }

    pub(crate) fn spawn(&mut self, name: &str) -> String {
        let base = if name.is_empty() { "entity" } else { name };
        let mut id = base.to_string();
        let mut index = 2;
        while self.entities.contains_key(&id) {
            id = format!("{base}_{index}");
            index += 1;
        }
        self.entities.insert(
            id.clone(),
            EntityState {
                id: id.clone(),
                name: name.to_string(),
                transform: Vec2::default(),
                rotation: 0.0,
                scale: default_scale2d(),
                transform3d: None,
                sprite: None,
                mesh3d: None,
                rigidbody: None,
                animation: None,
            },
        );
        id
    }

    pub(crate) fn snapshot(&self) -> WorldSnapshot {
        let entities =
            self.entities
                .iter()
                .map(|(id, entity)| {
                    (
                        id.clone(),
                        EntitySnapshot {
                            id: entity.id.clone(),
                            name: entity.name.clone(),
                            transform: Vec2 {
                                x: quantize_observation(entity.transform.x),
                                y: quantize_observation(entity.transform.y),
                            },
                            rotation: quantize_observation(entity.rotation),
                            scale: quantize_vec2(entity.scale),
                            transform3d: entity.transform3d.as_ref().map(|transform| {
                                Transform3DData {
                                    position: quantize_vec3(transform.position),
                                    rotation: quantize_vec3(transform.rotation),
                                    scale: quantize_vec3(transform.scale),
                                }
                            }),
                            sprite: entity.sprite.clone(),
                            mesh3d: entity.mesh3d.clone(),
                            rigidbody: entity.rigidbody.as_ref().map(|body| RigidBodySnapshot {
                                body_type: body.body_type,
                                mass: quantize_observation(body.mass),
                                radius: quantize_observation(body.radius),
                                velocity: Vec2 {
                                    x: quantize_observation(body.velocity.x),
                                    y: quantize_observation(body.velocity.y),
                                },
                                restitution: quantize_observation(body.restitution),
                            }),
                            animation: entity.animation.as_ref().map(|animation| {
                                AnimationSnapshot {
                                    asset: animation.asset.clone(),
                                    animation: animation.animation.clone(),
                                    looping: animation.looping,
                                    speed: quantize_observation(animation.speed),
                                    started_frame: animation.started_frame,
                                }
                            }),
                        },
                    )
                })
                .collect();
        let camera = self.camera_state.orthographic_data();
        let camera = Camera2DData {
            position: Vec2 {
                x: quantize_observation(camera.position.x),
                y: quantize_observation(camera.position.y),
            },
            zoom: quantize_observation(camera.zoom),
            view_height: quantize_observation(camera.view_height),
        };
        let camera3d = (self.camera_state.projection == CameraProjection::Perspective).then(|| {
            let camera = self.camera_state.perspective_data();
            Camera3DData {
                position: quantize_vec3(camera.position),
                target: quantize_vec3(camera.target),
                fov_degrees: quantize_observation(camera.fov_degrees),
            }
        });
        WorldSnapshot {
            jobs: None,
            instances3d: self.instances3d.clone(),
            #[cfg(feature = "physics3d")]
            physics3d: self.physics3d.as_ref().map(|p| p.snapshot()),
            #[cfg(not(feature = "physics3d"))]
            physics3d: None,
            frame: self.frame,
            time_seconds: self.time_seconds,
            camera,
            camera3d,
            entities,
            observations: BTreeMap::new(),
            ui: None,
            particle_effects: self.particles.definitions.clone(),
            #[cfg(feature = "particle")]
            particles: self.particles.snapshot(self.frame),
            #[cfg(not(feature = "particle"))]
            particles: Vec::new(),
            effects: self
                .effects
                .iter()
                .map(|effect| EffectInstance {
                    handle: effect.handle.clone(),
                    asset: effect.asset.clone(),
                    position: Vec2 {
                        x: quantize_observation(effect.position.x),
                        y: quantize_observation(effect.position.y),
                    },
                    scale: quantize_observation(effect.scale),
                    rotation: quantize_observation(effect.rotation),
                    started_frame: effect.started_frame,
                })
                .collect(),
            contacts: self
                .contacts
                .iter()
                .map(|contact| Contact {
                    a: contact.a.clone(),
                    b: contact.b.clone(),
                    normal: Vec2 {
                        x: quantize_observation(contact.normal.x),
                        y: quantize_observation(contact.normal.y),
                    },
                    penetration: quantize_observation(contact.penetration),
                    impulse: quantize_observation(contact.impulse),
                })
                .collect(),
            ground_contacts: self.ground_contacts.clone(),
            audio_events: self
                .audio
                .events
                .iter()
                .map(|event| AudioEvent {
                    volume: quantize_observation(event.volume),
                    speed: quantize_observation(event.speed),
                    position: event.position.map(quantize_vec2),
                    ..event.clone()
                })
                .collect(),
            audio_loops: self
                .audio
                .loops
                .iter()
                .map(|source| AudioLoop {
                    volume: quantize_observation(source.volume),
                    speed: quantize_observation(source.speed),
                    position: source.position.map(quantize_vec2),
                    ..source.clone()
                })
                .collect(),
            audio_mix: {
                let mix = self.audio.mix();
                (!mix.is_default(&self.audio.config)).then(|| AudioMix {
                    master: quantize_observation(mix.master),
                    categories: mix
                        .categories
                        .into_iter()
                        .map(|(name, level)| (name, quantize_observation(level)))
                        .collect(),
                })
            },
        }
    }

    /// Keep entity-attached sounds on their entity for this frame.
    ///
    /// The engine owns this because it owns where entities are; a game that had
    /// to write it would re-read every position every frame and still get the
    /// despawn case wrong.
    pub(crate) fn follow_audio_entities(&mut self) {
        if self
            .audio
            .loops
            .iter()
            .all(|source| source.entity.is_none())
        {
            return;
        }
        let frame = self.frame;
        let entities = &self.entities;
        self.audio
            .follow_entities(frame, |id| entities.get(id).map(|entity| entity.transform));
    }

    /// Remove an entity and everything attached to it.
    ///
    /// `entity.spawn` existed with no counterpart, so "defeated" had to mean
    /// "moved somewhere off screen", which leaves a body still colliding and
    /// still costing a physics step.
    pub(crate) fn despawn(&mut self, id: &str) -> Result<(), String> {
        if self.entities.remove(id).is_none() {
            return Err(format!("Entity '{id}' does not exist; cannot remove it."));
        }
        self.contacts
            .retain(|contact| contact.a != id && contact.b != id);
        self.ground_contacts.retain(|entity| entity != id);
        #[cfg(feature = "physics3d")]
        if let Some(p) = &mut self.physics3d
            && p.contains(id) {
                p.remove(id)?;
        }
        Ok(())
    }

    /// Show or hide an entity's sprite without removing the entity.
    pub(crate) fn set_sprite_visible(&mut self, id: &str, visible: bool) -> Result<(), String> {
        let Some(entity) = self.entities.get_mut(id) else {
            return Err(format!(
                "Entity '{id}' does not exist; cannot set sprite visibility."
            ));
        };
        let Some(sprite) = &mut entity.sprite else {
            return Err(format!("Entity '{id}' has no Sprite to show or hide."));
        };
        sprite.visible = visible;
        Ok(())
    }

    /// Select the animation clip an entity publishes to the host.
    pub(crate) fn play_animation(
        &mut self,
        id: &str,
        animation: &str,
        asset: Option<String>,
        looping: Option<bool>,
        speed: Option<f64>,
    ) -> Result<(), String> {
        let frame = self.frame;
        let Some(entity) = self.entities.get_mut(id) else {
            return Err(format!(
                "Entity '{id}' does not exist; cannot play animation."
            ));
        };
        if animation.trim().is_empty() {
            return Err("Animation name must not be empty.".to_string());
        }
        let speed = speed.unwrap_or(1.0);
        if !speed.is_finite() || speed <= 0.0 {
            return Err("Animation speed must be a finite number greater than 0.".to_string());
        }
        let asset = match (asset, entity.animation.as_ref()) {
            (Some(asset), _) => asset,
            (None, Some(existing)) => existing.asset.clone(),
            (None, None) => {
                return Err(format!(
                    "Entity '{id}' has no animation asset declared by the scene; play must provide an asset."
                ));
            }
        };
        if asset.trim().is_empty() {
            return Err("Animation asset must not be empty.".to_string());
        }
        let looping = looping.unwrap_or(true);
        let unchanged = entity.animation.as_ref().is_some_and(|current| {
            current.asset == asset
                && current.animation == animation
                && current.looping == looping
                && (current.speed - speed).abs() < f64::EPSILON
        });
        if unchanged {
            return Ok(());
        }
        entity.animation = Some(AnimationState {
            asset,
            animation: animation.to_string(),
            looping,
            speed,
            started_frame: frame,
        });
        Ok(())
    }

    pub(crate) fn stop_animation(&mut self, id: &str) -> Result<(), String> {
        let Some(entity) = self.entities.get_mut(id) else {
            return Err(format!(
                "Entity '{id}' does not exist; cannot stop animation."
            ));
        };
        entity.animation = None;
        Ok(())
    }

    /// Register one live effect instance for the host to play.
    pub(crate) fn spawn_effect(
        &mut self,
        asset: &str,
        position: Vec2,
        scale: Option<f64>,
        rotation: Option<f64>,
    ) -> Result<String, String> {
        if asset.trim().is_empty() {
            return Err("Effect asset must not be empty.".to_string());
        }
        let scale = scale.unwrap_or(1.0);
        let rotation = rotation.unwrap_or(0.0);
        if !scale.is_finite() || scale <= 0.0 {
            return Err("Effect scale must be a finite number greater than 0.".to_string());
        }
        if !rotation.is_finite() {
            return Err("Effect rotation must be finite.".to_string());
        }
        if !position.x.is_finite() || !position.y.is_finite() {
            return Err("Effect position must be finite.".to_string());
        }
        if self.effects.len() >= MAX_LIVE_EFFECTS {
            return Err(format!(
                "No more than {MAX_LIVE_EFFECTS} effects may exist at once; stop effects that are no longer needed first."
            ));
        }
        self.next_effect_handle += 1;
        let handle = format!("effect-{}", self.next_effect_handle);
        self.effects.push(EffectInstance {
            handle: handle.clone(),
            asset: asset.to_string(),
            position,
            scale,
            rotation,
            started_frame: self.frame,
        });
        Ok(handle)
    }

    pub(crate) fn stop_effect(&mut self, handle: &str) -> Result<bool, String> {
        let before = self.effects.len();
        self.effects.retain(|effect| effect.handle != handle);
        Ok(self.effects.len() != before)
    }

    pub(crate) fn get_camera_position(&self) -> Vec2 {
        Vec2 {
            x: self.camera_state.position.x,
            y: self.camera_state.position.y,
        }
    }

    pub(crate) fn set_camera_position(&mut self, position: Vec2) -> Result<(), String> {
        validate_vec2(position, "Camera position")
            .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))?;
        self.camera_state.position.x = position.x;
        self.camera_state.position.y = position.y;
        Ok(())
    }

    pub(crate) fn get_camera_zoom(&self) -> f64 {
        default_view_height() / self.camera_state.orthographic_size.max(f64::EPSILON)
    }

    pub(crate) fn set_camera_zoom(&mut self, zoom: f64) -> Result<(), String> {
        if zoom <= 0.0 || !zoom.is_finite() {
            return Err("Camera2D zoom must be a finite number greater than 0.".to_string());
        }
        if self.camera_state.projection != CameraProjection::Orthographic {
            return Err(
                "CAMERA_PROJECTION_INVALID: zoom is only available for orthographic projection"
                    .into(),
            );
        }
        self.camera_state.orthographic_size = default_view_height() / zoom;
        Ok(())
    }

    pub(crate) fn get_transform3d(&self, id: &str) -> Result<Transform3DData, String> {
        let entity = self
            .entities
            .get(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        entity
            .transform3d
            .clone()
            .ok_or_else(|| format!("Entity '{id}' has no Transform3D."))
    }

    pub(crate) fn get_transform2d(&self, id: &str) -> Result<Transform2DData, String> {
        let entity = self
            .entities
            .get(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        Ok(Transform2DData {
            position: entity.transform,
            rotation: entity.rotation,
            scale: entity.scale,
        })
    }

    pub(crate) fn set_position(&mut self, id: &str, position: Vec2) -> Result<(), String> {
        validate_vec2(position, "Entity position")
            .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))?;
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        entity.transform = position;
        Ok(())
    }

    pub(crate) fn set_transform2d(
        &mut self,
        id: &str,
        transform: Transform2DData,
    ) -> Result<(), String> {
        validate_transform2d(
            transform.position,
            transform.rotation,
            transform.scale,
            "Transform2D",
        )
        .map_err(|diagnostic| diagnostic.explanation.clone())?;
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        entity.transform = transform.position;
        entity.rotation = transform.rotation;
        entity.scale = transform.scale;
        Ok(())
    }

    pub(crate) fn set_transform3d(
        &mut self,
        id: &str,
        transform: Transform3DData,
    ) -> Result<(), String> {
        #[cfg(feature = "physics3d")]
        if self.physics3d.as_ref().is_some_and(|p| p.contains(id)) {
            return Err("PHYSICS3D_OWNERSHIP: use physics3d.teleport or moveKinematic for a physics-owned Transform3D".into());
        }
        validate_vec3(transform.position, "Transform3D position")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        validate_vec3(transform.rotation, "Transform3D rotation")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        validate_scale3d(transform.scale).map_err(|diagnostic| diagnostic.explanation.clone())?;
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        if entity.transform3d.is_none() {
            return Err(format!("Entity '{id}' has no Transform3D."));
        }
        entity.transform3d = Some(transform);
        Ok(())
    }

    pub(crate) fn get_camera3d(&self) -> Result<Camera3DData, String> {
        if self.camera_state.projection == CameraProjection::Perspective {
            Ok(self.camera_state.perspective_data())
        } else {
            Err("The current scene has no perspective Camera.".to_string())
        }
    }

    /// The public camera contract is one camera with a projection mode.  The
    /// old `camera`/`camera3d` fields remain as storage adapters for existing
    /// scenes and hosts, but new callers should not need to know that split.
    pub(crate) fn camera_projection(&self) -> &'static str {
        self.camera_state.projection_name()
    }

    pub(crate) fn set_camera_projection(&mut self, projection: &str) -> Result<(), String> {
        match projection {
            "orthographic" => {
                self.camera_state.projection = CameraProjection::Orthographic;
                Ok(())
            }
            "perspective" => {
                if self.camera_state.projection == CameraProjection::Orthographic
                    && self.camera_state.position.z == 0.0
                    && self.camera_state.target.z == -1.0
                {
                    self.camera_state.position.z = default_camera3d_position().z;
                    self.camera_state.target = Vec3 {
                        x: self.camera_state.position.x,
                        y: self.camera_state.position.y,
                        z: 0.0,
                    };
                }
                self.camera_state.projection = CameraProjection::Perspective;
                Ok(())
            }
            other => Err(format!(
                "CAMERA_PROJECTION_INVALID: expected 'orthographic' or 'perspective', got '{other}'"
            )),
        }
    }

    pub(crate) fn camera_orthographic_size(&self) -> f64 {
        self.camera_state.orthographic_size
    }

    pub(crate) fn set_camera_orthographic_size(&mut self, size: f64) -> Result<(), String> {
        if !size.is_finite() || size <= 0.0 {
            return Err(
                "CAMERA_ORTHOGRAPHIC_SIZE_INVALID: size must be finite and greater than 0"
                    .into(),
            );
        }
        if self.camera_state.projection != CameraProjection::Orthographic {
            return Err(
                "CAMERA_PROJECTION_INVALID: orthographicSize is only available for orthographic projection"
                    .into(),
            );
        }
        self.camera_state.orthographic_size = size;
        Ok(())
    }

    #[cfg(feature = "dev-tools")]
    pub(crate) fn set_camera3d(&mut self, camera: Camera3DData) -> Result<(), String> {
        // Reuse scene camera validation rather than a second set of FOV rules.
        crate::scene::validate_typed_scene(&SceneFile {
            camera3d: Some(camera.clone()),
            ..SceneFile::default()
        })
        .map_err(|diagnostic| diagnostic.explanation.clone())?;
        self.set_camera_perspective(camera)
    }

    /// Replace the active perspective projection after runtime/API validation.
    /// This method is intentionally separate from the dev-tools scene editor:
    /// regular Luau can update the active Camera without depending on the
    /// filesystem validation feature.
    pub(crate) fn set_camera_perspective(&mut self, camera: Camera3DData) -> Result<(), String> {
        validate_vec3(camera.position, "Camera position")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        validate_vec3(camera.target, "Camera target")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        if !(1.0..179.0).contains(&camera.fov_degrees) || !camera.fov_degrees.is_finite() {
            return Err(
                "CAMERA_FOV_INVALID: fovDegrees must be finite and between 1 and 179".into(),
            );
        }
        if self.camera_state.projection != CameraProjection::Perspective {
            return Err("The current scene has no perspective Camera.".into());
        }
        self.camera_state.position = camera.position;
        self.camera_state.target = camera.target;
        self.camera_state.fov_degrees = camera.fov_degrees;
        Ok(())
    }

    pub(crate) fn set_camera3d_position(&mut self, position: Vec3) -> Result<(), String> {
        validate_vec3(position, "Camera3D position")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        if self.camera_state.projection != CameraProjection::Perspective {
            return Err("The current scene has no perspective Camera.".to_string());
        }
        self.camera_state.position = position;
        Ok(())
    }

    pub(crate) fn set_camera3d_target(&mut self, target: Vec3) -> Result<(), String> {
        validate_vec3(target, "Camera3D target")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        if self.camera_state.projection != CameraProjection::Perspective {
            return Err("The current scene has no perspective Camera.".to_string());
        }
        self.camera_state.target = target;
        Ok(())
    }

    pub(crate) fn get_velocity(&self, id: &str) -> Result<Vec2, String> {
        let entity = self
            .entities
            .get(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        entity
            .rigidbody
            .as_ref()
            .map(|body| body.velocity)
            .ok_or_else(|| format!("Entity '{id}' has no RigidBody2D."))
    }

    pub(crate) fn set_velocity(&mut self, id: &str, velocity: Vec2) -> Result<(), String> {
        validate_vec2(velocity, "RigidBody2D velocity")
            .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))?;
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        let body = entity
            .rigidbody
            .as_mut()
            .ok_or_else(|| format!("Entity '{id}' has no RigidBody2D."))?;
        body.velocity = velocity;
        Ok(())
    }

    pub(crate) fn apply_impulse(&mut self, id: &str, impulse: Vec2) -> Result<(), String> {
        validate_vec2(impulse, "RigidBody2D impulse")
            .map_err(|diagnostic| format!("{}: {}", diagnostic.code, diagnostic.explanation))?;
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' does not exist."))?;
        let body = entity
            .rigidbody
            .as_mut()
            .ok_or_else(|| format!("Entity '{id}' has no RigidBody2D."))?;
        if body.body_type == RigidBodyType::Static {
            return Err(format!(
                "Entity '{id}' is static and cannot receive an impulse."
            ));
        }
        body.velocity.x += impulse.x / body.mass;
        body.velocity.y += impulse.y / body.mass;
        Ok(())
    }

    #[cfg(feature = "physics2d")]
    pub(crate) fn step_physics(&mut self, dt: f64) {
        self.contacts.clear();
        self.ground_contacts.clear();
        let damping = (1.0 - self.physics.linear_damping * dt).clamp(0.0, 1.0);
        for entity in self.entities.values_mut() {
            let Some(body) = &mut entity.rigidbody else {
                continue;
            };
            if body.body_type == RigidBodyType::Dynamic {
                body.velocity.x += self.physics.gravity.x * dt;
                body.velocity.y += self.physics.gravity.y * dt;
                body.velocity.x *= damping;
                body.velocity.y *= damping;
                entity.transform.x += body.velocity.x * dt;
                entity.transform.y += body.velocity.y * dt;
            }
        }

        if let Some(ground_y) = self.physics.ground_y {
            let friction = (1.0 - self.physics.ground_friction * dt).clamp(0.0, 1.0);
            let mut touched = Vec::new();
            for (id, entity) in self.entities.iter_mut() {
                let Some(body) = &mut entity.rigidbody else {
                    continue;
                };
                if body.body_type == RigidBodyType::Dynamic
                    && entity.transform.y - body.radius < ground_y
                {
                    entity.transform.y = ground_y + body.radius;
                    if body.velocity.y < 0.0 {
                        body.velocity.y = -body.velocity.y * body.restitution;
                        if body.velocity.y.abs() < 0.01 {
                            body.velocity.y = 0.0;
                        }
                    }
                    body.velocity.x *= friction;
                    if body.velocity.x.abs() < 0.01 {
                        body.velocity.x = 0.0;
                    }
                    touched.push(id.clone());
                }
            }
            self.ground_contacts = touched;
        }

        // Visual-only entities cannot collide. Keep them out of the pair list
        // so the common scene case does not pay for O(n²) no-op resolver calls.
        // BTreeMap iteration keeps the candidate order deterministic.
        let mut bodies: Vec<(&String, &mut EntityState)> = self
            .entities
            .iter_mut()
            .filter(|(_, entity)| entity.rigidbody.is_some())
            .collect();
        let circles = bodies
            .iter()
            .map(|(_, entity)| (entity.transform, entity.rigidbody.as_ref().unwrap().radius))
            .collect::<Vec<_>>();
        let mut grid = crate::broadphase::CircleGrid::new(&circles);
        let contacts = &mut self.contacts;
        for left_index in 0..bodies.len() {
            let mut seen = std::collections::BTreeSet::new();
            let mut pending = std::collections::BTreeSet::new();
            grid.extend_candidates(left_index, &mut seen, &mut pending, left_index);
            while let Some(right_index) = pending.pop_first() {
                let (left_slice, right_slice) = bodies.split_at_mut(right_index);
                let (left_id, left_entity) = &mut left_slice[left_index];
                let (right_id, right_entity) = &mut right_slice[0];
                if resolve_circle_pair(left_id, left_entity, right_id, right_entity, contacts) {
                    for index in [left_index, right_index] {
                        let (_, entity) = &bodies[index];
                        grid.update(
                            index,
                            entity.transform,
                            entity.rigidbody.as_ref().unwrap().radius,
                        );
                    }
                    grid.extend_candidates(left_index, &mut seen, &mut pending, right_index);
                }
            }
        }
    }
}

fn resolve_circle_pair(
    left_id: &str,
    left: &mut EntityState,
    right_id: &str,
    right: &mut EntityState,
    contacts: &mut Vec<Contact>,
) -> bool {
    // Ids arrive in sorted order from the caller, so a pair always reads
    // the same way and the contact list stays deterministic.
    let (Some(left_body), Some(right_body)) = (&left.rigidbody, &right.rigidbody) else {
        return false;
    };
    if left_body.body_type == RigidBodyType::Static && right_body.body_type == RigidBodyType::Static
    {
        return false;
    }
    let delta = Vec2 {
        x: right.transform.x - left.transform.x,
        y: right.transform.y - left.transform.y,
    };
    let distance_squared = delta.x * delta.x + delta.y * delta.y;
    let (distance, normal) = if distance_squared <= f64::EPSILON {
        (0.0, Vec2 { x: 1.0, y: 0.0 })
    } else {
        let distance = distance_squared.sqrt();
        (
            distance,
            Vec2 {
                x: delta.x / distance,
                y: delta.y / distance,
            },
        )
    };
    let penetration = left_body.radius + right_body.radius - distance;
    if penetration <= 0.0 {
        return false;
    }

    let left_inverse_mass = if left_body.body_type == RigidBodyType::Dynamic {
        1.0 / left_body.mass
    } else {
        0.0
    };
    let right_inverse_mass = if right_body.body_type == RigidBodyType::Dynamic {
        1.0 / right_body.mass
    } else {
        0.0
    };
    let inverse_mass_sum = left_inverse_mass + right_inverse_mass;
    if inverse_mass_sum <= 0.0 {
        return false;
    }

    let left_velocity = left_body.velocity;
    let right_velocity = right_body.velocity;
    let relative_velocity = Vec2 {
        x: right_velocity.x - left_velocity.x,
        y: right_velocity.y - left_velocity.y,
    };
    let velocity_along_normal = relative_velocity.x * normal.x + relative_velocity.y * normal.y;
    let restitution = (left_body.restitution + right_body.restitution) * 0.5;
    let impulse_magnitude = if velocity_along_normal < 0.0 {
        -(1.0 + restitution) * velocity_along_normal / inverse_mass_sum
    } else {
        0.0
    };
    let correction_magnitude = penetration * 0.8 / inverse_mass_sum;
    let correction = Vec2 {
        x: normal.x * correction_magnitude,
        y: normal.y * correction_magnitude,
    };
    let impulse = Vec2 {
        x: normal.x * impulse_magnitude,
        y: normal.y * impulse_magnitude,
    };

    contacts.push(Contact {
        a: left_id.to_string(),
        b: right_id.to_string(),
        normal,
        penetration,
        impulse: impulse_magnitude,
    });

    if let Some(body) = &mut left.rigidbody
        && body.body_type == RigidBodyType::Dynamic
    {
        left.transform.x -= correction.x * left_inverse_mass;
        left.transform.y -= correction.y * left_inverse_mass;
        body.velocity.x -= impulse.x * left_inverse_mass;
        body.velocity.y -= impulse.y * left_inverse_mass;
    }
    if let Some(body) = &mut right.rigidbody
        && body.body_type == RigidBodyType::Dynamic
    {
        right.transform.x += correction.x * right_inverse_mass;
        right.transform.y += correction.y * right_inverse_mass;
        body.velocity.x += impulse.x * right_inverse_mass;
        body.velocity.y += impulse.y * right_inverse_mass;
    }
    true
}

pub(crate) fn validate_vec3(value: Vec3, label: &str) -> Result<(), Box<Diagnostic>> {
    if !value.x.is_finite() || !value.y.is_finite() || !value.z.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM3D_INVALID",
            "3D coordinates contain a non-finite number",
            format!("{label} x, y, and z must all be finite numbers."),
        )));
    }
    Ok(())
}

pub(crate) fn validate_vec2(value: Vec2, label: &str) -> Result<(), Box<Diagnostic>> {
    if !value.x.is_finite() || !value.y.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "RUNTIME_VEC2_INVALID",
            "2D vector contains a non-finite number",
            format!("{label} x and y must both be finite numbers."),
        )));
    }
    Ok(())
}

pub(crate) fn validate_transform2d(
    position: Vec2,
    rotation: f64,
    scale: Vec2,
    label: &str,
) -> Result<(), Box<Diagnostic>> {
    if !position.x.is_finite() || !position.y.is_finite() || !rotation.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM2D_INVALID",
            "2D Transform contains a non-finite number",
            format!("{label} position x/y and rotation must all be finite numbers."),
        )));
    }
    if scale.x <= 0.0 || scale.y <= 0.0 || !scale.x.is_finite() || !scale.y.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM2D_INVALID",
            "Invalid 2D Transform scale",
            format!("{label} scale x and y must both be finite numbers greater than 0."),
        )));
    }
    Ok(())
}

pub(crate) fn validate_scale3d(scale: Vec3) -> Result<(), Box<Diagnostic>> {
    validate_vec3(scale, "Transform3D scale")?;
    if scale.x <= 0.0 || scale.y <= 0.0 || scale.z <= 0.0 {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM3D_INVALID",
            "Invalid Transform3D scale",
            "Transform3D scale x, y, and z must all be finite numbers greater than 0.",
        )));
    }
    Ok(())
}

fn quantize_vec3(value: Vec3) -> Vec3 {
    Vec3 {
        x: quantize_observation(value.x),
        y: quantize_observation(value.y),
        z: quantize_observation(value.z),
    }
}

fn quantize_vec2(value: Vec2) -> Vec2 {
    Vec2 {
        x: quantize_observation(value.x),
        y: quantize_observation(value.y),
    }
}

fn quantize_observation(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::{
        AudioBus, EntityState, PhysicsSettings, RigidBodyState, RigidBodyType, SceneFile,
        Camera3DData, Transform2DData, Vec2, Vec3, World, resolve_circle_pair,
    };
    use std::collections::BTreeMap;

    fn body(body_type: RigidBodyType, radius: f64) -> RigidBodyState {
        RigidBodyState {
            body_type,
            mass: 1.0,
            radius,
            velocity: Vec2::default(),
            restitution: 0.0,
        }
    }

    fn dynamic_body(velocity: Vec2) -> RigidBodyState {
        RigidBodyState {
            velocity,
            ..body(RigidBodyType::Dynamic, 0.5)
        }
    }

    fn entity(id: &str, x: f64, y: f64, rigidbody: RigidBodyState) -> EntityState {
        EntityState {
            id: id.to_string(),
            name: id.to_string(),
            transform: Vec2 { x, y },
            rotation: 0.0,
            scale: Vec2 { x: 1.0, y: 1.0 },
            transform3d: None,
            sprite: None,
            mesh3d: None,
            rigidbody: Some(rigidbody),
            animation: None,
        }
    }

    fn world_with(entities: BTreeMap<String, EntityState>) -> World {
        World {
            instances3d: BTreeMap::new(),
            physics3d: None,
            frame: 0,
            time_seconds: 0.0,
            entities,
            physics: PhysicsSettings {
                gravity: Vec2 { x: 0.0, y: -9.8 },
                ground_y: Some(0.0),
                linear_damping: 0.0,
                ground_friction: 0.0,
            },
            camera_state: super::CameraState::default(),
            effects: Vec::new(),
            next_effect_handle: 0,
            contacts: Vec::new(),
            ground_contacts: Vec::new(),
            audio: AudioBus::default(),
            particles: crate::particle::ParticleWorld::default(),
        }
    }

    fn brute_pairs(world: &mut World) {
        world.contacts.clear();
        let mut bodies = world.entities.iter_mut().collect::<Vec<_>>();
        for i in 0..bodies.len() {
            for j in i + 1..bodies.len() {
                let (left, right) = bodies.split_at_mut(j);
                let (left_id, left) = &mut left[i];
                let (right_id, right) = &mut right[0];
                resolve_circle_pair(left_id, left, right_id, right, &mut world.contacts);
            }
        }
    }
    #[test]
    fn broadphase_matches_brute_solver_even_after_correction_creates_contacts() {
        for seed in 0..32 {
            let mut entities = BTreeMap::new();
            for i in 0..80 {
                let id = format!("body{i:04}");
                let mut body = dynamic_body(Vec2 {
                    x: (i % 5) as f64 - 2.0,
                    y: (i % 3) as f64 - 1.0,
                });
                body.radius = if i == 3 {
                    8.0
                } else {
                    0.1 + ((i * 13 + seed) % 11) as f64 * 0.12
                };
                if i % 7 == 0 {
                    body.body_type = RigidBodyType::Static;
                }
                entities.insert(
                    id.clone(),
                    entity(
                        &id,
                        ((i * 31 + seed * 17) % 101) as f64 * 0.1 - 5.0,
                        ((i * 43 + seed * 19) % 97) as f64 * 0.1 - 5.0,
                        body,
                    ),
                );
            }
            let mut grid = world_with(entities);
            grid.physics.ground_y = None;
            let mut brute = grid.clone();
            for frame in 0..6 {
                grid.step_physics(0.0);
                brute_pairs(&mut brute);
                for id in grid.entities.keys() {
                    assert_eq!(
                        grid.entities[id].transform, brute.entities[id].transform,
                        "seed={seed} frame={frame} id={id}"
                    );
                    assert_eq!(
                        grid.entities[id].rigidbody.as_ref().unwrap().velocity,
                        brute.entities[id].rigidbody.as_ref().unwrap().velocity
                    );
                }
                assert_eq!(
                    serde_json::to_value(&grid.contacts).unwrap(),
                    serde_json::to_value(&brute.contacts).unwrap()
                );
            }
        }
    }
    #[test]
    #[ignore = "manual release physics-only timing; not an end-to-end FPS claim"]
    fn broadphase_benchmark() {
        for count in [250, 1000, 4000] {
            let mut entities = BTreeMap::new();
            for i in 0..count {
                let id = format!("body{i:05}");
                entities.insert(
                    id.clone(),
                    entity(
                        &id,
                        (i % 100) as f64 * 3.0,
                        (i / 100) as f64 * 3.0,
                        dynamic_body(Vec2::default()),
                    ),
                );
            }
            let mut grid = world_with(entities);
            grid.physics.ground_y = None;
            let mut brute = grid.clone();
            let mut grid_times = Vec::new();
            let mut brute_times = Vec::new();
            for _ in 0..9 {
                let start = std::time::Instant::now();
                grid.step_physics(0.0);
                grid_times.push(start.elapsed().as_secs_f64() * 1000.0);
                let start = std::time::Instant::now();
                brute_pairs(&mut brute);
                brute_times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            grid_times.sort_by(f64::total_cmp);
            brute_times.sort_by(f64::total_cmp);
            println!(
                "{}",
                serde_json::json!({"bodies":count,"layout":"sparse 3-unit lattice, radius 0.5","samples":9,"broadphase_physics_median_ms":grid_times[4],"brute_collision_median_ms":brute_times[4],"brute_pairs":count*(count-1)/2})
            );
        }
    }

    /// The solver already knew every collision; a game just could not be told.
    #[test]
    fn a_resolved_collision_is_published_as_a_contact() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "bird".to_string(),
            entity("bird", 0.0, 1.0, dynamic_body(Vec2 { x: 4.0, y: 0.0 })),
        );
        entities.insert(
            "pig".to_string(),
            entity("pig", 0.8, 1.0, dynamic_body(Vec2::default())),
        );
        let mut world = world_with(entities);
        world.physics.ground_y = None;
        world.step_physics(1.0 / 60.0);

        let contact = world
            .contacts
            .iter()
            .find(|contact| contact.a == "bird" && contact.b == "pig")
            .expect("the pair the solver just separated is reported");
        assert!(contact.penetration > 0.0, "{contact:?}");
        assert!(contact.impulse > 0.0, "an approaching pair carries impulse");
        assert!(contact.normal.x > 0.9, "normal points from a towards b");

        // A separated pair stops being reported rather than lingering.
        world.entities.get_mut("pig").unwrap().transform.x = 40.0;
        world.step_physics(1.0 / 60.0);
        assert!(world.contacts.is_empty(), "{:?}", world.contacts);
    }

    #[test]
    fn ground_friction_stops_a_landed_body_sliding_forever() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "block".to_string(),
            entity("block", 0.0, 0.5, dynamic_body(Vec2 { x: 6.0, y: 0.0 })),
        );
        let mut frictionless = world_with(entities.clone());
        let mut with_friction = world_with(entities);
        with_friction.physics.ground_friction = 8.0;
        for _ in 0..120 {
            frictionless.step_physics(1.0 / 60.0);
            with_friction.step_physics(1.0 / 60.0);
        }
        let sliding = frictionless.entities["block"].transform.x;
        let stopped = with_friction.entities["block"].transform.x;
        assert!(sliding > 10.0, "without friction a body keeps its velocity");
        assert!(
            stopped < sliding * 0.5,
            "friction took the horizontal speed"
        );
        assert!(
            with_friction.ground_contacts.contains(&"block".to_string()),
            "a body resting on the ground is reported"
        );
    }

    #[test]
    fn despawn_removes_the_entity_and_its_contacts() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "bird".to_string(),
            entity("bird", 0.0, 1.0, dynamic_body(Vec2 { x: 4.0, y: 0.0 })),
        );
        entities.insert(
            "pig".to_string(),
            entity("pig", 0.8, 1.0, dynamic_body(Vec2::default())),
        );
        let mut world = world_with(entities);
        world.physics.ground_y = None;
        world.step_physics(1.0 / 60.0);
        assert!(!world.contacts.is_empty());

        world.despawn("pig").unwrap();
        assert!(!world.entities.contains_key("pig"));
        assert!(world.contacts.is_empty(), "{:?}", world.contacts);
        assert_eq!(
            world.despawn("pig").unwrap_err(),
            "Entity 'pig' does not exist; cannot remove it."
        );
    }

    #[test]
    fn dynamic_body_falls_and_stops_on_ground() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "ball".to_string(),
            entity("ball", 0.0, 3.0, body(RigidBodyType::Dynamic, 0.5)),
        );
        let mut world = world_with(entities);

        for _ in 0..120 {
            world.step_physics(1.0 / 60.0);
        }

        let ball = world.entities.get("ball").unwrap();
        assert!((ball.transform.y - 0.5).abs() < 0.000_001);
        assert_eq!(ball.rigidbody.as_ref().unwrap().velocity.y, 0.0);
    }

    #[test]
    fn dynamic_body_resolves_against_static_circle() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "a".to_string(),
            entity("a", 0.0, 0.0, body(RigidBodyType::Dynamic, 0.5)),
        );
        entities.insert(
            "b".to_string(),
            entity("b", 0.75, 0.0, body(RigidBodyType::Static, 0.5)),
        );
        let mut world = world_with(entities);

        world.step_physics(0.0);

        let a = world.entities.get("a").unwrap();
        assert!(a.transform.x < 0.0);
    }

    #[test]
    fn sprite_size_defaults_to_unit_dimensions() {
        let scene: SceneFile = serde_json::from_str(
            r#"{"entities":[{"id":"player","sprite":{"asset":"asset://player"}}]}"#,
        )
        .unwrap();

        let sprite = scene.entities[0].sprite.as_ref().unwrap();
        assert_eq!(sprite.size, Vec2 { x: 1.0, y: 1.0 });
    }

    #[test]
    fn omitted_2d_visual_fields_keep_position_behavior_and_publish_defaults() {
        let scene: SceneFile = serde_json::from_str(
            r#"{"entities":[{"id":"player","transform":{"x":2.0,"y":3.0},"sprite":{"asset":"asset://player"}}]}"#,
        )
        .unwrap();

        assert_eq!(scene.entities[0].transform, Vec2 { x: 2.0, y: 3.0 });
        assert_eq!(scene.entities[0].rotation, 0.0);
        assert_eq!(scene.entities[0].scale, Vec2 { x: 1.0, y: 1.0 });
        assert_eq!(scene.entities[0].sprite.as_ref().unwrap().layer, 0);

        let mut world = World::default();
        world.load_scene_data(scene).unwrap();
        let player = world.snapshot().entities.remove("player").unwrap();

        assert_eq!(player.transform, Vec2 { x: 2.0, y: 3.0 });
        assert_eq!(player.rotation, 0.0);
        assert_eq!(player.scale, Vec2 { x: 1.0, y: 1.0 });
        assert_eq!(player.sprite.as_ref().unwrap().layer, 0);
    }

    #[test]
    fn two_d_visual_fields_are_serialized_and_quantized_without_changing_position() {
        let scene: SceneFile = serde_json::from_value(serde_json::json!({
            "entities": [{
                "id": "player",
                "transform": {"x": 2.0, "y": 3.0},
                "rotation": 1.23456789,
                "scale": {"x": 1.5, "y": 0.75},
                "sprite": {"asset": "asset://player", "layer": -2147483648}
            }]
        }))
        .unwrap();
        let mut world = World::default();
        world.load_scene_data(scene).unwrap();

        let snapshot = world.snapshot();
        let player = snapshot.entities.get("player").unwrap();
        assert_eq!(player.transform, Vec2 { x: 2.0, y: 3.0 });
        assert_eq!(player.rotation, 1.234568);
        assert_eq!(player.scale, Vec2 { x: 1.5, y: 0.75 });
        assert_eq!(player.sprite.as_ref().unwrap().layer, i32::MIN);

        let encoded = serde_json::to_value(snapshot).unwrap();
        assert_eq!(encoded["entities"]["player"]["rotation"], 1.234568);
        assert_eq!(encoded["entities"]["player"]["scale"]["x"], 1.5);
        assert_eq!(
            encoded["entities"]["player"]["sprite"]["layer"],
            -2147483648i64
        );

        let max_layer_scene: SceneFile = serde_json::from_value(serde_json::json!({
            "entities": [{
                "id": "top",
                "sprite": {"asset": "asset://top", "layer": 2147483647}
            }]
        }))
        .unwrap();
        assert_eq!(
            max_layer_scene.entities[0].sprite.as_ref().unwrap().layer,
            i32::MAX
        );
        let out_of_range = serde_json::from_value::<SceneFile>(serde_json::json!({
            "entities": [{
                "id": "invalid",
                "sprite": {"asset": "asset://invalid", "layer": 2147483648i64}
            }]
        }));
        assert!(
            out_of_range.is_err(),
            "layer must remain a portable signed32"
        );
    }

    #[test]
    fn invalid_2d_transform_update_does_not_mutate_entity() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "player".to_string(),
            entity("player", 2.0, 3.0, dynamic_body(Vec2::default())),
        );
        let mut world = world_with(entities);
        let original = Transform2DData {
            position: Vec2 { x: 2.0, y: 3.0 },
            rotation: 0.25,
            scale: Vec2 { x: 1.5, y: 0.75 },
        };
        world.set_transform2d("player", original.clone()).unwrap();

        let invalid = Transform2DData {
            scale: Vec2 { x: 0.0, y: 1.0 },
            ..original.clone()
        };
        let error = world.set_transform2d("player", invalid).unwrap_err();
        assert!(error.contains("scale"), "{error}");
        assert_eq!(world.get_transform2d("player").unwrap(), original);

        let invalid = Transform2DData {
            rotation: f64::NAN,
            ..original.clone()
        };
        let error = world.set_transform2d("player", invalid).unwrap_err();
        assert!(error.contains("rotation"), "{error}");
        assert_eq!(world.get_transform2d("player").unwrap(), original);
    }

    #[test]
    fn non_finite_runtime_vectors_are_rejected_before_world_mutation() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "player".to_string(),
            entity("player", 2.0, 3.0, dynamic_body(Vec2 { x: 4.0, y: 5.0 })),
        );
        let mut world = world_with(entities);
        let original_position = world.get_transform2d("player").unwrap().position;
        let original_velocity = world.get_velocity("player").unwrap();
        let original_camera = world.get_camera_position();

        let error = world
            .set_position(
                "player",
                Vec2 {
                    x: f64::NAN,
                    y: 0.0,
                },
            )
            .unwrap_err();
        assert!(error.contains("RUNTIME_VEC2_INVALID"), "{error}");
        assert_eq!(
            world.get_transform2d("player").unwrap().position,
            original_position
        );

        let error = world
            .set_velocity(
                "player",
                Vec2 {
                    x: f64::INFINITY,
                    y: 0.0,
                },
            )
            .unwrap_err();
        assert!(error.contains("RUNTIME_VEC2_INVALID"), "{error}");
        assert_eq!(world.get_velocity("player").unwrap(), original_velocity);

        let error = world
            .apply_impulse(
                "player",
                Vec2 {
                    x: 0.0,
                    y: f64::NEG_INFINITY,
                },
            )
            .unwrap_err();
        assert!(error.contains("RUNTIME_VEC2_INVALID"), "{error}");
        assert_eq!(world.get_velocity("player").unwrap(), original_velocity);

        let error = world
            .set_camera_position(Vec2 {
                x: f64::NAN,
                y: 1.0,
            })
            .unwrap_err();
        assert!(error.contains("RUNTIME_VEC2_INVALID"), "{error}");
        assert_eq!(world.get_camera_position(), original_camera);
    }

    #[test]
    fn invalid_2d_scene_transform_does_not_pollute_existing_world() {
        let mut world = World::default();
        world
            .load_scene_data(
                serde_json::from_value(serde_json::json!({
                    "physics": {"gravity": {"x": 0.0, "y": -3.0}},
                    "camera": {"position": {"x": 4.0, "y": 5.0}},
                    "entities": [{
                        "id": "player",
                        "transform": {"x": 2.0, "y": 3.0},
                        "sprite": {"asset": "asset://player"}
                    }]
                }))
                .unwrap(),
            )
            .unwrap();
        let before = serde_json::to_value(world.snapshot()).unwrap();

        let error = world
            .load_scene_data(
                serde_json::from_value(serde_json::json!({
                    "physics": {"gravity": {"x": 0.0, "y": -99.0}},
                    "camera": {"position": {"x": 40.0, "y": 50.0}},
                    "entities": [{
                        "id": "bad",
                        "rotation": 0.5,
                        "scale": {"x": 0.0, "y": 1.0},
                        "sprite": {"asset": "asset://bad"}
                    }]
                }))
                .unwrap(),
            )
            .unwrap_err();

        assert_eq!(error.code, "SCENE_TRANSFORM2D_INVALID");
        assert_eq!(serde_json::to_value(world.snapshot()).unwrap(), before);
        assert_eq!(world.physics.gravity, Vec2 { x: 0.0, y: -3.0 });
        assert_eq!(world.get_camera_position(), Vec2 { x: 4.0, y: 5.0 });
        assert!(world.entities.contains_key("player"));
        assert!(!world.entities.contains_key("bad"));
    }

    #[test]
    fn camera_projection_switch_keeps_one_state_and_preserves_mode_settings() {
        let mut world = World::default();
        world
            .set_camera_position(Vec2 { x: 4.0, y: 5.0 })
            .unwrap();
        world.set_camera_orthographic_size(6.0).unwrap();
        world.set_camera_projection("perspective").unwrap();
        world
            .set_camera_perspective(Camera3DData {
                position: Vec3 {
                    x: 4.0,
                    y: 5.0,
                    z: 12.0,
                },
                target: Vec3 {
                    x: 4.0,
                    y: 5.0,
                    z: 0.0,
                },
                fov_degrees: 48.0,
            })
            .unwrap();

        world.set_camera_projection("orthographic").unwrap();
        assert_eq!(world.camera_projection(), "orthographic");
        assert_eq!(world.camera_orthographic_size(), 6.0);
        assert_eq!(world.get_camera_position(), Vec2 { x: 4.0, y: 5.0 });

        world.set_camera_projection("perspective").unwrap();
        assert_eq!(world.camera_projection(), "perspective");
        assert_eq!(world.get_camera3d().unwrap().fov_degrees, 48.0);
        assert_eq!(world.get_camera3d().unwrap().position.z, 12.0);
    }

    #[test]
    fn visual_transform_does_not_change_physics_position_velocity_or_contacts() {
        let mut entities = BTreeMap::new();
        entities.insert(
            "bird".to_string(),
            entity("bird", 0.0, 1.0, dynamic_body(Vec2 { x: 4.0, y: 0.0 })),
        );
        entities.insert(
            "pig".to_string(),
            entity("pig", 0.8, 1.0, dynamic_body(Vec2::default())),
        );

        let mut baseline = world_with(entities.clone());
        baseline.physics.ground_y = Some(0.0);
        let mut visual_only = world_with(entities);
        visual_only.physics.ground_y = Some(0.0);
        visual_only.entities.get_mut("bird").unwrap().rotation = 1.25;
        visual_only.entities.get_mut("bird").unwrap().scale = Vec2 { x: 2.0, y: 0.5 };
        visual_only.entities.get_mut("pig").unwrap().rotation = -0.75;
        visual_only.entities.get_mut("pig").unwrap().scale = Vec2 { x: 0.75, y: 1.75 };

        let mut saw_contact = false;
        let mut saw_ground_contact = false;
        for frame in 0..120 {
            baseline.step_physics(1.0 / 60.0);
            visual_only.step_physics(1.0 / 60.0);

            saw_contact |= !baseline.contacts.is_empty();
            saw_ground_contact |= !baseline.ground_contacts.is_empty();
            assert_eq!(
                visual_only.contacts, baseline.contacts,
                "contacts at frame {frame}"
            );
            assert_eq!(
                visual_only.ground_contacts, baseline.ground_contacts,
                "ground contacts at frame {frame}"
            );
            for id in ["bird", "pig"] {
                let expected = &baseline.entities[id];
                let actual = &visual_only.entities[id];
                assert_eq!(
                    actual.transform, expected.transform,
                    "position for {id} at frame {frame}"
                );
                assert_eq!(
                    actual.rigidbody.as_ref().unwrap().velocity,
                    expected.rigidbody.as_ref().unwrap().velocity,
                    "velocity for {id} at frame {frame}"
                );
            }
        }
        assert!(
            saw_contact,
            "the regression must exercise an entity contact"
        );
        assert!(
            saw_ground_contact,
            "the regression must exercise a ground contact"
        );
        assert_ne!(
            visual_only.snapshot().entities["bird"].rotation,
            baseline.snapshot().entities["bird"].rotation
        );
        assert_ne!(
            visual_only.snapshot().entities["bird"].scale,
            baseline.snapshot().entities["bird"].scale
        );
    }

    #[test]
    fn invalid_sprite_size_is_rejected_with_semantic_diagnostic() {
        let scene: SceneFile = serde_json::from_str(
            r#"{"entities":[{"id":"player","sprite":{"asset":"asset://player","size":{"x":0.0,"y":1.0}}}]}"#,
        )
        .unwrap();
        let mut world = World::default();

        let diagnostic = world.load_scene_data(scene).unwrap_err();

        assert_eq!(diagnostic.code, "SCENE_SPRITE_INVALID");
        assert!(diagnostic.explanation.contains("Sprite size"));
        assert!(diagnostic.explanation.contains("greater than 0"));
    }

    #[test]
    fn loads_minimal_3d_scene_and_exposes_quantized_snapshot() {
        let scene: SceneFile = serde_json::from_value(serde_json::json!({
            "camera3d": {
                "position": {"x": 0, "y": 3, "z": 8},
                "target": {"x": 0, "y": 0, "z": 0},
                "fov_degrees": 60
            },
            "entities": [{
                "id": "car",
                "transform3d": {
                    "position": {"x": 1.23456789, "y": 0, "z": -2},
                    "rotation": {"x": 0, "y": 0.25, "z": 0},
                    "scale": {"x": 1, "y": 0.5, "z": 2}
                },
                "mesh3d": {"asset": "mesh://car"}
            }]
        }))
        .unwrap();
        let mut world = World::default();

        world.load_scene_data(scene).unwrap();

        let snapshot = world.snapshot();
        let car = snapshot.entities.get("car").unwrap();
        assert_eq!(car.transform3d.as_ref().unwrap().position.x, 1.234568);
        assert_eq!(car.mesh3d.as_ref().unwrap().asset, "mesh://car");
        assert_eq!(snapshot.camera3d.as_ref().unwrap().fov_degrees, 60.0);
    }

    #[test]
    fn rejects_invalid_3d_scale_with_semantic_diagnostic() {
        let scene: SceneFile = serde_json::from_value(serde_json::json!({
            "entities": [{
                "id": "car",
                "transform3d": {
                    "position": {"x": 0, "y": 0, "z": 0},
                    "rotation": {"x": 0, "y": 0, "z": 0},
                    "scale": {"x": 0, "y": 1, "z": 1}
                }
            }]
        }))
        .unwrap();
        let mut world = World::default();

        let diagnostic = world.load_scene_data(scene).unwrap_err();

        assert_eq!(diagnostic.code, "SCENE_TRANSFORM3D_INVALID");
        assert!(diagnostic.explanation.contains("scale x, y, and z"));
    }
}
