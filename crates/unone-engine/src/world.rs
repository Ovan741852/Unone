use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::diagnostics::Diagnostic;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
pub struct Mesh3DData {
    pub asset: String,
    #[serde(default = "default_true")]
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
pub struct PhysicsSettings {
    #[serde(default = "default_gravity")]
    pub gravity: Vec2,
    #[serde(default)]
    pub ground_y: Option<f64>,
}

fn default_gravity() -> Vec2 {
    Vec2 { x: 0.0, y: -9.8 }
}

impl Default for PhysicsSettings {
    fn default() -> Self {
        Self {
            gravity: default_gravity(),
            ground_y: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Camera2DData {
    #[serde(default)]
    pub position: Vec2,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

fn default_zoom() -> f64 {
    1.0
}

impl Default for Camera2DData {
    fn default() -> Self {
        Self {
            position: Vec2::default(),
            zoom: default_zoom(),
        }
    }
}

impl Default for Vec2 {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct SceneEntity {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub transform: Vec2,
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
pub struct SpriteData {
    pub asset: String,
    #[serde(default = "default_sprite_size")]
    pub size: Vec2,
    #[serde(default = "default_true")]
    pub visible: bool,
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
}

#[derive(Debug, Clone)]
pub(crate) struct EntityState {
    pub id: String,
    pub name: String,
    pub transform: Vec2,
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
}

impl World {
    pub fn load_scene(&mut self, path: &Path) -> Result<(), Box<Diagnostic>> {
        let text = fs::read_to_string(path).map_err(|err| {
            Box::new(Diagnostic::error(
                "SCENE_READ_FAILED",
                "無法讀取主場景",
                format!("{}：{}", path.display(), err),
            ))
        })?;
        let scene: SceneFile = serde_json::from_str(&text).map_err(|err| {
            Box::new(Diagnostic::error(
                "SCENE_INVALID",
                "主場景不是有效的 Unone scene JSON",
                format!("{}：{}", path.display(), err),
            ))
        })?;
        self.load_scene_data(scene)
    }

    pub(crate) fn load_scene_data(&mut self, scene: SceneFile) -> Result<(), Box<Diagnostic>> {
        self.physics = scene.physics;
        if scene.camera.zoom <= 0.0 || !scene.camera.zoom.is_finite() {
            return Err(Box::new(Diagnostic::error(
                "SCENE_CAMERA_INVALID",
                "Camera2D 的 zoom 無效",
                "Camera2D zoom 必須是大於 0 的有限數字。",
            )));
        }
        if let Some(camera3d) = &scene.camera3d {
            validate_vec3(camera3d.position, "Camera3D position")?;
            validate_vec3(camera3d.target, "Camera3D target")?;
            if !(1.0..179.0).contains(&camera3d.fov_degrees) || !camera3d.fov_degrees.is_finite() {
                return Err(Box::new(Diagnostic::error(
                    "SCENE_CAMERA3D_INVALID",
                    "Camera3D 的 fov_degrees 無效",
                    "Camera3D fov_degrees 必須是大於 1 且小於 179 的有限數字。",
                )));
            }
        }
        self.camera = scene.camera;
        self.camera3d = scene.camera3d;
        for entity in scene.entities {
            if let Some(transform3d) = &entity.transform3d {
                validate_vec3(transform3d.position, "Transform3D position")?;
                validate_vec3(transform3d.rotation, "Transform3D rotation")?;
                validate_scale3d(transform3d.scale)?;
            }
            if let Some(mesh3d) = &entity.mesh3d
                && mesh3d.asset.trim().is_empty()
            {
                return Err(Box::new(Diagnostic::error(
                    "SCENE_MESH3D_INVALID",
                    "Mesh3D 的 asset 無效",
                    format!("Entity '{}' 的 Mesh3D asset 不可為空。", entity.id),
                )));
            }
            if let Some(sprite) = &entity.sprite
                && (sprite.size.x <= 0.0
                    || sprite.size.y <= 0.0
                    || !sprite.size.x.is_finite()
                    || !sprite.size.y.is_finite())
            {
                return Err(Box::new(Diagnostic::error(
                    "SCENE_SPRITE_INVALID",
                    "Sprite 的 size 無效",
                    format!(
                        "Entity '{}' 的 Sprite size 必須是 x、y 都大於 0 的有限數字。",
                        entity.id
                    ),
                )));
            }
            let rigidbody = entity.rigidbody.map(|body| {
                if body.mass <= 0.0 || !body.mass.is_finite() {
                    return Err(Box::new(Diagnostic::error(
                        "SCENE_PHYSICS_INVALID",
                        "RigidBody2D 的 mass 無效",
                        format!("Entity '{}' 的 mass 必須是大於 0 的有限數字。", entity.id),
                    )));
                }
                if body.radius <= 0.0 || !body.radius.is_finite() {
                    return Err(Box::new(Diagnostic::error(
                        "SCENE_PHYSICS_INVALID",
                        "RigidBody2D 的 radius 無效",
                        format!("Entity '{}' 的 radius 必須是大於 0 的有限數字。", entity.id),
                    )));
                }
                if !body.restitution.is_finite() || !(0.0..=1.0).contains(&body.restitution) {
                    return Err(Box::new(Diagnostic::error(
                        "SCENE_PHYSICS_INVALID",
                        "RigidBody2D 的 restitution 無效",
                        format!("Entity '{}' 的 restitution 必須介於 0 與 1。", entity.id),
                    )));
                }
                Ok(RigidBodyState {
                    body_type: body.body_type,
                    mass: body.mass,
                    radius: body.radius,
                    velocity: body.velocity,
                    restitution: body.restitution,
                })
            });
            let rigidbody = match rigidbody {
                Some(Ok(body)) => Some(body),
                Some(Err(diagnostic)) => return Err(diagnostic),
                None => None,
            };
            self.entities.insert(
                entity.id.clone(),
                EntityState {
                    id: entity.id,
                    name: entity.name,
                    transform: entity.transform,
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
        Ok(())
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
        }
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
        for entity in self.entities.values_mut() {
            let Some(body) = &mut entity.rigidbody else {
                continue;
            };
            if body.body_type == RigidBodyType::Dynamic {
                body.velocity.x += self.physics.gravity.x * dt;
                body.velocity.y += self.physics.gravity.y * dt;
                entity.transform.x += body.velocity.x * dt;
                entity.transform.y += body.velocity.y * dt;
            }
        }

        if let Some(ground_y) = self.physics.ground_y {
            for entity in self.entities.values_mut() {
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
                }
            }
        }

        let ids: Vec<String> = self.entities.keys().cloned().collect();
        for left_index in 0..ids.len() {
            for right_index in (left_index + 1)..ids.len() {
                self.resolve_circle_collision(&ids[left_index], &ids[right_index]);
            }
        }
    }

    fn resolve_circle_collision(&mut self, left_id: &str, right_id: &str) {
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

fn validate_vec3(value: Vec3, label: &str) -> Result<(), Box<Diagnostic>> {
    if !value.x.is_finite() || !value.y.is_finite() || !value.z.is_finite() {
        return Err(Box::new(Diagnostic::error(
            "SCENE_TRANSFORM3D_INVALID",
            "3D 座標含有非有限數字",
            format!("{label} 的 x、y、z 必須都是有限數字。"),
        )));
    }
    Ok(())
}

fn validate_scale3d(scale: Vec3) -> Result<(), Box<Diagnostic>> {
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

fn quantize_observation(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::{
        EntityState, PhysicsSettings, RigidBodyState, RigidBodyType, SceneFile, Vec2, World,
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

    fn entity(id: &str, x: f64, y: f64, rigidbody: RigidBodyState) -> EntityState {
        EntityState {
            id: id.to_string(),
            name: id.to_string(),
            transform: Vec2 { x, y },
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
            },
            camera: super::Camera2DData::default(),
            camera3d: None,
            effects: Vec::new(),
            next_effect_handle: 0,
        }
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
