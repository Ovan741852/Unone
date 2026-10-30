# Engine stability audit corrections — 2026-10-29

The working tree through 2026-10-29 was preserved and pushed on `main` as
`735e1cb` before these corrections. Local `.cache/` build products and logs are
ignored; source modules, tests and authored evidence remain versioned.

These changes repair reusable runtime transactions, serialization and official
host resource handling. They add no game-specific rules to Rust and retain the
official player/renderer. Source correction, passing regression, rendered
presentation and sustained performance are separate evidence scopes.

## Reported defects

The numbers below match the eleven defects in the supplied audit. Their fixes
were committed as `feed494`; completed checks and remaining player/performance
limits are recorded below. A test name identifies coverage; use the linked raw
execution evidence for the result and its scope.

| Audit | Correction | Regression / remaining verification |
| --- | --- | --- |
| 1 — physical input becomes terminal at a retryable barrier | Start `InputTick` only after job/spatial preflight and time-scope admission. Preserve a staged physical lease across omitted input; accept an identical retry and reject a conflicting replacement. | `tests/input_admission.rs` covers pending spatial work, unchanged/empty retries, receipt commit and subsequent clearing. Execution failures remain terminal by design. |
| 2 — default application changes every legacy digest | Omit default application state from canonical JSON; keep it available on the typed snapshot. Non-default escape/quit state remains digest-bearing. | `tests/application_lifecycle.rs` pins exact legacy idle bytes and non-default digest changes. No blanket replay migration or engine-version change is claimed. |
| 3 — failed tick loses slider/text events | Keep unconsumed semantic events across empty retry frames. Reject conflicting same-ID replacements and accumulated capacity overflow before admitting any part of a frame. Generic game errors leave unused spatial state retryable; authored spatial state and explicit host faults retain their fail-closed contract. | `tests/input_admission.rs` covers slider `end`, text `submit`, Lua-error/empty-frame retry, atomic rejection and successful consumption. Existing input-edge/slider retry tests and spatial lifecycle/fault tests cover the ownership boundary. See [input contract](../ui-text-input.md). |
| 4 — native/WASM integral-number boundary differs | Apply signed-i32 restrictions to integral `Number` values as well as `Integer`, including save decode. Finite observations retain binary64. | Value-conversion unit tests exercise both VM variants, endpoints, wide integral JSON and permitted fractional values. |
| 5 — aliased tables expand without a work bound | Reject cycles and cap a Lua-to-JSON call at 64 nesting levels and 1,048,576 expanded value occurrences. Repeated aliases count for each serialized occurrence. | Value-conversion tests and `tests/observation_arrays.rs` cover a depth-40 shared graph and preservation of the prior save on rejection. This bounds conversion work, not all game memory. |
| 6 — deterministic tools resample live host time | Developer recording selects record before start and includes its tape; replay consumes that tape and checks completion. Tests/UI preview require explicit replay time instead of live/record resampling. | `tests/host_time.rs` covers developer round trips, missing/incomplete tapes and deterministic authoring guards. Runtime-relative monotonic time is still not a wall clock. |
| 7 — native hashes projected buffers every frame | Move complete projected geometry hashes to final/report diagnostics, outside the rendering hot path. | Inspect `render.rs::presentation_report` and actual native timing/report output; report generation still pays the hash cost. |
| 8 — native projected GPU allocations retain every historical peak | Compact retained geometry buffers under an aggregate budget, keep unchanged revisions as upload no-ops, and expose retained bytes. | `projected.rs` contains budget/revision/order tests and an explicit GPU stress test. Driver-deferred allocation reclamation and process-wide VRAM require host measurement. |
| 9 — CPU/GPU nearest tie comparison differs | Compare squared distances before square-root conversion on both backends; use the same body-ID tie break. | Native GPU differential and WebGPU fixture cases include distinct squared distances that round to the same square root. GPU availability and actual execution remain part of the evidence. |
| 10 — native replay depends on resize/automatic backend | Freeze the simulation viewport at startup dimensions during replay and reject `spatial_backend=auto` before runtime creation. Surface resize remains presentation-only. | `replay.rs` tests startup/resize policy and backend rejection. Compare runs using the same explicit dimensions, seed and backend; see [native replay contract](../native-input-replay.md). |
| 11 — anchored image batch has absolute quads | Reject anchor/pivot/offset/size placement for `image_batch` with `UI_IMAGE_BATCH_PLACEMENT`; require an explicit stage rect matching its absolute artwork. | `ui_image_batch_tests.rs` covers the explicit diagnostic. Cross-aspect player output still needs actual target validation. |

