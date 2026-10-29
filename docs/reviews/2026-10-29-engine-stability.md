# Engine stability cross-review — 2026-10-29

Reviewed baseline: `735e1cb4101459021a08bb76c6544bf691edc013` to the evolving
working diff, using `git diff 735e1cb -- <scope>` and adjacent source. This is a
bounded source review of the scopes below, not a review of every file preserved
in the initial commit or an assertion about an exact final commit/WASM package.

The changes belong to reusable runtime, serialization, compiler policy and
official presentation/host lifecycles. No game-specific rules were moved into
Rust, and the official renderer remains selected.

## Reviewers and scope

- **Codex `/root/native_performance`**, independent of the authors of the
  reviewed runtime/Web changes: host-time developer recording/replay, tape
  prefix/completion and deterministic test/UI-preview admission; value
  conversion budgets, cycles, arrays and portable integers; scroll registry and
  lazy UI validation paths; Web projected-frame geometry update/rollback,
  borrowed decoder buffers, structural publication identity, particle resource
  pooling, entity removal and context-loss helper teardown; no-instance Web
  canonical JSON passthrough and recursive disabled namespaces.
- **Codex `/root/runtime_audit`**, independent of the native implementation:
  native projected capacity compaction, cached order/revision no-ops,
  report-only hashes, and replay startup/resize viewport and explicit backend
  admission. Its read-only response found no concrete blocker. The existing
  immutable-revision contract remains required for upload no-ops.
- **Codex `/root`** coordinated fixes, verification and the independent review
  dispositions. `/root/web_lifecycle` implemented and validated Web lifecycle
  work; its implementation activity is not relabeled as an independent review
  of its own code here.

Claude CLI was **not attempted for this slice**, following the explicit user
instruction conveyed to the delegated task to use Codex review instead (Claude
quota was exhausted). There is no Claude CLI version, command, exit status or
raw response for this slice; no successful or failed Claude run is invented.

## Findings and disposition

No unresolved concrete P1/P2 correctness defect was found in the reviewed
scopes. This conclusion is bounded by source reading and the separately
identified executed checks; it is not an absence-of-defects guarantee.

The native reviewer identified an existing Web particle retention gap: idle
eviction alone does not shrink groups that remain active after a large historic
peak. A rotating large color bin, with small particles keeping older bins alive,
can retain one large instance buffer per bin despite a small current live set.
The finding was reported before edits. The implementation now plans aggregate
capacity, compacts above `max(4096,4*live_count)` toward the separate
`max(2048,2*live_count)` low-water budget, disposes retired InstancedMesh buffers,
and exposes retained capacity/bytes and compaction counts. The new particle
regression covers rotating active peaks and unchanged small-bin reuse. The
reviewer read the correction and found no new correctness blocker; root owns
the final executed Web regression/benchmark evidence. This closes the reported
retention scenario without claiming all driver/process memory is leak-free.

An additional Web performance opportunity was reported without treating it as a
correctness blocker: unchanged projected-frame resource validation still scans
typed-array content to preserve public in-place mutation checks. Removing full
decoder copies/base64 stringification does not mean all per-frame work is gone.

## Late additions checked before this record

- Unused spatial tick abort clears only its active/begun phase. Once spatial
  state has been authored, or an explicit host failure occurs, the established
  terminal fail-closed behavior remains. Failed generic game ticks no longer
  make a subsystem with no authored spatial state terminal.
- Source VMs select bytecode optimization 2 before source loading independently
  of native-codegen eligibility; preview/sampler builds retain level 1.
  Immutable ambient-time/random guards remain installed before sandboxing.
  Execution metadata/documents distinguish source defaults from cached job
  bytecode. Source reading does not establish cross-mode output/performance
  parity; root records that measurement separately.
- Web output serialization clears and reuses its output Vec for the known
  serializable envelope. Canonical JSON hashing precedes presentation rewriting,
  and instance backing buffers are still retained through publication. The
  no-instance branch requires no memory-reference rewrite.

## Evidence and limits

[Native validation](../evidence/2026-10-29-engine-stability/native-validation.json)
records exact commands, environment, completed 64-pass native unit result,
separate real GPU buffer stress, optimized release build, shader integration,
toolchain failures and an explicitly interrupted later log capture. Original
completed native raw output exists in the chat tool transcript; unavailable log
files are recorded as unavailable rather than reconstructed.

GPU buffer-size accounting is not process-wide VRAM measurement, shader
validation is not game pixel acceptance, and a fixed 60 Hz tick is not sustained
60 rendered FPS. No final-commit/final-WASM frame-rate, universal no-leak or
zero-GC guarantee is established by this cross-review. See the broader
[correction record](../issues/2026-10-29-engine-stability.md) for audit scope and
remaining capability gaps.

## 2026-10-30 SDK UI compatibility follow-up

Codex `/root/native_performance` independently read the new compatibility port
from the frozen SDK UI contract into shared main. Review covered
`ui.rs`/`ui/text_shadow.rs`, layout paint-versus-capture bounds, canonical types
and generated schema, `@unone/ui` constructors, Web Canvas typography/opacity/
clipping and pointer routing, native input-region routing/shadow rejection,
legacy DOM rejection, and CLI SDK/export inventory. The reviewer made no product
edits while the implementation agent tested. These are reusable UI primitives;
no Populous gameplay or replacement renderer is included in this review scope.

**P1 found and corrected:** the new `shared/ui-presentation.mjs` had three static
importers but was absent from `export.rs::WEB_FILES`. SDK template packaging
inherits that list, so UI-enabled exports would fail
`WEB_MODULE_DEPENDENCY_MISSING` and packed SDKs would lack the required module.
The finding was reported to `/root` and `/root/web_lifecycle` before edits.
The correction adds the module to the shared export/SDK inventory and prunes it
alongside the other UI modules when UI is disabled. The reviewer re-read both
changes and their SDK inheritance path. This is the source-review disposition;
the implementing agent owns execution of the dependency-closure/export tests.

