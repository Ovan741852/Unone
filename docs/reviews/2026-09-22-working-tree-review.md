# Working-tree review and repair — 2026-09-22

Scope: pending Unone UI slice/budget, runtime diagnostics, native preview and
local tooling changes. Gameplay ownership stays in Luau. No release, installer,
mobile-device parity or commercial security certification is implied.

## Findings repaired

1. CLI preview normalized physical cursor positions using a capped render target.
   A 2560 x 1369 window could map its center to x=62.5 instead of 50. Store the
   physical window dimensions, use them for both pointer mappings/projection,
   and shrink capped render targets uniformly. Tests cover landscape, portrait,
   4K, uncapped windows and zero-size bounds.
2. CLI Bloom discovery confused the primitive renderer with the separate native
   player. Discovery identifies `cli-primitive-preview`, excludes Bloom from
   available operations, and returns `CAPABILITY_UNAVAILABLE` when requested.
   Relaunching the CLI is not a remedy. Documentation separates both hosts.
3. Removed game-name/id-dependent Rust debug colors; neutral primitive shading
   does not interpret NPC, monster, temple or other gameplay names.
4. Frame Atelier's prototype server allowed cross-origin unauthenticated writes
   and served the projects directory. It now enforces loopback Host, Origin/fetch
   metadata, per-run bearer authentication, bounded JSON/command queues, and an
   explicit static-resource allowlist. The browser and CLI bootstrap contract
   are updated together. Timed-out operations are never automatically replayed;
   an uncertain execution is reported explicitly.
5. PNG decoding now honors the same premultiplied RGBA contract as SVG, handles
   grayscale variants, and bounds decoded output. A generated-PNG regression
   checks four color modes, including partial alpha.
6. Execution-pair fingerprints include embedded JSON and Luau assets, not only
   Rust sources. A fixture proves changing either embedded contract changes the
   fingerprint.
7. Fixed strict Clippy failures without globally disabling warnings. Changes
   include idiomatic validation, moving test modules after production items,
   naming the export tuple and boxing internal plugin diagnostics. No gameplay
   rule or public protocol was changed by these lint repairs.

## Verification on Windows

| Gate | Result |
| --- | --- |
| `cargo clippy --workspace --all-targets -j2 -- -D warnings` | Pass, zero warnings |
| `cargo test --workspace -j2` | Pass; 362 passed, 3 explicitly ignored |
| Colocated tracked Web/script tests plus new UI/mode tests | Pass; 66 passed, 2 skipped, before the additional fingerprint test |
| `node --test scripts/verify-runtime-modes.test.mjs` | 5 passed, including the fingerprint regression |
| `node scripts/sync-ui-contract.mjs --check` | UI contract v2 matches |
| `npm test --prefix packages/scout` | 5 passed |
| `npm test --prefix plugins/org.unone.ai-native` | 46 passed |
| Native player library tests | 19 passed, 1 GPU test initially ignored |
| Explicit native GPU UI test | 1 passed (PNG, CJK, transparent button surface) |
| `python scripts/test_frame_atelier.py` | 5 real-HTTP tests passed |
| Actual Edge Frame Atelier bridge | Authenticated inspect/add/update, visible name, reload persistence and negative authorization controls passed; no model calls |
| Actual Edge DOM nine-slice pixels | 8 PNG/SVG x DPR 1/2 x landscape/portrait cases passed |

Evidence retained outside the repository under
`C:/Users/liNao/AppData/Local/UnoneBuildCache/`:

- `review-20260922-atelier/report.json` and `bridge-roundtrip.png`.
- `review-20260922-ui-dom/dom-report.json` and captured images.
- `review-20260922-web-tests.log`.

The existing [UI feature evidence](../evidence/2026-09-20-ui-slice-and-budget.md)
records the original game migration and release raster benchmark. These are
historical measurements, not a fresh release-performance claim for this review.

## Boundaries and retained work

Frame Atelier remains a local prototype requiring the sibling UnoneUI checkout;
its optional assistant on port 8787 is a separate service. Loopback authentication
protects against other websites, not a malicious local OS user. Browser tests use
an isolated profile and ephemeral server; no user project state was modified.

