# Capability-first delivery log

## User direction

The user authorized the discussed capability-first changes and English-only
engine text. Current specifications are replaced in place; original failure
evidence remains intact. Game content and Unicode regression fixtures are not
engine-authored UI. No cache/package/evidence deletion is authorized by this task.

## Initial actions

- Replaced the roadmap in English, preserving stable backlog IDs and explicit
  unpassed final-game status. Prioritized completing 2D transform/layer hosts,
  then audio; retained bounded hot-update consistency repair.
- Added one work package, not a new ADR, for execution/review coordination.
- Assigned non-overlapping Luna/max public-document and core-message translation
  scopes; independent plan review and minimal audio contract design are separate.
- Main agent ran `cargo test -p unone-cli --test api_search_contract -- --nocapture`
  with `CARGO_INCREMENTAL=0` and `CARGO_BUILD_JOBS=1`: 8 passed, 0 failed.
  New tests execute a literal empty-string argument and a caller-relative root
  from an unrelated game directory. Claude's two conditional concerns do not
  justify production changes: Clap flags are global and project discovery already
  canonicalizes validated roots.
- Independent API source review reported no confirmed blocker and the relative
  path coverage gap now covered by the passing test. Package validation remains
  pending; this is not seven-game acceptance.

## Scope observations

The Android renderer still uses a fixed world scale and game-name-based shapes.
The 2D slice must honor existing camera semantics and use generic sprite drawing,
not game-specific compensation. Web DOM and WebGPU are separate rendering layers;
their composition needs an explicit bounded decision before claiming painter
order across ordinary sprites. These observations were sent to plan review.

## Tool failures and handling

- An attempted delete-plus-add patch for the same roadmap path was rejected by
  apply_patch before mutation. Replaced it with a single in-place update.
- rg literal wildcard paths such as `docs/*.json` do not expand in this PowerShell
  invocation; use directory arguments with rg globs instead. No files changed.

## Remaining evidence

### Web baseline

Main agent ran `node --test web/runner/semantic-output.test.mjs
web/live/bundle-store.test.mjs`: 6 passed. Raw output is retained in
`docs/evidence/2026-09-06-web-capabilities/baseline-tests.txt`.

A real browser source-mode probe uses the synthetic fixture at
`tests/fixtures/web-sprite-transform`. The pre-fix screenshot is
`docs/evidence/2026-09-06-web-capabilities/transform-before.png`: the image is
unrotated, above its expected center, and mixed DOM/GPU ordering hides the
foreground fallback. Semantic output also enumerates numeric-looking IDs in
numeric rather than required byte order. This is a host reproduction, not a
blind game or package acceptance result.

The fixture deliberately includes an undeclared asset to exercise fallback and
error visibility; strict asset validation is expected to reject it. The first
fixture attempt omitted the required sprite.asset field and was rejected by the
shared scene parser. That was a fixture-authoring mistake, fixed by supplying
the intentional missing asset ID; the corrected scene runs successfully.

Web renderer work was dispatched after independent plan review required a
single DOM painter layer, aligned geometry, world-space WebGPU transforms and
targeted camera/aspect/Unicode regressions. Existing 3D rendering is preserved.
The Web-only package change removes Android build dependencies from this slice;
the package must state its included platforms, not silently imply parity.

The user subsequently narrowed delivery to Web first and Android later. No
Android renderer/build/device work is authorized for this immediate slice.
Existing Android gap observations are retained for later, not immediate scope.
Audio design and plan review were redirected; mobile documentation translation
was paused in favor of the Web handoff. This supersedes the initial cross-host
delivery ordering above without rewriting the history of that instruction.

Plan review, translation review, 2D host implementation/output, audio lifecycle
and playback, hot-update failure repair and fresh package-only game validation
remain unfinished. Do not infer completion from dispatched work.
