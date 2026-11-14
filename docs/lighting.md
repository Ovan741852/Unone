# Lighting

A scene can light its 3D content: an ambient term, one sun (directional
light) that can cast shadows, and up to eight point lights. Without a
`lighting` declaration nothing changes and 3D content stays unlit.

```json
"lighting": {
  "ambient": {"color": "#ffffff", "intensity": 0.3},
  "hemisphere": {"sky": "#a8c8ff", "ground": "#403020", "intensity": 0.5},
  "sun": {
    "direction": {"x": -0.4, "y": -1, "z": -0.3},
    "color": "#fff4e0", "intensity": 1,
    "shadows": {"size": 2048, "distance": 20, "bias": 0.001}
  },
  "points": [
    {"position": {"x": 2, "y": 1.5, "z": 0}, "color": "#ff8030", "intensity": 1.5, "range": 6}
  ]
}
```

The declaration sits at the top level of the scene file. Game Luau reads and
replaces it while the game runs:

```luau
local light = api.lighting.get()            -- nil when the scene is unlit
light.sun.direction = {x = math.cos(t), y = -1, z = math.sin(t)}
api.lighting.set(light)                     -- replaces all of it
api.lighting.set(nil)                       -- back to unlit
```

Lighting is engine state: it is published in every snapshot as `lighting`,
so replays and every host light the same scene. An invalid declaration fails
the scene with `SCENE_LIGHTING_INVALID`; an invalid `set` fails with
`LIGHTING_INVALID` and leaves the lighting as it was.

## Fields

| Field | Default | Range |
|---|---|---|
| `ambient.color` | `"#ffffff"` | `"#rrggbb"` (sRGB) |
| `ambient.intensity` | 0.3 | [0, 16] |
| `hemisphere.sky` | `"#ffffff"` | `"#rrggbb"`: light from straight above |
| `hemisphere.ground` | `"#444444"` | `"#rrggbb"`: light from straight below |
| `hemisphere.intensity` | 0.5 | [0, 16]; a tilted surface gets the mix by its normal |
| `environment.map` | required | a declared `data` asset whose source is a Radiance `.hdr` panorama |
| `environment.intensity` | 1 | [0, 16] |
| `environment.rotation` | 0 | [-360, 360] degrees around the up axis |
| `environment.background` | false | also draw the panorama behind the scene |
| `sun.direction` | required | any non-zero vector: the way the light travels |
| `sun.color` | `"#ffffff"` | `"#rrggbb"` |
| `sun.intensity` | 1 | [0, 16] |
| `sun.shadows.size` | 2048 | 512, 1024, 2048 or 4096 |
| `sun.shadows.distance` | 20 | (0, 10000]: half-width of the shadow box |
| `sun.shadows.bias` | 0.001 | [0, 0.05], shadow-map depth |
| `points[i].position` | required | finite, within 1e9 |
| `points[i].color` | `"#ffffff"` | `"#rrggbb"` |
| `points[i].intensity` | 1 | [0, 100] |
| `points[i].range` | 10 | (0, 1e6] |

Omit `sun.shadows` for a sun without shadows. Unknown fields fail.

## The model

Lambert diffuse, with intensity 1 as full light:

```
colour = albedo * (ambient + hemisphere(n) + sun * max(n·l, 0) * shadow + Σ point * max(n·l, 0) * (1 - (d / range)^4)^2)
```

Meshes with a [material](materials.md) are shaded physically instead (metallic/roughness, GGX highlights). `albedo` is the mesh texture, or the flat primitive colour `#e6ecf5` for
`mesh://primitive/box` and `mesh://primitive/sphere`. Both faces of a
triangle are lit: the side the camera sees uses the normal turned towards it.

- **Lit:** mesh entities (`mesh3d`), instance batches (`api.instances3d`) and
  heightfields. With `sun.shadows` they all cast and receive shadows.
- **Never lit:** 2D sprites, particles, UI, runtime `api.geometry3d` meshes
  (they own their shading through shader materials) and projected geometry.
- **Shadows:** the sun renders a shadow map of the square box of half-width
  `distance` around the camera target, so shadows follow the camera. Outside
  the box, surfaces are lit without shadow. Raise `size` or lower `distance`
  for sharper shadows; raise `bias` if lit surfaces show stripes (shadow acne).
  Point lights cast no shadows.

## Environment

An HDR panorama lights meshes that have a [material](materials.md): a sharp
or blurred reflection by roughness, and soft sky light on the diffuse part, as
three.js `MeshStandardMaterial` takes `scene.environment`. Meshes without a
material ignore it. Declare the file as a data asset and name it:

```json
{"id": "sky", "kind": "data", "source": "assets/sky.hdr"}
```

```json
"environment": {"map": "sky", "intensity": 1, "rotation": 30, "background": true}
```

The panorama is equirectangular (2:1), Radiance RGBE (`#?RADIANCE`, `-Y
height +X width`, flat or run-length rows); its middle column faces +x. A
missing or non-`.hdr` map fails with `ENVIRONMENT_MAP_INVALID` (Web) or
`NATIVE_ENVIRONMENT_MAP_INVALID` (native). The Web player blurs reflections
with Three's PMREM; native uses a box-filtered mip chain and nine-term
spherical harmonics, so rough reflections differ slightly between hosts.

Whole-screen looks (AO, fog, bloom, tone mapping, colour grade, vignette) are
[render pipeline](render-pipeline.md) passes and combine with lighting.

## Hosts

- **Official Web player:** Three.js `MeshLambertMaterial` with an
  `AmbientLight`, a `DirectionalLight` (PCF shadow map) and `PointLight`s
  (`decay` 0, `distance` = range). Three's Lambert divides by π, so every
  intensity is multiplied by π to keep intensity 1 as full light. Unlit
  primitives keep their normal-colour material; lit ones use `#e6ecf5`.
- **Native wgpu player:** the same formula in its mesh shader, vertex normals
  computed like three.js `computeVertexNormals`, and a depth shadow map with
  3x3 PCF over the same shadow box.

Hosts shade some content slightly differently (the primitive sphere has a
different tessellation; shadow filtering differs at the edges); a lighting
change moves both the same way.

Design and alternatives: ADR 0054, `docs/decisions/0054-scene-lighting.md`.

Checked by:

- `crates/unone-engine/src/lighting.rs` and `crates/unone-engine/tests/lighting.rs`:
  defaults, validation, `api.lighting` and the snapshot;
- `web/renderer/lighting.test.mjs`: light placement, π scaling, shadow box;
- `crates/unone-native-player/src/lighting.rs` tests: Three-compatible normals,
  the shadow box, the uniform, and WGSL validation;
- on 2026-11-14, the same scene (sun with shadows; two point lights; unlit)
  captured in Chromium and the native player (RTX 5080, Vulkan) and matched
  by eye.
