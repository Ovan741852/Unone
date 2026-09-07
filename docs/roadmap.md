# Unone engine roadmap

This is the current engine capability roadmap. Validation games measure engine
gaps, not opportunities to put game-specific policy in core. The final authority
remains `D:/Projects/Unone_Games/validation/acceptance-matrix.json`: overall
`not_passed`, all seven final games `in_progress`.

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
view_height; Camera3D/Mesh3D semantic contracts; anchored/absolute UI trees;
opaque game-owned save transport; Spine/Effekseer semantic states; verified
asset archives and bundle cache/generation; checked Luau type contracts.

Hosts exist for native wgpu preview, Web runner/presentation and Android package
execution. Their capability sets are not equivalent.

## Immediate sequence

1. Close the existing bounded authoring correction: five-file project init,
   starter tests, shared strict scene ingestion and project-bound API discovery.
   Source changes exist; final package and independent game evidence remain.
2. Complete ordinary 2D rotation, scale and painter order on Web first.
   Core/schema/Luau already expose these fields. Fix the Web DOM center
   offset in this same slice. Preserve independent colliders.
3. ~~Deliver minimal Web audio through a reviewed lifecycle contract and actual host
   playback.~~ **Delivered**: `api.audio.play` / `loop` / `stop` / `stopAll`,
   `world.audio_events` and `world.audio_loops`, project-declared categories with
   `exclusive` and frame-exact fades, and playback in `web/presentation`. See the
   [audio work package](work-packages/2026-09-06-audio.md), plus the bus volumes,
   pause/resume and entity-attached sources every shipping engine has. A real
   cross-fade was measured in the browser:
   [evidence](evidence/2026-09-06-audio/). What is still missing is a person
   actually hearing it on a real game with licensed assets, and native/Android
   hosts remain silent.

Android implementation, rebuilding and device validation follow Web and are not
exit conditions for this slice. Native parity is also deferred, not implied.

The previously approved hot-update failure-consistency repair is delivered for
the Web runner: stage content, compare-and-set the generation pointer, perform
transactional Luau reload, and restore only the pointer on script failure.
Generation identifiers remain monotonic across rollback. Keep this boundary
bounded; do not create a general transaction/update framework.

## Capability backlog

Stable IDs are retained for existing references, not a competing priority order.

| ID | Capability | Current gap / smallest useful scope |
|---|---|---|
| 2, 3 | 2D transforms and painter order | Host wiring pending: positive finite scale, centered radians, signed i32 layer then UTF-8 ID byte order. See [contract](work-packages/2026-09-06-2d-transform-layer.md) and [independent colliders](decisions/0034-independent-2d-colliders.md). No angular physics. |
| 1 | Audio | **Core and Web host delivered**, including bus volumes, pause/resume and entity-attached sources. Remaining: native and Android playback, and the reserved category rules (`max_concurrent`, `on_limit`, `ducking`, `priority`, `exclusive_group`), which today fail the load rather than doing nothing. |
| 4 | Timers/tween | Games currently count frames. Consider fixed-frame mechanisms from concrete needs; no coroutine framework. |
| 5 | Scene switching | Only main_scene loads. Define runtime state ownership and save relationships first. |
| 6 | Physics queries | Contacts exist, raycast/region queries do not. Return deterministically ordered hits. |
| 7 | Sensors/triggers | Contact-only colliders without physical resolution are missing. |
| 8 | Import pipeline | Convert external formats into engine contracts, not Unity/Cocos semantics in core. |
| 9 | Non-circle colliders | Only circles and a ground plane; add the smallest required shapes. |
| 10 | Multiple pointers | One pointer currently. Engine owns identities; game owns gestures. |
| 21 | Reliable authoring start | Init/scene/API changes are candidates, not finished game acceptance. See [work package](work-packages/2026-09-06-ai-authoring.md). |
| 22 | Sprite frame animation | Spine is not ordinary sprite frame/UV animation. Add fixed-tick states and host UV rendering when needed, not a timeline editor first. |

## Reliability and evidence

