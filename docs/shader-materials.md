# Shader materials

Use scene shader declarations and `api.shader.*` for custom sprite shading in
the official WebGL player. The game owns shader source and effect choices; the
engine owns material allocation, shader compilation, uniform upload, draw calls
and disposal. A request for custom shaders does not require `renderer_mode:
"custom"` or game-owned WebGL/OpenGL calls.

This initial interface targets 2D sprite materials in the official WebGL renderer.
It does not apply to meshes, instance batches, particle materials or arbitrary
full-screen post-processing. Native export rejects scenes declaring
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
texture coordinate and `color` is its input texture/tint color. Return the shaded
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

Shader source is an authored resource, not a security sandbox. Semantic
validation does not prove that arbitrary GLSL compiles or is inexpensive. The
engine surfaces GPU compilation failures; Luau never receives a GPU context.
