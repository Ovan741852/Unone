# Native particle effects

Native particles are deterministic, fixed-60-Hz visual effects authored as scene data. The engine owns reusable emission and rendering primitives; Luau owns gameplay decisions such as when to cast, which target is hit, whether a buff is active, and when a trail should follow or finish.

This is the default path for AI-authored exhaust, sparks, explosions, smoke,
trails and auras. "Native" means built into Unone: both official Web and native
wgpu players render these effects. A game does not need an external Effekseer
asset, a custom renderer or direct GPU calls to use them. Keep `systems.particle`
enabled; disabling it removes this capability rather than selecting another
visual-effects backend.

Discover the current API contract before writing Luau:

```powershell
game --project <game-root> --json api search "explosion"
game --project <game-root> --json api search "particle"
game --project <game-root> --json api describe particle.play
game --project <game-root> --json api describe particle.play_batch
```

`scene.json` declares `particle_effects: {name: definition}`. The generated [particle schema](particle.schema.json) documents every accepted field. Unknown fields and invalid values fail before the definition is installed. The seeded [spark fixture](../tests/fixtures/spark.particle.json) shows the compatible v1 baseline.

```luau
local handle = api.particle.play("phoenix_fan", origin, 42)
api.particle.move(handle, troop.position) -- future births follow; old particles stay behind
api.particle.finish(handle)              -- taper the trail; existing particles fade out
api.particle.stop(handle)                -- cancel the instance immediately
```

Definitions support per-emitter start delays for staged effects; point, box, sphere, and ring birth shapes; vector, cone, and radial velocity; gravity; eased size and RGBA interpolation; start/end rotation plus angular velocity; and soft-circle, diamond, ring, or streak sprites. This covers the reusable visual building blocks for cast cues, projectile fans, impacts, fire/poison clouds, trails, persistent auras, and death bursts. A game composes cast/channel/release timing, buff rules, collisions, elemental reactions, damage, and target selection in Luau.

The native WGPU renderer batches particles into two blend passes, uses a compact 40-byte instance record, depth-sorts alpha particles, and keeps emission deterministic and seekable. The web Three renderer pools instanced quads by sprite/blend/alpha and never creates an individual Sprite or material per particle. Both renderers support the same four procedural sprite silhouettes and particle rotation. Bloom remains a presentation-layer post-process option; AO is still part of the renderer configuration rather than particle data.

Each definition is limited to 1,024 births per play; the world allows 64 active handles and 4,096 reserved births. Coordinates, colors, speed and size are validated. `finish` releases reservations after already-born particles reach their authored lifetime. `stop` releases immediately. `play_batch` remains intended for many static origins under one handle.

Run `game particle --file tests/fixtures/spark.particle.json --frame 15 --seed 42 --json` for deterministic sampling. `/web/particle-lab/` provides exact-frame preview and visual presets for common effect shapes. Scene definitions work in the official browser and native wgpu players, including the NativeActivity Android path. The older Canvas/JNI Android smoke host does not render these particles; it is a separate adapter.

Particle Lab presets are starting points for declarations, not separate gameplay
implementations. Copy the selected definition into the game's `particle_effects`,
then control effect timing and lifecycle through `api.particle.*`. Use a fixed
seed/frame to compare edits, and finally validate the result in the exported
official player. Bloom and custom shader resources belong to the engine's
presentation interface; they do not require replacing its renderer.
