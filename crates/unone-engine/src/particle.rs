//! Seeded, fixed-frame 3D particles. Definitions are data; no host clock or script eval.
use crate::Vec3;
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
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

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
    pub interval_frames: u32,
    pub lifetime_frames: u32,
    #[serde(default)]
    pub spread: Vec3,
    #[serde(default)]
    pub velocity_min: Vec3,
    #[serde(default)]
    pub velocity_max: Vec3,
    #[serde(default)]
    pub gravity: Vec3,
    pub size_start: f64,
    pub size_end: f64,
    pub color_start: [f64; 4],
    pub color_end: [f64; 4],
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
    pub additive: bool,
}
#[derive(Debug, Clone)]
struct Instance {
    definition: ParticleDefinition,
    position: Vec3,
    seed: u64,
    started: u64,
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
                || e.interval_frames == 0
                || e.lifetime_frames == 0
                || e.lifetime_frames > 3600
            {
                return Err("PARTICLE_DEFINITION_INVALID: unique emitter IDs and positive count/interval/lifetime required".into());
            }
            for v in [e.spread, e.velocity_min, e.velocity_max, e.gravity] {
                validate_particle_vector(v)?;
            }
            if e.spread.x < 0.0
                || e.spread.y < 0.0
                || e.spread.z < 0.0
                || e.velocity_min.x > e.velocity_max.x
                || e.velocity_min.y > e.velocity_max.y
                || e.velocity_min.z > e.velocity_max.z
                || ![e.size_start, e.size_end]
                    .iter()
                    .all(|n| n.is_finite() && *n >= 0.0 && *n <= 1000.0)
                || !e
                    .color_start
                    .iter()
                    .chain(&e.color_end)
                    .all(|n| n.is_finite() && (0.0..=1.0).contains(n))
            {
                return Err(
                    "PARTICLE_DEFINITION_INVALID: invalid spread, velocity range, size or RGBA"
                        .into(),
                );
            }
        }
        if self.capacity() > 1024 {
            return Err(
                "PARTICLE_CAPACITY: an effect may emit at most 1024 particles per play".into(),
            );
        }
        Ok(())
    }
    fn capacity(&self) -> u64 {
        self.emitters
            .iter()
            .map(|e| {
                u64::from(e.count)
                    * u64::from(self.duration_frames.div_ceil(e.interval_frames.max(1)))
            })
            .sum()
    }
    fn end_age(&self) -> u64 {
        u64::from(self.duration_frames)
            + u64::from(
                self.emitters
                    .iter()
                    .map(|e| e.lifetime_frames)
                    .max()
                    .unwrap_or(0),
            )
    }
    /// Pure sampling supports immediate preview/scrubbing without advancing a game.
    pub fn sample(
        &self,
        seed: u64,
        age: u64,
        position: Vec3,
    ) -> Result<Vec<ParticleSnapshot>, String> {
        self.validate()?;
        validate_particle_vector(position)?;
        Ok(sample(self, seed, age, position, "preview"))
    }
}
impl ParticleWorld {
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
        if self.live.len() >= 64
            || self
                .live
                .values()
                .map(|i| i.definition.capacity())
                .sum::<u64>()
                + definition.capacity()
                > 4096
        {
            return Err("PARTICLE_CAPACITY: world budget exceeded; stop existing effects".into());
        }
        self.next += 1;
        let handle = format!("particle-{}", self.next);
        self.live.insert(
            handle.clone(),
            Instance {
                definition,
                position,
                seed,
                started: frame,
            },
        );
        Ok(handle)
    }
    pub fn stop(&mut self, handle: &str) -> bool {
        self.live.remove(handle).is_some()
    }
    pub fn advance(&mut self, frame: u64) {
        self.live
            .retain(|_, i| frame.saturating_sub(i.started) < i.definition.end_age());
    }
    pub fn snapshot(&self, frame: u64) -> Vec<ParticleSnapshot> {
        self.live
            .iter()
            .flat_map(|(handle, i)| {
                sample(
                    &i.definition,
                    i.seed,
                    frame.saturating_sub(i.started),
                    i.position,
                    handle,
                )
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
fn sample(
    d: &ParticleDefinition,
    seed: u64,
    age: u64,
    origin: Vec3,
    handle: &str,
) -> Vec<ParticleSnapshot> {
    let mut result = Vec::new();
    let mut emitters = d.emitters.iter().collect::<Vec<_>>();
    emitters.sort_by(|a, b| a.id.cmp(&b.id));
    for e in emitters {
        for born in (0..u64::from(d.duration_frames)).step_by(e.interval_frames as usize) {
            if born > age || age - born >= u64::from(e.lifetime_frames) {
                continue;
            }
            let t = (age - born) as f64 / 60.0;
            let a = (age - born) as f64 / f64::from(e.lifetime_frames);
            for j in 0..u64::from(e.count) {
                let index = born * u64::from(e.count) + j;
                let axis = |channel, min, max, spread, gravity, origin| {
                    q(origin
                        + (unit(seed, &e.id, index, channel) * 2.0 - 1.0) * spread
                        + (min + (max - min) * unit(seed, &e.id, index, channel + 3)) * t
                        + 0.5 * gravity * t * t)
                };
                result.push(ParticleSnapshot {
                    id: format!("{handle}/{}/{index}", e.id),
                    instance: handle.into(),
                    emitter: e.id.clone(),
                    position: Vec3 {
                        x: axis(
                            0,
                            e.velocity_min.x,
                            e.velocity_max.x,
                            e.spread.x,
                            e.gravity.x,
                            origin.x,
                        ),
                        y: axis(
                            1,
                            e.velocity_min.y,
                            e.velocity_max.y,
                            e.spread.y,
                            e.gravity.y,
                            origin.y,
                        ),
                        z: axis(
                            2,
                            e.velocity_min.z,
                            e.velocity_max.z,
                            e.spread.z,
                            e.gravity.z,
                            origin.z,
                        ),
                    },
                    size: q(e.size_start + (e.size_end - e.size_start) * a),
                    color: std::array::from_fn(|i| {
                        q(e.color_start[i] + (e.color_end[i] - e.color_start[i]) * a)
                    }),
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
    fn sampling_is_seeded_seekable_and_bounded() {
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
        assert!(d.sample(7, 9999, Vec3::default()).unwrap().is_empty());
        assert_eq!(a.len(), 24);
    }
    #[test]
    fn capacity_and_unknown_fields_fail_closed() {
        let mut d = definition();
        d.emitters[0].count = 1025;
        assert!(d.validate().is_err());
        let mut value = serde_json::to_value(definition()).unwrap();
        value["emitters"][0]["lifetme"] = serde_json::json!(30);
        assert!(serde_json::from_value::<ParticleDefinition>(value).is_err());
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
