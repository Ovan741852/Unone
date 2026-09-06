use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{
    diagnostics::Diagnostic,
    scene::{parse_scene_file, validate_typed_scene},
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
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
#[serde(deny_unknown_fields)]
pub struct Mesh3DData {
    pub asset: String,
    #[serde(default = "default_true")]
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
#[serde(rename_all = "lowercase")]
pub enum RigidBodyType {
    #[default]
    Dynamic,
    Static,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl Default for Vec2 {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneFile {
    #[serde(default)]
    pub entities: Vec<SceneEntity>,
    #[serde(default)]
    pub physics: PhysicsSettings,
    #[serde(default)]
    pub camera: Camera2DData,
    #[serde(default)]
    pub camera3d: Option<Camera3DData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Default)]
pub(crate) struct World {
    pub frame: u64,
    pub time_seconds: f64,
    pub entities: BTreeMap<String, EntityState>,
    pub physics: PhysicsSettings,
    pub camera: Camera2DData,
    pub camera3d: Option<Camera3DData>,
    pub effects: Vec<EffectInstance>,
    next_effect_handle: u64,
    /// Contacts from the most recent physics step, rebuilt every frame.
    pub contacts: Vec<Contact>,
    pub ground_contacts: Vec<String>,
}

impl World {
    pub fn load_scene(&mut self, path: &Path) -> Result<(), Box<Diagnostic>> {
        let text = fs::read_to_string(path).map_err(|err| {
            crate::scene::scene_read_failed(path, err)
        })?;
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
        self.physics = scene.physics;
        self.camera = scene.camera;
        self.camera3d = scene.camera3d;
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
        WorldSnapshot {
            frame: self.frame,
            time_seconds: self.time_seconds,
            camera: Camera2DData {
                position: Vec2 {
                    x: quantize_observation(self.camera.position.x),
                    y: quantize_observation(self.camera.position.y),
                },
                zoom: quantize_observation(self.camera.zoom),
                view_height: quantize_observation(self.camera.view_height),
            },
            camera3d: self.camera3d.as_ref().map(|camera| Camera3DData {
                position: quantize_vec3(camera.position),
                target: quantize_vec3(camera.target),
                fov_degrees: quantize_observation(camera.fov_degrees),
            }),
            entities,
            observations: BTreeMap::new(),
            ui: None,
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
        }
    }

    /// Remove an entity and everything attached to it.
    ///
    /// `entity.spawn` existed with no counterpart, so "defeated" had to mean
    /// "moved somewhere off screen", which leaves a body still colliding and
    /// still costing a physics step.
    pub(crate) fn despawn(&mut self, id: &str) -> Result<(), String> {
        if self.entities.remove(id).is_none() {
            return Err(format!("Entity '{id}' 不存在，無法移除。"));
        }
        self.contacts
            .retain(|contact| contact.a != id && contact.b != id);
        self.ground_contacts.retain(|entity| entity != id);
        Ok(())
    }

    /// Show or hide an entity's sprite without removing the entity.
    pub(crate) fn set_sprite_visible(&mut self, id: &str, visible: bool) -> Result<(), String> {
        let Some(entity) = self.entities.get_mut(id) else {
            return Err(format!("Entity '{id}' 不存在，無法設定 sprite 可見性。"));
        };
        let Some(sprite) = &mut entity.sprite else {
            return Err(format!("Entity '{id}' 沒有 Sprite 可以顯示或隱藏。"));
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
            return Err(format!("Entity '{id}' 不存在，無法播放動畫。"));
        };
        if animation.trim().is_empty() {
            return Err("animation 名稱不可為空。".to_string());
        }
        let speed = speed.unwrap_or(1.0);
        if !speed.is_finite() || speed <= 0.0 {
            return Err("animation speed 必須是大於 0 的有限數字。".to_string());
        }
        let asset = match (asset, entity.animation.as_ref()) {
            (Some(asset), _) => asset,
            (None, Some(existing)) => existing.asset.clone(),
            (None, None) => {
                return Err(format!(
                    "Entity '{id}' 沒有 scene 宣告的 animation asset，play 必須提供 asset。"
                ));
            }
        };
        if asset.trim().is_empty() {
            return Err("animation asset 不可為空。".to_string());
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
            return Err(format!("Entity '{id}' 不存在，無法停止動畫。"));
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
            return Err("effect asset 不可為空。".to_string());
        }
        let scale = scale.unwrap_or(1.0);
        let rotation = rotation.unwrap_or(0.0);
        if !scale.is_finite() || scale <= 0.0 {
            return Err("effect scale 必須是大於 0 的有限數字。".to_string());
        }
        if !rotation.is_finite() {
            return Err("effect rotation 必須是有限數字。".to_string());
        }
        if !position.x.is_finite() || !position.y.is_finite() {
            return Err("effect position 必須是有限數字。".to_string());
        }
        if self.effects.len() >= MAX_LIVE_EFFECTS {
            return Err(format!(
                "同時存在的 effect 不可超過 {MAX_LIVE_EFFECTS} 個；請先停止不再需要的 effect。"
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
        self.camera.position
    }

    pub(crate) fn set_camera_position(&mut self, position: Vec2) {
        self.camera.position = position;
    }

    pub(crate) fn get_camera_zoom(&self) -> f64 {
        self.camera.zoom
    }

    pub(crate) fn set_camera_zoom(&mut self, zoom: f64) -> Result<(), String> {
        if zoom <= 0.0 || !zoom.is_finite() {
            return Err("Camera2D zoom 必須是大於 0 的有限數字。".to_string());
        }
        self.camera.zoom = zoom;
        Ok(())
    }

    pub(crate) fn get_transform3d(&self, id: &str) -> Result<Transform3DData, String> {
        let entity = self
            .entities
            .get(id)
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
        entity
            .transform3d
            .clone()
            .ok_or_else(|| format!("Entity '{id}' 沒有 Transform3D。"))
    }

    pub(crate) fn get_transform2d(&self, id: &str) -> Result<Transform2DData, String> {
        let entity = self
            .entities
            .get(id)
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
        Ok(Transform2DData {
            position: entity.transform,
            rotation: entity.rotation,
            scale: entity.scale,
        })
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
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
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
        validate_vec3(transform.position, "Transform3D position")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        validate_vec3(transform.rotation, "Transform3D rotation")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        validate_scale3d(transform.scale).map_err(|diagnostic| diagnostic.explanation.clone())?;
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
        if entity.transform3d.is_none() {
            return Err(format!("Entity '{id}' 沒有 Transform3D。"));
        }
        entity.transform3d = Some(transform);
        Ok(())
    }

    pub(crate) fn get_camera3d(&self) -> Result<Camera3DData, String> {
        self.camera3d
            .clone()
            .ok_or_else(|| "目前 scene 沒有 Camera3D。".to_string())
    }

    pub(crate) fn set_camera3d_position(&mut self, position: Vec3) -> Result<(), String> {
        validate_vec3(position, "Camera3D position")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        let camera = self
            .camera3d
            .as_mut()
            .ok_or_else(|| "目前 scene 沒有 Camera3D。".to_string())?;
        camera.position = position;
        Ok(())
    }

    pub(crate) fn set_camera3d_target(&mut self, target: Vec3) -> Result<(), String> {
        validate_vec3(target, "Camera3D target")
            .map_err(|diagnostic| diagnostic.explanation.clone())?;
        let camera = self
            .camera3d
            .as_mut()
            .ok_or_else(|| "目前 scene 沒有 Camera3D。".to_string())?;
        camera.target = target;
        Ok(())
    }

    pub(crate) fn get_velocity(&self, id: &str) -> Result<Vec2, String> {
        let entity = self
            .entities
            .get(id)
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
        entity
            .rigidbody
            .as_ref()
            .map(|body| body.velocity)
            .ok_or_else(|| format!("Entity '{id}' 沒有 RigidBody2D。"))
    }

    pub(crate) fn set_velocity(&mut self, id: &str, velocity: Vec2) -> Result<(), String> {
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
        let body = entity
            .rigidbody
            .as_mut()
            .ok_or_else(|| format!("Entity '{id}' 沒有 RigidBody2D。"))?;
        body.velocity = velocity;
        Ok(())
    }

    pub(crate) fn apply_impulse(&mut self, id: &str, impulse: Vec2) -> Result<(), String> {
        let entity = self
            .entities
            .get_mut(id)
            .ok_or_else(|| format!("Entity '{id}' 不存在。"))?;
        let body = entity
            .rigidbody
            .as_mut()
            .ok_or_else(|| format!("Entity '{id}' 沒有 RigidBody2D。"))?;
        if body.body_type == RigidBodyType::Static {
            return Err(format!("Entity '{id}' 是 static，不能施加 impulse。"));
        }
        body.velocity.x += impulse.x / body.mass;
        body.velocity.y += impulse.y / body.mass;
        Ok(())
    }

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

        let ids: Vec<String> = self.entities.keys().cloned().collect();
        for left_index in 0..ids.len() {
            for right_index in (left_index + 1)..ids.len() {
                self.resolve_circle_collision(&ids[left_index], &ids[right_index]);
            }
        }
    }

    fn resolve_circle_collision(&mut self, left_id: &str, right_id: &str) {
        // Ids arrive in sorted order from the caller, so a pair always reads
        // the same way and the contact list stays deterministic.
        let Some(left) = self.entities.get(left_id) else {
            return;
        };
        let Some(right) = self.entities.get(right_id) else {
            return;
        };
        let (Some(left_body), Some(right_body)) = (&left.rigidbody, &right.rigidbody) else {
            return;
        };
        if left_body.body_type == RigidBodyType::Static
            && right_body.body_type == RigidBodyType::Static
        {
            return;
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
            return;
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
            return;
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

        self.contacts.push(Contact {
            a: left_id.to_string(),
            b: right_id.to_string(),
            normal,
            penetration,
            impulse: impulse_magnitude,
        });

        if let Some(left) = self.entities.get_mut(left_id)
            && let Some(body) = &mut left.rigidbody
            && body.body_type == RigidBodyType::Dynamic
        {
            left.transform.x -= correction.x * left_inverse_mass;
            left.transform.y -= correction.y * left_inverse_mass;
            body.velocity.x -= impulse.x * left_inverse_mass;
            body.velocity.y -= impulse.y * left_inverse_mass;
        }
        if let Some(right) = self.entities.get_mut(right_id)
            && let Some(body) = &mut right.rigidbody
            && body.body_type == RigidBodyType::Dynamic
        {
            right.transform.x += correction.x * right_inverse_mass;
            right.transform.y += correction.y * right_inverse_mass;
            body.velocity.x += impulse.x * right_inverse_mass;
            body.velocity.y += impulse.y * right_inverse_mass;
        }
    }
}

pub(crate) fn validate_vec3(value: Vec3, label: &str) -> Result<(), Box<Diagnostic>> {
    if !value.x.is_finite() || !value.y.is_finite() || !value.z.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM3D_INVALID",
            "3D 座標含有非有限數字",
            format!("{label} 的 x、y、z 必須都是有限數字。"),
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
            "2D Transform 含有非有限數字",
            format!("{label} 的 position x/y 與 rotation 必須都是有限數字。"),
        )));
    }
    if scale.x <= 0.0 || scale.y <= 0.0 || !scale.x.is_finite() || !scale.y.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM2D_INVALID",
            "2D Transform 的 scale 無效",
            format!("{label} scale 的 x、y 必須都是大於 0 的有限數字。"),
        )));
    }
    Ok(())
}

