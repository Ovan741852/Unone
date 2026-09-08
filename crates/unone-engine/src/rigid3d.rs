//! Opt-in rigid-body simulation. Gameplay commands and collision responses stay in Lua.
#[cfg(feature = "physics3d")]
use crate::world::EntityState;
use crate::world::Vec3;
#[cfg(feature = "physics3d")]
use rapier3d::{
    na::{Isometry3, Translation3, UnitQuaternion},
    prelude::*,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[cfg(feature = "physics3d")]
use std::collections::BTreeSet;

#[cfg(feature = "physics3d")]
const MAX_BODIES: usize = 16384;
#[cfg(all(test, feature = "physics3d"))]
#[path = "rigid3d_tests.rs"]
mod tests;
fn one() -> f64 {
    1.0
}
fn friction() -> f64 {
    0.5
}
fn yes() -> bool {
    true
}
fn all() -> i32 {
    -1
}
fn gravity() -> Vec3 {
    Vec3 {
        x: 0.,
        y: -9.81,
        z: 0.,
    }
}
#[cfg(feature = "physics3d")]
fn v(a: Vec3) -> Vector<f32> {
    Vector::new(a.x as f32, a.y as f32, a.z as f32)
}
#[cfg(feature = "physics3d")]
fn out(a: Vector<f32>) -> Vec3 {
    Vec3 {
        x: a.x as f64,
        y: a.y as f64,
        z: a.z as f64,
    }
}
#[cfg(feature = "physics3d")]
fn check(a: Vec3) -> Result<(), String> {
    if [a.x, a.y, a.z]
        .iter()
        .all(|x| x.is_finite() && x.abs() <= 100000.)
    {
        Ok(())
    } else {
        Err("PHYSICS3D_INVALID: vector must be finite within +/-100000".into())
    }
}
#[cfg(feature = "physics3d")]
fn positive(x: f64) -> bool {
    x.is_finite() && x >= 0.0001 && x <= 10000.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Shape3D {
    Sphere {
        radius: f64,
    },
    Box {
        half_extents: Vec3,
    },
    Capsule {
        half_height: f64,
        radius: f64,
    },
    Convex {
        vertices: Vec<Vec3>,
    },
    Trimesh {
        vertices: Vec<Vec3>,
        indices: Vec<[u32; 3]>,
    },
}
#[cfg(feature = "physics3d")]
impl Shape3D {
    fn build(&self) -> Result<SharedShape, String> {
        let invalid = || {
            "PHYSICS3D_SHAPE_INVALID: dimensions [0.0001,10000]; convex 4..256 vertices; static trimesh <=8192 vertices/16384 triangles, nondegenerate valid indices".to_string()
        };
        Ok(match self {
            Self::Sphere { radius } if positive(*radius) => SharedShape::ball(*radius as f32),
            Self::Box { half_extents: e } if positive(e.x) && positive(e.y) && positive(e.z) => {
                SharedShape::cuboid(e.x as f32, e.y as f32, e.z as f32)
            }
            Self::Capsule {
                half_height: h,
                radius: r,
            } if positive(*h) && positive(*r) => SharedShape::capsule_y(*h as f32, *r as f32),
            Self::Convex { vertices } if (4..=256).contains(&vertices.len()) => {
                for p in vertices {
                    check(*p)?;
                }
                SharedShape::convex_hull(
                    &vertices
                        .iter()
                        .map(|p| Point::from(v(*p)))
                        .collect::<Vec<_>>(),
                )
                .ok_or_else(invalid)?
            }
            Self::Trimesh { vertices, indices }
                if (3..=8192).contains(&vertices.len()) && (1..=16384).contains(&indices.len()) =>
            {
                for p in vertices {
                    check(*p)?;
                }
                for t in indices {
                    if t.iter().any(|i| *i as usize >= vertices.len()) {
                        return Err(invalid());
                    }
                    let [a, b, c] = t.map(|i| v(vertices[i as usize]));
                    if (b - a).cross(&(c - a)).norm_squared() < 1e-12 {
                        return Err(invalid());
                    }
                }
                SharedShape::trimesh(
                    vertices.iter().map(|p| Point::from(v(*p))).collect(),
                    indices.clone(),
                )
                .map_err(|e| e.to_string())?
            }
            _ => return Err(invalid()),
        })
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum BodyKind {
    Dynamic,
    Static,
    Kinematic,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Body3D {
    pub body_type: BodyKind,
    pub shape: Shape3D,
    #[serde(default = "one")]
    pub mass: f64,
    #[serde(default)]
    pub velocity: Vec3,
    #[serde(default)]
    pub angular_velocity: Vec3,
    #[serde(default = "friction")]
    pub friction: f64,
    #[serde(default)]
    pub restitution: f64,
    #[serde(default)]
    pub linear_damping: f64,
    #[serde(default)]
    pub angular_damping: f64,
    #[serde(default = "one")]
    pub gravity_scale: f64,
    #[serde(default)]
    pub sensor: bool,
    #[serde(default)]
    pub ccd: bool,
    #[serde(default)]
    pub lock_rotation: bool,
    #[serde(default = "yes")]
    pub can_sleep: bool,
    #[serde(default = "all")]
    pub membership: i32,
    #[serde(default = "all")]
    pub filter: i32,
}
#[cfg(feature = "physics3d")]
impl Body3D {
    fn validate(&self) -> Result<(), String> {
        check(self.velocity)?;
        check(self.angular_velocity)?;
        if !positive(self.mass)
            || ![self.friction, self.linear_damping, self.angular_damping]
                .iter()
                .all(|x| x.is_finite() && *x >= 0. && *x <= 1000.)
            || !self.restitution.is_finite()
            || !(0. ..=1.).contains(&self.restitution)
            || !self.gravity_scale.is_finite()
            || self.gravity_scale.abs() > 1000.
        {
            return Err("PHYSICS3D_BODY_INVALID: mass [0.0001,10000], friction/damping [0,1000], restitution [0,1], gravity_scale +/-1000".into());
        }
        if matches!(self.shape, Shape3D::Trimesh { .. }) && self.body_type != BodyKind::Static {
            return Err(
                "PHYSICS3D_BODY_INVALID: trimesh requires static; use convex for moving bodies"
                    .into(),
            );
        }
        self.shape.build()?;
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Physics3DScene {
    #[serde(default = "gravity")]
    pub gravity: Vec3,
    #[serde(default)]
    pub bodies: BTreeMap<String, Body3D>,
}
#[cfg(feature = "physics3d")]
impl Physics3DScene {
    pub fn validate(&self, scene: &crate::world::SceneFile) -> Result<(), String> {
        check(self.gravity)?;
        if self.bodies.len() > MAX_BODIES {
            return Err("PHYSICS3D_BODY_LIMIT: maximum 16384 bodies".into());
        }
        for (id, body) in &self.bodies {
            body.validate()?;
            let transform = scene
                .entities
                .iter()
                .find(|e| e.id == *id)
                .and_then(|e| e.transform3d.as_ref())
                .ok_or_else(|| format!("PHYSICS3D_ENTITY_MISSING: {id} requires Transform3D"))?;
            check(transform.position)?;
            check(transform.rotation)?;
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Pose3D {
    pub position: Vec3,
    #[serde(default)]
    pub rotation: Vec3,
}
#[cfg(feature = "physics3d")]
fn pose(p: &Pose3D) -> Result<Isometry3<f32>, String> {
    check(p.position)?;
    check(p.rotation)?;
    Ok(Isometry3::from_parts(
        Translation3::from(v(p.position)),
        UnitQuaternion::from_euler_angles(
            p.rotation.x as f32,
            p.rotation.y as f32,
            p.rotation.z as f32,
        ),
    ))
}
#[derive(Debug, Clone, Serialize)]
pub struct BodyState3D {
    pub body_type: BodyKind,
    pub position: Vec3,
    pub rotation: [f32; 4],
    pub velocity: Vec3,
    pub angular_velocity: Vec3,
    pub sleeping: bool,
    pub sensor: bool,
    pub definition_digest: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct Collision3D {
    pub a: String,
    pub b: String,
    pub sensor: bool,
    pub normal: Vec3,
    pub impulse: f32,
    pub phase: &'static str,
}
#[derive(Debug, Clone, Serialize)]
pub struct Snapshot3D {
    pub gravity: Vec3,
    pub bodies: BTreeMap<String, BodyState3D>,
    pub contacts: Vec<Collision3D>,
    pub joints: BTreeMap<String, Joint3D>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum JointKind3D {
    Fixed {},
    Spherical {},
    Revolute {
        axis: Vec3,
        #[serde(default)]
        limits: Option<[f64; 2]>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Joint3D {
    pub body_a: String,
    pub body_b: String,
    pub anchor_a: Vec3,
    pub anchor_b: Vec3,
    pub joint: JointKind3D,
    #[serde(default)]
    pub contacts_enabled: bool,
}

#[cfg(feature = "physics3d")]
#[derive(Clone)]
pub(crate) struct PhysicsWorld3D {
    pipeline: Pipeline,
    joint_ids: BTreeMap<String, (ImpulseJointHandle, Joint3D)>,
    definition_digests: BTreeMap<String, String>,
    gravity: Vec3,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    islands: IslandManager,
    broad: BroadPhaseMultiSap,
    narrow: NarrowPhase,
    joints: ImpulseJointSet,
    multijoints: MultibodyJointSet,
    ccd: CCDSolver,
    query: QueryPipeline,
    ids: BTreeMap<String, (RigidBodyHandle, ColliderHandle, Body3D)>,
    names: std::collections::HashMap<ColliderHandle, String>,
    previous: BTreeSet<(String, String, bool)>,
    pub contacts: Vec<Collision3D>,
    dirty: bool,
    simulation_dirty: bool,
}
#[cfg(feature = "physics3d")]
impl std::fmt::Debug for PhysicsWorld3D {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PhysicsWorld3D")
            .field("bodies", &self.ids.len())
            .finish()
    }
}
#[cfg(feature = "physics3d")]
struct Pipeline(PhysicsPipeline);
// Pipeline contains temporary solver buffers; persistent solver state is cloned above.
#[cfg(feature = "physics3d")]
impl Clone for Pipeline {
    fn clone(&self) -> Self {
        Self(PhysicsPipeline::new())
    }
}
#[cfg(feature = "physics3d")]
impl Default for PhysicsWorld3D {
    fn default() -> Self {
        Self {
            definition_digests: BTreeMap::new(),
            joint_ids: BTreeMap::new(),
            pipeline: Pipeline(PhysicsPipeline::new()),
            gravity: gravity(),
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            islands: IslandManager::new(),
            broad: BroadPhaseMultiSap::new(),
            narrow: NarrowPhase::new(),
            joints: ImpulseJointSet::new(),
            multijoints: MultibodyJointSet::new(),
            ccd: CCDSolver::new(),
            query: QueryPipeline::new(),
            ids: BTreeMap::new(),
            names: Default::default(),
            previous: Default::default(),
            contacts: vec![],
            dirty: false,
            simulation_dirty: false,
        }
    }
}
#[cfg(feature = "physics3d")]
impl PhysicsWorld3D {
    pub fn definition(&self, id: &str) -> Result<&Body3D, String> {
        self.ids
            .get(id)
            .map(|(_, _, body)| body)
            .ok_or_else(|| format!("PHYSICS3D_BODY_MISSING: {id}"))
    }
    pub fn add_joint(&mut self, id: String, j: Joint3D) -> Result<(), String> {
        if id.is_empty()
            || id.len() > 80
            || self.joint_ids.contains_key(&id)
            || self.joint_ids.len() >= 16384
        {
            return Err(
                "PHYSICS3D_JOINT_INVALID: unique nonempty id <=80 bytes, maximum 16384 joints"
                    .into(),
            );
        }
        let a = self.handle(&j.body_a)?;
        let b = self.handle(&j.body_b)?;
        if a == b {
            return Err("PHYSICS3D_JOINT_INVALID: bodies must differ".into());
        }
        check(j.anchor_a)?;
        check(j.anchor_b)?;
        let mut joint: GenericJoint = match &j.joint {
            JointKind3D::Fixed {} => FixedJointBuilder::new()
                .local_anchor1(Point::from(v(j.anchor_a)))
                .local_anchor2(Point::from(v(j.anchor_b)))
                .build()
                .into(),
            JointKind3D::Spherical {} => SphericalJointBuilder::new()
                .local_anchor1(Point::from(v(j.anchor_a)))
                .local_anchor2(Point::from(v(j.anchor_b)))
                .build()
                .into(),
            JointKind3D::Revolute { axis, limits } => {
                check(*axis)?;
                if v(*axis).norm_squared() < 1e-12 {
                    return Err("PHYSICS3D_JOINT_INVALID: axis must be nonzero".into());
                }
                let mut builder =
                    RevoluteJointBuilder::new(rapier3d::na::Unit::new_normalize(v(*axis)))
                        .local_anchor1(Point::from(v(j.anchor_a)))
                        .local_anchor2(Point::from(v(j.anchor_b)));
                if let Some([min, max]) = limits {
                    if !min.is_finite()
                        || !max.is_finite()
                        || min > max
                        || min.abs() > 1000.
                        || max.abs() > 1000.
                    {
                        return Err(
                            "PHYSICS3D_JOINT_INVALID: ordered finite radian limits within +/-1000"
                                .into(),
                        );
                    }
                    builder = builder.limits([*min as f32, *max as f32]);
                }
                builder.build().into()
            }
        };
        joint.set_contacts_enabled(j.contacts_enabled);
        let handle = self.joints.insert(a, b, joint, true);
        self.joint_ids.insert(id, (handle, j));
        self.simulation_dirty = true;
        Ok(())
    }
    pub fn remove_joint(&mut self, id: &str) -> Result<(), String> {
        let (h, _) = self
            .joint_ids
            .remove(id)
            .ok_or_else(|| format!("PHYSICS3D_JOINT_MISSING: {id}"))?;
        self.joints.remove(h, true);
        self.simulation_dirty = true;
        Ok(())
    }
    pub fn contains(&self, id: &str) -> bool {
        self.ids.contains_key(id)
    }
    pub fn add(&mut self, id: String, config: Body3D, pose_data: Pose3D) -> Result<(), String> {
        if self.ids.contains_key(&id) {
            return Err(format!("PHYSICS3D_DUPLICATE: {id}"));
        }
        if self.ids.len() >= MAX_BODIES {
            return Err("PHYSICS3D_BODY_LIMIT".into());
        }
        config.validate()?;
        let position = pose(&pose_data)?;
        let shape = config.shape.build()?;
        let builder = match config.body_type {
            BodyKind::Dynamic => RigidBodyBuilder::dynamic(),
            BodyKind::Static => RigidBodyBuilder::fixed(),
            BodyKind::Kinematic => RigidBodyBuilder::kinematic_position_based(),
        };
        let mut body = builder
            .position(position)
            .linvel(v(config.velocity))
            .angvel(v(config.angular_velocity))
            .gravity_scale(config.gravity_scale as f32)
            .linear_damping(config.linear_damping as f32)
            .angular_damping(config.angular_damping as f32)
            .ccd_enabled(config.ccd)
            .can_sleep(config.can_sleep)
            .build();
        if config.lock_rotation {
            body.lock_rotations(true, false);
        }
        let handle = self.bodies.insert(body);
        let collider = ColliderBuilder::new(shape)
            .mass(config.mass as f32)
            .friction(config.friction as f32)
            .restitution(config.restitution as f32)
            .sensor(config.sensor)
            .collision_groups(InteractionGroups::new(
                Group::from_bits_truncate(config.membership as u32),
                Group::from_bits_truncate(config.filter as u32),
            ))
            .active_collision_types(ActiveCollisionTypes::all())
            .build();
        let collider = self
            .colliders
            .insert_with_parent(collider, handle, &mut self.bodies);
        use sha2::Digest;
        self.definition_digests.insert(
            id.clone(),
            format!(
                "sha256:{:x}",
                sha2::Sha256::digest(serde_json::to_vec(&config).expect("validated body"))
            ),
        );
        self.names.insert(collider, id.clone());
        self.ids.insert(id, (handle, collider, config));
        self.dirty = true;
        self.simulation_dirty = true;
        Ok(())
    }
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        let (body, collider, _) = self
            .ids
            .remove(id)
            .ok_or_else(|| format!("PHYSICS3D_BODY_MISSING: {id}"))?;
        self.bodies.remove(
            body,
            &mut self.islands,
            &mut self.colliders,
            &mut self.joints,
            &mut self.multijoints,
            true,
        );
        self.definition_digests.remove(id);
        self.names.remove(&collider);
        self.joint_ids
            .retain(|_, (h, _)| self.joints.get(*h).is_some());
        self.dirty = true;
        self.simulation_dirty = true;
        Ok(())
    }
    fn handle(&self, id: &str) -> Result<RigidBodyHandle, String> {
        self.ids
            .get(id)
            .map(|x| x.0)
            .ok_or_else(|| format!("PHYSICS3D_BODY_MISSING: {id}"))
    }
    pub fn set_gravity(&mut self, value: Vec3) -> Result<(), String> {
        check(value)?;
        self.gravity = value;
        for (_, body) in self.bodies.iter_mut() {
            if body.is_dynamic() {
                body.wake_up(true);
            }
        }
        Ok(())
    }
    pub fn move_body(&mut self, id: &str, p: Pose3D, kinematic: bool) -> Result<(), String> {
        let p = pose(&p)?;
        let handle = self.handle(id)?;
        let body = &mut self.bodies[handle];
        if kinematic {
            if !body.is_kinematic() {
                return Err("PHYSICS3D_OWNERSHIP: moveKinematic requires a kinematic body".into());
            }
            body.set_next_kinematic_position(p);
        } else {
            body.set_position(p, true);
            self.dirty = true;
            self.simulation_dirty = true;
        }
        Ok(())
    }
    pub fn vector_command(&mut self, id: &str, value: Vec3, method: &str) -> Result<(), String> {
        check(value)?;
        let handle = self.handle(id)?;
        let body = &mut self.bodies[handle];
        if !body.is_dynamic() {
            return Err("PHYSICS3D_OWNERSHIP: forces and velocities require a dynamic body".into());
        }
        match method {
            "setVelocity" => body.set_linvel(v(value), true),
            "setAngularVelocity" => body.set_angvel(v(value), true),
            "applyImpulse" => body.apply_impulse(v(value), true),
            "applyTorqueImpulse" => body.apply_torque_impulse(v(value), true),
            "addForce" => body.add_force(v(value), true),
            "addTorque" => body.add_torque(v(value), true),
            _ => unreachable!(),
        }
        Ok(())
    }
    pub fn clear_forces(&mut self, id: &str) -> Result<(), String> {
        let h = self.handle(id)?;
        self.bodies[h].reset_forces(true);
        self.bodies[h].reset_torques(true);
        Ok(())
    }
    fn refresh_queries(&mut self) {
        if self.dirty {
            self.bodies
                .propagate_modified_body_positions_to_colliders(&mut self.colliders);
            self.query.update(&self.colliders);
            self.dirty = false;
        }
    }
    pub fn step(
        &mut self,
        dt: f64,
        entities: &mut BTreeMap<String, EntityState>,
    ) -> Result<(), String> {
        if self.ids.is_empty() && self.previous.is_empty() {
            self.contacts.clear();
            return Ok(());
        }
        // An unchanged sleeping world needs no solver/query-tree/contact rebuild.
        // Wake commands, changed colliders/joints and kinematic motion bypass this.
        if !self.simulation_dirty
            && !self.bodies.iter().any(|(_, b)| {
                (b.is_dynamic() && !b.is_sleeping())
                    || (b.is_kinematic()
                        && (b.next_position() != b.position()
                            || b.linvel().norm_squared() != 0.
                            || b.angvel().norm_squared() != 0.))
            })
        {
            self.contacts.retain(|c| c.phase != "exit");
            for c in &mut self.contacts {
                c.phase = "stay";
            }
            return Ok(());
        }
        let parameters = IntegrationParameters {
            dt: dt as f32,
            max_ccd_substeps: 4,
            ..Default::default()
        };
        self.pipeline.0.step(
            &v(self.gravity),
            &parameters,
            &mut self.islands,
            &mut self.broad,
            &mut self.narrow,
            &mut self.bodies,
            &mut self.colliders,
            &mut self.joints,
            &mut self.multijoints,
            &mut self.ccd,
            Some(&mut self.query),
            &(),
            &(),
        );
        for (id, (handle, _, _)) in &self.ids {
            let body = &self.bodies[*handle];
            if body
                .translation()
                .iter()
                .chain(body.linvel().iter())
                .chain(body.angvel().iter())
                .chain(body.rotation().coords.iter())
                .any(|x| !x.is_finite())
            {
                return Err(format!(
                    "PHYSICS3D_NONFINITE: {id}; reduce forces/velocities and inspect snapshot before retry; step may have partial effects"
                ));
            }
        }
        self.dirty = false;
        self.sync(entities);
        self.simulation_dirty = false;
        let mut current = BTreeMap::new();
        for pair in self.narrow.contact_pairs() {
            if !pair.has_any_active_contact {
                continue;
            }
            let Some(a) = self.names.get(&pair.collider1) else {
                continue;
            };
            let Some(b) = self.names.get(&pair.collider2) else {
                continue;
            };
            let normal = pair
                .manifolds
                .first()
                .map(|m| out(m.data.normal))
                .unwrap_or_default();
            let (a, b, normal) = if a < b {
                (a.clone(), b.clone(), normal)
            } else {
                (b.clone(), a.clone(), out(-v(normal)))
            };
            let impulse = pair.total_impulse_magnitude();
            current.insert(
                (a.clone(), b.clone(), false),
                Collision3D {
                    a,
                    b,
                    sensor: false,
                    normal,
                    impulse,
                    phase: "stay",
                },
            );
        }
        for (a, b, intersecting) in self.narrow.intersection_pairs() {
            if !intersecting {
                continue;
            }
            if let (Some(a), Some(b)) = (self.names.get(&a), self.names.get(&b)) {
                let (a, b) = if a < b {
                    (a.clone(), b.clone())
                } else {
                    (b.clone(), a.clone())
                };
                current.insert(
                    (a.clone(), b.clone(), true),
                    Collision3D {
                        a,
                        b,
                        sensor: true,
                        normal: Vec3::default(),
                        impulse: 0.,
                        phase: "stay",
                    },
                );
            }
        }
        self.contacts.clear();
        for (key, contact) in &mut current {
            contact.phase = if self.previous.contains(key) {
                "stay"
            } else {
                "enter"
            };
            self.contacts.push(contact.clone());
        }
        for (a, b, sensor) in self
            .previous
            .iter()
            .filter(|key| !current.contains_key(*key))
        {
            self.contacts.push(Collision3D {
                a: a.clone(),
                b: b.clone(),
                sensor: *sensor,
                normal: Vec3::default(),
                impulse: 0.,
                phase: "exit",
            });
        }
        self.contacts
            .sort_by(|a, b| (&a.a, &a.b, a.sensor).cmp(&(&b.a, &b.b, b.sensor)));
        self.previous = current.into_keys().collect();
        Ok(())
    }
    pub fn sync(&self, entities: &mut BTreeMap<String, EntityState>) {
        for (id, (h, _, _)) in &self.ids {
            if let Some(t) = entities.get_mut(id).and_then(|e| e.transform3d.as_mut()) {
                let b = &self.bodies[*h];
                t.position = out(*b.translation());
                let (x, y, z) = b.rotation().euler_angles();
                t.rotation = Vec3 {
                    x: x as f64,
                    y: y as f64,
                    z: z as f64,
                };
            }
        }
    }
    pub fn snapshot(&self) -> Snapshot3D {
        Snapshot3D {
            gravity: self.gravity,
            bodies: self
                .ids
                .iter()
                .map(|(id, (h, _, c))| {
                    let b = &self.bodies[*h];
                    let q = b.rotation().quaternion();
                    (
                        id.clone(),
                        BodyState3D {
                            body_type: c.body_type,
                            position: out(*b.translation()),
                            rotation: [q.i, q.j, q.k, q.w],
                            velocity: out(*b.linvel()),
                            angular_velocity: out(*b.angvel()),
                            sleeping: b.is_sleeping(),
                            sensor: c.sensor,
                            definition_digest: self.definition_digests[id].clone(),
                        },
                    )
                })
                .collect(),
            contacts: self.contacts.clone(),
            joints: self
                .joint_ids
                .iter()
                .map(|(id, (_, j))| (id.clone(), j.clone()))
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Query3DFilter {
    #[serde(default = "all")]
    pub membership: i32,
    #[serde(default = "all")]
    pub filter: i32,
    #[serde(default)]
    pub exclude: Option<String>,
    #[serde(default)]
    pub include_sensors: bool,
}
impl Default for Query3DFilter {
    fn default() -> Self {
        Self {
            membership: all(),
            filter: all(),
            exclude: None,
            include_sensors: false,
        }
    }
}
#[cfg(feature = "physics3d")]
impl Query3DFilter {
    fn filter(&self, p: &PhysicsWorld3D) -> Result<QueryFilter<'static>, String> {
        Ok(QueryFilter {
            groups: Some(InteractionGroups::new(
                Group::from_bits_truncate(self.membership as u32),
                Group::from_bits_truncate(self.filter as u32),
            )),
            exclude_rigid_body: self.exclude.as_deref().map(|id| p.handle(id)).transpose()?,
            flags: if self.include_sensors {
                QueryFilterFlags::empty()
            } else {
                QueryFilterFlags::EXCLUDE_SENSORS
            },
            ..Default::default()
        })
    }
}
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Ray3D {
    pub from: Vec3,
    pub to: Vec3,
    #[serde(default)]
    pub filter: Query3DFilter,
}
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Cast3D {
    pub pose: Pose3D,
    pub to: Vec3,
    pub shape: Shape3D,
    #[serde(default)]
    pub filter: Query3DFilter,
}
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct Overlap3D {
    pub pose: Pose3D,
    pub shape: Shape3D,
    #[serde(default)]
    pub filter: Query3DFilter,
}
#[derive(Debug, Serialize)]
pub struct QueryHit3D {
    pub id: String,
    pub fraction: f32,
    pub point: Vec3,
    pub normal: Vec3,
}
#[cfg(feature = "physics3d")]
impl PhysicsWorld3D {
    pub fn raycast(&mut self, r: Ray3D) -> Result<Option<QueryHit3D>, String> {
        check(r.from)?;
        check(r.to)?;
        let dir = v(r.to) - v(r.from);
        if dir.norm_squared() == 0. {
            return Err("PHYSICS3D_QUERY_INVALID: ray segment must be nonzero".into());
        }
        let filter = r.filter.filter(self)?;
        self.refresh_queries();
        let ray = Ray::new(Point::from(v(r.from)), dir);
        Ok(self
            .query
            .cast_ray_and_get_normal(&self.bodies, &self.colliders, &ray, 1., true, filter)
            .map(|(h, hit)| QueryHit3D {
                id: self.names[&h].clone(),
                fraction: hit.time_of_impact,
                point: out(ray.point_at(hit.time_of_impact).coords),
                normal: out(hit.normal),
            }))
    }
    pub fn cast(&mut self, r: Cast3D) -> Result<Option<QueryHit3D>, String> {
        let p = pose(&r.pose)?;
        check(r.to)?;
        if matches!(r.shape, Shape3D::Trimesh { .. }) {
            return Err("PHYSICS3D_QUERY_INVALID: cast shape must be convex".into());
        }
        let shape = r.shape.build()?;
        let filter = r.filter.filter(self)?;
        self.refresh_queries();
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.,
            ..Default::default()
        };
        Ok(self
            .query
            .cast_shape(
                &self.bodies,
                &self.colliders,
                &p,
                &(v(r.to) - v(r.pose.position)),
                &*shape,
                options,
                filter,
            )
            .map(|(h, hit)| QueryHit3D {
                id: self.names[&h].clone(),
                fraction: hit.time_of_impact,
                point: out(hit.witness1.coords),
                normal: out(*hit.normal1),
            }))
    }
    pub fn overlap(&mut self, r: Overlap3D) -> Result<Vec<String>, String> {
        let p = pose(&r.pose)?;
        if matches!(r.shape, Shape3D::Trimesh { .. }) {
            return Err("PHYSICS3D_QUERY_INVALID: overlap shape must be convex".into());
        }
        let shape = r.shape.build()?;
        let filter = r.filter.filter(self)?;
        self.refresh_queries();
        let mut ids = vec![];
        self.query.intersections_with_shape(
            &self.bodies,
            &self.colliders,
            &p,
            &*shape,
            filter,
            |h| {
                ids.push(self.names[&h].clone());
                true
            },
        );
        ids.sort();
        Ok(ids)
    }
}

#[cfg(not(feature = "physics3d"))]
impl Physics3DScene {
    pub fn validate(&self, _: &crate::world::SceneFile) -> Result<(), String> {
        Err("SYSTEM_NOT_COMPILED: scene.physics3d requires a runtime built with physics3d; rebuild for this project or remove the physics scene.".into())
    }
}
