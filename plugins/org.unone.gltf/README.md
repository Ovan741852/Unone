# Unone glTF

Imports glTF 2.0 binary models (`.glb`) as static meshes through the engine's
[import pipeline](../../docs/import-pipeline.md). The conversion is a Luau
importer (`importer/unone-gltf.luau`), so the engine re-imports the model
whenever the source changes, before a run, test, verify or export; this plugin
only inspects models and writes the wiring.

```powershell
game --project <game> plugin call --id org.unone.gltf --tool gltf.inspect --input request.json
game --project <game> plugin call --id org.unone.gltf --tool gltf.plan --input request.json
game --project <game> plugin call --id org.unone.gltf --tool gltf.apply --input request.json
```

with `request.json` such as `{"path": "art/crate.glb", "name": "crate"}`.
`gltf.apply`:

- copies the importer to `import/unone-gltf.luau` and registers it as
  `unone.gltf.mesh` in `project.unone.json`;
- adds an import root for the model's folder (machine-local in
  `.unone/import-roots.json`; on another machine set the same root name there
  or with `UNONE_IMPORT_ROOT_<NAME>`);
- declares `mesh://<name>` (`assets/imported/<name>.mesh.json`) and
  `texture://<name>` (the model's base colour image) in the asset manifest;
- adds a [material](../../docs/materials.md) `<name>` from the model's first
  material (base colour, metallic, roughness, emissive) to the main scene.

Then spawn it:

```luau
api.entity.spawn("crate", {mesh3d = {asset = "mesh://crate", material = "crate"},
    transform3d = {position = {x = 0, y = 0, z = 0}}})
```

## What is read

The default scene's meshes, flattened into one static mesh with node
transforms applied (a mirroring transform keeps faces outward); positions,
`TEXCOORD_0` (float or normalized integers) and indices; the first textured
material's base colour image (PNG or JPEG embedded in the GLB). A model
without a texture gets a white one.

Not read, with a clear `GLTF_IMPORT_FAILED`: `.gltf` text files (export GLB),
Draco, meshopt and KTX2/Basis compression, quantized vertices, sparse
accessors, external buffers or images, and non-triangle primitives. Skins and
animations are ignored (bind pose), and only the first textured material's
image is used for the whole mesh. `gltf.inspect` lists all of this before you
import.

Tests: `node --test plugins/org.unone.gltf/test/gltf.test.mjs`, and the engine
test `the_bundled_gltf_importer_flattens_nodes_flips_uvs_and_keeps_the_texture`
runs the importer on `test/fixtures/quad.glb`.
