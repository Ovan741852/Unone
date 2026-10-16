# UI control, operation discovery and type authoring review

Date: 2026-10-16. Baseline: `859826ecdac50f5722cc66a226123039d4675e2e`.

## Shared implementation

`@unone/ui` 0.2.0 has the same typed constructor vocabulary on the default
module and themed kit, including slider, combobox, screen and registered scroll
helpers. No game colors, component IDs, value model, automatic layout or renderer
replacement were added. Runtime diagnostics reject invented callbacks and relative
placement props. Real API descriptors route English and Chinese operation queries
to `wasPressed`, `wasReleased` or `isDown` and construction queries to callable
constructors. CLI and MCP share these results.

Tick edges are non-consuming successful-tick snapshots. The safe marked type
refresh preserves outside bytes and uses staged atomic replacement, confined
paths and no-op detection. Virtual options preserve project row types through
generic callbacks. Source export and SDK selection share exact package-version
gates. New scaffolds explicitly declare their demonstrated optional systems,
without changing legacy project defaults.

## Independent review

An independent read-only agent reviewed input rollback/reload/replay, package
managed-handle identity, canonical types, atomic updates and scaffold contracts.
It subsequently reviewed the replay-adapter reload fix, direct-export version
gates and minimal starter profile. It reported no concrete remaining defects.
This was source review, not test execution. The final type-only row generics were
separately checked with the official analyzer, including a rejected field typo.

The first full test run exposed an existing reload defect: the replacement VM
never registered its returned replay adapter. The shared reload path now registers
it before publication. Successful reload/new adapter and rejected candidate/old
adapter behavior have regression coverage. The original failed run is retained
locally as `artifacts/ui-ergonomics/workspace-tests.txt`.

The prescribed fixed-diff Claude CLI attempt used version 2.1.280, disabled tools,
plan permission mode and one turn. It timed out after 56.3 seconds with no stdout
or stderr (exit 124). It is **not a completed review**. Its exact invocation and
fixed diff SHA-256 are in [raw attempt](../evidence/2026-10-16-ui-ergonomics/claude-attempt.json).
The supplied diff preceded the final starter profile, virtual type generics and
documentation cleanup; no Claude conclusion is claimed for any part.

## Fresh SDK author

A new agent with `fork_turns=none` received only an immutable official SDK, an empty
project, a requested control exercise and an analyzer path. Its restriction was
instruction-enforced, not an OS sandbox. It did not inspect package implementation,
engine code, other examples or this conversation. The public search/describe,
typings, schema, verify and project prepare routes produced a strict typed UI
with a button, slider, combobox and 120-row virtual list. All construction uses
the official kit and official player. Six deterministic cases and four normal
verify gates passed.

The raw [author report](../evidence/2026-10-16-ui-ergonomics/fresh-author-report.md)
and [49 command records](../evidence/2026-10-16-ui-ergonomics/fresh-commands.json)
preserve actual errors and corrections. Rechecks confirmed all 62 SDK input files
and 93 frozen project/export files unchanged. This probe snapshot preceded the
last fixes: unused scaffold-system requirements, stale manual-edge scroll advice
and non-generic row types were found by the author and corrected afterward.
Analyzer installation remains an explicit official toolchain prerequisite.

Independent real-browser QA performed actual mouse hold/release, drag, combobox
choice, wheel scrolling and visible-row selection. Both viewports passed all 15
interaction/runtime checks without fatal, console, page or request errors. Desktop
was readable. The fresh author's fixed two-column geometry clips labels at 390px;
portrait visual responsiveness did **not** pass. This interaction probe is not
claimed as mobile visual or accessibility acceptance, and its frozen project was
not rewritten to conceal that finding. The game examples own their responsive
geometry. See [browser summary](../evidence/2026-10-16-ui-ergonomics/fresh-browser.json).

## Maintained examples and final validation

VOIDWAKE retains its fonts, explicit geometry, palette, actions, ImageGen art,
declarative particles, engine shader API and official renderer. It uses canonical
marked types, the default kit, composeStyle, screen and shared input edges.
Observatory uses the same typed controls and shared edges. Neither receives a
special engine control or layout rule.

Final command results, SDK provenance, real-browser/font checks and the independent
old/new runtime comparison are recorded in the adjacent evidence directory.
The final workspace release run passed 455 tests with 3 pre-existing ignored tests.
No generated binaries, exports, fonts or screenshots are added as engine source.

The final SDK's 61 inventory files passed SHA-256 verification; its 14 bundled
package/type/guide files match this checkout byte-for-byte. A new untouched
`project init` then passed verify (2/2 cases), compatible preflight and ready
prepare on the first attempt, without editing systems or source. Only prepare's
normal bundle_manifest field was added. See [starter follow-up](../evidence/2026-10-16-ui-ergonomics/starter-final-report.json).

The two separate real production WASM VMs executed 20,022 ticks. All 19
checkpoints at each of three aspects (57/57) have exactly equal raw world.ui and
observations, including held actions, pause, upgrades and natural death. No font,
script, config, state or expectation normalization was used. Both input exports
and runtime binaries remained byte-identical before/after; dirty-build provenance
and JS/WASM hashes are explicit. This compares runtime semantics, not pixels.
See [comparison](../evidence/2026-10-16-ui-ergonomics/runtime-ui-equivalence.json).

Actual official-player browser checks passed 108/108 for VOIDWAKE and 77/77 for
Observatory at desktop, intermediate and portrait sizes, with no reported browser
or failed-request errors. Strict local cmap coverage passed (10 VOIDWAKE font
faces and 5 Observatory faces). The main agent inspected VOIDWAKE desktop menu,
pause, portrait HUD and Observatory portrait screenshots: type hierarchy, control
labels and authored layout remain intact. Screenshots and full observations stay
in ignored artifacts with SHA-256 inventories in the committed summaries.
The external live player has all 124 files byte-identical to the canonical export;
its actual runtime check passed 27 assertions over 1,501 frames. Preview:
http://127.0.0.1:8341/?ui=unone-ui-0.2.0 . This URL is local, not a public deployment.

`cargo clippy --workspace --all-targets --release -- -D warnings` and the final
release CLI build passed. The first failed full run, final 455-pass run, build
logs and compiled dirty-runtime identities are hashed in
[build validation](../evidence/2026-10-16-ui-ergonomics/build-validation.json).
