# Fresh SDK-only control authoring, second validation

Date: 2026-10-16. Baseline: `aaffcf37ac3886a89c7cde167a1519f4ae87e1a4`.

## Boundary and deliverable

A newly spawned author with `fork_turns=none` received an immutable public SDK,
an empty directory, UI outcome requirements and an opaque official analyzer path.
It could read SDK docs and public CLI search/describe/typings/schema/project
commands, not engine/package implementation, other projects, Git history or this
conversation. The restriction was instruction-enforced, not an OS sandbox.
The initial SDK was not updated while the author worked. Its 62 files including
sdk.json and the selected export's 72 files passed independent SHA rechecks.

The author independently built Harbor Settings: official themed components,
slider, project-owned combobox/options, 120 semantic-key virtual rows, Apply/Reset,
non-consuming press/release/held counters and two independent readers per tick.
All source is strict Luau with canonical EngineApi and typed row callbacks. Three
explicit viewport compositions remain project code. No images, custom host,
renderer, HTML UI, network assets or automatic layout were introduced.
The maintained copy is [_Games/harbor-controls](../../_Games/harbor-controls/README.md).

The original [author report](../evidence/2026-10-16-fresh-sdk-ui/author-REPORT.md),
[68 public command records](../evidence/2026-10-16-fresh-sdk-ui/author-public-commands.json),
[document reads](../evidence/2026-10-16-fresh-sdk-ui/author-doc-reads.jsonl) and freeze
inventories preserve actual successes and failures. An unchanged marked-block
refresh preserved project code. Eight deterministic cases and five normal gates
passed, including collapsed and expanded strict previews with zero findings.
Headless preview did not certify fonts, browser input or appearance.

## Confirmed shared findings and fixes

1. Natural UI queries such as `按住按鈕`, `可捲動清單`, `文字字重`, `system font`
   and `兩個讀者按下瞬間` returned empty. `settings screen` returned audio APIs
   without a construction route. The shared API index now fully consumes known
   words inside capability families, including unspaced Chinese, and routes to
   real input/constructor/style APIs. A scrollable-list result also offers the
   real virtual-list constructor. Unknown prefixes/infixes/suffixes and unrelated
   domains remain isolated, exact symbol queries retain one result, and CLI/MCP
   parity is tested. This adds no project-specific API or fuzzy OR fallback.
   Business requests such as `選擇品質` and `調整音量` retain no-match recovery;
   an arbitrary project model is not invented as an engine method.
2. Slider `value` and missing placement passed strict analysis but failed runtime
   validation. The canonical slider/combobox props now mark common invented
   value/options/binding fields absent with `never?`; real analyzer probes reject
   numeric `value`, automatic `options` and `onChange`, while legal rect and anchor
   inputs still pass. Generic row field typos already failed correctly.
   **Remaining type boundary:** structural Luau types are not an exact object
   schema. Conditional placement and arbitrary extra props still need normal
   `verify`/runtime validation. Stronger placement-union prototypes rejected legal
   constructor calls with the supplied analyzer and were not shipped. The public
   guide makes this boundary explicit instead of claiming strict-only acceptance.
3. Bundled UI guides recommended browser/font scripts that the SDK did not ship,
   and linked to unbundled source examples/proposals. The SDK now includes a root
   entry README and the two existing general-purpose observer/cmap tools, all
   embedded from the CLI's compiled authoring contract and covered by its normal
   inventory hashes. External Node/Playwright/browser/Python/fontTools prerequisites
   are explicit and optional. Source-only references/tests are clearly labeled.
   Manifest format and runtime/package requirements are unchanged; a packing
   regression checks inventory, tamper rejection and acceptance of older SDKs
   without these convenience files. Its fake runtime bytes test packaging only.

These fixes belong to shared API discovery, canonical typing and SDK distribution.
Harbor's preset names, geometry, colors and model behavior remain in project Luau.
The UI package implementation and production WASM are unchanged at 0.2.0.

## Independent browser and source review

Independent browser QA used actual official production WASM with a read-only
observation reader and real mouse/wheel input; no game state, payload, API,
renderer or virtual window was injected. At 1440x900, 1020x884 and 390x844, all
363 checks over 48 input/resize steps passed with zero recorded browser/fatal/
console/request/HTTP errors. Two physical hold cycles produced exactly two
presses/releases; held ticks advanced, both reader counters agreed and mismatches
remained zero. Slider capture/clamp, combobox selection, wheel scrolling to the
last visible semantic row, Apply/Reset holds and changed-state resize passed.
Source and export inventories remained unchanged before/after.

