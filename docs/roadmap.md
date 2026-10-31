# Unone engine roadmap

Unone is a 3D engine with 2D workflows. This is the current engine capability roadmap. Validation games measure engine
gaps, not opportunities to put game-specific policy in core. The final authority
remains `D:/Projects/Unone_Games/validation/acceptance-matrix.json`: overall
`not_passed`, all seven final games `in_progress`.

For the product-level direction across Editor, AI Workshop, plugins, assets,
SDK packaging, and the optional marketplace, see
[platform-architecture.md](platform-architecture.md).

## Delivery policy

- Prioritize usable capabilities over additional verification machinery.
- Keep `game verify` as the aggregated author entry point: types, strict assets,
  applicable layouts and tests. Package/host parity belongs to the distributor.
- Add checks for concrete failure modes, preferably within existing entry points.
  Preserve defenses against data loss, corrupt content and inconsistent state.
- Reserve ADRs for shared boundaries and material alternatives. Field definitions
  belong in schemas/API docs; ordinary fixes belong in issues/devlogs and tests.
- Engine-authored public text is English. Game/user content and Unicode fixtures
  remain unrestricted. Preserve raw historical evidence; replace obsolete current
  guidance in place rather than maintaining competing specifications.
- Necessary host mechanisms remain this engine project's responsibility. Do not
  make games compensate for missing engine features or host bugs.

See the [authorized delivery plan](work-packages/2026-09-06-capability-first.md).

## Available today

Author tools: verify, systems list/search/set, API search/describe/typings.
Diagnostics: semantic observations, UI preview, trace, replay record/diff.
Performance: per-stage timings, bounded-window median/p95, frame counts and Luau heap measurements,
startup phases, and game-defined spans/counters ([api.profile](profiling.md)) that never reach the digest;
these are measurements, not deterministic gameplay facts or automatic verdicts.

Core: fixed timestep, seeded random, deterministic replay/digest, 2D gravity,
damping, ground friction/restitution and circle contacts; Camera2D with declared
view_height; host-wired 2D transforms and painter order; Camera3D, static meshes
and Rapier 3D bodies/queries/sensors; anchored/absolute UI trees and the official
`@unone/ui` package; opaque game-owned save transport persisted by the Web and
native players; optional demand-sampled
monotonic host time; batched spatial queries and ordered physical-input records;
Spine/Effekseer semantic states; verified asset archives and bundle
cache/generation; checked Luau type contracts. See the bounded
[engine stability work](issues/2026-10-29-engine-stability.md) for current fixes
and validation limits.

Hosts exist for native wgpu preview, Web runner/presentation and Android package
execution. Their capability sets are not equivalent.

## Immediate sequence

The current user-directed performance priority is the official Web player.
Use [Decision 0044](decisions/0044-retained-presentation-resources.md) for the
resource/instance/stream boundary: complete the existing sprite/UI paths and
measure end-to-end retention/transport before adding another low-level 2D
authoring API. The resource transport and new authoring capabilities in that
decision are planned, not currently implemented or a 60 FPS acceptance claim.

1. Keep runtime data contracts unique: Rust DTOs generate JSON schemas; unknown
   typed fields fail ingestion; common host loaders and normalized replay fixtures
   prevent silent platform drift. See [runtime contracts](runtime-contracts.md).
2. Provide AI-operated observation, input, debug edits and raw measurements through
   [developer sessions](developer-session.md). Include 3D entity/camera experiments
   and replay. Diagnosis and optimization decisions belong to the AI.
3. Validate the 3D racing workflow and extend real 3D needs: entity lifecycle,
   mesh/material import, camera/picking, host rendering and 3D physics. Existing
   2D fixtures remain regression coverage; their convenience does not set direction.
4. Extend the implemented [AI-native particle v1](native-particles.md) alongside Effekseer. Keep Spine
   as an external format/runtime integration. Do not promise deterministic pixels
   from external renderers or force external formats into an invented DSL.

Audio decisions and Web/native playback exist; Android playback and native
feature parity remain open. Android Canvas is currently a limited 2D adapter,
not the engine's intended dimensional boundary. Representative device
validation is still required.

