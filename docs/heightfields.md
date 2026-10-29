# Updateable heightfield presentation

`api.heightfield` presents a regular grid of game-owned local Y samples. It is
an engine geometry primitive. The game owns terrain/spell brush rules, sampling,
navigation, coordinate wrapping, collision policy and water. This first contract
does not create or update physics colliders.

The first rendered implementation targets the official native player. Other
hosts must implement the same contract or fail explicitly when heightfields are
present; ignoring a nonempty heightfield snapshot is not supported presentation.
A headless replay proves state semantics, not a rendered mesh.

Create in `Game.start` (the strict scene DTO has no `heightfields` declaration):

```luau
api.heightfield.set("ground", {
    width = 3, depth = 2,
    heights = {0, 0, 0, 1, 1, 1}, -- X fastest, then increasing Z
    cell_size = 1,
    origin = {x = -1, y = 0, z = 0},
    texture = "texture://ground", -- declared texture asset resolved by the host
})
api.heightfield.update("ground", {
    x = 1, z = 0, width = 1, depth = 2, heights = {2, 3},
})
-- api.heightfield.remove("ground")
```

The full definition is exactly `width,depth,heights,cell_size,origin,texture`.
Use `game schema heightfield` and `game schema heightfield-patch` for generated
structural schemas; `game api describe heightfield.set` describes semantics.
Dimensions are integer sample counts in 2..512. The sample array must contain
exactly `width*depth` finite f32-compatible values; maximum 262144 per field.
`cell_size` is finite in (0,10000]. Origins, final X/Z extents, local heights
and final world Y values stay within +/-100000. Texture IDs have 1..256 UTF-8
bytes; field IDs have 1..128. Unknown fields fail. At most 16 fields and 1048576
samples may exist in a world. A 129x129 grid is valid.

Patch coordinates are **zero-based sample indices**, including the outer row
and column. A patch must be nonempty and completely in bounds. All input is
validated before modification; errors preserve the existing field and revision.
Dimensions, cell size, origin and texture change through a full `set` only.
The API returns nil; the game retains its authoritative heights and decides when
to publish edits. It does not read geometry back from a renderer.

Full heights and revision appear in `WorldSnapshot.heightfields` and canonical
observations, so edits are visible to replay/diff tests. Identical `set` or
no-op patches keep the previous revision. Effective changes allocate a
deterministic monotonic revision per runtime; remove/recreate cannot reuse an old
ID/revision pair. Removing a missing ID fails. Scene application clears fields;
the revision counter remains monotonic for that runtime. Independent runtimes
with the same operations produce the same observations. This is not a claim of
arbitrary cross-architecture floating-point simulation identity.

Rust hosts read `Heightfield::definition()`, `revision()` and `mesh()`. Mesh
generation is explicit, never performed during snapshot publication. Cache it
by `(id,revision)` and evict missing IDs. `mesh()` produces validated-format local
positions, [0,1] UVs and upward-facing triangles `[a,c,b,b,c,d]`, where a/b are
the first row and c/d the next. Apply `definition.origin` separately. Each cell
uses the b/c diagonal; games that sample heights should use the same triangle
interpolation when exact surface agreement matters. Normals/material resources,
GPU buffers and renderer lifetime remain host-owned.

Queries and physics require a separate primitive. Do not silently derive physics
from these render triangles or replace per-unit game rules with rigid bodies.

## Official native host

The wgpu player uses Uint32 indices and supports the core's complete 512x512
sample bound. It resolves the declared texture asset, generates local vertices
only when (id, revision) changes, and applies origin through an instance. A
changed revision currently rebuilds the field's vertex/index buffers; patching
is atomic state semantics, not a promise of partial GPU uploads. Removed fields
release cached geometry even when switching to a 2D camera. A nonempty field
without camera3d fails explicitly. UV v=0 samples the PNG's top row.

This is the existing unlit textured mesh pipeline. Normals, dynamic lighting,
water effects, terrain collision and navigation are not introduced by this API.
The WebGL/Three, raw WebGPU and diagnostic CLI preview/capture reject nonempty
fields with HEIGHTFIELD_BACKEND_UNSUPPORTED; use the official Windows export.

Native keyboard input exposes physical A-Z as uppercase action names, digits
as their characters, arrows as Left/Right/Up/Down, and Space/Enter by name.
Gameplay assigns their meanings. Focus loss resets held input; Escape retains
the host's close behavior. The native launch options --width and --height select
physical client pixels (each 180..7680, default 1280x720). Actual surface dimensions
are reported after OS/GPU negotiation. Reports include observations,
heightfield_revisions and per-heightfield presentation_batches rows. Rendering
and screenshots still require a real surface; --headless is not visual evidence.