| ID | Item | Current evidence and limits |
|---|---|---|
| 11 | Asset workflow / full generation | Bounded Rust/clippy, CLI/Wasm/Android builds, package maintenance and native/Web checks recorded in [predecessor evidence](evidence/2026-09-06-ai-authoring/predecessor-gate.json). Raw-evidence gaps and untested platforms remain explicit, not full hot-update or seven-game acceptance. |
| 12 | API project context | Shared CLI/MCP structured actions bind systems discovery to caller root. Global lookup stays project-independent. Source review has no confirmed blocker; executable empty-query and relative-root tests pass. New-package/game verification pending. See [issue](issues/2026-09-06-api-search-project-context.md). |
| 13 | Package parity | Package verifier detects CLI/Wasm contract mismatch; author verify runs native checks. Do not duplicate distributor responsibilities in author workflow. |
| 14 | Web digest | Shared Rust digest wired and checked via ABI, JS and source-mode browser smoke. New immutable-package evidence pending; see [record](devlog/2026-09-06-digest-integration.md). |
| 15 | World inspection | No world ASCII map. Camera view_height fixed a framing root cause; missing map is not grounds for speculative verdicts. |
| 16 | Flaky types gate | `verify` reported `types: failed` once in seven runs on an untouched project while `check --types` passed every time alone. A gate that fails at random teaches rerunning until green and erodes every other gate. Reproduce and measure before fixing; separate "the analyzer could not run" from "the types are wrong". See [issue](issues/2026-09-06-verify-types-step-flaky.md). |

## Platform gaps

| ID | Gap | Current limitation |
|---|---|---|
| 16 | Native UI | Native preview and Android do not render UI trees; Web does. |
| 17 | Native textures | Preview verifies/decodes sprite bytes but draws procedural shapes. |
| 18 | Native/mobile Spine and Effekseer | Actual presentation is Web-only; semantic state is not playback. |
| 19 | iOS host | ABI exists; implementation and device evidence are absent. |
| 20 | Large asset delivery | Whole-bundle loading remains; production streaming/CDN/OPFS/quota policies are not implemented. |

## Localization

The engine has no string table concept at all — a gap the slot machine product
plan surfaced, not a blind run. Decision: ship one language now and put the seam
in the contract, so adding a language later is a new file rather than a rewrite
of every display string. UI nodes may carry `text_key` plus named params instead
of a literal; the engine resolves at `ui.setRoot`, so hosts, the layout gate and
existing `ui` assertions are unchanged. A missing key is an error, never a
fallback to the key itself. Observation values stay untranslated: they are state
tokens, not display text. See the
[work package](work-packages/2026-09-06-localization-seam.md).

The payoff is deferred but concrete: text length varies by language, so the same
layout can pass in one and overlap in another. Once a second table exists the
layout gate only needs to loop over locales, and no game code changes — provided
the strings are in a table now.

## Shipping a game

Opening the served root today shows a developer tool: a page listing games, each
reached with `?project=<path>`. A shipped game is not that — the URL should be
the game, with no switcher, no query parameter and no debug panel. There is no
export path at all: `game` has verify, perf, bundle and preview, and nothing
that produces a playable artifact, while `pack-ai-engine.ps1` packages the
engine for subagents rather than a game.

Planned as `game export web --output <dir>` producing a self-contained
directory: see the [work package](work-packages/2026-09-06-web-export.md). It
also closes three standing faults at once — the host pages hardcode
`../../target/...` which is gitignored, so a clean clone opens broken; the only
Web runtime anyone can build is a 33 MB debug wasm; and that runtime is a crate
named `unone-web-live-smoke`, which reads as a throwaway test while being the
only Web runtime there is.

The development hosts stay exactly as they are. Switching projects and showing
semantic state is why they exist.

## Deliberate exclusions

- No imitation Unity prefab/Cocos scene model; external formats belong in imports.
- No full CSS engine or embedded browser framework in core. Native UI backend
  choices need AVG/RTS evidence. Web already uses DOM/CSS.
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