## Allocation and authoring corrections

Lua-to-JSON now builds its final sorted object map and dense array vector
directly, avoiding a second object-map build and one ordered-map entry per array
index. Dense-array length, key/count, mixed-key and portable-value checks remain
strict. UI validation retains numeric path coordinates and formats a full path
only on failure. Ordinary `setRoot` publication skips virtual-registry traversal
when the registry is empty; traversed leaves no longer allocate an empty Lua
table just to iterate absent children. Virtual node identity and publication
validation remain authoritative.

Non-preview source VMs now default to bytecode optimization level 2 independently
of native code generation; preview/sampler VMs keep level 1. Type information
level 1 remains specific to non-preview native-codegen builds. Execution
metadata and [mode documentation](../runtime-mode-validation.md) state those
defaults and the separately compiled job-cache limitation. Sampled same-source
parity and target performance are recorded below; they do not establish full-game
or cross-platform acceptance.

The official UI package reduces redundant copies/temporary tables without
publishing mutable author aliases. Web projected-frame updates reuse typed
buffers and draw groups where their identity is unchanged; particle render
scratch storage and renderer-owned resources follow their existing disposal
lifecycle. These are concrete allocation reductions, not proof of zero GC.

Additional authoring fixes reject 2D transform mutation on 3D entities, align
runner actions with the official player, and guard `api typings --output`
against overwriting an existing file. The canonical `--update-script` path
preserves surrounding game code. Their targeted tests and final execution
evidence belong with the completed run.

## Capability gaps retained explicitly

The [roadmap](../roadmap.md) now distinguishes delivered 2D transforms, native
audio/textures and 3D queries/sensors/shapes from remaining host gaps. Native UI
uses unique ID 28; types-diagnostic item 16 keeps its identity and records the
implemented `LUAU_ANALYZER_FAILED` diagnostic.

This correction does not implement native durable saves, a host UTC/wall clock,
a production entropy/default-seed policy, general `require`/structured-data
loading, runtime sprite/mesh assembly, sprite-frame or 3D skeletal animation,
native scrolling/editing/IME/cursor parity, gamepad, navigation, general lighting
or localization. Timer/tween, scene switching, entity hierarchy, networking and
accessibility also require their own contracts and target evidence. Gameplay
rewards, movement choices, content and state ownership remain in Luau.

The remaining authoring observations are also not all closed by this change:
strict option-table validation, a release-only debug-call authoring gate,
unknown UI interaction-ID diagnostics, enforced View/renderItem purity, reverse
runtime/typing inventory checks, reload-hook typo diagnostics and particle API
naming still need separately scoped corrections. Neutral action names remain
open game-owned strings; the documented cross-host physical names avoid the
runner's former game-specific mappings.

## Evidence limits

Completed bounded verification is recorded under
[engine stability evidence](../evidence/2026-10-29-engine-stability/) and the
[independent cross-review](../reviews/2026-10-29-engine-stability.md). A later
full engine unit run passed 345 tests (three opt-in tests ignored); host-time
integration passed 13, dimension/disabled-namespace checks passed two, and a
600-tick repeated UI-publication test kept collected Lua retention within its
32 KiB warmup allowance. The three observation-array tests passed in the earlier
full integration run, while a later launch was blocked by Windows error 4551.
The original failed/blocked commands remain evidence, not passing reruns.
The later UI-retention regression initially exposed phase variance from a
single collection cycle. mlua documents that two cycles may be required to
collect all currently unreachable values; the test now performs an explicit
settling cycle before each measured diagnostic collection, and passed without
raising its allowance. No collection was inserted into production ticks.

Web renderer/shared regressions passed 414 cases after particle high/low-water
compaction. Actual WebGL passed 1,028 conformance samples, unchanged redraws
uploaded no geometry, two adjacent real-game packets matched full framebuffer
pixels, and context restoration/cleanup passed with no captured console errors.
Native GPU retention stress and explicit WebGPU differential execution are
separately recorded. These checks establish those lifecycles and sample scopes.

