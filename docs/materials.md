# Materials

A scene can give 3D meshes surface materials: a colour, how metallic and how
rough the surface is, and an emissive glow. A mesh without a material looks
exactly as before.

```json
"materials": {
  "gold":    {"color": "#ffcc55", "metallic": 1, "roughness": 0.3},
  "plastic": {"color": "#d03030", "roughness": 0.35},
  "screen":  {"color": "#202020", "emissive": "#30a0ff", "emissive_intensity": 2}
},
"entities": [
  {"id": "coin", "transform3d": {"position": {"x": 0, "y": 1, "z": 0}},
   "mesh3d": {"asset": "mesh://primitive/sphere", "material": "gold"}}
]
```

```luau
api.material.set("hurt", {color = "#ff2020", emissive = "#ff0000", emissive_intensity = 0.5})
local gold = api.material.get("gold")       -- defaults filled in, or nil
api.entity.spawn("coin", {mesh3d = {asset = "mesh://primitive/sphere", material = "gold"},
    transform3d = {position = {x = 2, y = 1, z = 0}}})
```

Materials are engine state, published in every snapshot as `materials`.
`material.set` adds or replaces one; a mesh3d component may name only a
material that exists (`SCENE_MATERIAL_INVALID` at scene load,
`MATERIAL_UNKNOWN` from `entity.spawn`). Invalid values fail with
`MATERIAL_INVALID` and change nothing. At most 256 materials.

## Fields

| Field | Default | Range | Meaning |
|---|---|---|---|
| `color` | `"#ffffff"` | `"#rrggbb"` | Multiplies the mesh texture. Primitive meshes with a material start from white, so `"#ff0000"` is red. |
| `metallic` | 0 | [0, 1] | 1 is bare metal: it reflects light tinted by `color` and has no diffuse colour. |
| `roughness` | 1 | [0, 1] | 0 is mirror-smooth with a sharp highlight, 1 fully rough. |
| `emissive` | `"#000000"` | `"#rrggbb"` | Light the surface gives off regardless of lighting. |
| `emissive_intensity` | 1 | [0, 100] | Multiplies `emissive`; values above 1 also feed bloom. |

Material names are 1 to 64 characters of a-z, A-Z, 0-9, `_`, `-` and `.`.

## Shading

Without [scene lighting](lighting.md) a material shows its colour only. In a
lit scene it is shaded physically, the way three.js `MeshStandardMaterial`
shades: diffuse `colour × (1 - metallic)`, a GGX specular highlight from each
light whose reflectance runs from 0.04 (non-metal) to `colour` (metal), plus
the emissive glow. Ambient and hemisphere light reach only the diffuse part,
so without an environment a bare metal looks dark apart from its highlights.

Mesh entities (`mesh3d`) take materials. Instance batches and heightfields do
not yet.

## Hosts

- **Official Web player:** `MeshStandardMaterial` (lit) or
  `MeshBasicMaterial` (unlit) per mesh asset and material, sharing the mesh
  texture.
- **Native wgpu player:** one batch per mesh asset and material; the mesh
  shader implements the same GGX formulas (Schlick Fresnel, height-correlated
  Smith visibility, GGX distribution, roughness clamped at 0.0525).

Design and alternatives: ADR 0055, `docs/decisions/0055-materials.md`.

Checked by `crates/unone-engine/src/material.rs`,
`crates/unone-engine/tests/material.rs`, `web/renderer/materials.test.mjs`,
the native `material_values` test and WGSL validation, and on 2026-11-14 the
same scene (gold metal, red plastic, emissive sphere under sun, hemisphere and
shadows) captured in Chromium and the native player and matched by eye.
