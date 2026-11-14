# Decision 0055: Surface materials

- Date: 2026-11-14
- Status: implemented on the official Web player and the native wgpu player for mesh entities. Guide: [materials](../materials.md)
- Scope: scene format, mesh3d component, Engine API, snapshot, both renderers

## Problem

After ADR 0054 every lit mesh was plain Lambert diffuse: metal, plastic and
glowing panels looked the same. Engines that games compare Unone with offer
metallic/roughness materials as a matter of course.

## Classification

Reusable presentation primitive: a material describes how a surface reflects
light and holds no game rule. Game Luau chooses and swaps materials.

## Decision

1. **Named materials.** A scene's `materials` declares them by name and a
   mesh3d component refers to one (`mesh3d.material`). `api.material.set`
   adds or replaces one and `api.material.get` reads it. Materials are engine
   state published in the snapshot.
2. **Metallic/roughness model**, as three.js `MeshStandardMaterial`: base
   colour multiplying the texture, metallic, roughness, emissive colour and
   intensity. Native ports Three's GGX formulas so the hosts match.
3. **Backward compatible.** Meshes without a material keep ADR 0054's Lambert
   shading; unlit scenes show the material colour only.
4. **Hemisphere light** joins the lighting record: sky and ground colours mixed
   by the normal's height, a cheap stand-in for an environment that both hosts
   compute identically.

## Alternatives

- **Per-entity material values** on mesh3d: simplest to author, but every
  distinct value would break native instancing. Named materials keep one batch
  per asset and material.
- **Materials inside mesh asset files**: glTF import can fill them later;
  scene-level names stay the way games choose and swap looks at run time.
- **Image-based lighting first**: metals look right only with an environment,
  but HDR environments need a new asset path on both hosts. It follows as a
  separate step.
