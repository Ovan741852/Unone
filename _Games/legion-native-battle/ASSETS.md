# Asset provenance

The converted meshes and palette in `assets/` are included so the demo does not require Blender or downloading source archives to run.

| Source | Author | License | Used for |
| --- | --- | --- | --- |
| [Animated Knight](https://quaternius.itch.io/lowpoly-animated-knight) ([license page](https://quaternius.com/packs/knightcharacter.html)) | Quaternius | CC0 | Knight and sword |
| [Animated Animals](https://quaternius.itch.io/lowpoly-animated-animals) | Quaternius | CC0 | Horse |
| [Low Poly Medieval Weapons](https://lowpolyassets.itch.io/low-poly-medieval-weapons) | LowPolyAssets | CC0 | Bow, ballista, catapult and boulder |

`build_models.py` uses Blender 5.1 to freeze an animation pose, decimate meshes, recolor armor by team, bake directional shading into a palette, and combine equipment. These are **static posed meshes**, not skeletal animation playback. Terrain, colored tabards, flying-unit wings, mage accessories and effect geometry are assembled by the demo converter.

To rebake, download and extract the packs under repository `artifacts/legion-assets/` as `knight/`, `animals/`, and `weapons/` (paths are listed in the converter), then run Blender with `--background --python _Games/legion-native-battle/build_models.py` from the repository root. Raw archives are not committed.

Recorded source archive SHA-256:

```text
knight.zip   94FF0550D0A593AAF2F2D102EC90D4B63A1C0C1DA77FCEF892B72C8AF81DC38D
animals.zip  B4BC5F209368CAFC21962934E7D676CF1CFB1F746A363086CD9F45C4385DB70E
weapons.zip  2CF1CCBAEB1F9151CA980F722D1F552C2700C08ACA3F59FFEC03732AE53CD2EB
```