Three sequential 300-tick Node production windows used exactly the same frozen
JYRogue source, initial save and inputs for both runtimes. Median-of-run tick
medians changed from 28.26 ms to 17.98 ms; run medians ranged 22.33–32.49 ms and
17.87–22.51 ms respectively. End-frame UI, entities, observations and save hashes
matched across all six runs. WASM capacity stayed constant within each sampled
window, growing between initial runtime reloads to a 48 MiB capacity. This is
allocator capacity, not a reachable-heap or GC-frequency measurement, and the
wide timing variation does not establish statistical significance.

The final isolated-browser opt2 follow-up still **fails** the 60 Hz simulation
target: idle 31.94 ticks/s, drag 31.88 and travel 26.21, with dropped steps.
RAF cadence alone was higher and does not satisfy the target. Earlier atlas and
constructed battle-fixture windows reached approximately 60 ticks/s without
dropped steps; they are separate workloads, not a whole-game pass. The first
opt2 windows overlapped automatic parity work and are retained as contended;
the final follow-up excludes those windows. Full 89-case JYRogue automatic
parity (26,484 ticks) was interrupted to isolate performance sampling; it is
not recorded as a completed parity gate.

## Packaged handoff — 2026-10-30

The new production SDK is
`D:/Projects/Unone/artifacts/core-sdk-stability-20261030`; its pinned identities,
runtime paths, preflight results and limits are in
[sdk-handoff.json](../evidence/2026-10-29-engine-stability/sdk-handoff.json).
It includes official Web and Windows production runtimes. Existing SDKs,
published game exports, live browser pages and saves were not replaced. The
optional development runtime is not included; its local PowerShell launcher
capture failure is preserved separately.

The official optimized Windows player, RTX 5080/Vulkan at 1280×720 with 1,000
moving sprites and the ordinary realtime scheduler, measured 60.0069 rendered
callbacks/s and 60.0069 simulation ticks/s over ten seconds after warmup,
with zero dropped ticks. Tick p95 was 1.2207 ms and interval p95 17.04 ms.
The rendered screenshot was inspected. Fifteen additional synthetic windows
(three runs each of static/moving 1,000/10,000 sprites and a layering fixture)
measured 59.95–60.13 callbacks/s. Static windows freeze simulation; moving
windows use deterministic fixed ticks and are not the realtime-scheduler test.
See [native realtime output](../evidence/2026-10-29-engine-stability/native-realtime-moving-1000.json)
and [synthetic windows](../evidence/2026-10-29-engine-stability/native-fps-synthetic.json).

The Populous SDK8-r3-compatible generic `text_shadow` and `input_region`
primitives were carried into shared source, with explicit unsupported-host
diagnostics. [Capability evidence](../evidence/2026-10-29-engine-stability/ui-capability-port.json)
includes 928 real Canvas pixel comparisons and the corrected export inventory.
After that port, UI-off dependency pruning and metrics stubs were corrected;
the actual minimal player reached tick 91 without UI module requests/errors.
These are artifact and primitive checks, not full Populous port/FPS acceptance.

A fixed 60 Hz simulation timestep does not establish 60 rendered FPS. Headless
WASM/native runs do not establish rendered output. Short allocation or lifecycle
tests do not establish absence of memory leaks, driver retention or frequent GC
in every game. Final evidence must identify the exact runtime/package, workload,
target, sample window and measured percentiles/heap/retention behavior. Record
failed or blocked commands, including Windows execution-policy error 4551, as
execution limits instead of passing checks. Independent review is recorded
separately under [the review process](../review-process.md).

## Web priority and presentation design follow-up — 2026-10-30

The user selected the official Web player as the priority and requested a
general engine design review after questioning the proposed `set2D` shortcut.
Godot, Unity and Bevy primary documentation and three independent source
assessments converge on [Decision 0044](../decisions/0044-retained-presentation-resources.md):
shared resources, retained instances and an explicit advanced geometry stream,
reusing existing entities/assets/UI. The new preset prototype was withdrawn
before SDK distribution; it did not remove caller triangulation, clip-space
projection, texture grouping or whole-payload transport.

Independent fixes reduce duplicate UI projection/validation and host retention,
cache current save encoding, write canonical publication directly into the ABI
output, and retain decoded/GPU projected resources with transactional updates.
The advanced projected stream now supports explicit source-over on official
WebGL host raster. Its bounded Canvas comparison allows at most 2/255 channel
error in the sampled linear cases; nearest samples are exact. Native, checked
raster and WebGPU do not implement that blend contract and reject explicitly.
See [host/pixel evidence](../evidence/2026-10-29-engine-stability/web-priority-hosts-and-source-over.json)
and [save/publication evidence](../evidence/2026-10-29-engine-stability/save-publication-validation.json).

