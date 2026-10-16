# Explicit shared responsive UI layout

Date: 2026-10-16. Baseline: `4442a5e46df21faa50ff7db47999f40eaaa56df2`
on `main`; review covered the subsequent working tree. The ownership decision
is [ADR 0043](../decisions/0043-explicit-responsive-ui-layout.md).

## Shared contract and ownership

`@unone/ui` 0.4.0 adds `ui.components.createResponsiveLayout<T>` on the direct
module and themed kit. Projects explicitly author semantic groups, aspect
thresholds, slot/row/column/grid trees and complete typed presentation values.
The retained pure Luau model owns inclusive highest-threshold selection,
fixed/grow allocation, equal-cell grids, padding/gaps and coordinate conversion.
The first threshold is exactly zero, providing the declared fallback.

Views call `model.resolve(api.ui.getViewport(),bounds?)`, then use named
`rect(id)` results for leaves and `viewport(id)` results for scroll helpers.
Stage rectangles remain y-up; explicit `space="scroll"` produces local y-down
rectangles. Both viewport results use top-left/y-down. Layout lengths use
per-axis rectangle units, independently of the vertical units for typography
and styles. Options are snapshotted and outputs copied defensively. Resolution
does not transform nodes, mutate virtual registrations, publish UI, measure
text, advance a tick, consume input or use RNG.

Component construction still performs no implicit layout. No device categories,
font scale, game theme, business rules, renderer or constraint solver were added.
The ordinary official player renders the same canonical UI transport. Native
scroll support remains explicitly unavailable; the layout helper does not
extend that capability. See [the complete typed contract](../ui-responsive.md).

## Source review and corrected findings

| Finding and reproduction | Correction and bounded coverage |
| --- | --- |
| Recursive discriminated layout unions, including a version without intersections, widened ordinary nested literal `kind` fields and produced 24 strict errors in the maintained Harbor example. | Canonical `UiLayoutNode` is a recursive record with a literal `kind` union, typed optional fields and explicit forbidden-property guards. The factory enforces kind-dependent combinations and numeric rules. The full Harbor probe and complete documentation entry use no `any` or per-node casts. |
| Ordinary equal subdivisions, including a six-column row and three-row column, could accumulate rounding beyond a container edge and fail the existing Core bounds validator. | Allocation uses cumulative spans and conserved final edges, with bounded roundoff correction against allocated parent edges. Existing Core bounds checks stay strict. |
| Independent architecture review found that a floor-one or cross-axis-scaled tolerance accepted a 20% fixed-size overflow on a legal `1e-18` main axis, including with a `1e100` cross axis. | Tolerances use the allocated axis itself, with no floor of one and no unrelated cross-axis or origin contribution to the sizing budget. Tiny row/column and very large cross-axis regressions cover the counterexample. |
| A variant omitted its required `values` field and was accepted because the portable-data copier accepts `nil`. | Factory validation requires a non-nil value for every variant; `{}` is the documented choice when no presentation fields are needed. A rejection regression covers omission. |
| A fresh SDK-only author followed the SDK README and `ui.components.info` example, then strict analysis rejected the named `UiComponentsInfo` record as recursive `ObservationValue`. Layout authoring itself was not blocked. | The SDK guide and API example now project public `name`, `version` and `declared` fields into a portable literal. The exact replacement snippet passes canonical strict analysis without a cast; no runtime, package or type behavior changed. |

These are shared authoring and numerical corrections. The engine does not
recognize a game name, card count or device-specific screen arrangement. Source
review does not establish rendering; executed checks and actual-player results
must be evaluated separately below. The main agent recorded the independent
reviewer's counterexample, disposition, final read-only response and limits in
[the source-review record](../evidence/2026-10-16-ui-responsive/independent-review.json).

## Executed validation

The main agent executed the final release workflow. The evidence writer copied
raw output without rewriting it and separately verified the SDK inventory.
Commands, scope and results are in
[validation.json](../evidence/2026-10-16-ui-responsive/validation.json).