pub(crate) fn validate_scale3d(scale: Vec3) -> Result<(), Box<Diagnostic>> {
    validate_vec3(scale, "Transform3D scale")?;
    if scale.x <= 0.0 || scale.y <= 0.0 || scale.z <= 0.0 {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM3D_INVALID",
            "Transform3D 的 scale 無效",
            "Transform3D scale 的 x、y、z 必須都是大於 0 的有限數字。",
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
        EntityState, PhysicsSettings, RigidBodyState, RigidBodyType, SceneFile, Transform2DData,
        Vec2, World,
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
            frame: 0,
            time_seconds: 0.0,
            entities,
            physics: PhysicsSettings {
                gravity: Vec2 { x: 0.0, y: -9.8 },
                ground_y: Some(0.0),
                linear_damping: 0.0,
                ground_friction: 0.0,
            },
            camera: super::Camera2DData::default(),
            camera3d: None,
            effects: Vec::new(),
            next_effect_handle: 0,
            contacts: Vec::new(),
            ground_contacts: Vec::new(),
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
        assert!(stopped < sliding * 0.5, "friction took the horizontal speed");
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
            "Entity 'pig' 不存在，無法移除。"
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
        assert_eq!(world.camera.position, Vec2 { x: 4.0, y: 5.0 });
        assert!(world.entities.contains_key("player"));
        assert!(!world.entities.contains_key("bad"));
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
            assert_eq!(visual_only.contacts, baseline.contacts, "contacts at frame {frame}");
            assert_eq!(
                visual_only.ground_contacts,
                baseline.ground_contacts,
                "ground contacts at frame {frame}"
            );
            for id in ["bird", "pig"] {
                let expected = &baseline.entities[id];
                let actual = &visual_only.entities[id];
                assert_eq!(actual.transform, expected.transform, "position for {id} at frame {frame}");
                assert_eq!(
                    actual.rigidbody.as_ref().unwrap().velocity,
                    expected.rigidbody.as_ref().unwrap().velocity,
                    "velocity for {id} at frame {frame}"
                );
            }
        }
        assert!(saw_contact, "the regression must exercise an entity contact");
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
        assert!(
            diagnostic
                .explanation
                .contains("Sprite size 必須是 x、y 都大於 0")
        );
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
        assert!(diagnostic.explanation.contains("scale 的 x、y、z"));
    }
}
