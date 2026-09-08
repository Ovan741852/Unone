# 3D rigid-body physics

This is a reusable engine primitive, enabled with `systems.physics3d=true`.
Luau owns gameplay: choosing body settings, firing, damage, scoring, lifetimes,
effects and reactions to contacts. A registered body explicitly opts into the
engine's fixed 60 Hz integration; existing games using `sweepSphere` retain their
Lua integration and do not acquire a second solver implicitly.

The backend is pinned Rapier 0.26.1 (`dim3`, `f32`, `enhanced-determinism`), with
neither parallel nor SIMD features enabled. It is compiled into the existing
native library / player WASM, not a separate downloaded physics WASM. See the
[upstream determinism contract](https://rapier.rs/docs/user_guides/templates/determinism/).
Changing the backend/toolchain requires rerunning exported-payload parity.

## Available contract

| Capability | Contract |
| --- | --- |
| Bodies | Dynamic, static, position-based kinematic; one collider per entity. |
| Shapes | Sphere, oriented box, Y-axis capsule, convex hull; static triangle mesh. |
| Dynamics | Mass/inertia, linear/angular velocity, force/torque, impulse/torque impulse, gravity scale, damping, friction, restitution and rotation lock. |
| Contacts | Sorted entity pairs with `enter`, `stay`, `exit`; sensors have no collision response. |
| Filtering | Signed 32-bit membership/filter masks; `-1` enables all bits, `-2147483648` is the highest bit. Both `(A.membership & B.filter)` and `(B.membership & A.filter)` must be nonzero. This representation stays in Luau's portable integer range on native and WASM. |
| Fast motion | Per-body CCD, up to four CCD substeps; convex shape cast for explicit gameplay queries. |
| Queries | Indexed closest raycast, convex shape cast and sorted overlap IDs. Exclude an entity, filter groups, include sensors explicitly. |
| Joints | Fixed, spherical and limited revolute, using local anchors. Connected collision is disabled by default. |
| Lifecycle | Add/remove body and joint; entity despawn removes its collider and attached joints. |
| Performance | Persistent multi-SAP broad phase, query BVH, warm-start solver state, sleeping, and unchanged sleeping-world fast path. |

The scene schema has an optional `physics3d` object:

```json
{
  "physics3d": {
    "gravity": {"x": 0, "y": -9.81, "z": 0},
    "bodies": {
      "ball": {
        "body_type": "dynamic",
        "shape": {"kind": "sphere", "radius": 0.35},
        "mass": 2,
        "restitution": 0.8,
        "ccd": true
      }
    }
  },
  "entities": [{"id": "ball", "transform3d": {"position": {"x": 0, "y": 3, "z": 0}}}]
}
```

Or attach a body with `api.physics3d.addBody(id, definition)` to an existing
Transform3D. The shape is built once on insertion. Dimension values are explicit
world units: render mesh bounds and Transform3D scale never silently resize a
collider. Capsule `half_height` is the half-length of its central Y segment;
total height is `2*(half_height+radius)`. Triangle indices are **zero-based** even
when supplied from Lua. Static trimeshes support up to 8192 vertices and 16384
triangles; convex hulls use 4..256 vertices. Degenerate triangles/hulls fail.

Body/shape dimensions and mass must be in `[0.0001,10000]`; supplied vectors are
finite within +/-100000; friction/damping are `[0,1000]`, restitution `[0,1]`.
Physics uses f32 metres/seconds/radians; JSON/Lua numbers are converted at the
boundary. Keep ordinary gameplay near metre scale. A runtime supports at most
16384 bodies and 16384 joints; these are safety bounds, not performance targets.
Unknown fields, missing entities, duplicate handles and wrong body ownership fail.
Scene physics while the system is disabled also fails on every host.

## Ownership and timing

Native preview now uses a wall-clock accumulator at fixed 60 Hz instead of one
tick per window redraw. It performs at most five catch-up steps and reports
`profile.renderer.dropped_steps`; manual pause/step remains explicit. Tests cover
30/60/144/240 Hz redraw schedules and stalls. Host slowdown can still drop wall
time; deterministic replay is by simulation frame, not elapsed wall time.

`Game.update` runs first, then physics solves, then Transform3D and observations
are published. `contacts()` in the next update reads that completed step. Contacts
remain visible for human inspection while paused. Normals point from lexical `a`
toward `b`; sensor/exit normals and impulses are zero. Contact impulse is the last
solved manifold impulse, not force; resting cached contacts may retain it.
Sensors are discrete overlap events: CCD does not guarantee detecting a trigger
crossed completely between steps. Use a filtered cast for that gameplay case.

```lua
api.physics3d.applyImpulse("ball", {x=12,y=2,z=0})
for _, contact in ipairs(api.physics3d.contacts()) do
    if contact.phase == "enter" then
        -- Lua decides whether this contact causes damage, sound or effects.
    end
end
local hit = api.physics3d.raycast({
    from={x=0,y=10,z=0}, to={x=0,y=-1,z=0},
    filter={exclude="ball"}
})
```

`teleport(id, {position, rotation?})` changes the pose immediately and retains
velocity; its path is not swept. Rotation is XYZ Euler applied X then Y then Z,
in radians. The body snapshot also publishes quaternion `[x,y,z,w]`; Web rendering
uses that quaternion directly to avoid Euler convention differences.
`moveKinematic` sets the next tick's pose and generates physical platform motion.
Direct `entity.setTransform3D` on a registered body fails with `PHYSICS3D_OWNERSHIP`.
Remove its body to return Transform ownership to Lua. Joints use body-local
anchors/axes; a fixed joint locks the two local frames with identity orientation.

`addForce` and `addTorque` accumulate persistent values until `clearForces`;
impulses apply once. Velocity/force commands require a dynamic body. Neither
queries nor commands advance a tick. Queries see additions, removals and teleports
immediately, and kinematic target poses only after the next step. Ray/cast results
use segment fraction `[0,1]`, world contact point and outward collider normal.
Initial ray overlap returns fraction zero. Equal-distance hits use the pinned
backend's deterministic traversal order; only overlap arrays and contact pairs
promise lexical sorting.

`getBody(id)` returns the authored definition; `snapshot()` returns current poses,
velocities, sleep state and joints. A definition digest participates in each body
observation so different collider settings cannot have an identical initial
observation merely because their poses match. Large hull/mesh arrays are not
duplicated into every frame. Snapshots/save payloads are **not** complete Rapier
checkpoints; internal warm-start/broad-phase state is retained by live runtime
clones for developer rollback, while save restoration remains game-owned.

Generated schemas: `game schema body3d|ray3d|cast3d|overlap3d|joint3d`.
`game api search physics3d --json` discovers the Luau methods. Core Profile includes
3D body count and measured physics time; this is raw evidence for AI investigation.

## Validation and scope

`cargo test -p unone-engine rigid3d --release` checks stacks/sleep/wake, friction,
restitution, CCD against a thin wall, sensors/filtering, indexed queries after
teleports, primitive/hull/mesh geometry, kinematic bodies, joints and cloned
solver continuation. `scripts/verify-player-parity.mjs` additionally exports the
actual Physics Lab and compares CLI/WASM at frames 0, 1, 30, 120 and 360, then
changes gravity in the emitted payload and requires a mismatch. This is tested
replay coverage, not a proof over all physics configurations or Android ARM.

Run the solver-only performance experiment with:

```powershell
cargo test -p unone-engine rigid3d_benchmark --release -- --ignored --nocapture
```

The samples exclude Lua, world snapshots/JSON, the host bridge and rendering.
The development panel's Profile measures those larger costs separately. Collapsed
panels avoid inspection polling overhead. Dense contact graphs can still have
quadratic actual work; a broad phase cannot remove real contacts.

Not yet wrapped: compound colliders, joint motors, character controller, vehicles,
ragdoll authoring, deformables, cloth, fluids, terrain streaming and complete
solver checkpoint serialization. These are explicit remaining capabilities, not
aliases that silently do nothing. Current native presentation remains a primitive
renderer; this change provides shared simulation, not full native visual parity.