Controlled frozen candidate3 browser runs with speed-optimized WASM and the UI
host changes measured about 53.05 simulation ticks/s idle, 44.15 while dragging
and 36.48 during travel; atlas and battle remained about 60. These detail-world
cases still fail the target. This A/B predates the subsequent save/direct-ABI
and advanced source-over changes and cannot establish their game-level benefit.
Exact cases, runtime substitutions and sampling limitations are in
[candidate3 browser evidence](../evidence/2026-10-29-engine-stability/web-priority-candidate3-browser.json).
The retained authoring/resource transport in Decision 0044 is implemented in the
internal engine 0.2.0/UI 0.5.0 candidate. Generic official main/worker player
smoke verifies the pipeline and lifecycle; full target-game performance and
memory/GC acceptance still require actual measurements.

### Local containment mismatch found in internal candidate 2

Candidate 2's retained quad containment compares absolute endpoint sums;
the Web consumer checks local differences. At local origin `x=1e9`, resource
width `1e-7` and quad width `1.5e-7`, both binary64 endpoint sums round to
`1000000000.0000001`. Core can therefore admit the oversized quad, while the
Web check correctly rejects its `5e-8` excess above the `1e-8` tolerance. The
origin fits the Lua portable integer range; this is an invalid-data admission
mismatch rather than an ordinary large-origin rendering limitation.

Before the performance window started, the next candidate's Core source was
corrected to the same local-delta/remaining-extent inequalities used by Web,
preserving its `1e-8` tolerance and explicit rejection. A real-Lua regression
attempts both oversized width and height replacements and checks unchanged
resource revision, immutable content and the published tree. Candidate 2
remains an immutable historical artifact; no game workaround or relaxed bounds
contract was introduced. Exact source-test execution status is recorded in the
[review follow-up](../reviews/2026-10-29-engine-stability.md).

### Long-running UI0.6 and scalar-query evidence — 2026-10-30

The SDK10 60-second inventory windows still fail the target: the original Game
measured 32.017 RAF callbacks/s with 71 dropped steps; an isolated scalar-query
variant measured 40.930 with four dropped steps. Cross-project CPU competition
was present or possible, so these remain observed failures rather than isolated
engine attribution. The variant changes bounded geography access in a cache-owned
Game copy; the original Game Product files were not replaced. Two actual
Sampler9 WASM modules compared complete world/UI/entities/shaders/observations
and save JSON bytes plus the authoritative Core digest at all 3,619 checkpoints,
with an empty allowlist. Its late repeated geography decode samples disappeared;
allocation-growth requests fell about 33.4% and incremental GC callback wall time
about 25.5% in that instrumented pair. Maximum GC callback step rose slightly.

Natural SDK10 V8 tracing under explicitly permitted concurrent load still
observed canonical `MinorGC`/`MajorGC` duration events: idle had 22/65 over
45.004 seconds; inventory had 11/39 over 45.012 seconds. These event names and
coalesced trace phases are not whole collector cycles or OS pause counts, and do
not measure Luau or worker live heaps. Twenty inventory open/close cycles plus
a ten-second tail kept WASM capacity, geometry/material owners and the decoded
texture cache bounded. Final texture owners, DOM nodes and listeners remained
one, one and two above the warm-world baseline, respectively; the tail was
stable but did not prove exact retirement or leak-free behavior. Raw traces and
full Game worlds remain cache-only. Exact identities, failures, counts and scope
are retained in [the compact validation record](../evidence/2026-10-29-engine-stability/ui06-scalar-sdk10-long-validation.json).
The browser result combines the scalar Game variant and SDK10; the same-Game
SDK9/SDK10 comparator deliberately rejects their differing script hashes.

## Shared decoded images and explicit Web startup working sets

The official Web player now shares one decoded-image broker across world
textures, Canvas UI and the cursor. Consumers own leases; GPU textures remain
renderer-owned. Successful PNG header probes drain to EOF instead of cancelling
the response, which had produced real browser `ERR_ABORTED` events. Unused
decoded images have a bounded LRU; active and scene leases are never evicted.
An oversized unused image is retired before it can displace smaller reusable
entries.