Android/iOS/macOS were not tested in this review. Large Wuxia prototype assets,
blind-layout experiments and unverified Particle Lab UI changes are not included
in this engine repair submission. Historical audit records are evidence of their
declared versions only, not fresh badges for the modified engine.

## Integration with newer `origin/master`

Before pushing, fetched and merged `8d5bd16` (the newer Forest Lord UI and art
work). Kept its loadout assets, typography and top-right close controls, while
preserving the single-node nine-slice migration and complete host-file export.
No gameplay rules moved into Rust.

Additional integration findings repaired:

- The incoming host imported `presentation/loadout-preview.mjs`, but the module
  was absent from the repository, so the actual browser could not boot. Added
  the game-owned module and a browser/GPU lifecycle regression. Rebuilding an
  outfit removes the old root and cloned skeletons, without disposing geometry
  shared with the battlefield. Twenty rebuilds retain one actor root and cause
  zero shared-geometry disposals, with nonzero rendering calls.
- A decorative currency badge's `*_plate` was mistaken for a button plate.
  Numeric labels expanded under their icons. Shared control classification now
  preserves resource-label bounds and still handles disabled controls.
- Equipment name/owner, summary and cost rows overlapped; AUTO names overlapped
  their counts. Assigned separate rows without lowering the existing font
  floors. Compact equipment actions remain above 44 design pixels.
- Shop tests still expected a removed bottom cancel button. Updated assertions
  to the documented top-right close control, retaining its action, artwork,
  hit-area containment, modal keyboard trap and pointer-click verification.

The Impeccable narrow-refinement process was used to compare actual screenshots
with the existing design instead of replacing it. Its final mechanical detector
reported no findings; this is not a complete accessibility certification.
The historical `.impeccable/design.json` sidecar predates `DESIGN.md`; no unrelated
design-document migration was performed.

### Post-merge verification

| Gate | Result |
| --- | --- |
| `node --test _Games/ashen-legion/tools/ui-components.test.mjs` | 2 passed |
| Actual Edge `verify-shop-components.cjs` | 29 checks passed; four window sizes, glyph bounds, purchasing, rerolls and animation states |
| Actual Edge `verify-shop-accessibility.cjs` | 5 groups passed; native accessibility tree, keyboard focus/trap, synthetic touch and letterboxing |
| Actual Edge `verify-loadout-preview.cjs` | Passed; 20 outfit rebuilds, one root, zero shared geometry disposals |
| `verify-all-screens.mjs` | 98 synthetic Luau/WASM UI states passed; no browser errors; final AUTO and loadout screenshots inspected |
| `verify-formal-flows.mjs` | Passed; purchases, enchant, chest hold, all seven arrivals and settlement |

Game browser/flow tests use an isolated export with the frozen 2026-09-20
release WASM from `ui-slice-20260920/runtime-final`, plus the merged game source
and current presentation/host modules. They do not establish a new release
performance measurement. The current Rust sources were separately exercised by
the workspace and native test gates above. No Android/iOS simulator claim is
made for these desktop game tests.

Additional evidence in the same build-cache directory:

- `review-20260922-game-shop-confirm/components-report.json` and screenshots.
- `review-20260922-game-accessibility/accessibility-report.json` and screenshots.
- `review-20260922-all-ui-confirm/report.json` and all 98 state captures.

### Known legacy test debt (not reported as a pass)

`game --project _Games/ashen-legion test --json` has 17 failing cases out of 19.
An isolated `origin/master` game snapshot, run using the same engine, produces
identical names, pass/fail values and failure messages for every case. These
legacy scripts start from the menu without traversing the newer profile/formal
UI flow. The explicit formal-flow and browser suites above cover that flow.
The old fixtures remain unchanged and need a separate migration; the repository
must not be described as having every game test green. For this command, callers
must inspect `value.passed`, not just the outer successful-command envelope.

Baseline and merged results are retained as `review-20260922-origin-game-tests.json`
and `review-20260922-game-tests.json`. This review's submission is the engine and
integration repair, not a full game-release approval.
