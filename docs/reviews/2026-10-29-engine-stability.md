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
