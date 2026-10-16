# Bounded final SDK consumer follow-up

Completed using only final-sdk public README/docs/CLI and a copy of my own
source. Original example/author-evidence/sdk were not written; all 166 original
project files and 162 evidence files match their frozen hashes, as do the old
SDK manifest/CLI. No engine/package/runtime/template implementation, root
source, other project or prior solution was read. No Cargo, web search,
renderer replacement, design/action change, commit or push was used.

## Results

- Replayed all 17 original natural queries: 15 now return related callable
  descriptors. Improvements include settings screen, 按住按鈕, 可捲動清單,
  文字字重, system font and 兩個讀者按下瞬間. Full descriptors/guide paths are
  preserved in discovery-results.json and raw command outputs.
- 調整音量 and 選擇品質 remain no-match with an explanation of project-owned
  semantics and usable full-index/project-bound systems recovery. Both recovery
  commands were actually executed and exited 0.
- Seven unknown suffix/cross-namespace/project-word probes correctly return no
  matches: ui.components.slider.extra, input.wasPressedFoobar, audio.wasPressed,
  physics.slider, save.virtualList, SelectPreset_travel-creative, 海港晨間預設.
- Official typings update changed only the canonical block (38114→38423 bytes).
  Outside-block prefix and entire project body are byte-for-byte identical;
  before/after sources and byte/hash proof are retained.
- Slider value, slider onChange and combobox options now fail strict analysis
  with never? errors. Contextual PresetRow item.lable still fails precisely.
  Legal rect and anchor+size pass strict analysis and runtime. Missing placement
  still passes types and fails runtime, matching the documented limitation.
  Every temporary probe was restored; invalid sources/raw failures are retained.
- Valid copy verify passed all five gates, including zero collapsed/expanded
  layout findings and 8/8 deterministic cases. Preflight/prepare passed with
  web-production-0, @unone/ui 0.2.0 and renderer_mode=official.

## Bundled tool smoke

The new SDK root README led directly to the public browser-tool guide. Its {}
minimal plan was executed from the SDK root using the SDK's actual
scripts/verify-ui-example-browser.mjs, Node 24.11.1, the provided Playwright module,
msedge and Python 3.12/fontTools 4.56.0. No script implementation was inspected.

Exit 0: 12 checks, zero errors at 1440×900, 1020×884 and 390×844. Reports confirm
actual official renderer, advancing production WASM, no fatal/browser/asset/
compiler errors, and desktop/medium/portrait compositions. Three initial
screenshots were produced and inspected as tool-output artifacts.

The invoked font audit also exited 0; its report truthfully has ok=false,
strict=false, zero packaged faces and 85 unproven codepoints. The unchanged
project uses installed fonts, and the minimal plan does not require packaged
coverage. This smoke covers initial states only and does not replace the
independent 363-check browser QA or prove action/drag/scroll/hold acceptance.

## Frozen artifacts

- Copy/export: followup/, followup/dist/player/index.html.
- Source SHA-256: 6d63cc7191d66e92d3ace0b6a17513bbcbdaa96cc1026866f5e6465fe39ee747.
- Release: releases/e0016f3283178200f6f12298d33e69cc093223f9da805fb29ddf8c0ea7b7421a/.
- 48 exact executable/argv/cwd/environment/exit/raw records: commands/.
- Detail: discovery-results.json, type-results.json, type-upgrade-proof.json,
  prepared-summary.json, browser-smoke-summary.json, original-freeze-check.json.
- SDK/source/export/evidence hashes: sdk-input.json and freeze/.

No new blocking SDK issue was encountered. A local evidence formatter's empty
matches/null-text handling was corrected; it did not affect SDK or project code.