The reviewer also re-read the implementing agent's separate raw-host sparse
RGBA correction: shadow colors now validate each index 0 through 3 explicitly,
so Array.prototype iteration cannot skip missing entries in direct JavaScript
host inputs. This does not expand shadow support to native/legacy targets.

A subsequent UI-disabled export correction was also re-read: disabled packages
prune the text-input/cursor modules, replace their entry imports, and provide
the Canvas `report()`/particle `metrics()` methods called by ordinary host
telemetry. This preserves the disabled host shapes without dangling imports.
The implementing agent reports the actual enabled/disabled closure regression
passing; its real exported UI-off player reached frame 91 without errors or UI
module requests in [browser evidence](../evidence/2026-10-29-engine-stability/ui-disabled-browser.json).
The reviewer did not rerun that browser workload.

No additional unresolved P1/P2 was found in this follow-up. Shadow paint reuses
the foreground layout with translated clips and an expanded opacity envelope;
input regions retain authored capture rectangles and button ownership lifetime
while consuming no paint region. Unsupported native glyph-shadow and legacy DOM
paths reject explicitly. SDK schema bytes now come from the CLI's compiled
Rust contract, preventing stale embedded schema text from rolling back the
published structural contract.

This follow-up is source evidence only. It does not establish native rebuilt
player support, font/pixel equivalence on every target, a final immutable SDK's
contents, or any frame-rate/GC result. Those require separately identified
build, package and actual-player evidence.

After the source freeze, `/root/native_performance` rebuilt the official Windows
runtime with `scripts/build-native-player.ps1` into the new
`artifacts/stability-20261030-windows-runtime` directory. The manifest accurately
records base `735e1cb` plus dirty source, and its executable SHA-256 was checked.
Final native unit checks passed 64/64 (two opt-in tests ignored), the separately
invoked real GPU retention test passed, and the optimized release shader
integration passed. Exact commands, process-local proc-macro workaround, raw
logs and artifact identity are in the `frozen_source_native_phase` of
[native validation](../evidence/2026-10-29-engine-stability/native-validation.json).
No FPS benchmark or game/native UI visual-completion claim was added.

## 2026-10-30 Web publication and source-over follow-up

This slice compares `feed49461d84982a18aa45fec9e47b73cb895c2c` with the working
source. Codex `/root/runtime_audit` independently reviewed the SaveState and
no-instance Web ABI changes authored by `/root/native_performance`; `/root`
also read the diff. No concrete P1/P2 was found. All accepted save writes
invalidate the current immutable encoding, detached owned/Lua reads retain
existing behavior, and reload rollback restores the payload together with its
matching encoding. Publication receives an owned immutable Rc lease, so no
RefCell borrow crosses a public callback. Storage retains one current encoding;
explicit host leases may outlive replacements.

The direct Web envelope writes canonical world bytes into the reusable output
Vec, hashes exactly that byte range, and uses serde for every JSON value. The
instance-bearing rewrite path remains. The independent reviewer requested an
actual ABI instance-to-empty transition regression; it was added and passed,
including retirement of the previous memory lease. Focused checks passed
3 save-publication integration tests, 1 cache unit test, all 15 default-feature
Web ABI tests, and 2 direct-publication tests with development features disabled.
Exact commands, process-local environment and raw output are in
[save/publication validation](../evidence/2026-10-29-engine-stability/save-publication-validation.json).
First/dirty save-cache encoding is outside the existing publication phase
timers; complete ABI/browser measurements must assess its total cost. No FPS,
GC or universal memory-leak claim follows from these tests.

Codex `/root/native_performance` independently read the source-over Core/Lua
contract and Web renderer/GLSL hunks authored by the other agents. No concrete
P1/P2 was found in that bounded source review. The explicit `source_over` mode
requires both depth flags disabled, remains revision-bearing, and shares the
authored rank queue with opaque draws. Filtered transparent samples use
premultiplied interpolation before returning straight RGB for blending. Actual
GPU pixel equivalence remains a separate implementing-agent validation.

Native explicitly rejects `source_over` before renderer creation and GPU/texture
preparation because its sRGB attachment blend path does not implement the Web
encoded-color contract. The descriptor reports this limit; its focused
admission regression passed 1/1. The previously packaged Windows executable
was not replaced or recertified by this follow-up. Claude was not attempted in
this slice, following the user's delegated instruction to use Codex review.

## Withdrawn projected preset prototype — 2026-10-30

The uncommitted `api.projected.set2D` prototype was withdrawn after the user
challenged its abstraction. It only fixed material defaults around the existing
40-byte clip-space stream. A caller still had to tessellate quads, normalize
source-pixel crops, split consecutive texture runs and republish geometry. Fewer
flags did not establish a coherent ordinary sprite/artwork interface.

The prototype registration, `ProjectedGeometry2D` type, discovery entry, narrow
recipe and prototype-only tests were removed. The advanced `projected.set`
stream and its explicit source-over material, validation, compatibility and GPU
evidence remain. No game adapter was implemented and no JYRogue product file was
changed by this investigation. Candidate SDK/runtime artifacts generated while
the prototype existed are historical evidence, not an accepted public API.
Prototype test logs remain at `.cache/projected-set2d-core-tests.log` and
`.cache/projected-set2d-api-tests.log`; they demonstrate the discarded preset's
behavior, not a shipping capability or frame-rate result.

