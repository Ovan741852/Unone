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

Definitions support per-emitter start delays for staged effects; point, box, sphere, and ring birth shapes; vector, cone, and radial velocity; gravity; eased size and RGBA interpolation or multi-key size and colour curves; drag; orbit around the emitter; per-particle size, rotation, spin and lifetime randomness; rotation aligned to velocity; start/end rotation plus angular velocity; and soft-circle, diamond, ring, or streak sprites, or a painted image per emitter (`texture`), optionally a flipbook. This covers the reusable visual building blocks for cast cues, projectile fans, impacts, fire/poison clouds, trails, persistent auras, and death bursts. A game composes cast/channel/release timing, buff rules, collisions, elemental reactions, damage, and target selection in Luau.

The native WGPU renderer uses a 64-byte instance record, depth-sorts alpha particles and draws them in that order, joining only adjacent particles with the same image into one draw; additive particles group by image. The web Three renderer pools instanced quads by sprite or image/blend/alpha and never creates an individual Sprite or material per particle. Both renderers draw the same four procedural silhouettes, image particles with flipbook cells, and particle rotation (the silhouette turns with the particle). Emission stays deterministic and seekable. Bloom remains a presentation-layer post-process option; AO is still part of the renderer configuration rather than particle data.

## Image particles

Set an emitter's `texture` to a `texture2d` asset id from the project's asset manifest to draw that image for every particle: hearts, confetti, sweat drops, leaves, coins, painted smoke. The particle colour multiplies the image, so `[1,1,1,a]` keeps the painted colours and the alpha fades it; `size` is the image height and the width follows its aspect ratio; rotation and every motion field work as for shapes. Use non-additive blending for painted images (additive washes light colours toward white) and keep additive for glows.

```json
{"id": "hearts", "count": 6, "interval_frames": 1, "lifetime_frames": 50, "emission_shape": "point",
 "velocity_mode": "cone", "direction": {"x": 0, "y": 1, "z": 0}, "cone_angle_degrees": 40, "speed_min": 50, "speed_max": 90,
 "size_start": 20, "size_end": 30, "size_easing": "ease_out", "color_start": [1, 1, 1, 1], "color_end": [1, 1, 1, 0],
 "sprite_shape": "diamond", "texture": "asset://game/fx-heart"}
```

Image particles are scene asset references: `game assets inspect` reports a missing id as `ASSET_REFERENCE_MISSING`, packaging keeps the image, and the official web player admits it before READY like scene sprites. Both official players draw them (web Three and native wgpu); until an image is resident the particles draw `sprite_shape`, so choose a fitting silhouette there.

## Motion, curves and variety

All of these are optional emitter fields, off by default and omitted from JSON when off, and every one is closed-form, so sampling stays seeded and seekable.

- `drag` (per second, 0..1000): velocity decays by e^(-drag·t) under gravity, so fast launches settle: confetti, dust, sparks.
- `orbit_velocity` (radians per second) and `orbit_axis` (default +Z, the screen plane of a 2D scene): each particle's whole path turns around the emitter origin: dizzy stars, swirling motes.
- `size_keys` / `color_keys`: 2-8 keys `{ "t": 0..1, "size": n }` or `{ "t": 0..1, "color": [r,g,b,a] }` with increasing `t`, linear between keys and held beyond the ends. They replace the start/end pair and its easing, so an effect can fade in, hold and fade out, or pop up and shrink.
- `size_random` (0..1, a fraction), `rotation_random` (radians), `angular_velocity_random` (radians per second) and `lifetime_random_frames` (below `lifetime_frames`): each particle varies by up to that amount, from its own seeded random value.
- `align_to_velocity`: the rotation follows the direction of travel in the XY plane (drag, gravity and orbit included); the rotation fields add to it. Use it for streaks, sparks and falling drops.
- `texture_frames` (image particles): `{ "columns": c, "rows": r, "count": n?, "fps": f, "random_start": bool }` reads equal cells left to right, top to bottom. `fps` 0 plays the frames once over each particle's life; otherwise they loop at that rate. Snapshots carry the cell as `uv` (u, v, width, height from the top left) and the cell's aspect ratio sizes the particle.

```json
{"id": "confetti", "count": 20, "interval_frames": 1, "lifetime_frames": 90, "lifetime_random_frames": 30,
 "velocity_mode": "vector", "velocity_min": {"x": -180, "y": 240, "z": 0}, "velocity_max": {"x": 180, "y": 380, "z": 0},
 "gravity": {"x": 0, "y": -420, "z": 0}, "drag": 1.6, "size_start": 12, "size_end": 12, "size_random": 0.3,
 "rotation_random": 3.14, "angular_velocity": 6, "angular_velocity_random": 4,
 "color_keys": [{"t": 0, "color": [1, 1, 1, 1]}, {"t": 0.7, "color": [1, 1, 1, 1]}, {"t": 1, "color": [1, 1, 1, 0]}],
 "sprite_shape": "diamond", "texture": "asset://game/confetti"}
```

Each definition is limited to 1,024 births per play; the world allows 64 active handles and 4,096 reserved births. Coordinates, colors, speed and size are validated. `finish` releases reservations after already-born particles reach their authored lifetime. `stop` releases immediately. `play_batch` remains intended for many static origins under one handle.

Run `game particle --file tests/fixtures/spark.particle.json --frame 15 --seed 42 --json` for deterministic sampling. `/web/particle-lab/` provides exact-frame preview and visual presets for common effect shapes. Scene definitions work in the official browser and native wgpu players, including the NativeActivity Android path. The older Canvas/JNI Android smoke host does not render these particles; it is a separate adapter.

Particle Lab presets are starting points for declarations, not separate gameplay
implementations. Copy the selected definition into the game's `particle_effects`,
then control effect timing and lifecycle through `api.particle.*`. Use a fixed
seed/frame to compare edits, and finally validate the result in the exported
official player. Bloom and custom shader resources belong to the engine's
presentation interface; they do not require replacing its renderer.