- Final release workspace tests: **487 passed, 3 ignored**, including 13 shared
  responsive-layout regressions and CLI/MCP discovery coverage.
- Strict release workspace Clippy and the release CLI build passed.
- Existing Web regression tests: **53 passed**, preserving Slider capture,
  input semantics, scroll projection and inertia behavior.
- Strict analysis passed for the package, all three maintained examples and
  the complete public responsive-guide entry. The initial union probes remain
  separate failure evidence.
- Production WASM built with the official release configuration, 0.4.0 package
  declaration and no dev/preview tools. Reduced-system dead-code warnings in
  that build remain distinct from strict all-feature workspace Clippy.

The portable SDK at `D:/TSProject/UnoneResponsive-20261016/sdk` passed pack and
inspect. Independent read-only SHA-256 and byte-count verification matched
**all 68 inventory files**; see
[the initial inventory record](../evidence/2026-10-16-ui-responsive/sdk-initial-inventory-verification.json).
The bundled source, types, responsive guide, matching runtime and CLI are part
of that inventory. Pack/inventory checks alone do not demonstrate rendering.

Harbor Controls prepared with five passing gates, Observatory Settings with
four and VOIDWAKE with seven. Exported-player parity passed nine compared Harbor
frames and ten VOIDWAKE frames. Those bounded runtime comparisons are distinct
from native GUI/device acceptance.

The initial recursive-union strict failures remain distinct from the successful
recursive-record probes. Historical evidence directories and the preceding
slider/inertia release are preserved unchanged.

The first full release workspace run failed a pre-existing component-error
guidance assertion after the improved diagnostic started naming
`createResponsiveLayout`. Its exact output is preserved as
[the initial stale-guidance failure](../evidence/2026-10-16-ui-responsive/workspace-tests-initial-stale-guidance-failure.txt).
It is not counted as a passing run; the successful final rerun is preserved
separately as `workspace-tests-final.txt`. Updating the two expectations to
require the explicit shared helper route changed the test, not product behavior.

## Fresh SDK-only authoring

