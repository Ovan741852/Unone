# Decision 0054: Scene lighting

- Date: 2026-11-14
- Status: implemented on the official Web player and the native wgpu player. Guide: [lighting](../lighting.md)
- Scope: scene format, Engine API, snapshot, official Web and native renderers

## Problem

Neither official renderer lit anything. Web drew textured meshes and
heightfields with `MeshBasicMaterial` and primitives with
`MeshNormalMaterial`; native drew everything unlit and had no vertex normals.
A white cube on a white floor was invisible on native, and the two hosts
showed primitives in different colours. Lights and shadows are something every
general engine has, so games had no reusable way to light a 3D scene.

## Classification

Reusable presentation primitive, not gameplay: a light has no game rule in it.
Game Luau chooses lights and moves them; the engine owns GPU resources,
shading and shadow maps (AGENTS.md, engine versus gameplay ownership).

## Decision

1. **Declaration.** A scene's top-level `lighting` declares an ambient term,
   one directional `sun` with optional `shadows`, and up to eight `points`.
   Absent, 3D content stays unlit, so existing games render unchanged.
2. **One model.** Lambert diffuse with intensity 1 as full light:
   `albedo * (ambient + Σ light * max(n·l, 0) * shadow * falloff)`, point
   falloff `(1 - (d / range)^4)^2`. Colours are `"#rrggbb"` sRGB, matching
   render pipeline params.
3. **Engine state.** `api.lighting.set(lighting?)` replaces the lighting and
   `api.lighting.get()` returns it with defaults filled in. It is published in
   the snapshot only when present, so unlit games keep their snapshot bytes
   and replays light the same scene on every host.
4. **Shadows follow the camera.** The sun's shadow map covers a square box of
   half-width `distance` around the camera target. Both hosts place the shadow
   camera identically: two box widths back along the light, depth over four.
5. **What is lit.** Mesh entities, instance batches and heightfields. Sprites,
   particles, UI, runtime geometry3d (custom shading) and projected geometry
   stay unlit.
6. **Hosts.** Web uses Three's Lambert material and lights with intensities
   multiplied by π, because Three's Lambert BRDF divides by π. Native
   implements the formula in its mesh shader, computes normals like three.js
   `computeVertexNormals`, and renders a depth shadow map with 3x3 PCF.

## Alternatives

- **Physically based materials** (metalness, roughness, image-based light).
  Larger contract: materials per mesh, environment maps, tone mapping
  defaults. Lambert covers the common need and does not prevent adding a
  material model later as another field.
- **Lights as entities** with components. More flexible placement, but
  lighting would be spread over entity state and shadow configuration would
  belong nowhere. A scene-level record keeps one obvious place; games that
  attach a light to an entity move it from Luau.
- **Per-entity lit and shadow flags.** Useful for skyboxes and emissive
  meshes; left out until a game needs them, rather than guessing their shape.
- **Shadow cascades and point-light shadows.** Left for later; one camera
  following box is enough for small and medium scenes.
