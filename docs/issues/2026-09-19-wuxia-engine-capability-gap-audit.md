# Unone Engine Capability Gap Audit: Wuxia Sandbox

Status: requested engine backlog
Date: 2026-09-19
Scope: the 40-resident 3D wuxia town, using free external assets, native CLI preview, the Web runner, and an AI-operated inspection loop.

This is an engine/host request, not a request to move gameplay into Rust. NPC goals, relationships, work schedules, jealousy, cooperation, crimes, combat outcomes, and the reason for each action remain Luau-owned. Unone should provide reusable asset, presentation, input, audio, navigation, and persistence primitives.

## Evidence from the current slice

- `_Games/wuxia-sandbox/project.unone.json` enables `camera3d`, `observation`, and `ui`; it does not enable audio, particles, or physics.
- The game currently uses custom mesh JSON and a PNG palette. The downloaded repro fixture is `assets/external/plewr-character.glb`, SHA-256 `939D0D0F1E1D563350BA6C6FDA42E29FF004083F7C5BD3288A778B55D0FE0E7`.
- `game preview` can produce a native screenshot, but the current CLI renderer is a deterministic mesh-silhouette renderer and reports `includes_ui: false`; it does not provide the same textured 3D/UI result a player sees in a real game.
- The engine already has semantic `Mesh3D`, camera, UI, save transport, animation, audio, and physics APIs. Several of those are contracts or host-required paths rather than complete cross-host presentation capabilities.
- The existing roadmap already calls out import pipeline, native textures, native/mobile audio, scene switching, navigation-related queries, and host parity. This issue consolidates the gaps exposed by one real game instead of treating each symptom as a game workaround.

## Requested backlog

| Priority | Capability | Current gap | Smallest useful acceptance |
|---|---|---|---|
| P0 | Shared GLB/glTF 2.0 import | Itch assets commonly arrive as `.glb`; the current manifest/hosts do not consume this fixture as a `mesh3d` asset. | `asset inspect`, `bundle pack/install`, native preview, Web runner, and export can resolve one stable asset ID. Support embedded and external/data-URI buffers, node transforms, primitives, indices, POSITION/NORMAL/TEXCOORD_0, PNG/JPEG images, base-color factor/texture, and deterministic diagnostics for unsupported extensions. |
| P0 | Native 3D renderer parity | CLI preview currently draws silhouettes/boxes and ignores mesh UV materials; native screenshot excludes semantic UI. A successful asset decode is not visible proof. | Render the same mesh/material/texture data used by the asset contract, then render the published UI tree (text, buttons, images) in the screenshot path. Return capability metadata when a host intentionally omits a layer. |
| P0 | Cross-host character animation | `animation.play` publishes semantic state, but the engine does not evaluate glTF skins, animation clips, blending, or completion, and native/Android playback is incomplete. | A skinned GLB with idle/walk/attack clips renders and advances on native and Web; looping, speed, blend/transition, root transform policy, and clip completion are deterministic and inspectable. |
| P0 | Screen-pointer normalization and picking | A native window reports pixel coordinates while the game UI uses normalized 0..100 y-up coordinates. The host path currently conflates world and screen pointer values, so clicking a resident can miss the Luau UI hit-test. | Every host supplies both world and normalized screen coordinates, with DPI, resize, y-axis, and outside-viewport behavior covered by one shared test fixture. A native click selects a resident and the next snapshot exposes its detail view. |
| P1 | Navigation primitive | The game can provide a Luau `pathfind` extension, but there is no reusable navmesh/agent path query for obstacles, reservations, or stuck detection. | Import or build a deterministic walkable navmesh, query a path for an agent, return stable waypoints/cost/failure, and leave movement policy in Luau. |
| P1 | Complete 3D interaction layer | Physics3D and ray/sweep contracts exist, but a town still needs trigger volumes, character-controller movement, obstacle queries, and deterministic click-to-world picking. | Add the smallest reusable trigger/query/controller primitives; expose contacts and failures in snapshots without encoding wuxia rules. |
| P1 | Native and Android audio playback | Core requests/mixing are modeled; the native player now has a rodio/cpal adapter with explicit device/asset diagnostics. The Android NativeActivity uses the same native player path; the legacy Canvas smoke host remains semantic-only. | Verify one-shots and loops on a real Windows device and Android NativeActivity package, including pause/resume, bus volume, entity attachment, and host accepted/failed evidence. |
| P1 | Runtime scene/content lifecycle | Only `main_scene` loads and whole-bundle loading remains. A real town needs loading another area and large asset bundles without blocking the frame. | Add explicit scene transitions and host-owned streaming/cache/quota hooks with atomic bundle generations, progress, cancellation, and failure recovery. |
| P1 | Game persistence beyond opaque payload transport | `api.save` is a useful contract, but the host owns storage and there are no engine-level slots, atomic writes, corruption/version diagnostics, or resumable save evidence. | Keep the schema game-owned, but provide host storage primitives for named slots, atomic commit, checksum, migration failure, and load/save test evidence. |
| P2 | Authoring and inspection for imported 3D assets | There is no single GLB inspection/thumbnail/animation-list workflow that an AI agent can use before putting an asset in a scene. | Add `asset inspect --format glb` facts for bounds, nodes, materials, textures, skins, clips, file dependencies, licenses, and a deterministic preview thumbnail. |
| P2 | 3D presentation features | The current preview is intentionally low-model; lighting, shadows, LOD, culling, and material diagnostics are not a complete player surface. | Establish a minimum native/Web 3D presentation profile for meshes, textures, lights/shadows, camera, culling, and GPU budget reporting; fail clearly when a host is below it. |

## Do not close this by changing the game

The project should not convert every GLB to custom mesh JSON, replace walking with teleporting, draw status only in observations, or implement an A* solver as a one-off Luau workaround when the reusable host primitive is the missing piece. Those can remain temporary fallbacks, but they are not engine acceptance.

## Non-gaps already usable

The current slice already demonstrates Luau gameplay ownership, fixed-step updates, seeded deterministic replay, 3D transforms/camera semantics, semantic observations, UI-tree transport, relationship/state simulation, and a native screenshot endpoint. These should be preserved while the host capabilities above are filled in.

## Definition of done for this request

1. Give each row a tracked Unone issue/owner and keep the priority labels.
2. Add one small cross-host fixture around the downloaded GLB rather than another game-specific asset converter.
3. Do not claim “3D support” from headless snapshots alone; require a native/Web screenshot or an explicit host capability result.
4. Keep the Wuxia Sandbox fallback running while the engine work lands, but remove the fallback from the release acceptance once the corresponding row is verified.

Reference fixture: [Plewr 3D Rigged Character Model](https://plewr.itch.io/3d-rigged-character), downloaded as a free CC0 asset for this reproduction.
