# Textured static meshes

The Web player and offline Android WebView player accept `mesh3d` assets whose
source ends in `.mesh.json`. Scene entities reference their asset ID in `mesh3d`
and use the existing `transform3d` component. The development Three renderer uses
the same decoder. This does not add decoding to the native Canvas host.

Version 1 has exactly five fields: `version: 1`, flat finite XYZ `positions`,
flat finite `uvs` (two per vertex), triangle `indices` (three zero-based integers
per triangle), and `texture` (a declared `texture2d` asset ID). Unknown fields,
out-of-range indices and missing textures fail explicitly. The limits are one
million vertices and two million triangles. UVs follow Three TextureLoader's
image convention; the Creator adapter flips V during conversion.

An explicit asset encoding uses `format: unone-mesh-json`, `mime: application/json`,
`decoder: mesh`, and `companions: []`; the texture is a separate manifest asset.
The current material is unlit, double-sided with alpha test 0.05. Normals are
computed from triangles. There is no imported lighting, normal map, skinning,
animation clip, material graph or automatic Creator prefab reconstruction.

`_Games/dragon-tycoon3/tools/import_art.py` converts eight selected, locally
collected Creator 3.8 meshes and copies their eight original textures unchanged.
It uses the bundle pack index to locate metadata, validates the observed vertex
layout and index ranges, then normalizes each static rest pose. Unsupported
layouts stop conversion. Texture pairing is curated from logical resource names.
`asset-provenance.json` records source paths, bounds, counts and output hashes.
