# Dragon Tycoon 3 engine probe

## Web and Android builds

Local deliverables: `dist/dragon-tycoon3-web.zip` (deploy its contents to a static
HTTP server) and `dist/dragon-tycoon3-android.apk` (offline WebView player, local
test signature). `dist/web` is the unpacked Web version. Both contain the same
verified release player/content. [distributions.json](distributions.json) records
sizes, hashes, embedded-file verification and platform checks. Android 14 / WebView
137 emulator testing covers 3D presentation, touch hits, visible particles and
pause/resume; physical devices have not been tested.

Rebuild Web with `game --project _Games/dragon-tycoon3 export web --output <new-dir>`;
then use [the Android packaging script](../../platform/android-player/README.md)
on that export. These outputs remain local under the ignored `dist` directory.

Reference: https://www.slam777.com.tw/game/38 (獵龍戰紀 3, Creator 3.8.5).
This is a small offline reconstruction experiment for finding engine gaps.
It is not the original game's client or a complete remake. No account, wagering,
server or payment logic is included. Login was used to inspect the reference;
session tokens and credentials are not retained in the project.

`tools/collect_creator.py` downloads only manifest-declared public resources.
The completed collection has 5,841 import/script/native entries, 349,658,291 bytes,
zero failed downloads and zero native entries with unresolved extension metadata.
Configs/settings are retained alongside them. `reference/creator/collection.json`
contains hashes and UUID/logical-path mappings. This does not recover original
Creator editor sources or prove every decoder works. Resource versions may change
on the remote server. Raw reference assets and generated players remain local and
are ignored by Git.

Run `python tools/prepare_probe.py` from this directory after collection. It now
calls `tools/import_art.py`: six original actor meshes (four dragons, pterosaur,
tiger), the original cannon and floor, with eight unchanged original textures.
Twelve moving actors use these meshes instead of the previous sphere proxies.
`asset-provenance.json` records source logical paths, conversion bounds and hashes.
Click targets or the hit-test button. `game test` exercises two deterministic hits.

The adapter extracts static rest poses from inspected Creator 3.8 vertex buffers.
Skeleton clips, skinning, source prefab transforms and original material/shader
behavior are not restored. Texture pairs and display scales are curated. In
particular, the floor has source UVs outside 0..1 and currently uses clamp sampling;
its edge stretching remains a material/sampler integration gap. These are real
3D meshes, but this is not a visual reconstruction of the complete original game.
See [the mesh contract](../../docs/static-mesh.md).

The current art packages contain 34 matching export files: Web ZIP 1,351,991 bytes,
Android APK 1,375,669 bytes. Both were visually checked with the original models;
Web hit-button interaction also passed. The Android check used a Pixel 8 / Android
14 emulator, not a physical phone. Earlier proxy measurements below are historical.

## Reproduced gaps

Run `python tools/check_gaps.py`; [gap-results.json](gap-results.json) records failures.

| Attempt | Actual obstacle | Needed engine capability |
|---|---|---|
| Reuse `res/fbx/scene/scene1/scene1/scene1_floor` | Raw Creator `.bin` still fails; the new curated static conversion renders it | General material/sampler/prefab resolution beyond the selected adapter |
| Create a new 3D fish with spawn + setTransform3D | New entity has no Transform3D, setter rejects it | Typed component/lifecycle creation, followed by prefab/package support |
| Shoot through the camera into the world | No `physics.raycast3D` API | Camera ray construction and 3D queries/physics |
| Reuse original animated actors | Collection includes Skeleton, AnimationClip and skinned assets; there is no corresponding import route | Skeleton/clip/skinning import and renderer integration; collection alone is insufficient |
| Reuse original atlases/effects | Image bytes load, but atlas regions/material UVs and `.efk` companion remapping are separate contracts | Sprite-frame/atlas and effect dependency adapters |

The playable slice predeclares targets and uses a game-owned approximate ray/sphere
test. These are explicit workarounds, not completed engine features. The first three
gaps have executable negative probes; the remaining two are inventory/implementation
findings, not claims of completed decoder tests. The original live session expired
while resources were collected; no paid gameplay was performed.

The experiment also fixed a real player boot defect (Emscripten/Binaryen name-map
incompatibility), exposed `.mjs` MIME handling on Windows, added primitive 3D
presentation and native particles, and made unsupported player mesh/effect paths
fail visibly.

## Measurements

`measurements.json` records the earlier proxy build, not the current art build.
See `distributions.json` for current archive hashes/sizes and validation. One local
browser run with all original art reached first content in 357.2 ms; this is not a
repeated benchmark or an Android startup measurement.
Startup is HTML-bootstrap-to-first-content on this Windows machine using localhost,
gzip and HTTP no-store. Browser/OS caches may still accelerate compilation; these
are not mobile-network or fresh-browser guarantees. The full reference collection
is not part of the exported game's download.

`game perf --frames 600 --json` and the player's DOM measurement attributes provide
raw simulation/presentation timings. A low headless mean does not prove GPU speed;
the current particle renderer uses one sprite per particle and needs instancing
before high-density effects. No universal performance verdict is encoded in a tool.
