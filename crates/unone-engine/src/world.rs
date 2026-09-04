use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::diagnostics::Diagnostic;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneEntity {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub transform: Vec2,
    #[serde(default)]
    pub sprite: Option<SpriteData>,
    #[serde(default)]
    pub rigidbody: Option<RigidBody2DData>,
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
    pub sprite: Option<SpriteData>,
    pub rigidbody: Option<RigidBodySnapshot>,
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
    pub entities: BTreeMap<String, EntitySnapshot>,
    pub observations: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<crate::ui::UiTree>,
}

#[derive(Debug, Clone)]
pub(crate) struct EntityState {
    pub id: String,
    pub name: String,
    pub transform: Vec2,
    pub sprite: Option<SpriteData>,
    pub rigidbody: Option<RigidBodyState>,
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
        self.camera = scene.camera;
        for entity in scene.entities {
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
                    sprite: entity.sprite,
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
                sprite: None,
                rigidbody: None,
            },
        );
        id
    }

    pub(crate) fn snapshot(&self) -> WorldSnapshot {
        let entities = self
            .entities
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
                        sprite: entity.sprite.clone(),
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
            entities,
            observations: BTreeMap::new(),
            ui: None,
        }
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
            sprite: None,
            rigidbody: Some(rigidbody),
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
}
