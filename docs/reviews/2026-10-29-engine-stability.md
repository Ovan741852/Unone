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
