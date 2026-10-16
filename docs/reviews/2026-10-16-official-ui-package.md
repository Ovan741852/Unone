# Official shared UI package: implementation and acceptance

Date: 2026-10-16. Baseline: `b776403b8055187fa8ac2faad0a5e852fa2a9f52` on `main`.

## Result and ownership

The official `@unone/ui` version `0.1.0` now supplies shared pure Luau
constructors through `api.ui.components`. It ships with Core and the portable
SDK, including its source, documentation and canonical types. It builds the
existing typed UI tree for the official player; no npm install, network package
loader, second renderer or automatic layout is involved. See the
[package contract](../ui-components.md).

Projects declare the exact version in `runtime_packages`. `info()` remains
available before declaration; the other package helpers require it. The returned
kit constructs text, button, panel, image and component nodes, composes copied
styles and stable instance IDs, and can prepend an explicit scoped surface.
Themes, content, application state, action meanings, responsive choices and
geometry remain project-owned. Custom project factories remain valid.

The observatory example now composes that kit from its existing factories.
Its component names, action IDs, typography, colors, geometry, child order,
responsive branches and state behavior are preserved. Four ordinary component
background IDs use the package's generated `/surface` role. The six deliberate
slider-skin overlap pairs remain unchanged; the helper does not weaken strict
foreground or partial-overlap inspection.

## Review findings and corrections

1. **Live virtual-node ownership.** Source review found that deep-copying an
   engine-registered `virtualList` / `virtualGrid` node detached the published
   tree from the node retained by the runtime registry. A later UI request
   updated the registry original while the copied published node stayed stale.
   The copy path at `packages/unone-ui/src/components.luau:69` now preserves exact
   registered-node identity through a private predicate supplied at
   `crates/unone-engine/src/runtime/bindings/state.rs:74` and implemented at
   `crates/unone-engine/src/runtime/bindings/scroll.luau:126`.
   Ordinary authored props, themes and children still copy. The
   runtime keeps ownership of a live virtual node's viewport, materialized
   children and scroll state. A real EngineRuntime regression exercises the
   subsequent request/update path; source-level constructor equality alone
   would not establish this behavior.
2. **Stale native package descriptors.** Android packaging queried an existing
   Windows capability executable. After a package version change, that stale
   Windows version could be stamped into `runtime.json` for a newly built
   Android binary embedding the current version.
   `Assert-CurrentNativeRuntimePackages` at `scripts/build-native-player.ps1:9`
   now compares the queried descriptor's complete package map against the
   canonical source manifest before creating the output directory or copying
   files. Review exercised 16 isolated cases, including current manifest version
   `0.2.0` versus a stale queried Windows descriptor declaring `0.1.0`. The
   [independent review](../evidence/2026-10-16-ui-package/independent-review.json)
   preserves those cases and their results. SDK validation also requires package
   declarations in `sdk.json` and `runtime.json` to agree, and runtime selection
   rejects missing or incompatible project package versions. These are
   compatibility checks; they are not native GPU execution evidence.

Independent read-only review reported no remaining concrete findings after
these corrections. The scope includes package copying, runtime integration,
strict API/type discovery, SDK inventory/selection and the example migration.

## Executed validation

- Final release workspace tests: **432 passed, three existing ignored**. The
  raw final run is `artifacts/ui-package/workspace-tests-final3.txt`. Coverage
  includes constructor/style/identity behavior, declaration failures, real
  runtime virtual-node updates, canonical API types, English/Chinese discovery
  and CLI/MCP parity, SDK selection and descriptor compatibility.
- Final strict workspace Clippy passed; raw output is
  `artifacts/ui-package/clippy-final.txt`.
- The observatory's normal SDK preparation and official Web export passed.
  The independent browser gate passed **77 checks and 30 real input sequences
  across three viewports**: 1440x900, 1020x884 and 390x844. Its initial-state RGB
  pixels exactly match the accepted baseline at all three shapes. That pixel
  comparison covers the initial state; subsequent input outcomes are covered
  separately by the browser gate.
- A source comparison passed **57 raw UI/observation comparisons** against the
  pre-migration example, normalizing only the four permitted surface IDs. The
  exact command, harness, stdout and limitations are preserved under
  `artifacts/ui-package/baseline-comparison*`. This used the real package Luau
  source with a fake API; it did not run the EngineRuntime parser, package
  selection, host hit testing or rendering. It is separate supporting evidence
  from the actual runtime and official-player checks above.

The compact committed record is
[acceptance.json](../evidence/2026-10-16-ui-package/acceptance.json).
Detailed local reports, screenshots and command output remain under
`artifacts/ui-package/`. The
[example instructions](../../_Games/observatory-settings/README.md) reproduce
the normal author workflow; source review and distributor parity checks do not
add duplicate mandatory author commands.

## Fresh-context SDK-only authoring

A fresh author started with `fork_turns=none` and received an immutable portable
SDK and official documentation, without engine implementation or existing-game
examples. This was an instruction-enforced input boundary, not an operating
system filesystem sandbox. Two independent project compositions were authored
through the public package/API surface. Each passed its **two deterministic
tests**, then independent official-player browser QA passed **24 checks and nine
real input sequences across three viewports per project**. Repeated instances
maintained separate counters under actual browser clicks.

Project A's first browser attempt timed out during navigation after 30 seconds,
before any checks ran. Its raw failure remains in
`artifacts/ui-package/fresh-browser-a-process.txt`; the successful 24-check
rerun is recorded separately under `fresh-browser-a-final/`. Project B's report
is under `fresh-browser-b/`. The initial timeout is not counted as a passing run.

These small projects use system fonts and requested desktop compositions.
Additional small-viewport input checks establish the exercised interactions;
they do not certify responsive typography, packaged-font coverage or arbitrary
layouts. The observatory's separate packaged-font and player evidence remains
the stronger typography scenario.

## Prescribed Claude attempt and limits

The prescribed read-only Claude CLI review was attempted with version
`2.1.280 (Claude Code)`, tools disabled, a supplied fixed diff and a 60-second
bound. It timed out after **60.82 seconds**, exit **124**, with zero stdout and
stderr bytes. **This was not a completed Claude review.** The exact command,
baseline, duration and exit status are preserved in
[attempt metadata](../evidence/2026-10-16-ui-package/claude-attempt.json), with
[empty stdout](../evidence/2026-10-16-ui-package/claude-stdout.txt) and
[empty stderr](../evidence/2026-10-16-ui-package/claude-stderr.txt).

The supplied diff SHA-256 was
`1d6ad2e53a983c7fae7dab551f95c867703e662fb6c107660994e37ca10f97a4`.
Later documentation-inventory and test-helper edits are outside that incomplete
snapshot. Independent source review and executable regression results are
separate evidence, not a substitute labeled as Claude output.

Acceptance is bounded to the tested Core/SDK contracts and official Web player.
No native GPU validation was performed. These results do not certify every
widget, accessibility behavior, arbitrary composition, future package version
or every AI author's discovery route. Headless validation and descriptor
compatibility do not prove a host painted a screen.
