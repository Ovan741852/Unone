# Downloaded model provenance

Downloaded 2026-09-19 from the original author's website. Both packs use **CC0 1.0**, including commercial use. Original license files are retained below `external/`.

| Pack | Official source | Use here |
|---|---|---|
| Kenney Fantasy Town Kit 2.0 | https://kenney.nl/assets/fantasy-town-kit | Four modular house variants, market stalls, carts, trees, lanterns, fountain, rocks |
| Kenney Mini Characters | https://kenney.nl/assets/mini-characters | Twelve character appearances, assigned across forty named residents; original preview PNGs used as portraits |

Archive SHA-256:

- `kenney_fantasy-town-kit_2.0.zip`: `1a7530c09f4d2fa2cdee259876f089334f8b1f27fa86a0c4f54ef86cdd8676ef`
- `kenney_mini-characters.zip`: `9e1d48e6d7b8479ebbe84df71eb5bd8e1b3f0da546dea641890dccc8a02d0999`

Import process: `node tools/build-town.mjs` parses original OBJ positions, UVs and faces into Unone `.mesh.json`, triangulates polygon faces, assembles downloaded wall/roof modules, and normalizes characters to 1.85 world units. Source palette textures are copied unchanged. The simple ground/road/river surface is project-authored, not a downloaded town model.

This is low-poly placeholder art, not historically accurate wuxia clothing. OBJ characters are static meshes: they translate and turn, but do not yet have a skeletal walk cycle. Forty identities do not mean forty unique mesh files (twelve visual variants are reused).

During import D: ran out of space. Originals were preserved at `C:\Users\liNao\Documents\ComfyUI\wuxia-model-sources`; `assets/external` is a directory junction to that folder. No source model was deleted. The compact game-ready meshes and textures remain in this project under `assets/imported`.
