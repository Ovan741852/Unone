# Fresh-author UI discovery and SDK recovery validation

Date: 2026-10-16. Baseline: `91448f00419d96ef544bfbe4fdcdec2c719df4f7` on `main`.

## Result

A fresh-context AI built the observatory settings example from the official
README/AGENTS, linked documentation, public CLI/API/schema and a precompiled
portable SDK. It found the existing component tree, packaged font catalog and
typed style contract without engine source or existing-game implementation hints.
No new engine UI primitive or game-specific rendering rule was required.

The example uses three repeated setting cards, reusable actions and a skinned
slider. Three font families and regular/bold faces establish hierarchy. Actual
controls change draft state; Apply snapshots it and Reset restores defaults.
Wrapping, intentional ellipsis, padding, rounded borders and opacity use the
official player. This is a UI/state example, with no audio playback, hardware
brightness control or persistence.

Independent real-player acceptance passed **77 checks, three viewports and 30
real input sequences**. Font auditing found no uncovered characters in either
the original corrected export or the integrated rerun. The author corrected an intermediate-width heading after independent
visual feedback; the original clipped screen and earlier exports remain preserved.

The observed common tooling problem was a generic starter paired with a limited
SDK runtime. Its first preflight failed without identifying the missing systems.
The shared CLI now reports concrete capability differences and executable recovery
actions. A second fresh-context AI used that information and public docs to
recover without implementation hints or engine changes.

## Experiment boundary and discovery

The first author used `fork_turns=none`; the earlier game, UI implementation and
conversation were not inherited. Inputs were an immutable SDK, 115 official
document/schema files, licensed font resources and the official Luau analyzer.
Access to engine source, Git history, existing games, other agents' output and
the web was explicitly prohibited. This boundary was instruction-enforced, not an
operating-system filesystem sandbox. A documentation assistant used the same
restricted official input set.

SDK verification and document hashes were checked again after authoring. The
[protocol and input hashes](../evidence/2026-10-16-ui-authoring/protocol.json)
record the baseline. The [command log index](../evidence/2026-10-16-ui-authoring/discovery-log-index.json)
preserves 34 CLI log hashes, exact arguments, exit statuses and eight searches.
Queries for font size, text alignment, border padding and component styling all
found `ui.setRoot`; responsive discovery found `ui.getViewport`. The author then
used the generated strict types, schema and described input APIs.

The first official export took roughly eight and a half minutes from the first
read in this one run. This includes model, filesystem and tool time; it is not
an isolated engine performance measurement or a general AI productivity claim.
The [original author's report](../evidence/2026-10-16-ui-authoring/fresh-author-findings.txt)
retains the actual route, failures and rough timing.

## Observed problems and corrections

1. **SDK compatibility guidance.** The supplied minimal runtime omitted
   `camera3d`, `physics2d` and `save`, which the generic starter enabled. The old
   `SDK_RUNTIME_UNAVAILABLE` response named no concrete gap and left only a
   retry action. The shared selection error now retains target, variant, pinned
   ID, required systems, each candidate's match flags, compiled systems and
   missing systems under `facts.runtime_selection`. SDK/system inspection and
   exact preflight retry are preserved. No selection policy or authored system
   choice is changed automatically.
2. **Recovery context.** Independent source review found that non-capability
   errors could drop an explicit SDK from retry suggestions. Requests now retain
   SDK, target, variant and runtime ID for all prepare/preflight failures;
   a verified canonical SDK root takes precedence when available. The second
   fresh recovery probe also found that bare `game` was unavailable on PATH.
   Suggested actions now use the actual executable with platform-appropriate
   shell quoting. Both problems have focused regressions and direct command
   acceptance, separate from the original immutable probe.
3. **Author mistakes.** Strict Luau caught two widened `kind` literals; explicit
   `UiNode` locals fixed them. Strict layout exposed one unintended control/text
   overlap; the author corrected the rectangle and supplied the documented
   explicit background policy. At 1020 by 884, a fixed large heading clipped;
   the author chose a smaller explicit size for that aspect. These were authored
   type/layout errors, not unsupported engine APIs. The
   [visual correction record](../evidence/2026-10-16-ui-authoring/author-visual-correction.txt)
   and before/after screenshots are retained. Current styling guidance explains
   strict node annotation, intermediate-aspect inspection and font notice copying.
4. **Test/setup mistakes.** The coordinator initially misspelled the analyzer
   environment variable and supplied a Chinese font subset; both were corrected
   before the first relevant checks. Earlier QA had a stale label selector,
   an overly broad automatic-wrap assertion and a `letterSpacing="normal"`
   measurement issue. Those were corrected in the harness and are not counted
   as engine failures. Raw prior attempts remain in ignored local evidence.

The [second fresh AI report](../evidence/2026-10-16-ui-authoring/fresh-recovery-report.md)
preserves its first failure, inspections, justified choices, successful retry and
normal verify. It changed only the three unused system settings, retained used
particles and UI, and passed both starter tests. Its observations about PATH
precede the final executable-path correction described above.

## Reproduce and assess the evidence

The integrated [source example](../../_Games/observatory-settings/README.md)
preserves the author's corrected UI/state code and generated type prelude.
Only portable launch/export documentation and tooling were added during
integration. Normal SDK `project prepare` owns verification, synchronization
and the untouched official export inventory. Five TTFs and their three license
notices are included in the source; generated SDKs, runtimes and bundles are not.

Use the example's export instructions, then run the tracked
`scripts/verify-ui-example-browser.mjs` with its public-outcome browser plan.
The gate observes the actual production WASM ABI and Canvas paint calls without
editing source, payloads, snapshots or runtime memory. Input uses actual browser
events. The three viewports are 1440 by 900, 1020 by 884 and 390 by 844.
It checks sound/mode/level/Apply/Reset, repeated components, actual font painting,
font character coverage, automatic wrapping where exercised, intentional ellipsis
and the heading's measured extent. Screenshots are also inspected visually.

Compact final results are in
[acceptance.json](../evidence/2026-10-16-ui-authoring/acceptance.json) and the
[original corrected-player browser report](../evidence/2026-10-16-ui-authoring/browser-acceptance.json).
The final integrated export is checked independently using the same tracked gate.
Release workspace tests and strict Clippy cover the shared CLI changes; SDK
selection tests retain exact target/variant/ID/system matching and size/ID ordering.

This is one complete UI scenario and a separate fresh recovery probe on the Web
official player. It does not certify every widget, arbitrary layouts, native GPU
presentation, accessibility or all future AI models. The headless layout preview
still uses its reference aspect; portrait acceptance here comes from the actual
browser, not an inferred headless result. Background overlaps remain explicitly
reviewed rather than inferred by a layout engine.

## Independent source review

Read-only review confirmed unchanged runtime selection policy and found the SDK
retry-context issue corrected above. The prescribed Claude CLI review was also
attempted with version 2.1.280, tools disabled and a fixed SDK/prepare diff. It
produced no stdout or stderr before a 90-second timeout (exit 124), so **it was
not a completed Claude review**. The exact command and supplied diff hash are in
[attempt metadata](../evidence/2026-10-16-ui-authoring/claude-attempt.json).
The final SDK-context and executable-quoting corrections are outside that
incomplete snapshot; executable regression results are separate evidence.