## Capability backlog

Stable IDs are retained for existing references, not a competing priority order.

| ID | Capability | Current gap / smallest useful scope |
|---|---|---|
| 2, 3 | 2D transforms and painter order | Core, official Web and native sprite paths implement positive finite scale, centered radians and signed i32 layer/UTF-8 ID ordering. See [contract](work-packages/2026-09-06-2d-transform-layer.md), [delivery record](devlog/2026-09-06-2d-transform-layer.md) and [independent colliders](decisions/0034-independent-2d-colliders.md). No angular 2D physics; other hosts need their own output evidence. |
| 1 | Audio | Core, Web and native playback are implemented, including native loop/event synchronization. Remaining: Android playback, target-specific parity and reserved category rules (`max_concurrent`, `on_limit`, `ducking`, `priority`, `exclusive_group`), which fail loading rather than silently doing nothing. |
| 4 | Timers/tween | Games currently count frames. Consider fixed-frame mechanisms from concrete needs; no coroutine framework. |
| 5 | Scene switching | Only main_scene loads. Define runtime state ownership and save relationships first. |
| 6 | Physics queries | [3D closest raycast, convex shape cast and overlap queries](physics3d.md) and [batched spatial geometry queries](spatial-batches.md) exist. General 2D physics raycast/region-query APIs remain open; deterministic hit ordering stays part of each contract. |
| 7 | Sensors/triggers | [3D sensors with enter/stay/exit contacts](physics3d.md) exist. General 2D sensor/trigger support remains open. |
| 8 | Import pipeline | [Asset imports](import-pipeline.md): an asset declares which project importer (a pure Luau node with typed ports) makes its file from read-only roots or other assets; every development host and export brings imported files up to date with caching and provenance, so new source formats need no engine change. A file needing no conversion is copied with `import.from`; `game check` rejects data pasted into scripts as large string literals (SCRIPT_EMBEDDED_DATA) and points to data assets. Products are bytes, RGBA images (PNG) and JSON. Remaining: running importers at runtime over player-selected files, mesh/audio product types, GLB ingestion; see the [Wuxia capability audit](issues/2026-09-19-wuxia-engine-capability-gap-audit.md). Convert external formats into engine contracts, not game policy. |
| 9 | Non-circle colliders | [3D sphere, oriented box, capsule, convex hull and static triangle mesh](physics3d.md) exist. 2D remains circle/ground based; do not describe the 3D engine as circle-only. |
| 10 | Multiple pointers | [Ordered physical input](ordered-physical-input.md) carries pointer identities and multiple-pointer records. Legacy semantic input remains one pointer; native live routing and touch/device acceptance need explicit host work. Engine owns identities; game owns gestures. |
| 21 | Reliable authoring start | Init/scene/API changes are candidates, not finished game acceptance. See [work package](work-packages/2026-09-06-ai-authoring.md). |
| 22 | Sprite frame animation | [Sprite sheets and fixed-tick clips](sprite-animation.md): `sprite.sheet`/`sprite.frame` pick an equal-grid cell, `sprite_animation` and `entity.playSpriteAnimation`/`setSpriteFrame`/`getSpriteFrame` step cells on the fixed tick, and observations carry the resolved cell, which the official Web (Three.js, raw WebGPU, runner DOM) and native wgpu sprite paths sample. Remaining: per-cell durations or events, packed/trimmed atlases, flipping and clip blending, added from concrete needs; skeletal animation stays separate (29). |
| 23 | Native save persistence | Web (localStorage) and the native player persist `api.save`: Windows `%APPDATA%/Unone/<project>/save.json`, Android NativeActivity internal data `save.json`. Restore precedes Game.start; changed encodings are written atomically; replay/measurement runs stay off and corrupt saves fail startup. See [player export](player-export.md). Remaining: an Android build and on-device restart evidence, plus any slot/cloud/export story a game concretely needs. |
| 24 | Wall-clock time / offline progress | [Host time](host-time.md) is runtime-relative monotonic elapsed time, not a UTC/wall clock. Offline progress needs an explicit host wall-clock input and persistence contract; reward calculations stay in Luau. |
| 25 | Shipping random seed policy | Shipped players draw a fresh seed per session: the official Web player per load/restart (`?seed=<u64>` reproduces one; published as `data-player-seed`), native interactive play per launch (`--seed` overrides; report records it). Native tool runs and development hosts keep seed 42. See [player export](player-export.md). This is not a randomness-quality or gambling-security guarantee. |
| 26 | Modules and data loading | Game scripts have no supported general `require` or packaged structured-data module loader. Add a bounded package-relative contract for reusable code and authored data; do not make every game inline its tables. [Data assets](data-assets.md) deliver packaged files to Luau through `api.assets.load` with manifest-named loaders (bytes, text, json, or runtime-registered), as frozen values. Remaining: a code module `require`. |
| 27 | Runtime entity assembly | `entity.spawn(name, components?)` assembles transform, sprite, shader material, mesh3d, 2D rigid body and animation from the scene entity fields, with the same validation and unknown-field rejection; `entity.setSprite` swaps or removes a sprite. Sheets and frame clips (`sheet`, `frame`, `sprite_animation`) assemble the same way. Remaining: 3D physics bodies, which keep their own lifecycle API. |
| 29 | Skeletal animation | No shipped general 3D skeletal animation path; Spine semantic state alone does not establish native/export playback. Keep this separate from ordinary sprite frame animation (22). |
| 30 | Gamepad input | No official host gamepad contract and cross-target acceptance. Add normalized controls, connection lifecycle and replayable input before game-specific mappings. |
| 31 | Navigation / pathfinding | No reusable navigation/pathfinding API. Choose geometry/query primitives from concrete RTS needs; unit orders, steering rules and movement policy stay in Luau. |
| 32 | Lighting and materials | Current basic 3D presentation is predominantly unlit. General lighting/material support and imported-material parity remain open; engine rendering owns GPU resources. |
| 34 | Runtime meshes and camera projection | [Retained world meshes](geometry3d.md) (`api.geometry3d`) and perspective camera curvature/rect are drawn by the official Web player; camera motion costs no Luau vertex work. Meshes can name a [shader material](shader-materials.md#mesh-materials-and-the-vertex-stage) with its own vertex stage, declared per-vertex attributes, varyings and samplers over [runtime data textures](data-textures.md), so a game can run its own exact projection on the GPU. Remaining: native wgpu drawing (it rejects them explicitly), lit materials, and rect together with bloom/render pipelines. |
| 35 | Rendering backends: newest first, with fallback | The official Web player always uses WebGL2; the WebGPU adapter rejects shader materials, projected geometry and postprocessing. Native wgpu already prefers Vulkan/DX12/Metal and falls back to GL. Target: material stages keyed by shading language -- the existing GLSL ES 3.00 as the WebGL2 fallback, plus optional WGSL shared by WebGPU and native wgpu -- and automatic backend selection that picks the most capable backend able to draw the whole scene, falls back otherwise, and reports the chosen backend and the reason for any fallback. No silent visual downgrade: a backend that cannot draw some content is not selected. |
| 33 | Localization | No implemented string-table/resolution contract. The [localization proposal](work-packages/2026-09-06-localization-seam.md) is design work, not a callable API. |

## Reliability and evidence

| ID | Item | Current evidence and limits |
|---|---|---|
| 11 | Asset workflow / full generation | Bounded Rust/clippy, CLI/Wasm/Android builds, package maintenance and native/Web checks recorded in [predecessor evidence](evidence/2026-09-06-ai-authoring/predecessor-gate.json). Raw-evidence gaps and untested platforms remain explicit, not full hot-update or seven-game acceptance. |
| 12 | API project context | Shared CLI/MCP structured actions bind systems discovery to caller root. Global lookup stays project-independent. Source review has no confirmed blocker; executable empty-query and relative-root tests pass. New-package/game verification pending. See [issue](issues/2026-09-06-api-search-project-context.md). |
| 13 | Package parity | Package verifier detects CLI/Wasm contract mismatch; author verify runs native checks. Do not duplicate distributor responsibilities in author workflow. |
| 14 | Web digest | Shared Rust digest wired and checked via ABI, JS and source-mode browser smoke. New immutable-package evidence pending; see [record](devlog/2026-09-06-digest-integration.md). |
| 15 | World inspection | No world ASCII map. Camera view_height fixed a framing root cause; missing map is not grounds for speculative verdicts. |
| 16 | Types gate diagnostics | Analyzer execution failure is distinguished from type errors through `LUAU_ANALYZER_FAILED`, with a regression for a failed analyzer process. The [historical intermittent report](issues/2026-09-06-verify-types-step-flaky.md) is not evidence of a current reproducible defect; any new recurrence needs its exact analyzer diagnostic. This does not claim all analyzer/toolchain failures are solved. |

## Platform gaps

| ID | Gap | Current limitation |
|---|---|---|
| 28 | Native UI | Native wgpu renders ordinary non-DOM UI, images/static SVG and text fields; [scroll views/virtualization](ui-scroll.md) reject with `UI_HOST_CAPABILITY_UNSUPPORTED`, and [text editing/IME](ui-text-input.md) is Web-only. Native cursor presentation, editing and device/whole-game acceptance remain open. Windows SVG fixture/SDK evidence is [recorded](reviews/2026-09-10-svg-sdk.md). ID 28 replaces the former duplicate 16; reliability item 16 keeps its original identity. |
| 17 | Native textures | Native sprite/mesh/UI texture decoding and GPU upload are implemented; it no longer draws only procedural sprite shapes. See [native asset loading](native-asset-loading.md). Remaining work concerns decoder/material parity, large-asset costs and target-specific visual evidence. |
| 18 | Native/mobile Spine and Effekseer | Actual presentation is Web-only; semantic state is not playback. |
| 19 | iOS host | ABI exists; implementation and device evidence are absent. |
| 20 | Large asset delivery | Whole-bundle loading remains; production streaming/CDN/OPFS/quota policies are not implemented. |

## Localization

The engine has no implemented string-table contract. Games currently author
literal text or their own Luau lookup tables. The
[work package](work-packages/2026-09-06-localization-seam.md) proposes `text_key`
and named parameters resolved before host presentation, with missing-key errors
and untranslated observation tokens. These proposed fields are not accepted by
the current UI schema. Ship one language with a game-owned data seam until a
versioned reusable contract is implemented.

Text length varies by language, so a layout can pass in one and overlap in
another. A future localization-aware layout gate must validate every supported
locale; no such automatic locale sweep is currently shipped.

## Shipping a game

`game export web --output <dir>` now builds a self-contained single-game directory
from a separately compiled release player. See [player export](player-export.md)
for the compile-time boundary, commands, measured payload and supported decoders.
The editor/runner, MCP, bundles, schemas and reload code are excluded from the
player build. Shipping support currently covers WebGL primitives, image sprites,
UI, Web Audio, static engine mesh JSON, native particles and the supported legacy
SKFE 1500 Effekseer path. Other mesh encodings, Spine and unsupported Effekseer
encodings fail export. Native/mobile shipping parity remains open.

## Deliberate exclusions

- No imitation Unity prefab/Cocos scene model; external formats belong in imports.
- No full CSS engine or embedded browser framework in core. Native UI backend
  choices need AVG/RTS evidence. The official Web player uses Canvas UI with
  host editing sinks where the text-input contract requires them.
- No user-pluggable verdict rules or guessed constants presented as facts.
- No mesh UI conversion merely to differentiate the engine; preserve text/input
  and accessibility requirements when selecting host implementations.

## Acceptance

Final games remain 3D racing, RTS, idle combat, AVG, auto chess, slot machine and
fish game. Angry Birds is the intermediate physics/authoring stress test.
Historical headless passes do not establish later patches or actual host output.

For each capability: define the minimal contract, implement usable end-to-end
behavior, test concrete risks, then run independent package-only game validation.
Keep limitations, raw evidence and reasons for changes discoverable.
