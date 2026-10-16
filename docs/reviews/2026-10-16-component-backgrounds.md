# Reusable UI background intent: implementation and acceptance

Date: 2026-10-16. Baseline: `c64790748a00d239d181f120959854c49c7494d0` on `main`.

## Result and ownership

Existing Luau component factories already reuse the example's cards, actions and
styles. The demonstrated remaining burden was external validation intent: its
68 explicit overlap pairs exposed component internals. Optional typed
`background_for` on existing image/panel leaves now carries that intent inside
the factory. This is a reusable validation primitive, not a themed widget,
renderer, layout solver or game behavior. See [ADR 0039](../decisions/0039-component-background-intent.md).

The observatory example now has **six external pairs instead of 68**. Five
background instances declare the other 62 relationships: the screen, the preset
card and three setting cards. All 68 approved ordered leaf pairs are the same as
before. The six slider skin pairs retain the existing deliberate layering path.
Adding another label inside a card no longer requires a new external pair.

The parser rejects unsupported kinds, malformed scopes, nonancestor targets,
cross-scroll references and backgrounds outside their scope. The inspector only
exempts later, fully contained leaves belonging to the declared scope. It keeps
content collisions, protruding leaves, unrelated siblings, earlier occlusion and
incomplete inspections failing. No placement, paint, clipping or input rule
changed. A matching CLI and player runtime are required for the new field.

## Validation

- Release workspace tests: **417 passed, three existing ignored**. New parser,
  schema, ancestry, scroll, collision, partial-overlap, paint-order and budget
  regressions pass. CLI/MCP search tests cover English and Chinese component
  background/overlap queries using the same API index.
- Strict Clippy: `cargo clippy --workspace --all-targets --locked -- -D warnings`
  passed. The production WASM runtime was rebuilt from the current Core source;
  its known minimal-system build warnings remain separate from strict workspace
  Clippy. The runtime records the baseline commit and dirty source state honestly.
- Normal portable-SDK `project prepare --target web` verified the example's
  strict types, assets, strict desktop layout and **nine deterministic cases**,
  synchronized its bundle and exported the official player. No generated player
  source or inventory was edited.
- The tracked browser gate passed **77 checks, three viewports and 30 real input
  sequences** at 1440x900, 1020x884 and 390x844. Packaged font coverage passed.
  Screenshots were inspected; the initial RGB pixels at all three sizes exactly
  match the accepted previous export, and its leaf geometry/styles/order match.
  This is bounded Web acceptance, not native GPU or arbitrary-widget coverage.

Use the [example's normal export and browser instructions](../../_Games/observatory-settings/README.md)
to reproduce the player checks. Local detailed output is under
`artifacts/ui-background/`; the committed [acceptance summary](../evidence/2026-10-16-ui-background/acceptance.json)
retains counts, input/output hashes and migration equivalence.

## Fresh-context public-SDK probe

A separate AI received an immutable precompiled SDK, an official-document
snapshot, an empty project and the official analyzer, with `fork_turns=none`.
Engine source, existing games, history, web and other agents' output were excluded
by instruction; this was not an operating-system sandbox. All 165 input files
were hashed and reverified unchanged. The snapshot predates the final README
and handoff prose, but includes the implemented API index/types/schema and guide.

Its searches for `card background`, `component overlap` and `font size` found
`ui.setRoot` and `ui.inspect`. It independently used a single typed card factory
twice and declared the screen background. No external overlap file was needed.
Normal verify passed strict types, assets, layout with zero findings and three
deterministic cases; normal portable-SDK prepare exported the official player.
The [command index](../evidence/2026-10-16-ui-background/fresh-command-index.json)
retains 30 recorded calls, including raw search and verify responses.

The first starter preflight still encountered a limited-runtime mismatch:
`camera3d`, `physics2d` and `save` were enabled by the generic starter but absent
from the supplied minimal runtime. The author used public diagnostics to disable
those unused systems in its project. Two author/tool mistakes involved a patch
target repeated in one operation and shell/JSON quoting; neither required an
engine API correction. These residual setup costs are not hidden as successes.

Independent real browser input then passed 30 checks across three viewports:
two clicks on one card and one on the other changed independent counters. The
requested composition was desktop; extra small-viewport input checks do not
certify responsive typography. This small probe uses system fonts, so it makes
no packaged-font coverage claim. Its first QA attempt exposed an order-sensitive
`JSON.stringify` comparison in the coordinator's harness. Replacing that with
semantic `isDeepStrictEqual` fixed the harness without changing the source or
expected outcomes; the original 77-check observatory gate was rerun and passed.

The reusable card remains an ordinary project-owned Luau function. This change
provides shared transport, styling, validation and official presentation, not an
independently installable themed component package or general module loader.

## Independent review and correction

Separate read-only agents checked Core versus layout and the final integrated
diff. One cross-review found that external policy approvals could append beyond
the new intentional-overlap evidence limit. The fix coalesces duplicate ordered
pairs and checks typed plus external evidence before mutating the report.
Focused tests cover exact-cap success, overflow with a byte-equivalent unchanged
report, duplicate amplification and invalid duplicate reasons. Final independent
review found no concrete defect; it was source review, not runtime acceptance.

The prescribed Claude CLI review used version 2.1.280 with a fixed supplied diff,
tools disabled and a 60-second bound. It returned no stdout or stderr before the
timeout (exit 124); **this was not a completed Claude review**. The exact command,
file list and diff hash are preserved in [attempt metadata](../evidence/2026-10-16-ui-background/claude-attempt.json).
The final documentation-only handoff additions are outside that fixed snapshot.