The reviewer inspected 21 actual screenshots; the main agent also inspected all
three initial compositions. Labels and hierarchy were readable with no unintended
clipping. A partial list row at the viewport boundary is deliberate scroll clipping.
Typography uses installed Windows Segoe UI/Microsoft JhengHei plus system fallback:
zero packaged faces means 88 observed codepoints have no packaged cmap proof.
This is not a missing-glyph observation or a cross-OS font guarantee. Keyboard,
mobile touch-device and native-host acceptance were not performed.
See [QA report](../evidence/2026-10-16-fresh-sdk-ui/independent-QA.md) and
[browser summary](../evidence/2026-10-16-fresh-sdk-ui/browser-summary.json).
The original qa-freeze also snapshotted concurrently produced root build logs;
qa-owned-freeze is the authoritative immutable scope for the 95 QA-owned files.

A separate read-only source reviewer found no concrete defect in SDK inventory/
legacy compatibility, full-consumption tokenizer/UTF-8 boundaries or the legal
control fields retained by the never? restrictions. It did not build/test.
The prescribed bounded Claude 2.1.280 fixed-diff attempt failed (exit 1,
error_max_turns, no completed report). Its raw response is retained and is
**not a completed review**. The fixed diff preceded the final settings-screen
aliases and Clippy-only corrections; no Claude approval is claimed.

## Validation scope

The full workspace release run passed 458 tests with 3 pre-existing ignored
cases. After the final settings-screen alias change, engine API unit tests and
all 13 CLI/MCP search contract tests were run again. Clippy and final SDK consumer
results are recorded in the adjacent evidence directory. Generated runtimes,
exports, bundle archives and screenshot pixels remain ignored local artifacts;
committed summaries preserve their inventories and exact hashes.

The corrected SDK consumer follow-up retried its own originally missed queries
through the new SDK's public README/CLI. The expected real routes were found;
unknown/cross-domain probes retained no-match recovery. A marked type upgrade
preserved every byte outside the block; legal rect/anchor calls passed and
value/options/onChange/row-typo probes failed strict analysis as expected. Its
valid copy again passed all five verify gates, 8/8 cases and compatible/ready
preflight/prepare, without changing the authored design or state behavior.
The SDK's newly bundled browser tool was executed directly from that SDK with
an empty optional plan: 12 checks, no errors, three actual viewport screenshots,
and a successful font-audit subprocess. This proves tool availability/execution,
not all interactions; the independent 363-check run is separate. Non-strict
system-font coverage remains unproven rather than reported as packaged coverage.

The final SDK's 64 inventory files and root README local links were verified.
The maintained Harbor copy differs from the frozen original only in its marked
canonical type block (outside bytes are identical). The new typed-copy official
export is served at http://127.0.0.1:8344/ . VOIDWAKE and Observatory also passed
normal verify after refreshing their canonical blocks. The final Clippy run and
release build passed; the initial three Clippy style warnings and their correction
remain in the hashed build logs. See [build validation](../evidence/2026-10-16-fresh-sdk-ui/build-validation.json)
and [final SDK/integration](../evidence/2026-10-16-fresh-sdk-ui/final-sdk-and-integration.json).

The follow-up's [48 raw command records](../evidence/2026-10-16-fresh-sdk-ui/followup-public-commands.json)
and [frozen report](../evidence/2026-10-16-fresh-sdk-ui/followup-REPORT.md) are
preserved. All 72 files of its actual SDK-tool-tested official export are
byte-identical to the maintained live preview; the final SDK inventory and both
follow-up source/export manifests passed a final hash recheck. Original author
project (166 files) and original evidence (162 files) remained unchanged.


## Subsequent user-facing host correction

The user later reported strict module MIME errors at the actual8344 preview.
Earlier `--export` QA used its own correctly configured HTTP server and did not
cover that host. The raw Python preview served mjs as text/plain on this Windows
machine. The shared server/SDK guidance and actual-URL acceptance were corrected;
the original player export bytes remain unchanged. See the
[MIME issue and regression](../issues/2026-10-16-web-player-mime.md).

The subsequent mouse-gesture report also exposed a validation gap: earlier
slider checks used the labelled field rather than its separately painted track,
and list checks used the wheel rather than content dragging. The maintained
example now includes the visible track in its authored drag-start region, and
the shared Web controller supports desktop content dragging. These changes
intentionally go beyond the earlier type-block-only integration; frozen original
authoring evidence stays unchanged. See the
[gesture correction](../issues/2026-10-16-ui-pointer-gestures.md).
