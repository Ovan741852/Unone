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
Performance: per-stage timings, bounded-window median/p95, frame counts and Luau heap measurements;
these are measurements, not deterministic gameplay facts or automatic verdicts.

Core: fixed timestep, seeded random, deterministic replay/digest, 2D gravity,
damping, ground friction/restitution and circle contacts; Camera2D with declared
view_height; host-wired 2D transforms and painter order; Camera3D, static meshes
and Rapier 3D bodies/queries/sensors; anchored/absolute UI trees and the official
`@unone/ui` package; opaque game-owned save transport; optional demand-sampled
monotonic host time; batched spatial queries and ordered physical-input records;
Spine/Effekseer semantic states; verified asset archives and bundle
cache/generation; checked Luau type contracts. See the bounded
[engine stability work](issues/2026-10-29-engine-stability.md) for current fixes
and validation limits.

Hosts exist for native wgpu preview, Web runner/presentation and Android package
execution. Their capability sets are not equivalent.

## Immediate sequence

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
| 8 | Import pipeline | Static engine mesh JSON is supported. General GLB ingestion and broader material/animation conversion remain open; see the [Wuxia capability audit](issues/2026-09-19-wuxia-engine-capability-gap-audit.md). Convert external formats into engine contracts, not game policy. |
| 9 | Non-circle colliders | [3D sphere, oriented box, capsule, convex hull and static triangle mesh](physics3d.md) exist. 2D remains circle/ground based; do not describe the 3D engine as circle-only. |
| 10 | Multiple pointers | [Ordered physical input](ordered-physical-input.md) carries pointer identities and multiple-pointer records. Legacy semantic input remains one pointer; native live routing and touch/device acceptance need explicit host work. Engine owns identities; game owns gestures. |
| 21 | Reliable authoring start | Init/scene/API changes are candidates, not finished game acceptance. See [work package](work-packages/2026-09-06-ai-authoring.md). |
| 22 | Sprite frame animation | Spine is not ordinary sprite frame/UV animation. Add fixed-tick states and host UV rendering when needed, not a timeline editor first. |
| 23 | Native save persistence | Core transports opaque save JSON and Web persists it; native currently supplies no durable save read/write adapter. Restore before Game.start and persist committed payloads through a reusable host contract. |
| 24 | Wall-clock time / offline progress | [Host time](host-time.md) is runtime-relative monotonic elapsed time, not a UTC/wall clock. Offline progress needs an explicit host wall-clock input and persistence contract; reward calculations stay in Luau. |
| 25 | Shipping random seed policy | Official Web player loads/restarts with seed 42; native defaults to 42 unless explicitly configured. Define a host entropy/default-seed policy while retaining explicit seeds for replay. This is not a randomness-quality or gambling-security guarantee. |
| 26 | Modules and data loading | Game scripts have no supported general `require` or packaged structured-data module loader. Add a bounded package-relative contract for reusable code and authored data; do not make every game inline its tables. |
| 27 | Runtime entity assembly | `entity.spawn` creates a bare entity. General runtime sprite/mesh attachment and sprite asset replacement are missing. Existing 3D body lifecycle APIs do not supply a complete rendered-object assembly path. |
| 29 | Skeletal animation | No shipped general 3D skeletal animation path; Spine semantic state alone does not establish native/export playback. Keep this separate from ordinary sprite frame animation (22). |
| 30 | Gamepad input | No official host gamepad contract and cross-target acceptance. Add normalized controls, connection lifecycle and replayable input before game-specific mappings. |
| 31 | Navigation / pathfinding | No reusable navigation/pathfinding API. Choose geometry/query primitives from concrete RTS needs; unit orders, steering rules and movement policy stay in Luau. |
| 32 | Lighting and materials | Current basic 3D presentation is predominantly unlit. General lighting/material support and imported-material parity remain open; engine rendering owns GPU resources. |
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
