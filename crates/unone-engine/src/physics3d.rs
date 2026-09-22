//! Continuous sphere/sphere queries. No integration or gameplay lifecycle.
use crate::world::{Vec3, World};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    id: String,
    radius: f64,
    previous_position: Vec3,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SphereSweep {
    from: Vec3,
    to: Vec3,
    radius: f64,
    targets: Vec<Target>,
}
#[derive(Serialize, Debug)]
pub struct SweepHit {
    pub id: String,
    pub fraction: f64,
    pub point: Vec3,
    pub normal: Vec3,
}
fn sub(a: Vec3, b: Vec3) -> Vec3 {
    Vec3 {
        x: a.x - b.x,
        y: a.y - b.y,
        z: a.z - b.z,
    }
}
fn add(a: Vec3, b: Vec3) -> Vec3 {
    Vec3 {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z,
    }
}
fn scale(a: Vec3, t: f64) -> Vec3 {
    Vec3 {
        x: a.x * t,
        y: a.y * t,
        z: a.z * t,
    }
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    a.x * b.x + a.y * b.y + a.z * b.z
}
fn valid(v: Vec3) -> bool {
    [v.x, v.y, v.z]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= 1e9)
}

fn sweep(relative: Vec3, delta: Vec3, radius: f64) -> Option<f64> {
    let c = dot(relative, relative) - radius * radius;
    if c <= 0.0 {
        return Some(0.0);
    }
    let a = dot(delta, delta);
    if a == 0.0 {
        return None;
    }
    let b = dot(relative, delta);
    let discriminant = b * b - a * c;
    if b >= 0.0 || discriminant < 0.0 {
        return None;
    }
    // Stable near-entry root; avoid cancellation when starting near a surface.
    let t = c / (-b + discriminant.sqrt());
    (0.0..=1.0).contains(&t).then_some(t)
}
pub fn sweep_sphere(world: &World, request: SphereSweep) -> Result<Option<SweepHit>, String> {
    if !valid(request.from)
        || !valid(request.to)
        || !request.radius.is_finite()
        || request.radius <= 0.0
        || request.radius > 1e6
        || request.targets.len() > 1024
    {
        return Err("SWEEP_INVALID: finite vectors within 1e9, radius in (0,1e6], and at most 1024 targets required".into());
    }
    let delta = sub(request.to, request.from);
    let mut hit: Option<SweepHit> = None;
    let mut ids = std::collections::BTreeSet::new();
    for target in request.targets {
        if !ids.insert(target.id.clone())
            || !valid(target.previous_position)
            || !target.radius.is_finite()
            || target.radius <= 0.0
            || target.radius > 1e6
        {
            return Err("SWEEP_INVALID: unique target ids, finite previous positions and positive bounded radii required".into());
        }
        let current = world
            .entities
            .get(&target.id)
            .and_then(|e| e.transform3d.as_ref())
            .ok_or_else(|| format!("SWEEP_TARGET_MISSING: {} requires Transform3D", target.id))?
            .position;
        if !valid(current) {
            return Err(format!(
                "SWEEP_INVALID: target {} exceeds coordinate bounds",
                target.id
            ));
        }
        let relative = sub(request.from, target.previous_position);
        let target_delta = sub(current, target.previous_position);
        if let Some(t) = sweep(
            relative,
            sub(delta, target_delta),
            request.radius + target.radius,
        ) {
            if hit
                .as_ref()
                .is_some_and(|h| h.fraction < t || (h.fraction == t && h.id <= target.id))
            {
                continue;
            }
            let center = add(request.from, scale(delta, t));
            let normal = sub(
                center,
                add(target.previous_position, scale(target_delta, t)),
            );
            let length = dot(normal, normal).sqrt();
            let normal = if length > 0.0 {
                scale(normal, 1.0 / length)
            } else {
                Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 1.0,
                }
            };
            hit = Some(SweepHit {
                id: target.id,
                fraction: t,
                point: sub(center, scale(normal, request.radius)),
                normal,
            });
        }
    }
    Ok(hit)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sweep_catches_fast_projectile_and_moving_target() {
        let origin = Vec3 {
            x: -10.0,
            y: 0.0,
            z: 0.0,
        };
        assert_eq!(
            sweep(
                origin,
                Vec3 {
                    x: 20.0,
                    y: 0.0,
                    z: 0.0
                },
                1.0
            ),
            Some(0.45)
        );
        assert_eq!(
            sweep(
                origin,
                Vec3 {
                    x: 5.0,
                    y: 0.0,
                    z: 0.0
                },
                1.0
            ),
            None
        );
        // Relative target motion can hit a stationary projectile.
        assert_eq!(
            sweep(
                origin,
                Vec3 {
                    x: 40.0,
                    y: 0.0,
                    z: 0.0
                },
                1.0
            ),
            Some(0.225)
        );
        assert_eq!(sweep(Vec3::default(), Vec3::default(), 1.0), Some(0.0));
    }
    #[test]
    fn query_is_read_only_breaks_ties_and_rejects_invalid_targets() {
        let mut world = World::default();
        world
            .load_scene_data(
                serde_json::from_value(serde_json::json!({"entities":[
                    {"id":"a","transform3d":{}},{"id":"b","transform3d":{}}
                ]}))
                .unwrap(),
            )
            .unwrap();
        let target = |id: &str| Target {
            id: id.into(),
            radius: 0.5,
            previous_position: Vec3::default(),
        };
        let request = |targets| SphereSweep {
            from: Vec3 {
                x: -10.0,
                y: 0.0,
                z: 0.0,
            },
            to: Vec3 {
                x: 10.0,
                y: 0.0,
                z: 0.0,
            },
            radius: 0.5,
            targets,
        };
        let hit = sweep_sphere(&world, request(vec![target("b"), target("a")]))
            .unwrap()
            .unwrap();
        assert_eq!(hit.id, "a");
        assert_eq!(hit.fraction, 0.45);
        assert_eq!(
            world.entities["a"].transform3d.as_ref().unwrap().position,
            Vec3::default()
        );
        assert!(sweep_sphere(&world, request(vec![target("missing")])).is_err());
        assert!(sweep_sphere(&world, request(vec![target("a"), target("a")])).is_err());
        assert!(sweep_sphere(&world, request(vec![])).unwrap().is_none());
        assert!(serde_json::from_value::<SphereSweep>(serde_json::json!({"from":{"x":0,"y":0,"z":0},"to":{"x":1,"y":0,"z":0},"radius":1,"targets":[],"speed":10})).is_err());
    }
}