A fresh-context author used only the portable SDK, its bundled documentation,
canonical types and public CLI discovery to build `_Games/responsive-layout-lab`.
The [author's raw report](../evidence/2026-10-16-ui-responsive/fresh-sdk-usability-report.json)
records no engine-source or previous-example access, SDK mutation, custom
renderer, DOM/CSS UI, `any` casts or manual viewport-branch geometry.

The SDK README immediately led to `createResponsiveLayout`; the first
`responsive layout` API result was that callable helper. The author declared
one-, two- and four-column variants, a fixed/grow toolbar row and a retained
inner model for reusable cards. State changes use the shared semantic press
edge outside the View. Strict analysis, four normal verify gates and both
deterministic tests passed, and the official Web export prepared successfully.

The metadata-observation example failure above is retained as
[the original type-check result](../evidence/2026-10-16-ui-responsive/fresh-sdk-05-first-typecheck-failure.json).
The later documentation correction requires a release CLI rebuild, matching SDK
repack and strict snippet probe, rather than a repeated full workspace run for
two example-text changes. The author's typography adjustment was project
content tuning within the existing API.

The final SDK at `D:/TSProject/UnoneResponsive-20261016/sdk-final` passed pack and
inspect after the guide/API example correction. Independent byte-count and
SHA-256 verification again matched **all 68 inventory files**; see
[the final inventory](../evidence/2026-10-16-ui-responsive/sdk-inventory-verification.json).
Only the bundled README and rebuilt CLI changed in the SDK inventory. Final-SDK
preparation passed five Harbor gates and four Layout Lab gates, including both
Lab tests. Both exports retain their browser-tested release and identical
hashes/lengths for **all 71 exporter-inventory payload files**. The export metadata
descriptor is outside that inventory; SDK-selection path metadata may differ.
[The continuity record](../evidence/2026-10-16-ui-responsive/final-sdk-continuity.json)
records this exact boundary. The final source identities are in
[the source inventory](../evidence/2026-10-16-ui-responsive/source-inventory.json).

After browser acceptance, the new Lab entry's extra trailing blank line was
normalized to one EOF newline for `git diff --check`. Final-SDK verify again
passed four gates and both tests. This changes no source body or behavior and
does not mutate the browser-tested exports; source-file byte identity with the
served script is not claimed after that whitespace-only cleanup.

## Actual official-player acceptance

Independent browser QA passed **197/197 assertions** against the actual URL
`http://127.0.0.1:8344/?sdk=fresh-ui-verified&mime=fixed`, using Playwright's
Microsoft Edge channel in production-player contexts. The official export
loaded `@unone/ui` 0.4.0 with release
`b249a80048b22a7e681d87a8ce063e694ad6a90cf28be324a6ff0434afeda95f`.

Desktop 1440x900, medium 1020x884 and portrait 390x844 preserve the three authored
designs, typography and control artwork. Ten live-resize cases cover boundaries
and intermediate aspects. Physical mouse tests exercise the visible Slider
track, outside capture/release, scroll drag versus row tap, inertia, combobox,
Apply and press/release readers. Resizing preserves retained values and selected
state; changing geometry cancels an existing Slider drag. The observer reads
production WASM observation memory without private simulation/input mutation.

The QA worker inspected all six screenshots and reported readable hierarchy,
expected clipping of partial virtual rows and no error overlay. Windows
installed-font output and browser mouse input do not establish packaged glyph
coverage, hardware touch behavior or native appearance. **All 142 export files
stayed unchanged** during both regression and responsive runs.

See the [raw summary](../evidence/2026-10-16-ui-responsive/browser-summary.json),
[responsive observations](../evidence/2026-10-16-ui-responsive/browser-responsive.json),
[gesture observations](../evidence/2026-10-16-ui-responsive/browser-gestures.json)
and [artifact/screenshot hashes](../evidence/2026-10-16-ui-responsive/browser-artifacts.json).
PNGs remain in ignored artifacts.

The fresh SDK-only Layout Lab also passed **47/47 assertions** at
`http://127.0.0.1:8345/`, on official release
`ae61e55ea184109094d77d88d3b4d0d99a88e5d67200ee4cd3e5e78eb87f4ebb`.
Desktop 1440x900, square 900x900 and portrait 390x844 exercise the four-column,
two-column and single-column layouts. Physical button clicks and live resizing
preserve application count; authored thresholds select the expected variants, equal
grid cells and fixed/grow toolbar allocation match the declared plan. The QA
worker inspected all three screenshots, reported readable complete card text and
no unintended clipping, overlap or error overlay. All 72 export files stayed
unchanged. See [the fresh browser summary](../evidence/2026-10-16-ui-responsive/fresh-browser-summary.json),
[raw observations](../evidence/2026-10-16-ui-responsive/fresh-browser-report.json)
and [screenshot hashes](../evidence/2026-10-16-ui-responsive/fresh-browser-artifacts.json).
The two actual Web samples total **244 passing assertions**, under the same
Windows/browser/input limits stated above.

## Prescribed Claude attempt

Claude Code `2.1.280` was invoked read-only with tools disabled, an empty MCP
configuration, plan permission mode, no session persistence and a two-turn
bound. It timed out at the configured 55 seconds (60.6 seconds measured), exit
124, with zero stdout/stderr bytes. **This was not a completed Claude review and
supplies no approval.** Its recorded baseline, argv, timeout, source/context
scope and byte counts are preserved in
[the attempt record](../evidence/2026-10-16-ui-responsive/claude-attempt.json).

The exact reviewed diff bytes are preserved as base64 with their SHA-256 hash;
this snapshot is a bounded attempt, not an assertion that Claude assessed the
final working tree. Later source corrections must be covered by their executed
regressions and independent source review. No Claude finding or approval is
inferred from the empty output.
