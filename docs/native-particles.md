# Native particle v1

Native particles are a 3D, engine-owned option alongside external Effekseer.
Scene JSON declares `particle_effects: {name: definition}`. The generated
[schema](particle.schema.json) describes every accepted field; unknown fields
and invalid values fail before mutation. [Spark](../tests/fixtures/spark.particle.json)
is a complete definition.

`api.particle.play(name, {x=0,y=0,z=0}, seed)` returns a handle;
`api.particle.stop(handle)` returns whether it existed. `game api search particle`
and `game api typings` expose the same API. The `particle` system can be disabled.
Effekseer continues through `api.effect`; selecting native particles does not
require installing or loading Effekseer. This is not an Effekseer file converter.

Each emitter has a stable ID, count, interval and lifetime in frames, box spread,
velocity range, gravity, start/end size and RGBA, and additive/normal blending.
Motion is sampled analytically at 60 Hz from the seed and integer frame age.
Emitter order does not change randomness. Values are quantized to 1e-6 before
publication. Replay promises particle state, not identical GPU pixels across
devices. Bounds: 16 emitters, 3,600 emission frames, 3,600 lifetime frames,
1,024 emitted particles per definition, 64 simultaneous instances and 4,096
reserved particles per world. Vector components must be finite within ±1e9.
The capacity limit counts the whole instance reservation, not only visible particles.

`game particle --file tests/fixtures/spark.particle.json --frame 15 --seed 42 --json`
samples without advancing a game. After building the player, serve the repository
with `python scripts/serve-export.py . --port 8177` and open
`/web/particle-lab/` for JSON editing and exact-frame visual preview. The preview
uses the actual WASM runtime, not a second JavaScript simulation.

DeveloperSession Enact accepts scene operations `set_particle_definition`,
`spawn_particle`, and `stop_particle`. Dry-run and atomic rollback apply. Replacement
affects future plays; active instances retain their original definition. These
are transient session edits; persist approved definitions into scene JSON.
Snapshots/journals expose definition and particle changes. Web/Mobile/core parity
fixtures now include a seeded native effect. Raw `game perf` counts include particles.

Rendering currently uses Three.js camera-facing glow sprites in the Web runner,
player and particle lab. Native/Android presentation still needs particle adapters.
Texture emitters, mesh particles, trails, collisions, curves and GPU instancing
are outside v1. Spine remains an external animation format.
