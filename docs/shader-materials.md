# Shader materials

Use scene shader declarations and `api.shader.*` for custom sprite shading in
the official WebGL player. The game owns shader source and effect choices; the
engine owns material allocation, shader compilation, uniform upload, draw calls
and disposal. A request for custom shaders does not require `renderer_mode:
"custom"` or game-owned WebGL/OpenGL calls.

The interface targets 2D sprite materials and runtime `api.geometry3d` meshes in
the official WebGL renderer; meshes may add a vertex stage and per-vertex inputs
(see [Mesh materials](#mesh-materials-and-the-vertex-stage)). It does not apply
to mesh assets, instance batches, particle materials or arbitrary full-screen
post-processing. Native export rejects scenes declaring
`shader_materials`; the WebGPU renderer rejects active shader assignments rather
than silently drawing the ordinary material. Built-in declarative
particles remain the first choice for exhaust, sparks, smoke, trails and
explosions; Bloom remains a player presentation option.

Declare reusable materials in the scene and refer to them from sprite entities:

```json
{
  "shader_materials": {
    "shield_glow": {
      "fragment": "vec4 unoneShade(vec2 uv, vec4 color) { float pulse = 0.5 + 0.5 * sin(unone_time * 4.0); return vec4(color.rgb + tint * strength * pulse, color.a); }",
      "uniforms": { "strength": 0.5, "tint": [0.1, 0.6, 1.0] }
    }
  },
  "entities": [
    {
      "id": "ship",
      "transform": { "x": 0, "y": 0 },
      "sprite": { "asset": "ship_texture", "size": { "x": 2, "y": 2 } },
      "shader_material": "shield_glow"
    }
  ]
}
```

The example is a scene fragment; declare `ship_texture` and its image bytes using
the ordinary [asset workflow](asset-workflow.md). A shader changes the material
of existing art; it is not a substitute for requested image assets.

`fragment` is a bounded GLSL ES 1.00 source defining
`vec4 unoneShade(vec2 uv, vec4 color)`. `uv` is the sprite's
texture coordinate (on a [sheet sprite](sprite-animation.md), within the drawn
cell) and `color` is its input texture/tint color. Return the shaded
RGBA color. Uniform defaults are numbers or arrays of two to four numbers,
corresponding to GLSL `float`, `vec2`, `vec3` and `vec4`. The host supplies
`unone_frame` and `unone_time` (seconds) from the fixed simulation frame; visual animation
can follow replay time without a separate game-owned wall clock.

A scene supports at most 64 materials, each with up to 32 uniforms and 16,384
UTF-8 bytes of fragment source. Omit `#version`; the renderer supplies the shader
wrapper and uniform declarations. Uniform names are GLSL identifiers of at most
64 ASCII characters; `gl_`, `unone_`, double underscores and reserved GLSL names
are unavailable. Numeric values must be finite and fit a 32-bit float.

Discover the current API before writing Luau:

```powershell
game --project <game-root> --json api search "shader"
game --project <game-root> --json api describe shader.setMaterial
game --project <game-root> --json api describe shader.setUniform
game --project <game-root> --json api describe shader.clearMaterial
```

```luau
api.shader.setMaterial("ship", "shield_glow")
api.shader.setUniform("shield_glow", "strength", 0.8)
api.shader.setUniform("shield_glow", "tint", {0.2, 0.8, 1.0})
-- Restore the ordinary sprite material when the shield ends.
api.shader.clearMaterial("ship")
```

`setMaterial` requires an existing sprite entity and a declared material ID.
`setUniform` updates an existing declared uniform and must retain its original
scalar/vector width; it does not add arbitrary uniforms at runtime. Errors use
semantic codes such as `SHADER_MATERIAL_UNKNOWN`, `SHADER_TARGET_UNSUPPORTED`,
`SHADER_UNIFORM_UNKNOWN` and `SHADER_UNIFORM_TYPE` before mutation. The Web
renderer reports `SHADER_BACKEND_UNSUPPORTED` for non-WebGL bindings and
`SHADER_COMPILE_FAILED` for compilation failures; native export reports
`HOST_SHADER_UNSUPPORTED` for shader declarations.

Uniform state belongs to the material definition, so updating one named material
affects entities that share it. Declare separate material IDs when entities need
independent parameter values. Headless tests can verify declarations, bindings
and parameter changes; they do not compile GLSL or prove a rendered frame.
Validate compilation and the visible result in the exported official WebGL
player, and report that target when handing off the game.

## Mesh materials and the vertex stage

A runtime mesh names a material with `material = {shader = "id"}` in
`api.geometry3d.set` (see [geometry3d](geometry3d.md)). The fragment stage is the
same `unoneShade(uv, color)`, with `color` the texture (white when the mesh has
none) times the vertex RGBA. A mesh material may also declare:

- `vertex`: GLSL ES 3.00 defining `vec4 unoneVertex(vec3 position, mat4 model)`,
  which returns the clip-space position. `model` includes the mesh's placement
  (and instance); `unone_view` and `unone_projection` are the camera's matrices,
  so `unone_projection * unone_view * model * vec4(position, 1.0)` is the default.
  `model` and `unone_view` use the game's coordinates, including a left-handed
  camera: the host's own mirroring never reaches the shader.
  The stage may also write `unone_uv` and `unone_color` before the fragment stage
  reads them. Returning `w = 1` gives screen-affine interpolation, as
  pre-transformed (TL) vertices of older renderers had. Integer types and
  operations are available (`highp int`, 32-bit wrapping arithmetic, shifts).
- `attributes`: an ordered list of `{name, size}` (size 1..4 floats; at most 8
  attributes and 16 floats). Each vertex of a mesh using the material carries
  them after its RGBA, in this order, and the vertex stage reads them by name.
- `varyings`: `{name, size, interpolation}` values the vertex stage writes and
  the fragment stage reads; `interpolation` is `smooth` (default) or `flat`
  (the triangle's last vertex).
- `samplers`: texture inputs of both stages, `{"<name>": {"type": "float" | "int",
  "source": {"asset": "texture://..."}}}`. A `float` sampler is a `sampler2D`
  (image assets, `rgba8` and float data textures); an `int` sampler is an
  `isampler2D` for `r32i`/`rgba32i` [data textures](data-textures.md), read
  exactly with `texelFetch`. Scenes may name an asset; runtime data textures
  are bound with `api.shader.setTexture(material, sampler, {data = id})`, and
  `nil` unbinds. An unbound sampler reads zero. Like uniforms, bindings belong
  to the shared material.

The renderer supplies `unone_time`, `unone_frame` and `unone_viewport` (x, y,
width, height of the world's drawing area in drawing-buffer pixels, lower-left
origin) to both stages. Attributes and varyings need a vertex stage. Names of
uniforms, attributes and varyings are distinct identifiers; a material with a
vertex stage also cannot reuse the renderer's inputs (`position`, `uv`,
`color`, `normal`, `modelMatrix`, `viewMatrix`, `projectionMatrix`, ...).
A material with a vertex stage or samplers shades only meshes; assigning it to
a sprite fails with `SHADER_TARGET_UNSUPPORTED`. The mesh's `blend`, `alpha_cutoff`,
`filter`, `address` and `double_sided` still apply; camera curvature does not
bend shader meshes (a vertex stage can apply its own).

```json
"shader_materials": {
  "exact_land": {
    "vertex": "vec4 unoneVertex(vec3 position, mat4 model) { shade = vec4(cell.z); return unone_projection * unone_view * model * vec4(position, 1.0); }",
    "fragment": "vec4 unoneShade(vec2 uv, vec4 color) { return color * shade; }",
    "attributes": [{"name": "cell", "size": 3}],
    "varyings": [{"name": "shade", "size": 4, "interpolation": "flat"}],
    "uniforms": {"zoom": 1.0}
  }
}
```

Shader source is an authored resource, not a security sandbox. Semantic
validation does not prove that arbitrary GLSL compiles or is inexpensive. The
engine surfaces GPU compilation failures; Luau never receives a GPU context.