The design direction separates retained render resources from per-instance
transform, visibility and paint order, with rendering/batching owned by the
engine. This follows the relevant distinction in
[Godot Resources](https://docs.godotengine.org/en/stable/tutorials/scripting/resources.html),
[CanvasItem](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html)
and the independent asset/instance components shown by
[Bevy Sprite](https://docs.rs/bevy/latest/bevy/sprite/struct.Sprite.html) and
[Mesh2d](https://bevy.org/examples/2d-rendering/mesh2d/).
It is an architectural recommendation, not a claim that a new general resource
or scene API has been implemented. Existing entity/UI semantics should be reused;
game-specific projection, visibility decisions, content and action meaning stay
in Luau.

All three Codex reviewers independently assessed Decision 0044. Concrete
omissions corrected in the final design record: RAF callbacks can occur while a
renderer skips its pass, so acceptance also counts completed ready presentation;
retained UI references need success/failure replacement and virtual-retirement
rules; Web-first rollout needs explicit per-host material/crop/clip admission.
The record also avoids introducing an implicit hierarchy, a duplicate public
rectangle-array API or a claim that four 2D corners encode perspective W.
This is a reviewed architecture direction; no new retained resource/instance
protocol or general high-level drawing API was implemented in this slice.

The withdrawal edits were confined to
`crates/unone-engine/src/runtime/bindings/projected.rs`,
`crates/unone-engine/src/api.rs`,
`crates/unone-engine/src/engine.d.luau`, `docs/engine.d.luau`,
`crates/unone-engine/tests/projected_geometry.rs`,
`docs/projected-geometry.md` and this review note. The retained advanced blend
implementation in `projected.rs`, its public export, and the other agents' Web
and native changes were not removed. This describes the surgical withdrawal,
not the complete shared working-tree diff.

After withdrawal, `cargo test -p unone-engine --test projected_geometry` passed
11/11 tests and `cargo test -p unone-engine --lib api::tests` passed 15/15 tests.
The API count was 16 before withdrawal because the removed prototype had one
discovery/type-contract test. Raw output is retained in
`.cache/projected-advanced-after-preset-withdrawal.log` and
`.cache/projected-api-after-preset-withdrawal.log`. A source/docs scan found no
remaining prototype registration, input type, recipe or tests outside this
historical record; `git diff --check` passed. These are focused source gates,
not a new SDK build or a performance measurement.

## Retained logical image artwork — engine 0.2.0 / UI 0.5.0

The Core follow-up implements reusable logical artwork resources under the
existing `image_batch` UI node. This is engine presentation ownership: ordered
asset/crop/opacity data, affine placement, validation and bounded resource
lifetime. Content, projection choices, visibility decisions, picking and game
rules remain authored in Luau. No JYRogue product or game script was changed.

`api.ui.imageBatch.define(id,{bounds,quads})` creates a copied immutable Arc
generation. Nodes reference `content=id` and may change the six-value affine
transform independently; their explicit stage rect is the clip/layout viewport.
Core admissions use cached per-generation count/string metadata and do not scan
the resource quads for a camera-only tree change. Complete canonical snapshots
contain `{revision,bounds,quads}`; the resource caches that full JSON encoding.
The private player transfer protocol and renderer are separate agents' work.

Replacement validates registry limits and all current UI references before
commit. In-use removal fails; old snapshots can retain old generations.
Resources share world reset/reload ownership. Virtual `renderItem` resource
mutations fail, including initial materialization, with guard restoration after
callback errors. Scroll-local retained artwork is explicitly rejected in this
slice. Inline logical image authoring remains available; unifying its private
rendering path does not require another game-facing GPU API.

The package's new retained constructor props ship as `@unone/ui` 0.5.0 with the
deliberately breaking engine 0.2.0 release. Current authoring guidance, templates'
canonical metadata, fixtures and AGENTS package instructions were aligned on an
explicit path allowlist. Historical ADR/evidence/review captures and unrelated
UnoneUI plugin versions were left intact. Existing game configurations were not
automatically migrated.

Implementing-agent checks: `cargo check -p unone-engine --lib` passed; before the
version-string alignment, the retained integration suite passed 7/7, existing
UI component integration tests 14/14, and image-batch package tests 2/2. Logs are
`.cache/retained-image-core-check.log` and
`.cache/retained-image-package-tests.log`. The engine 0.2.0/UI 0.5.0 integration
rerun compiled, but Windows App Control blocked the new executable before any
test ran (error 4551); see `.cache/retained-image-package-0.5-tests.log`.
Likewise, the UI library test executable compiled but was blocked before
execution (`.cache/retained-image-ui-lib-tests.log`); the subsequent API test
command was not reached. The private Arc-release and aggregate-registry-budget
unit tests are therefore not recorded as passing. No policy workaround was
attempted. `cargo test -p unone-engine --lib --no-run` subsequently passed for
engine 0.2.0, compiling the new API and ownership tests; its raw output is
`.cache/retained-image-lib-0.2-compile.log`. Actual matching WASM/Web execution,
pixels, full publication cost,
frame cadence, GC and long-run memory evidence remain separate acceptance gates.

### Encoded-definition limit and completed Core source gates

An independent follow-up found that the 8 MiB raw UTF-8 asset-string allowance
did not establish the Web wire's encoded byte bound: JSON escaping can expand a
control character from one byte to six. Core admission now prepares the
immutable generation's cached canonical JSON once, rejects a resource over
16 MiB and rejects a registry whose cached definition payloads sum above
32 MiB. These checks precede resource/tree/revision mutation. Camera-only
updates and checks of previous generations read cached string lengths in O(1).
The original semantic DTO validation remains in place.

The focused boundary suite passed 4/4, including exact 16 MiB acceptance,
one-byte overflow rejection, escaped-NUL expansion, exact aggregate 32 MiB
acceptance and atomic aggregate overflow rejection, plus the previously
unexecuted Arc-release/reset and stored-quad checks. Raw output is
`.cache/retained-image-encoded-budget-tests.log`.

Windows subsequently permitted the final engine 0.2.0 test binaries to execute.
On the frozen final Core/UI 0.5.0 source, `cargo test -p unone-engine --lib ui::`
passed 33/33, `cargo test -p unone-engine --lib api::tests` passed 16/16, and the
retained/image-batch-package/UI-component integration targets passed 7/7, 2/2
and 14/14. Final logs are `.cache/retained-image-ui-final-tests.log`,
`.cache/retained-image-api-final-tests.log` and
`.cache/retained-image-package-final-tests.log`. These results supersede the
earlier execution-block limitation for these focused targets; they do not
replace the official exported Web pipeline, pixel or performance gates.

### Canonical field order during physical input

Before the unshipped 0.2.0 candidate was rebuilt, the retained registry was
moved to the first `WorldSnapshot` field. A changing physical-input receipt or
application field had previously preceded the static definitions, invalidating
the exact-byte SHA prefix at its first block during interaction. Definitions
now precede all mutable metadata. Complete canonical data is still hashed; this
does not remove the receipt, ignore a revision or weaken digest comparison.

A full-snapshot regression uses more than 48 KiB of static artwork, changes
receipt/frame/time/application (including optional field presence), compares
each cached result to a complete SHA-256, and requires at least 16 KiB of exact
prefix reuse. It compiled, but Windows App Control blocked the new executable
before execution (4551). See `.cache/retained-canonical-input-prefix-tests.log`;
this new test is not recorded as passing. The earlier 72 focused source tests
were executed before this final declaration-order change.

## 2026-10-30 completion telemetry and native retained-UI admission

Codex `/root/runtime_audit` independently read `/root/native_performance`'s
completion helper, official main-host glue, cursor outcomes, export inventory
and UI-disabled stubs. It found no concrete P1/P2, including the follow-up that
makes dropped-step counts relative to the successful load/restart session.
Main and worker paths consume existing decoded publications; querying the
frozen accessor invokes no runtime command. The fixed 512-sample interval ring
is copied/sorted only on report queries. Completion requires explicit world,
Canvas UI and required cursor outcomes, after synchronous submission; missing
contracts remain unknown. Focused helper/main-backend/worker-entry/cursor tests
passed 17/17. Actual combined renderer/UI pending/failure/context-loss browser
execution remains separate evidence, not established by those fixtures.

The same independent reviewer also read the native retained-image gate and
found no concrete P1/P2. Recursive component/scroll traversal rejects retained
content or transforms at startup admission and before later preparation/paint;
unused definitions remain admissible. Native explicitly declares that limit
instead of painting an empty quad list. The nested missing-texture admission
regression passed 1/1. No optimized native artifact or FPS run was produced in
this slice. Exact commands and raw logs are in
[completion validation](../evidence/2026-10-29-engine-stability/player-completion-validation.json).

## 2026-10-30 retained-resource wire review and serialization follow-up

Codex `/root/native_performance` independently reviewed root's new ABI resource
leases, epoch-aware synchronous reader, immutable-generation grants, worker
resource deltas, receiver admission and backend/core teardown after `8060abf`.
Concrete findings were reported before changes: worker admission could cancel
its timeout and then strand the request when delta validation threw; close kept
the decoded latest graph and old asynchronous barriers could write after
unload; resource-ID and encoded-byte limits differed between Core and the
reader/first consumer. The implementing agents corrected these paths, and the
reviewer re-read the corrections. No additional concrete P1/P2 was found in
this bounded wire scope. Generation grants prove immutable ownership, not
geometry validity; first presentation consumers still validate complete content.

The reviewer then authored a separately delegated serializer optimization in
`ui_transport.rs`. A generic forwarding serializer filters only the top-level
registry field from the existing WorldSnapshot struct; it does not hand-copy a
field list or affect nested names. No-instance presentation writes directly to
the reusable OUTPUT buffer. Canonical state remains complete, and mixed
instance worlds keep their explicit transport rewrite. Retiring the final wire
registry releases the canonical/lease vectors and retained hash capacity once;
ordinary non-UI publications retain normal bounded hash-prefix reuse.
Codex `/root/runtime_audit` independently reviewed this serializer/lifetime
change and found no concrete P1/P2. Its requested mixed UI/instance regression
was added to the final source.

Intermediate optimized source executed 4/4 focused ABI tests and 19/19 full ABI
tests. Initial final-source attempts were blocked by Windows application
control before execution (error 4551), including a release dependency build
script. Root subsequently ran the normal production-feature command
`cargo test -p unone-web-live-smoke --no-default-features`: all 10 tests passed,
including the six final retirement, mixed-instance, unload and serialization
cases. That later execution supersedes the initial execution gap; failed logs
remain preserved. Actual final WASM/browser/worker rendering and SDK validation
remain separate evidence.
Commands, successful and blocked raw logs, ownership limits and findings are in
[retained wire validation](../evidence/2026-10-29-engine-stability/retained-image-wire-validation.json).

## Final retained Core execution and candidate-1 official-player smoke

The final ordinary Core library run completed with **352 passed, 0 failed,
3 ignored** in `.cache/retained-image-core-full-tests.log`. It executed the new
complete-snapshot input-receipt/application prefix regression, encoded byte
boundaries, immutable Arc release/reset and all other retained Core library
checks. This supersedes earlier Windows 4551 execution blocks for those Core
tests; their original failed-launch logs remain available. It does not turn the
separately blocked final ABI test executable into a passing run.

The Core authorship scope was the existing UI node/resource model, strict
binding/type validation, affine placement, immutable canonical content,
bounded admission and world-owned reset/reload lifetime. The final field-order
change retains complete SHA-256 input while placing immutable artwork before
mutable physical/application/frame data. Gameplay and rendering remain separate
owners. The implementing agent's independent review scope was the other
agents' wire serializer/lease retirement, completion metrics and native
fail-closed admission; those bounded dispositions are recorded above.

The actual production SDK candidate-1 official Web export also passed the
prepared end-to-end smoke in both **main and worker** backends, with eight
recorded phases per backend. The report is
`artifacts/retained-official-web-smoke-candidate1/report.json` and identifies
Edge 156.0.4314.50 and release
`a3d8fb5014576e4d82e4c4d1fde1d44cb898d5c0beedd43490619f9ee79f7cf7`.
The run checked camera-only resource retention, mixed UI order and the real
button path, live replacement, removal/recreation and context-loss recovery;
root also inspected the initial/restored screenshots. It is pipeline/lifecycle
evidence, not a frame-rate or long memory-soak result. Candidate 1 remains an
internal candidate: a subsequent independent GPU fallback-retirement P2 is
being fixed before publication. Its passing smoke is not certification of
the next renderer/SDK candidate.

### Retained artwork CLI discovery

The release-candidate CLI search had returned no match for `2D GPU artwork`.
The existing scoped authoring intent index now directs that phrase, image
batching, camera pan and 大量圖片 to logical retained image resources and the
official kit/publish lifecycle. It does not present expert projected buffers as
the normal artwork route. The vocabulary requires a batch/retention/GPU or
camera-pan intent; ordinary `ui image` and exact API names preserve their own
routes, and adding an unknown word does not broaden a query. The descriptor
states that GPU eligibility and an order-preserving Canvas fallback belong to
the official host.

This changed only the development-tools API index/descriptors and its focused
test. The final API suite passed 16/16, including all new English/Chinese
queries and the narrow-scope checks; output is
`.cache/retained-artwork-discovery-final-tests.log`. Production Core behavior,
canonical types, compiled gameplay and the final WASM are unchanged by this
discovery follow-up; the CLI is rebuilt separately.

## Constructor typing and local containment before SDK candidate 3

The game owner reported four Luau errors at existing `imageBatch` calls. The
canonical inputs now expose named `UiInlineImageBatchProps` and
`UiRetainedImageBatchProps`: outer input fields are readonly, and `never?`
exclusions preserve the two mutually exclusive forms. Their existing
`UiComponentImageBatchProps` union and single constructor signature remain.
Returned UI nodes remain mutable game-owned data. No runtime constructor,
package Lua implementation, authored field shape, `any` escape or cast was
added. Readonly constructor overloads were investigated but rejected because
the actual full game produced an ambiguous-call error with a union fallback.

Isolated verification met all 28 expected outcomes: fourteen positive/negative
cases each on the existing owner Luau 0.743 analyzer and official pinned 0.734.
It covers fresh inline/retained literals with screen/component backgrounds,
named/union/inferred variables, and rejection of false screen, mixed/missing
forms, inline transform and invalid asset/crop types. The owner's 0.743 binary
has SHA-256 `7b756b36e5d912b097ecce27040a15a68ee79060e5ab27a996c3bdc5dfbbf415`;
its existing build manifest discloses only a solver constraint-budget increase.
The existing candidate-2 Core compiler also parsed and executed the new
canonical declarations through one headless tick. This establishes parser
support, not rendering or performance. Results are in
`.cache/artifacts/image-batch-type-ergonomics/final/report.json`.

The actual current JY source snapshot
`a438b4a8385ecd86d12930a73dc0ee12c8f1a9e45bdece55e9709ba0ff9d98e5`
was read into cache and only its canonical type block was refreshed. The
original four TypeErrors became zero (analyzer status 0), with the game body,
existing game assertions/lint warnings and original product file unchanged.
No new game casts or handwritten shapes were used. Hashes and the complete
raw output are in
`.cache/artifacts/image-batch-type-ergonomics/final/full-game-report.json` and
`full-game-canonical-only.log` beside it. Canonical source/docs mirror hashes
match. These declaration changes require a refreshed CLI/SDK typing inventory,
not a production VM behavior change.

Root also authorized closing the previously recorded candidate-2 containment
mismatch before the performance window. Core now compares local deltas and
remaining width/height using the exact Web `1e-8` inequalities, avoiding rounded
absolute endpoint sums. A real-Lua regression attempts oversized width and
height at origin `1e9` and verifies atomic resource revision/content/tree
preservation. The first final-source test executable compiled but Windows
App Control blocked execution (4551), recorded at
`.cache/retained-image-containment-final-tests.log`; it is not a passing run.
An ordinary final-source retry subsequently executed **8/8 retained integration
tests successfully**, including that atomic width/height regression; output is
`.cache/retained-image-containment-final-tests-retry.log`. That executed result
supersedes the earlier launch block for this target while preserving its log.
Candidate 2 remains immutable historical evidence. The corrected next
artifact requires the rebuilt Core/WASM and its own acceptance results.

## Final retained Web compositor and READY review

Codex `/root/native_performance` independently reviewed the frozen resolver,
Canvas compositor, GPU prefix presenter and Three glue against `8060abf`.
Reported P2 findings were corrected and re-read: fallback now retires prior and
non-selected GPU owners; invalidating assets transfers existing readiness
waiters to the new generation; and decoded images exceeding the actual GPU
texture limit fall back before Three can silently resize source pixels.
Leading-prefix eligibility preserves paint order, consecutive A/B/A texture
runs and the Canvas HUD; f64 origin rebasing and conservative f32 admission keep
unsupported transforms/precision on the Canvas path. No additional concrete
P1/P2 was found in this bounded final source scope.

The same reviewer reported whole-player READY preceding pending Canvas assets
and was delegated the main/cursor fix. Startup now waits abortably for all
required presentation assets and validates a fresh full submission at the final
RAF barrier. Codex `/root/runtime_audit` found a cursor-enter freshness gap in
that draft; a final-commit redraw and controlled regression corrected it. The
independent reviewer re-read that correction and found no additional critical
issue. Focused tests passed 25/25; the Web agent's final whole-Web log passed
467/467 with no skips. All nine reviewed source hashes match immutable template
checkpoint 3 in [final prefix review](../evidence/2026-10-29-engine-stability/retained-ui-prefix-review.json).

The actual component GPU report covers 30 pan/zoom/clip/DPR cases with no
interior channel errors above 2/255 or shared-edge gaps, unchanged camera
geometry uploads/HUD raster, large-origin equivalence and context restoration.
Its accepted one-pixel outer coverage rim differs from Canvas antialiasing;
this is not universal pixel equivalence. The reviewer read that report and did
not rerun the GPU workload. Final SDK/exported-player smoke, game FPS/GC and
artifact certification remain separately identified evidence.

## Performance follow-up: save publication ownership

Codex `/root/native_performance` independently reviewed the new save lease in
`save_transport.rs`, its complete/direct/UI-filtered envelope integration,
`load-project.js`, `save-publication.mjs`, worker deltas and the main persistence
hook. No concrete P1/P2 was found for valid official Core/main/worker paths.
Prepared publication keeps the old encoded lease alive until envelope success;
change/clear/reload use a new revision or epoch, and mode/close retirement drops
private ownership. Readers keep frozen detached JSON/text and never heap views.
Worker packets restore complete public observations and stage save admission
before committing their private cache. Replacing a public save field invalidates
the private serialization grant. This was a source-only independent review;
the implementation owner records execution and byte/digest evidence separately.

A malformed save descriptor after a valid UI descriptor can update the private
image-reader cache before save admission fails because the two restoration
functions run in sequence. No valid Core publication produces that combination;
cross-cache malformed-admission testing remains a hardening opportunity, not a
claimed production failure. Unchanged Rust saves still compare cached encoded
text; removing clone/encode work does not imply zero save-publication cost.

The same follow-up adds the explicit native `image_batch.pixel_snap` capability
gate: nested inline requests fail before GPU/asset preparation; unsnapped inline
batches retain admission. Its focused native regression executed 1/1. Native
pixel snapping itself is unsupported. See
[RAF scheduling evidence](../evidence/2026-10-29-engine-stability/raf-scheduling-validation.json)
for the separate scheduler change and its current verification limits.

## Pixel snapping and follow-up independent source checks

`image_batch.pixel_snap` is optional instance state, defaulting to false, for
both inline and retained artwork. Core rejects non-boolean/null values,
placement on other node kinds, and snapped retained shear/rotation before
publication. Signed or zero axis scales remain legal; the host skips collapsed
quads. Source rectangles and the explicit clip are unchanged. The change covers
the Core node/parser and schema, canonical declarations and their docs mirror,
the package constructor whitelist, API discovery, and focused integration and
schema regressions. Resource definitions, generations and encoded bytes do not
change when only snapping changes.

The ordinary final-source command
`cargo test -p unone-engine --test ui_image_batch_pixel_snap` executed **2/2**
successfully in `.cache/image-batch-pixel-snap-final-normal.log`. Earlier App
Control 4551 launch failures are retained in
`.cache/image-batch-pixel-snap-core-tests.log` and
`.cache/image-batch-pixel-snap-instance-tests.log`; the passing retry supersedes
the integration target's launch failure, not the unexecuted package/unit targets.
The UI JSON schema was emitted from the current compiled Core schema function.
Host snapping pixels and SDK acceptance remain separate evidence.

Codex `/root/runtime_audit` also independently read the final GPU prefix buffer
reuse, RAF scheduler, and save publication/worker transport source. No concrete
P1/P2 was found within this bounded review. The GPU check covered shared old/new
generations, selected-resource compaction, material/group ordering, sweep and
fallback/context retirement. The scheduler check covered in-flight
pause/hide/reset/stop/start, catch-up caps and bounded rounding debt. The save
check covered commit-after-publication leases, load/unload reset, direct and
UI/mixed-instance envelopes, synchronous detached decoding, worker delta/full
restoration, persistence ownership and export/build inventory. This reviewer ran
no additional browser, GPU or CPU workload; the implementation owners' reported
81 GPU cases, 28 scheduler regressions and save transport results are separate
execution evidence. These checks do not establish sustained 60 FPS, leak freedom
or GC frequency.

Codex `/root/runtime_audit` independently reviewed the final RAF-owned async
scheduler and found no concrete P1/P2. The review covered stop/start during an
in-flight transaction, pause/visibility/reset generations, finally scheduling,
bounded sequential catch-up/drop accounting, high-refresh zero-step redraws
and retained early-step rounding debt. The reviewer ran no tests or builds.
The implementation's combined focused run passed 38/38, including real-worker
backend plus actual main entry wiring, readiness, input and completion cases.
It leaves the completion counter definitions unchanged. This establishes
scheduling correctness under the controlled cases, not final SDK/game FPS.

## Startup save persistence correction

Root's exported-save smoke preparation found a preexisting data-loss path:
READY assigned the post-`Game.start` save to the persisted marker without a
storage write, so unchanged later ticks never persisted it. Codex
`/root/native_performance` added one actual main helper shared by startup,
updates and restart. It advances the marker only after successful storage,
initializes it from the restored text, and persists before READY. A paused
restart now persists newly produced `Game.start` data without a later tick.

Focused actual-entry tests passed 28/28. A changed 112 KiB immutable publication
writes once before READY; 120 unchanged calls perform zero payload stringifies
and no additional writes. Change/clear each write once. A startup storage
exception preserves the old marker and creates no READY or scheduler; the
worker-backed tick path also verifies rejected-write preservation/retry.
Actual exported-player acceptance and final SDK evidence are separate from
these controlled VM-entry tests. See
[startup save evidence](../evidence/2026-10-29-engine-stability/startup-save-persistence-validation.json).

## RAF diagnostics and withdrawn render-first draft

The next browser result corrected snapshot throughput (about 60 distinct frames
per second), while actual CPU submission intervals still failed the existing
temporal gate. A proposed render-first pipeline passed 52 focused scheduling,
metrics and lifecycle cases. Its first independent review covered memory leases,
buffer ownership and cancellation; that bounded result did not establish
game-owned input/projector coherence.

The game owner and Codex `/root/runtime_audit` then found a P2 in that proposal:
preparing the next `Game.update`/View while the previous View remains visible
advances private Luau camera/hit-target caches. `InputFrame` and ordered physical
points carry no presented-world/View revision or history. Host snapshots cannot
reconstruct private game caches. JY's actual update processes map input before
camera stepping and View publication, so adding a whole-frame cache-ahead gap
changes which visible target a screen click can select.

Root withdrew that default before SDK6 packaging. Source, tests, hashes and the
working diff are preserved in `.cache/render-first-withdrawn-20261030/` with the
reason and scope. The official scheduler retains update → acceptance → draw;
the additive RAF diagnostics stay. Original completion timestamps and acceptance
gates are unchanged. The synchronous drawing continuation is measured after
awaited preparation, so worker waits cannot be labelled synchronous callback
work. The restoration removes the added mismatch; it does not invent historical
event-time input semantics for existing backlog/worker cases. Moving-camera and
drag-release interaction evidence remains part of actual exported-player QA.

The restored implementation passed 53/53 focused Node cases, with no skips.
Tests preserve actual 15 ms completion intervals even when RAF intervals are
10 ms, distinguish 1 ms synchronous drawing from 9 ms awaited preparation,
preserve the originating RAF token across an actual worker backend and verify
cancelled-generation exclusion. A private moving-projector regression protects
input-before-next-View ordering. Metrics retain bounded primitive storage;
default queries construct no paired rows and explicit queries filter/freeze
at most 512 rows. Codex `/root/native_performance` independently reviewed the
helper built by `/root/web_lifecycle`; non-RAF wall and cancelled-preparation
pollution were corrected before the final run. Codex `/root/runtime_audit`
then re-reviewed restored scheduler/main timing, lease and cancellation paths
and found no additional concrete P1/P2. Reviewer claims are source-only.
Final hashes and raw output are in
[coherent RAF diagnostics evidence](../evidence/2026-10-29-engine-stability/raf-coherent-diagnostics-validation.json).

## Candidate5 exported acceptance and remaining game gate

The final recursive Web inventory executed **519/519**, zero failures/skips,
including the real adjacent projected-packet fixture. Current targeted Core
integration executed **15/15** (retained resources, cached saves, package props and
pixel snapping); production ABI executed **12/12**, including actual leased save
publication with/without artwork, change/clear, full inspection and unload.
These do not relabel the earlier full Core run as a new one.

Actual immutable SDK candidate4 failed context recovery with particles disabled:
the exporter-generated empty particle implementation lacked the new lifecycle
method. Candidate4 and its failed report remain unchanged. The explicit disabled
stub now provides `contextLost`, and the export dependency/interface regressions
cover it. Actual candidate5 production exports passed main/worker **9 phases
each**, including 112 KiB startup save persistence before READY, no unchanged save
resend/storage write, one changed-save update, pixel snapping, UI ordering/input,
resource replacement/removal/recreation and lost/restored context completion.
The main initial and worker restored screenshots were inspected. All 99 SDK Web
template fingerprints match the frozen production source.

The ordinary-world context regression also supplies a negative control: removing
the retirement call grows dispose listeners from 1 to 4 through three restores
and produces 151 stale-handle warnings. The fixed renderer preserves CPU
objects/images and pixels, performs no refetch, retains one current listener,
and releases geometry/texture/program ownership on teardown. Custom presentation
hooks and optional Effekseer restoration remain outside that verification scope.

The prescribed Claude CLI attempt used version **2.1.308**, a fixed six-file
source bundle on stdin, `-p --tools "" --max-turns 1 --output-format json`.
It produced no stdout/stderr and was interrupted with exit 1 after the bounded
attempt; it is **incomplete**, not a passing review. Independent Codex source
reviews and executed regressions are recorded separately. The first rebuilt
release CLI was blocked by Windows App Control; the normal debug and subsequent
standard release builds executed successfully without policy changes. Candidate5
ships the standard optimized release CLI and production WASM.

Candidate3's actual game review1 failed all complete performance gates; candidate5
is an integration candidate awaiting the same five scenarios and longer memory/GC
measurements. No stable 60 FPS, universal leak freedom or zero-GC claim is made.
See the [current SDK handoff](../evidence/2026-10-29-engine-stability/retained-web-sdk-handoff.json)
and its linked raw acceptance/fingerprint records.

## Opt2 diagnosis and candidate6 instrumentation

The retained publication fast path previously bypassed publication phase
accounting. The diagnostic now measures its actual canonical encode/hash and
envelope work once, with bounded successful frame/path records. Production
compiles out Core diagnostic scopes and VM probes and does not read new
publication clocks. Coarse phase-only opt2 diagnosis and opt2 safe-point
sampling are separate artifacts; ordinary preview keeps its opt1 policy.
Phase-only rejects function sampling before resetting a window and installs no
VM allocation/GC callbacks. Cargo feature unification gives phase-only precedence.

The current ordinary Core suite executed 354 passed / 3 ignored, plus one
execution-policy test. Phase integration/policy executed four cases and its
module two cases; opt2 sampling executed five cases and combined-feature
precedence four. Current production ABI executed 12/12 with no diagnostic
features, and phase ABI executed 14/14, including all four publication paths.
The final recursive Web inventory executed 531/531 with no skips. Actual emitted
phase WASM matched all 68 canonical digest checkpoints, including 60 active
frames; actual emitted sampler WASM matched baseline/unsampled/sampled runs at
all 13 checkpoints, attributed an escaping named function and froze VM and
publication reports after stop. These synthetic measurements establish neither
sampler overhead nor browser FPS. See the
[actual sampler validation](../evidence/2026-10-29-engine-stability/sampling-profile-actual-wasm-validation.json).

The game owner's actual phase-only travel window completed 635 frames with no
failed attempts. Script p95 was 15.6 ms, versus UI conversion 0.8 ms and UI
parse/validation 0.3 ms; publication phases were around 1 ms combined. The script
residual includes package wrappers and other engine bindings, not just game
Luau. The owner subsequently preserved a paired game-only presentation-cache
change: on unchanged SDK5, travel achieved 601 updates / 601 new submissions,
59.990 Hz, zero drops, worst one-second new-frame rate 59.014 Hz and RAF p99
16.8 ms. Its original completion-end p95/p99 gate still failed. Neither a single
case nor a diagnostic profile is a five-scenario pass. Read-only scalar summaries
and source hashes are in
[real game diagnosis](../evidence/2026-10-29-engine-stability/retained-real-game-diagnosis.json).

Candidate6 retains update → accept → draw, the original completion-end clock and
every existing acceptance gate. It adds originating-RAF and advancing-snapshot
distributions, explicitly scoped synchronous wall/preparation diagnostics, and
opt-in bounded detached paired rows. Actual candidate6 official production
exports passed main/worker nine functional phases each; initial and restored
screenshots were inspected. The specific RAF fields receive a separate exported
main/worker functional check before handoff. No renderer timing from this small
fixture is treated as actual-game acceptance.

The newly compiled release CLI was blocked on execution by Windows App Control.
Candidate6 therefore uses the unchanged functioning candidate5 release CLI,
with its exact binary hash retained. Its new production WASM and frozen Web
templates are explicit separate inputs. The current profiling guide is copied
into the SDK and its indexed hash updated; every indexed file is verified after
that operation. Embedded CLI guide/search content keeps candidate5 provenance.
Runtime metadata honestly records base e3d4f6d plus dirty source rather than
claiming a later clean-commit build.

Independent Codex review found no additional concrete P1/P2 in the restored
RAF implementation or in diagnostic mode, callback, production feature-off,
publication ring/error/stop and ownership boundaries. These are source-only
reviews. A fresh fixed four-file Claude CLI 2.1.308 review used tools disabled,
one turn, no session persistence and a 60-second bound. It returned no stdout or
stderr and was terminated; it remains incomplete. Command, source hashes and
exit/signal are preserved in the candidate6 evidence, with no passing-review
claim. Actual game five-case and longer memory/GC acceptance remain open.

## Owned UI leaf styles and private identity purity

Actual game opt2 sampling also attributed safe-point samples to the official
package's copy/field helpers. Counts are not exact time attribution, but source
confirmed a redundant operation: leaf first deep-copied props/style, then copied
the same style again while composing defaults. The internal fast path now
transfers that already detached override. Defaults still receive a fresh copy,
public composeStyle retains its independent-copy contract, root metatables
retain the original compose path, and public nodes remain mutable. No subtree
memoization, public freeze or additional traversal was introduced.

Independent review caught a valid descendant-metatable counterexample: the
private ownership probe used `node.id`, unintentionally invoking arbitrary
`__index` during each copy. The correction is a raw ID lookup plus the existing
private registry object-identity check. Genuine handles have raw IDs, so
rebind/retirement behavior remains intact. The real-helper regression verifies
zero getter invocations and unchanged authored colors. This intentionally fixes
private probe purity rather than preserving an accidental callback side effect.

The final opt2 targeted suite executed **19/19**, including mutation isolation,
padding/replacement, metatables, portable work/depth limits and real managed
virtual identity. The source-paired fixture compared complete canonical world
bytes/digests across 120 warmup views and ten measured changed views, each with
96 leaves. On this native x86_64 debug-host opt2 diagnostic, Luau positive
allocation growth fell from 9,100,629 to 8,389,228 bytes and allocation events
from 134,935 to 123,177. This is about 7.8% fewer measured Luau growth bytes in
that fixture, not a Web workload, production CPU/FPS result or total allocator
traffic measurement. Incremental GC raw metrics are retained without a timing
gate or collection-cycle claim. See
[allocation evidence](../evidence/2026-10-29-engine-stability/ui-leaf-owned-style-allocation.json)
and [executed tests](../evidence/2026-10-29-engine-stability/ui-leaf-owned-style-tests.log).
The earlier 18-case pre-purity-fix result remains cache history, not the final
result. Independent Codex source re-review found no remaining concrete P1/P2.
SDK6 remains immutable; this package/helper slice requires a separate runtime.

## Aggregate semantic pressed-action query

The actual game sampled a second reusable cost: empty discrete-action dispatch
still built hundreds of action names and crossed the binding once per recipe,
inventory operation and skill. `input.hasPressedActions()` now returns whether
the same existing `InputState.pressed` set used by `wasPressed` is nonempty.
The query is O(1), non-consuming and zero-argument, with no new cached state or
wire field. Raw physical presence, held/release-only, text and slider events do
not invent semantic press edges. Games may gate discrete scanners while still
updating held movement, text, sliders, pointer capture and releases normally.

Independent Codex source review found no additional concrete P1/P2 in binding,
transaction/reload visibility, canonical types or discovery. API metadata/search
and type coverage executed **17/17**. The eight new behavioral cases and five
existing edge cases compiled, but Windows App Control blocked their executables
with 4551 on launch; **none of those 13 cases executed**. One ordinary retry is
preserved; no policy changes, file renaming or bypass was attempted. Production
Node/WASM behavior verification is prepared separately and remains pending the
new emitted runtime. This is not a completed behavior or actual-game FPS gate.
