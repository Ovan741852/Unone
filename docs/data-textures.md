# Runtime data textures

`api.texture` keeps texel arrays a game builds in Luau -- lookup tables,
palettes, height and flag maps, masks -- for [mesh shader
materials](shader-materials.md#mesh-materials-and-the-vertex-stage) to sample.
The engine validates the bytes once and keeps them immutable; a shader reads
them on the GPU every frame without the game resubmitting anything.

```luau
local heights = buffer.create(128 * 128 * 4)
-- ... buffer.writei32(heights, (z * 128 + x) * 4, raw) ...
api.texture.set("heights", {width = 128, height = 128, format = "r32i", data = heights})
api.shader.setTexture("exact_land", "heights", {data = "heights"})
-- One edited cell later:
api.texture.update("heights", {x = 4, y = 9, width = 1, height = 1, data = cell})
```

| format | bytes per texel | sampler type | read as |
| --- | --- | --- | --- |
| `rgba8` | 4 | `float` | 0..1 per channel |
| `r32i`, `rgba32i` | 4, 16 | `int` | exact signed integers |
| `r32f`, `rgba32f` | 4, 16 | `float` | 32-bit floats |

Texels are little-endian, row-major, first row first, and `data` holds exactly
`width * height` of them (1..4096 each way, at most 16 MiB per texture, 64
textures and 64 MiB per world). Every texture is sampled nearest and clamped,
so `texelFetch(name, ivec2(x, y), 0)` reads exactly the texel written at
`(x, y)`. `update` replaces one rectangle and keeps the rest.

Identical texels keep a texture's revision; any change allocates a new one.
Observations carry only width, height, format and revision, so a large table
costs no encoding or hashing per tick; the official Web player receives the
texels as memory views and uploads a texture again only on a new revision.
Applying a new scene clears data textures. A texture bound to a material
sampler cannot be removed (`DATA_TEXTURE_BOUND`); unbind it first with
`api.shader.setTexture(material, sampler, nil)`.

The official WebGL2 player supports data textures. The native player rejects
them (`HOST_DATA_TEXTURE_UNSUPPORTED`) instead of drawing without them.
