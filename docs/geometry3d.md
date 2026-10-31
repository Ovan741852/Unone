# Retained world meshes and the curved camera

`api.geometry3d` keeps game-built meshes in world space. The game submits a
mesh once; the engine validates it, keeps it until its content changes, and the
host's camera places it on the GPU every frame. Moving the camera, or moving a
mesh with `setTransform`, costs no vertex work in Luau and resends no vertices.

Use it for generated terrain, buildings, decals and any geometry the game builds
itself. Use mesh assets (`mesh3d`, `instances3d`) for authored models, and
`api.projected` only when a game must emit exact preprojected reference output.
A game that projects every vertex in Luau each tick pays for the projection,
its allocations and their garbage collection again on every camera move.

```luau
-- 36 bytes per vertex: position.xyz, uv (v0 at the bottom), linear RGBA 0..1.
-- u32 triangle indices.
api.geometry3d.set("terrain", {
    vertices = vertices, indices = indices,
    texture = "texture://ground",          -- optional; vertex color alone otherwise
    material = {filter = "nearest", address = "repeat", double_sided = true},
    transform = {position = {x = 0, y = 0, z = 0}}, -- optional placement
})
api.geometry3d.setTransform("terrain", {position = {x = 4, y = 0, z = 0}})
api.geometry3d.setVisible("terrain", false)
-- api.geometry3d.remove("terrain")
```

The material is unlit: texture (when declared) times vertex RGBA. `blend` is
`opaque` (default), `cutout` (discard below `alpha_cutoff`, default 0.5) or
`transparent` (alpha-blended in `order`, no depth writes). `filter` is
`linear` (default) or `nearest`; `address` is `clamp` (default) or `repeat`.
Unknown fields fail.

Limits: 3..262144 vertices and 3..1572864 indices (a multiple of 3) per mesh,
1024 meshes and 2097152 vertices per world. Positions stay within +/-1000000,
UVs within +/-65536 and colors in 0..1; every index references a vertex. Invalid
content fails before replacing the current mesh.

## Revisions and transport

Identical content (vertices, indices, texture and material) keeps the mesh's
revision even when its placement changes. Content changes allocate a
deterministic world-monotonic revision; a removed and recreated ID gets a fresh
one. Applying a new scene clears runtime meshes.

The canonical observation contains the complete mesh as base64, so digests and
inspection see the content. The official Web player instead receives memory
views of the engine's immutable bytes, decodes a mesh only when its revision
changes, and the worker backend transfers the bytes only then. The canonical
base64 is encoded once per mesh generation.

## Camera curvature and rect

The perspective camera has two optional settings, set through
`api.camera.setTransform` (omitted values keep their current setting):

```luau
api.camera.setTransform({projection = "perspective",
    position = {x = 0, y = 40, z = 60}, target = {x = 0, y = 0, z = 0},
    curvature = 0.004,                              -- bend around the target
    rect = {x = 0.18, y = 0, width = 0.82, height = 1}, -- lower-left origin
})
```

`curvature` bends all world geometry around the camera target: in view space
relative to the target, `y -= curvature * (x^2 + z^2)`. This is the planet-like
horizon of god games and endless runners. Populous: The Beginning's projection
uses the same quadratic term in camera space; its fixed-point coefficient `c`
corresponds to `curvature = c / 2^30` in its own units. The bend runs in the
vertex shader, so it costs nothing per camera move.

`rect` renders the world into a normalized part of the surface, such as the
area beside a side panel, with the projection centered in that rect. The
default is the whole surface. Both are perspective-only.

## Hosts

The official Web player draws meshes, curvature and rect. It patches the
standard projection chunk of world materials (meshes, terrain, mesh entities,
instances), so custom shaders that do not use it are not bent. A rect cannot
yet combine with bloom or a declared render pipeline (`CAMERA_RECT_UNSUPPORTED`).
The native player rejects meshes (`HOST_GEOMETRY3D_UNSUPPORTED`) and a curved or
rect camera (`HOST_CAMERA_PROJECTION_UNSUPPORTED`) instead of drawing them
differently.