An authored `player.image-assets.json` declares groups and an explicit startup
working set. Required images are admitted before automatic scene sprites under
one decoded-image plan budget and must all decode before Core/READY. Scene-only
preparation may remain partial. The engine does not infer Game-specific IDs,
create hidden entities or preload the entire manifest. The SDK-indexed publisher
validates the source project and sealed official export, preserves project host
adapters, and emits a fresh generation using the engine's tuple hash. CLI10
does not apply the sidecar automatically; use the documented publisher after
normal host finalization. See [the contract](../web-image-assets.md).

Source and Node validation passed at `ab8941b`; `f054a62` also preserves the
earlier broker ownership guidance. The complete Web/tool suite reported
637 passes, no failures and three existing optional skips out of 640 tests.
SDK14 retains the exact verified SDK10 CLI, UI package and both runtime images;
all 148 indexed files were verified. It includes the new host and indexed
publisher/documentation, not the build-blocked fused-copy Runtime11. Independent
source review closed the bounded reader, config projection, scene identity,
plan allocation, required-format and HTML metadata findings. Claude's separate
60-second attempt produced no response and remains incomplete.

The emitted official SDK14 player passed nine lifecycle phases on both main
and worker backends, including required PNG decoding before READY, retained
publication and context recovery. This fixture establishes functional host
behavior, not seven-scene FPS or leak-free operation. Source/package evidence
and actual-player evidence are recorded separately in
[source and SDK validation](../evidence/2026-10-29-engine-stability/image-preload-source-and-sdk14-validation.json)
and [official-player smoke](../evidence/2026-10-29-engine-stability/image-preload-official-web-smoke.json).
The [current handoff](../evidence/2026-10-29-engine-stability/retained-web-sdk-handoff.json)
tracks the authorized Product integration and subsequent same-artifact
performance, natural GC and repeated inventory lifecycle acceptance.

### Incremental GPU image ownership and current acceptance

The frozen Game6073 SDK16 eight-case run passed six cadence gates. Inventory
also passed its 60-second cadence gate at about 60.003 fresh submissions/s;
idle failed after a single 66.6 ms RAF gap. Its prior synchronous submission
took 68.4 ms. These are measured failures and bounded successes, not release
readiness: the original completion-end diagnostics and nominal phase overruns
remain recorded. The machine continued other project work as authorized.

Around the idle stall, only the Canvas UI asset `brawler` disappeared, while
four GPU-prefix geometries, the shared material and nineteen textures were
disposed and recreated. Broker and world-cache counters stayed stable. Canvas
was globally clearing the prefix when any UI image retired, including images
used only by Canvas. SDK17 gives the prefix independent ready-image leases and
retires unused GPU owners incrementally. Surviving resources retain their
identities. This is a reusable presentation primitive; no Game rule, asset ID,
idle-cache budget, renderer, scheduler or acceptance gate was changed.

At `310aea1`, fourteen new real-broker/Canvas/prefix regressions cover owner
identity and failure cleanup. The full Web/tool suite passed 663 of 666 tests
with three existing skips. SDK17's 148 indexed files were hash-verified and
retain the exact SDK10 CLI, WASM and compiled UI package. Its emitted official
player passed nine phases on each of main and worker, with required PNG decode
before READY, retained pixels and context recovery. Same-Game performance is
being measured separately; a passing functional fixture is not a 60 FPS result.
See [source/package review](../evidence/2026-10-29-engine-stability/image-handoff-sdk17-source-resolution.json)
and [actual official-player smoke](../evidence/2026-10-29-engine-stability/image-handoff-sdk17-official-web-smoke.json).

The exact Game6073 SDK16 natural 45-second idle/inventory windows kept WASM
capacity fixed at 29,097,984 bytes. One hundred inventory open/close cycles
kept broker and renderer ownership bounded, but performed 300 image reloads and
accumulated 1,800 additional CDP DOM nodes. Two separate intrusive V8 GC
commands reclaimed JavaScript heap without reducing those node counts. The
natural result was sealed before those commands and remained byte-identical.
Neither collector event counts nor persistent native-node counts alone prove
whole-cycle frequency or a memory leak verdict. This unresolved reclamation
question and the same-artifact SDK17 follow-up remain explicit in
[the SDK16 memory record](../evidence/2026-10-29-engine-stability/sdk16-game6073-main-memory-cycles.json).
