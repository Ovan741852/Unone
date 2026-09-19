//! Seeded, fixed-frame 3D particles. Definitions are data; no host clock or script eval.
use crate::Vec3;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

fn validate_particle_vector(value: Vec3) -> Result<(), String> {
    if [value.x, value.y, value.z]
        .iter()
        .all(|n| n.is_finite() && n.abs() <= 1.0e9)
    {
        Ok(())
    } else {
        Err("PARTICLE_VECTOR_INVALID: finite coordinates within +/- 1e9 required".into())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ParticleSpriteShape {
    #[default]
    SoftCircle,
    Diamond,
    Ring,
    Streak,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ParticleEmissionShape {
    Point,
    #[default]
    Box,
    Sphere,
    Ring,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ParticleVelocityMode {
    #[default]
    Vector,
    Cone,
    Radial,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ParticleEasing {
    #[default]
    Linear,
    EaseIn,
    EaseOut,
    SmoothStep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ParticleDefinition {
    pub version: u32,
    pub duration_frames: u32,
    pub emitters: Vec<ParticleEmitter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct ParticleEmitter {
    pub id: String,
    pub count: u32,
    #[serde(default)]
    pub start_delay_frames: u32,
    pub interval_frames: u32,
    pub lifetime_frames: u32,
    #[serde(default)]
    pub spread: Vec3,
    #[serde(default)]
    pub emission_shape: ParticleEmissionShape,
    #[serde(default)]
    pub emission_radius: f64,
    #[serde(default)]
    pub velocity_min: Vec3,
    #[serde(default)]
    pub velocity_max: Vec3,
    #[serde(default)]
    pub velocity_mode: ParticleVelocityMode,
    #[serde(default)]
    pub direction: Vec3,
    #[serde(default)]
    pub cone_angle_degrees: f64,
    #[serde(default)]
    pub speed_min: f64,
    #[serde(default)]
    pub speed_max: f64,
    #[serde(default)]
    pub gravity: Vec3,
    pub size_start: f64,
    pub size_end: f64,
    #[serde(default)]
    pub size_easing: ParticleEasing,
    pub color_start: [f64; 4],
    pub color_end: [f64; 4],
    #[serde(default)]
    pub color_easing: ParticleEasing,
    #[serde(default)]
    pub rotation_start: f64,
    #[serde(default)]
    pub rotation_end: f64,
    #[serde(default)]
    pub angular_velocity: f64,
    #[serde(default)]
    pub sprite_shape: ParticleSpriteShape,
    #[serde(default)]
    pub additive: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParticleSnapshot {
    pub id: String,
    pub instance: String,
    pub emitter: String,
    pub position: Vec3,
    pub size: f64,
    pub color: [f64; 4],
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rotation: f64,
    #[serde(default, skip_serializing_if = "is_soft_circle")]
    pub sprite_shape: ParticleSpriteShape,
    pub additive: bool,
}

fn is_zero(value: &f64) -> bool {
    *value == 0.0
}

fn is_soft_circle(value: &ParticleSpriteShape) -> bool {
    *value == ParticleSpriteShape::SoftCircle
}

#[derive(Debug, Clone)]
struct Instance {
    definition: ParticleDefinition,
    position: Vec3,
    origins: Option<Vec<Vec3>>,
    /// Position samples are game-authored by `api.particle.move`; each birth
    /// keeps the world position at its emission frame, leaving older particles behind.
    path: Vec<(u64, Vec3)>,
    /// `finish` truncates future births but lets all already-born particles fade.
    emission_frames: Option<u32>,
    seed: u64,
    started: u64,
}
impl Instance {
    fn emission_frames(&self) -> u32 {
        self.emission_frames
            .unwrap_or(self.definition.duration_frames)
            .min(self.definition.duration_frames)
    }
    fn reserved_particles(&self) -> u64 {
        self.definition.capacity_for(self.emission_frames())
            * self.origins.as_ref().map_or(1, |v| v.len() as u64)
    }
    fn max_lifetime(&self) -> u64 {
        self.definition
            .emitters
            .iter()
            .map(|e| u64::from(e.lifetime_frames))
            .max()
            .unwrap_or(0)
    }
    fn position_at(&self, frame: u64) -> Vec3 {
        self.path
            .iter()
            .rev()
            .find(|(at, _)| *at <= frame)
            .map_or(self.position, |(_, position)| *position)
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ParticleWorld {
    pub definitions: BTreeMap<String, ParticleDefinition>,
    live: BTreeMap<String, Instance>,
    next: u64,
}

impl ParticleDefinition {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.duration_frames == 0
            || self.duration_frames > 3600
            || self.emitters.is_empty()
            || self.emitters.len() > 16
        {
            return Err(
                "PARTICLE_DEFINITION_INVALID: version=1, duration 1..3600, emitters 1..16 required"
                    .into(),
            );
        }
        let mut ids = BTreeSet::new();
        for e in &self.emitters {
            if e.id.trim().is_empty()
                || !ids.insert(&e.id)
                || e.count == 0
                || e.start_delay_frames > 3600
                || e.interval_frames == 0
                || e.lifetime_frames == 0
                || e.lifetime_frames > 3600
            {
                return Err("PARTICLE_DEFINITION_INVALID: unique emitter IDs and positive count/interval/lifetime required".into());
            }
            for v in [
                e.spread,
                e.velocity_min,
                e.velocity_max,
                e.gravity,
                e.direction,
            ] {
                validate_particle_vector(v)?;
            }
            let scalar_values = [
                e.emission_radius,
                e.cone_angle_degrees,
                e.speed_min,
                e.speed_max,
                e.size_start,
                e.size_end,
                e.rotation_start,
                e.rotation_end,
                e.angular_velocity,
            ];
            if scalar_values
                .iter()
                .any(|v| !v.is_finite() || v.abs() > 1.0e9)
                || e.emission_radius < 0.0
                || e.cone_angle_degrees < 0.0
                || e.cone_angle_degrees > 180.0
                || e.speed_min < 0.0
                || e.speed_max < e.speed_min
                || e.size_start < 0.0
                || e.size_end < 0.0
                || e.size_start > 1000.0
                || e.size_end > 1000.0
                || e.spread.x < 0.0
                || e.spread.y < 0.0
                || e.spread.z < 0.0
                || e.velocity_min.x > e.velocity_max.x
                || e.velocity_min.y > e.velocity_max.y
                || e.velocity_min.z > e.velocity_max.z
                || (e.velocity_mode == ParticleVelocityMode::Cone
                    && vector_length(e.direction) <= f64::EPSILON)
                || !e
                    .color_start
                    .iter()
                    .chain(&e.color_end)
                    .all(|n| n.is_finite() && (0.0..=1.0).contains(n))
            {
                return Err("PARTICLE_DEFINITION_INVALID: invalid shape, direction, velocity, curve endpoints or RGBA".into());
            }
        }
        if self.capacity() > 1024 {
            return Err(
                "PARTICLE_CAPACITY: an effect may emit at most 1024 particles per play".into(),
            );
        }
        Ok(())
    }
    fn capacity_for(&self, duration_frames: u32) -> u64 {
        self.emitters
            .iter()
            .map(|e| {
                u64::from(e.count)
                    * u64::from(
                        duration_frames
                            .saturating_sub(e.start_delay_frames)
                            .div_ceil(e.interval_frames.max(1)),
                    )
            })
            .sum()
    }
    fn capacity(&self) -> u64 {
        self.capacity_for(self.duration_frames)
    }
    /// Pure sampling supports deterministic frame scrubbing without advancing a game.
    pub fn sample(
        &self,
        seed: u64,
        age: u64,
        position: Vec3,
    ) -> Result<Vec<ParticleSnapshot>, String> {
        self.validate()?;
        validate_particle_vector(position)?;
        Ok(sample(
            self,
            seed,
            age,
            self.duration_frames,
            |_| position,
            "preview",
        ))
    }
}

impl ParticleWorld {
    fn reserved_particles(&self) -> u64 {
        self.live.values().map(Instance::reserved_particles).sum()
    }
    fn insert(
        &mut self,
        definition: ParticleDefinition,
        seed: u64,
        frame: u64,
        position: Vec3,
        origins: Option<Vec<Vec3>>,
    ) -> String {
        self.next += 1;
        let handle = format!("particle-{}", self.next);
        let path = if origins.is_none() {
            vec![(frame, position)]
        } else {
            Vec::new()
        };
        self.live.insert(
            handle.clone(),
            Instance {
                definition,
                position,
                origins,
                path,
                emission_frames: None,
                seed,
                started: frame,
            },
        );
        handle
    }
    pub fn play(
        &mut self,
        effect: &str,
        position: Vec3,
        seed: u64,
        frame: u64,
    ) -> Result<String, String> {
        validate_particle_vector(position)?;
        let definition = self
            .definitions
            .get(effect)
            .ok_or_else(|| format!("PARTICLE_NOT_FOUND: {effect}"))?
            .clone();
        definition.validate()?;
        if self.live.len() >= 64 || self.reserved_particles() + definition.capacity() > 4096 {
            return Err("PARTICLE_CAPACITY: world budget exceeded; stop existing effects".into());
        }
        Ok(self.insert(definition, seed, frame, position, None))
    }
    pub fn play_batch(
        &mut self,
        effect: &str,
        origins: Vec<Vec3>,
        seed: u64,
        frame: u64,
    ) -> Result<String, String> {
        if origins.is_empty() || origins.len() > 4096 {
            return Err("PARTICLE_BATCH_INVALID: 1..4096 positions required".into());
        }
        for &position in &origins {
            validate_particle_vector(position)?;
        }
        let definition = self
            .definitions
            .get(effect)
            .ok_or_else(|| format!("PARTICLE_NOT_FOUND: {effect}"))?
            .clone();
        definition.validate()?;
        if self.live.len() >= 64
            || self.reserved_particles() + definition.capacity() * origins.len() as u64 > 4096
        {
            return Err("PARTICLE_CAPACITY: world budget exceeded; stop existing effects".into());
        }
        Ok(self.insert(definition, seed, frame, Vec3::default(), Some(origins)))
    }
    /// Move the emission origin. Existing particles keep their birth positions.
    pub fn move_to(&mut self, handle: &str, position: Vec3, frame: u64) -> Result<bool, String> {
        validate_particle_vector(position)?;
        let Some(instance) = self.live.get_mut(handle) else {
            return Ok(false);
        };
        if instance.origins.is_some() {
            return Ok(false);
        }
        if frame < instance.started {
            return Err("PARTICLE_FRAME_INVALID: move precedes play".into());
        }
        if let Some((last_frame, _)) = instance.path.last() {
            if frame < *last_frame {
                return Err("PARTICLE_FRAME_INVALID: move frames must be monotonic".into());
            }
            if frame == *last_frame {
                if let Some(last) = instance.path.last_mut() {
                    last.1 = position;
                }
                return Ok(true);
            }
        }
        instance.path.push((frame, position));
        Ok(true)
    }
    /// Stop future births while existing samples complete their authored lifetime.
    pub fn finish(&mut self, handle: &str, frame: u64) -> bool {
        let Some(instance) = self.live.get_mut(handle) else {
            return false;
        };
        let age = frame.saturating_sub(instance.started).saturating_add(1);
        let until = (age.min(u64::from(instance.definition.duration_frames))) as u32;
        instance.emission_frames = Some(instance.emission_frames().min(until));
        true
    }
    pub fn stats(&self, frame: u64) -> serde_json::Value {
        serde_json::json!({"active_handles":self.live.len(),"max_handles":64,"reserved_particles":self.reserved_particles(),"max_particles":4096,"live_particles":self.snapshot(frame).len()})
    }
    pub fn stop(&mut self, handle: &str) -> bool {
        self.live.remove(handle).is_some()
    }
    pub fn advance(&mut self, frame: u64) {
        self.live.retain(|_, instance| {
            let emission = u64::from(instance.emission_frames());
            frame.saturating_sub(instance.started) < emission + instance.max_lifetime()
        });
    }
    pub fn snapshot(&self, frame: u64) -> Vec<ParticleSnapshot> {
        self.live
            .iter()
            .flat_map(|(handle, instance)| {
                let age = frame.saturating_sub(instance.started);
                if let Some(origins) = &instance.origins {
                    origins
                        .iter()
                        .enumerate()
                        .flat_map(|(index, &origin)| {
                            let mut particles = sample(
                                &instance.definition,
                                instance.seed.wrapping_add(index as u64),
                                age,
                                instance.emission_frames(),
                                |_| origin,
                                &format!("{handle}:{index}"),
                            );
                            for particle in &mut particles {
                                particle.instance = handle.clone();
                            }
                            particles
                        })
                        .collect::<Vec<_>>()
                } else {
                    sample(
                        &instance.definition,
                        instance.seed,
                        age,
                        instance.emission_frames(),
                        |born| instance.position_at(instance.started + born),
                        handle,
                    )
                }
            })
            .collect()
    }
}

fn unit(seed: u64, emitter: &str, index: u64, channel: u64) -> f64 {
    let mut n =
        seed ^ index.wrapping_mul(0x9e3779b97f4a7c15) ^ channel.wrapping_mul(0xd6e8feb86659fd93);
    for b in emitter.bytes() {
        n = (n ^ u64::from(b)).wrapping_mul(1099511628211);
    }
    n = (n ^ (n >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    n = (n ^ (n >> 27)).wrapping_mul(0x94d049bb133111eb);
    n ^= n >> 31;
    (n >> 11) as f64 / 9007199254740992.0
}
fn q(v: f64) -> f64 {
    (v * 1_000_000.0).round() / 1_000_000.0
}
fn vector_length(v: Vec3) -> f64 {
    (v.x * v.x + v.y * v.y + v.z * v.z).sqrt()
}
fn normalize(v: Vec3) -> Vec3 {
    let length = vector_length(v);
    if length <= f64::EPSILON {
        Vec3::default()
    } else {
        Vec3 {
            x: v.x / length,
            y: v.y / length,
            z: v.z / length,
        }
    }
}
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    Vec3 {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    }
}
fn eased(easing: ParticleEasing, t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    match easing {
        ParticleEasing::Linear => t,
        ParticleEasing::EaseIn => t * t,
        ParticleEasing::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
        ParticleEasing::SmoothStep => t * t * (3.0 - 2.0 * t),
    }
}
fn sphere_direction(seed: u64, emitter: &str, index: u64, channel: u64) -> Vec3 {
    let y = unit(seed, emitter, index, channel) * 2.0 - 1.0;
    let angle = unit(seed, emitter, index, channel + 1) * std::f64::consts::TAU;
    let radius = (1.0 - y * y).max(0.0).sqrt();
    Vec3 {
        x: radius * angle.cos(),
        y,
        z: radius * angle.sin(),
    }
}
fn offset(e: &ParticleEmitter, seed: u64, index: u64) -> Vec3 {
    let random = |channel| unit(seed, &e.id, index, channel) * 2.0 - 1.0;
    match e.emission_shape {
        ParticleEmissionShape::Point => Vec3::default(),
        ParticleEmissionShape::Box => Vec3 {
            x: random(0) * e.spread.x,
            y: random(1) * e.spread.y,
            z: random(2) * e.spread.z,
        },
        ParticleEmissionShape::Sphere => {
            let direction = sphere_direction(seed, &e.id, index, 0);
            let radius = unit(seed, &e.id, index, 2).cbrt() * e.emission_radius;
            Vec3 {
                x: direction.x * radius,
                y: direction.y * radius,
                z: direction.z * radius,
            }
        }
        ParticleEmissionShape::Ring => {
            let angle = unit(seed, &e.id, index, 0) * std::f64::consts::TAU;
            Vec3 {
                x: angle.cos() * e.emission_radius,
                y: random(1) * e.spread.y,
                z: angle.sin() * e.emission_radius,
            }
        }
    }
}
fn velocity(e: &ParticleEmitter, seed: u64, index: u64, offset: Vec3) -> Vec3 {
    match e.velocity_mode {
        ParticleVelocityMode::Vector => {
            let axis = |n, min, max| min + (max - min) * unit(seed, &e.id, index, n);
            Vec3 {
                x: axis(3, e.velocity_min.x, e.velocity_max.x),
                y: axis(4, e.velocity_min.y, e.velocity_max.y),
                z: axis(5, e.velocity_min.z, e.velocity_max.z),
            }
        }
        ParticleVelocityMode::Radial => {
            let direction = if vector_length(offset) > f64::EPSILON {
                normalize(offset)
            } else {
                sphere_direction(seed, &e.id, index, 6)
            };
            let speed = e.speed_min + (e.speed_max - e.speed_min) * unit(seed, &e.id, index, 9);
            Vec3 {
                x: direction.x * speed,
                y: direction.y * speed,
                z: direction.z * speed,
            }
        }
        ParticleVelocityMode::Cone => {
            let axis = normalize(e.direction);
            let reference = if axis.y.abs() < 0.999 {
                Vec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                }
            } else {
                Vec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                }
            };
            let tangent = normalize(cross(axis, reference));
            let bitangent = cross(axis, tangent);
            let angle = unit(seed, &e.id, index, 10) * std::f64::consts::TAU;
            let cos_min = e.cone_angle_degrees.to_radians().cos();
            let cos_theta = 1.0 - unit(seed, &e.id, index, 11) * (1.0 - cos_min);
            let sin_theta = (1.0 - cos_theta * cos_theta).max(0.0).sqrt();
            let direction = Vec3 {
                x: axis.x * cos_theta
                    + (tangent.x * angle.cos() + bitangent.x * angle.sin()) * sin_theta,
                y: axis.y * cos_theta
                    + (tangent.y * angle.cos() + bitangent.y * angle.sin()) * sin_theta,
                z: axis.z * cos_theta
                    + (tangent.z * angle.cos() + bitangent.z * angle.sin()) * sin_theta,
            };
            let speed = e.speed_min + (e.speed_max - e.speed_min) * unit(seed, &e.id, index, 9);
            Vec3 {
                x: direction.x * speed,
                y: direction.y * speed,
                z: direction.z * speed,
            }
        }
    }
}
fn sample<F>(
    d: &ParticleDefinition,
    seed: u64,
    age: u64,
    emission_frames: u32,
    origin_at: F,
    handle: &str,
) -> Vec<ParticleSnapshot>
where
    F: Fn(u64) -> Vec3,
{
    let mut result = Vec::new();
    let mut emitters = d.emitters.iter().collect::<Vec<_>>();
    emitters.sort_by(|a, b| a.id.cmp(&b.id));
    for e in emitters {
        for born in (u64::from(e.start_delay_frames)..u64::from(emission_frames))
            .step_by(e.interval_frames as usize)
        {
            if born > age || age - born >= u64::from(e.lifetime_frames) {
                continue;
            }
            let t = (age - born) as f64 / 60.0;
            let normalized = (age - born) as f64 / f64::from(e.lifetime_frames);
            let size_t = eased(e.size_easing, normalized);
            let color_t = eased(e.color_easing, normalized);
            let origin = origin_at(born);
            for j in 0..u64::from(e.count) {
                let index = born * u64::from(e.count) + j;
                let initial = offset(e, seed, index);
                let v = velocity(e, seed, index, initial);
                let at = |p: f64, speed: f64, gravity: f64, base: f64| {
                    q(base + p + speed * t + 0.5 * gravity * t * t)
                };
                result.push(ParticleSnapshot {
                    id: format!("{handle}/{}/{index}", e.id),
                    instance: handle.into(),
                    emitter: e.id.clone(),
                    position: Vec3 {
                        x: at(initial.x, v.x, e.gravity.x, origin.x),
                        y: at(initial.y, v.y, e.gravity.y, origin.y),
                        z: at(initial.z, v.z, e.gravity.z, origin.z),
                    },
                    size: q(e.size_start + (e.size_end - e.size_start) * size_t),
                    color: std::array::from_fn(|i| {
                        q(e.color_start[i] + (e.color_end[i] - e.color_start[i]) * color_t)
                    }),
                    rotation: q(e.rotation_start
                        + (e.rotation_end - e.rotation_start) * size_t
                        + e.angular_velocity * t),
                    sprite_shape: e.sprite_shape,
                    additive: e.additive,
                });
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn definition() -> ParticleDefinition {
        serde_json::from_str(include_str!("../../../tests/fixtures/spark.particle.json")).unwrap()
    }
    #[test]
    fn batch_origins_are_bounded_atomic_and_share_a_handle() {
        let mut world = ParticleWorld::default();
        world.definitions.insert("spark".into(), definition());
        let h = world
            .play_batch(
                "spark",
                vec![
                    Vec3::default(),
                    Vec3 {
                        x: 10.,
                        y: 0.,
                        z: 0.,
                    },
                ],
                42,
                0,
            )
            .unwrap();
        let a = world.snapshot(1);
        let b = world.snapshot(1);
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(&b).unwrap()
        );
        assert!(a.iter().all(|p| p.instance == h));
        let ids: BTreeSet<_> = a.iter().map(|p| &p.id).collect();
        assert_eq!(ids.len(), a.len());
        assert!(
            world
                .play_batch(
                    "spark",
                    vec![Vec3 {
                        x: f64::NAN,
                        y: 0.,
                        z: 0.
                    }],
                    0,
                    0
                )
                .is_err()
        );
        assert!(
            world
                .play_batch("spark", vec![Vec3::default(); 4096], 0, 0)
                .is_err()
        );
        assert_eq!(world.stats(1)["active_handles"], 1);
        assert!(world.stop(&h));
        assert_eq!(world.stats(1)["reserved_particles"], 0);
    }
    #[test]
    fn sampling_is_seeded_seekable_and_backward_compatible() {
        let d = definition();
        let a = d.sample(7, 15, Vec3::default()).unwrap();
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(d.sample(7, 15, Vec3::default()).unwrap()).unwrap()
        );
        assert_ne!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(d.sample(8, 15, Vec3::default()).unwrap()).unwrap()
        );
        let first = serde_json::to_value(&a[0]).unwrap();
        assert!(first.get("rotation").is_none());
        assert!(first.get("sprite_shape").is_none());
        assert!(d.sample(7, 9999, Vec3::default()).unwrap().is_empty());
        assert_eq!(a.len(), 24);
    }
    #[test]
    fn cone_shapes_curves_rotation_and_sprite_shapes_are_sampled() {
        let mut d = definition();
        d.duration_frames = 1;
        let e = &mut d.emitters[0];
        e.count = 12;
        e.interval_frames = 1;
        e.lifetime_frames = 100;
        e.emission_shape = ParticleEmissionShape::Point;
        e.velocity_mode = ParticleVelocityMode::Cone;
        e.direction = Vec3 {
            x: 1.,
            y: 0.,
            z: 0.,
        };
        e.cone_angle_degrees = 0.;
        e.speed_min = 2.;
        e.speed_max = 2.;
        e.gravity = Vec3::default();
        e.size_start = 0.;
        e.size_end = 10.;
        e.size_easing = ParticleEasing::EaseOut;
        e.color_start = [0., 0., 0., 1.];
        e.color_end = [1., 1., 1., 0.];
        e.color_easing = ParticleEasing::SmoothStep;
        e.rotation_start = 0.2;
        e.rotation_end = 1.;
        e.angular_velocity = 0.5;
        e.sprite_shape = ParticleSpriteShape::Diamond;
        let p = d.sample(42, 30, Vec3::default()).unwrap();
        assert_eq!(p.len(), 12);
        for v in &p {
            assert!((v.position.x - 1.0).abs() < 0.00001);
            assert!(v.position.y.abs() < 0.00001 && v.position.z.abs() < 0.00001);
            assert!((v.size - 5.1).abs() < 0.00001);
            assert!((v.color[0] - 0.216).abs() < 0.001);
            assert!((v.rotation - (0.2 + 0.8 * 0.51 + 0.5 * 0.5)).abs() < 0.00001);
            assert_eq!(v.sprite_shape, ParticleSpriteShape::Diamond);
        }
    }
    #[test]
    fn sphere_and_ring_emitters_stay_inside_authored_shapes() {
        let mut d = definition();
        d.duration_frames = 1;
        {
            let e = &mut d.emitters[0];
            e.count = 96;
            e.interval_frames = 1;
            e.lifetime_frames = 60;
            e.velocity_min = Vec3::default();
            e.velocity_max = Vec3::default();
            e.gravity = Vec3::default();
            e.emission_shape = ParticleEmissionShape::Sphere;
            e.emission_radius = 2.;
        }
        let sphere = d.sample(42, 0, Vec3::default()).unwrap();
        assert!(sphere.iter().all(|p| vector_length(p.position) <= 2.00001));
        {
            let e = &mut d.emitters[0];
            e.emission_shape = ParticleEmissionShape::Ring;
            e.emission_radius = 3.;
        }
        let ring = d.sample(42, 0, Vec3::default()).unwrap();
        assert!(ring.iter().all(|p| {
            (p.position.x * p.position.x + p.position.z * p.position.z - 9.0).abs() < 0.00001
        }));
    }
    #[test]
    fn emitter_delay_stages_authored_effect_phases() {
        let mut d = definition();
        d.duration_frames = 40;
        let emitter = &mut d.emitters[0];
        emitter.count = 1;
        emitter.interval_frames = 12;
        emitter.start_delay_frames = 12;
        emitter.lifetime_frames = 60;
        emitter.spread = Vec3::default();
        emitter.velocity_min = Vec3::default();
        emitter.velocity_max = Vec3::default();
        emitter.gravity = Vec3::default();

        assert!(d.sample(7, 11, Vec3::default()).unwrap().is_empty());
        assert_eq!(d.sample(7, 12, Vec3::default()).unwrap().len(), 1);
        assert_eq!(d.sample(7, 24, Vec3::default()).unwrap().len(), 2);
    }
    #[test]
    fn followed_emitter_leaves_particles_behind_and_finish_keeps_the_fade() {
        let mut d = definition();
        d.duration_frames = 10;
        let e = &mut d.emitters[0];
        e.count = 1;
        e.interval_frames = 1;
        e.lifetime_frames = 20;
        e.spread = Vec3::default();
        e.velocity_min = Vec3::default();
        e.velocity_max = Vec3::default();
        e.gravity = Vec3::default();
        let mut world = ParticleWorld::default();
        world.definitions.insert("trail".into(), d);
        let h = world.play("trail", Vec3::default(), 42, 0).unwrap();
        assert!(
            world
                .move_to(
                    &h,
                    Vec3 {
                        x: 5.,
                        y: 0.,
                        z: 0.
                    },
                    1
                )
                .unwrap()
        );
        let samples = world.snapshot(1);
        assert_eq!(samples.len(), 2);
        assert_eq!(samples[0].position.x, 0.);
        assert_eq!(samples[1].position.x, 5.);
        assert!(world.finish(&h, 1));
        assert_eq!(world.stats(1)["reserved_particles"], 2);
        let samples = world.snapshot(5);
        assert_eq!(samples.len(), 2);
        assert!(
            samples
                .iter()
                .all(|p| p.id.ends_with("/0") || p.id.ends_with("/1"))
        );
        world.advance(22);
        assert_eq!(world.stats(22)["active_handles"], 0);
        assert_eq!(world.stats(22)["reserved_particles"], 0);
    }
    #[test]
    fn capacity_and_unknown_fields_fail_closed() {
        let mut d = definition();
        d.emitters[0].count = 1025;
        assert!(d.validate().is_err());
        let mut value = serde_json::to_value(definition()).unwrap();
        value["emitters"][0]["lifetme"] = serde_json::json!(30);
        assert!(serde_json::from_value::<ParticleDefinition>(value).is_err());
        let mut invalid = definition();
        invalid.emitters[0].velocity_mode = ParticleVelocityMode::Cone;
        assert!(invalid.validate().unwrap_err().contains("direction"));
    }
    #[test]
    fn stop_and_expiry_release_world_budget() {
        let mut world = ParticleWorld::default();
        world.definitions.insert("spark".into(), definition());
        let id = world.play("spark", Vec3::default(), 1, 0).unwrap();
        assert!(!world.snapshot(0).is_empty());
        assert!(world.stop(&id));
        assert!(world.snapshot(0).is_empty());
        world.play("spark", Vec3::default(), 1, 0).unwrap();
        world.advance(999);
        assert!(world.live.is_empty());
    }
}
