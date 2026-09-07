# Ownership and rendering contracts

`api.physics3d.sweepSphere(request)` is a read-only geometry query. Enable
`systems.physics3d` explicitly. The exact request is `{from: Vec3, to: Vec3,
radius: number, targets: [{id, radius, previous_position: Vec3}]}`. Target current
positions come from Transform3D. Radii are explicit world units. Up to 1024 unique
targets are accepted, coordinates must be finite within 1e9, and radii must be in
(0, 1e6]. Unknown fields, duplicates and missing transforms fail. An empty target
list returns nil. Relative linear motion handles moving targets and fast objects.

The result is nil or `{id, fraction, point, normal}`. Fraction lies in [0,1],
initial overlap returns zero, and equal-time contacts use ascending entity ID.
The point lies on the swept sphere surface; coincident centers use +Z as a stable
normal. There is no integration, gravity choice, damage, lifetime or response in
Rust. The sample's Luau script owns all of these, including stopping bullets and
choosing the original GoldCrystal_Hit asset. This is not a general rigid-body solver.

The release WebGL player supports legacy SKFE 1500 Effekseer files. Export checks
all six dependency tables against declared companion files before writing output.
The vendor JS/WASM is included only for games declaring Effekseer assets. The
sample copies the effect unchanged and transcodes its collected texture to PNG
under the original resource name. Missing resources fail startup. Effekseer follows
simulation frame deltas; its GPU animation is presentation, not a core digest
guarantee. Existing effect transport uses XY, so this game's Lua projects 3D
contacts onto its camera's z=0 plane. A general 3D effect transform remains pending.

Games may declare `player.presentation.json` with `bloom` and `show_performance`
booleans; both default false and unknown keys fail export. Bloom renders a full
resolution base, quarter-resolution bright extraction and separable blur, then
composites in linear color with output color conversion. Half-float targets are
used when supported, otherwise normalized targets. This adds four Three passes.

The opt-in performance UI can freeze the simulation while continuing presentation,
and switch Bloom without changing the frozen scene. DOM `playerPerformance`
contains drawing-buffer size, bounded CPU windows and asynchronous GPU timer
windows. Unsupported GPU timers return null (no invented estimate), disjoint
queries are discarded, and no blocking GPU readback is used. Three draw counts
exclude Effekseer calls. This UI is a measurement aid, not an automatic bottleneck
classifier. `bloom-measurements.json` records the sample's actual A/B measurements.
