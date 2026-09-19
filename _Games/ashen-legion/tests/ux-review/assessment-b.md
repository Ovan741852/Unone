# Assessment B — isolated detector, browser, and mechanical evidence

Status: COMPLETE / WITHHELD FROM PARENT SYNTHESIS UNTIL ASSESSMENT A COMPLETES.

Current disclosure rule: FULL Assessment A must finish before any further detector findings, counts, or partial map/layout results are disclosed. The user's latest correction revokes the earlier narrow-disclosure exception recorded below. This rule supersedes that historical note; readiness-only handoff is required.

Date: 2026-09-19 (Asia/Taipei). Delegated Assessment B only; no subagents spawned. Assessment A, prior critique snapshots, and prior critique conclusions were not read. This is not the combined critique and does not assign A's aesthetic/heuristic scores.

## Scope and baseline

- Target: [ui/formal-ui.luau](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau); resolved target slug: `ui-formal-ui-luau`.
- Live export: [seed 42](http://127.0.0.1:8190/?seed=42), inspected in a NEW B-owned in-app browser tab at 1280×720.
- Followed ancestor/project AGENTS, UI-PRODUCTION, DESIGN, equipment-store guidelines, and currency rules. Applied Impeccable's B/overlay protocol and the freshly retrieved Web Interface Guidelines. Used existing test infrastructure/evidence without adding a framework.
- Parent is separately replacing map art. All observations below concern the OLD/current export, not the new map or its acceptance. No export build was run.
- No runtime/source changes, settings changes, save creation/loading/deletion, purchases, deployment, injected actions, or injected scripts. The only writes are this report and its two detector JSON evidence files.
- `impeccable context` was NOT rerun. `.impeccable/critique/ignore.md` absent; no project/local detector config files were found at their exact conventional paths.

Baseline fingerprints (SHA-256; captured before report assembly):

| File | Fingerprint |
| --- | --- |
| ui/formal-ui.luau | `5acbb8c47d1a6383219ef74ff6d00b4b3857d12faf2d13f2b9f787494d55097e` |
| host.mjs | `ed5857581aa35ceb2e754b6250bf5924dc5b03649ad79bf7ff3c93e61517ecbb` |
| presentation/adaptive-ui.mjs | `1c2f404f6a585708efead8760755b220bdc0d80ab0f381b98e3979ec167e67e0` |
| presentation/screen-layouts.mjs | `64cf8af4bcc95ae944b4fb696ecbb3a464b845596d3302d4ee88f012cb74e330` |
| presentation/shop-accessibility.mjs | `b1084140d111668f22e32894e5c39e96b320b02ebbacc516606b17f29362a339` |
| dist/web/content/project.json | `cd339e3aabd28e43cabdcefd4695f05a2db9aa460d868d2526d55eda311ac277` |

The source UI was last modified at 2026-09-19 20:23:35 +08:00. Export payload was modified at 20:29:20. Read-only comparison verified that the exported payload's script exactly equals current main.luau and contains the complete trimmed formal-ui source. The live DOM's host module URL contained the matching `ed5857…17ecbb` content hash. Export files were read only for provenance, not scanned as duplicate detector targets.

## Actual installed detector execution

Executable invoked: `C:/Users/liNao/.codex/skills/impeccable/scripts/impeccable.cmd`. Installed launcher VERSION file: `0.1.5`; skill metadata version: `4.3.1`. The actual launcher ran successfully; no substitute scanner was used.

Working directory: `D:/Projects/YesSir/_Games/ashen-legion`.

General scan:

```powershell
& 'C:/Users/liNao/.codex/skills/impeccable/scripts/impeccable.cmd' detect --json index.html host.mjs ui/formal-ui.luau presentation/adaptive-ui.mjs presentation/screen-layouts.mjs presentation/ui-components.mjs presentation/ui-motion.mjs presentation/shop-accessibility.mjs presentation/landscape-host.mjs
```

Map-related layout scan:

```powershell
& 'C:/Users/liNao/.codex/skills/impeccable/scripts/impeccable.cmd' detect --json --scope layout index.html host.mjs ui/formal-ui.luau presentation/adaptive-ui.mjs presentation/screen-layouts.mjs
```

These are named-file scans: nine first-party targets, then five map-relevant targets. No directory recursion into `presentation/vendor`, no vendor source, no `dist` copies, design previews, or test snapshots. The HTML target brought in its linked `presentation/landscape-host.css`; neither pass was CSS-only.

Raw results:

- [General JSON](D:/Projects/YesSir/_Games/ashen-legion/tests/ux-review/assessment-b-detector.json): 6 records = 2 warning/primary records + 4 advisory records.
- [Layout JSON](D:/Projects/YesSir/_Games/ashen-legion/tests/ux-review/assessment-b-detector-layout.json): 0 records.
- Both tool invocations reported shell-process exit code 0. Native `$LASTEXITCODE` was not separately captured; do NOT interpret the first process exit code as “no primary findings”—the JSON explicitly contains two warnings. No operational scan error was reported.
- Reuse these complete outputs; there is no need for the parent to rerun the detector.

| Rule id | Count / severity | Detector location | Verified originating source / disposition |
| --- | --- | --- | --- |
| design-system-font | 1 warning | index.html:0 | [landscape-host.css:8](D:/Projects/YesSir/_Games/ashen-legion/presentation/landscape-host.css:8): actual family is `"Microsoft JhengHei",sans-serif`, already declared in DESIGN front matter. Detector reports only `jhenghei`. Parser/tokenization false positive, not a demonstrated font substitution. |
| marquee | 1 warning | index.html:0 | [landscape-host.css:14](D:/Projects/YesSir/_Games/ashen-legion/presentation/landscape-host.css:14): indeterminate loading-progress sweep, not scrolling content. Has a reduced-motion fallback at line 16 and real progress/error semantics in index.html:12–40. Contextual false positive; removing progress feedback is not warranted. |
| design-system-color | 4 advisory | index.html:0 | Loading background rgb(16,37,32), title text rgb(237,223,180), border rgb(141,121,79), elapsed text rgb(178,185,153). Actual literals at [landscape-host.css:8](D:/Projects/YesSir/_Games/ashen-legion/presentation/landscape-host.css:8), :9, :11, :12. Outside the small named palette, but within the existing forest/parchment loader treatment. Documentation-coverage advisory; no proven readability failure or reason to overturn approved art. |

The detector uses line 0 for these HTML/computed-style reports. That is NOT a valid source-line claim. Exact first-party CSS locations above were resolved manually.

### Detector/platform limits

The scanned gameplay interface is authored as Luau nodes, transformed by JavaScript, and drawn into Canvas with nine-slice PNG assets. A static HTML/CSS/regex scan does not execute that Luau layout or understand its normalized rectangles, action bands, Canvas glyph clipping, textured contrast, modal action routing, or WASM state transitions. No findings in mjs/luau and an empty layout scan are NOT a passing Canvas audit. Actual scannability/coverage of each non-HTML language was not reported by the CLI; no AST-level Luau support is claimed.

## Browser capability and overlay accounting

- Initial attempt to create a visible IAB tab was rejected: `IAB visibility is not supported in a subagent thread`.
- Created a new hidden/background IAB tab instead; tab id `1`, owned by B. The creation result was returned before an assignment-binding error; B then bound that exact newly created tab. No existing user/A tab was reused.
- Browser docs expose `playwright.evaluate` and locator evaluate as READ-ONLY. No documented mutable script-injection API was exposed. Therefore the title/script mutation preflight was not attempted.
- Overlay injection: NOT RUN. In-page Impeccable detector: NOT RUN. User-visible overlay: NONE. No claim of a [Human] overlay or console scan.
- No Impeccable live-server was started; stop method not applicable. Existing game server at 8190 was neither restarted nor stopped.
- Fallback: native browser screenshots and accessibility-tree/DOM reads, plus existing official Canvas metrics/glyph captures under tests/all-ui.
- Native browser screenshots were inspected inline in the B tool transcript (menu, keyboard-focused menu, settings, profiles, deletion confirmation). The exposed native capture returned image bytes/inline images, not a persisted screenshot path; these live images are NOT falsely listed as local PNG artifacts. Durable fixture PNGs are linked below.
- B's tab was explicitly closed after safe return to the title screen. No viewport override, injected element, temp server, or temporary source file remains.

## New live interaction evidence — not fixture

All below occurred at 1280×720, seed 42, current export, through native keyboard/mouse APIs. Screenshot/AX observations follow each action; timing below means observed response by the next capture, not a measured latency benchmark.

| Step | Action | Observed response |
| --- | --- | --- |
| 1 | Open B tab, allow normal loading | Ready menu; DOM `data-ready=true`, `data-phase=menu`. Native AX exposes three real buttons: 讀取進度 / 系統設定 / 離開. |
| 2 | Tab from page | Focus becomes `start`; native screenshot shows a clear gold focus outline around 讀取進度. |
| 3 | Tab, Enter | Opens settings. Focus moves to `settings_music_down`; visible gold outline. AX names volume controls correctly; quality/language both appear as “切換”. No setting activated. |
| 4 | Escape | Returns to title; focus goes to `start`, not the originating settings button. |
| 5 | Enter on 讀取進度 | Opens profile selection, NOT a save. One existing slot and two empty slots were visible. First focus `profile_load_1`; empty slots both expose “建立新檔” without slot names. |
| 6 | Try AX-index click on 刪除 | Browser reports “Node does not have a layout object”. Canvas fallback semantics are exposed but not normal DOM layout boxes. This is an automation targeting limitation, not proof that the game is unclickable. No effect. |
| 7 | Native Canvas click at (341,478), observed delete-button center | Opens confirmation only. Source check beforehand showed DeleteProfile sets the pending candidate, while persistence occurs only on ConfirmDelete. Never confirmed. Focus `delete_cancel`; DOM role=dialog, aria-modal=true; only Keep/Delete in semantic modal. |
| 8 | Shift+Tab, then Tab | Focus wraps to `delete_confirm`, then back to `delete_cancel`. No activation of confirm. |
| 9 | Escape | Cancels confirmation. Original slot and values remain visible. Focus returns to `profile_load_1`, the previously focused element, not pointer-clicked `profile_delete_1`. |
| 10 | Native Canvas click at (450,653), inside the return button's left decorative area | Returns to title; verifies an additional non-text-center hit position. |
| 11 | Read warning/error log and close B tab | Captured warning/error log list empty. Tab closed successfully. |

This establishes keyboard navigation, visible focus, a sampled Canvas mouse hit, a second decorative-edge hit, cancel-first modal focus, trap wrap, Escape recovery, and concrete focus-return behavior. It does NOT establish every card's full-area hit coverage, touch gesture correctness, all modal background blocking, screen-reader speech output, or millisecond responsiveness.

Safety: no profile loaded/created/confirmed deleted, no language/audio/quality toggle activated, no purchase, no save-storage manipulation. The game owns automatic startup persistence in [host.mjs:145](D:/Projects/YesSir/_Games/ashen-legion/host.mjs:145); B did not disable or intercept it and does not claim an instrumented before/after byte audit of localStorage.

## Existing fresh fixture and test evidence — NOT rerun by B

[tests/all-ui/report.json](D:/Projects/YesSir/_Games/ashen-legion/tests/all-ui/report.json) was last modified 2026-09-19 20:29:43 +08:00. SHA-256: `9e854058c55c48ec1144885e3926de78733eff57b20d95f55c422dd8c8db1183`.

It reports `fixture:true`, `ok:true`, 188 cases (47 states × four sizes), no listed failures, no listed browser errors, minimum captured font 14 px. Sizes: 1440×900, 1280×720, 900×600, 844×390.

Mechanism verified in [tools/verify-all-screens.mjs:22](D:/Projects/YesSir/_Games/ashen-legion/tools/verify-all-screens.mjs:22): synthetic state is inserted into actual Luau/WASM startup, then official exported Canvas renderer draws it on a routed fixture page. This is not natural play and does not include the full live 3D scene. The test checks bounds, glyph/font clipping, text overlap, merged same-action target sizes, and renderer diagnostics at [tools/verify-all-screens.mjs:51](D:/Projects/YesSir/_Games/ashen-legion/tools/verify-all-screens.mjs:51). Same-action union checks do not prove contiguous hit area or exercise every pointer point. The minimum font test is 14 px; it is not a complete semantic audit of every primary-name/price 16 px requirement.

Visually inspected in this B run:

| Fixture | Capture time +08:00 | Evidence / bounds |
| --- | --- | --- |
| [map-1440.png](D:/Projects/YesSir/_Games/ashen-legion/tests/all-ui/map-1440.png) | 20:29:27 | Baseline map, 1440×900; paired JSON: 53 nodes, minimum font 16, no diagnostics; only unique action VisitLocation. |
| [map-844.png](D:/Projects/YesSir/_Games/ashen-legion/tests/all-ui/map-844.png) | 20:29:39 | Baseline map, 844×390; 53 nodes, minimum font 14, no diagnostics; same one action. |
| [gear-844.png](D:/Projects/YesSir/_Games/ashen-legion/tests/all-ui/gear-844.png) | 20:29:40 | Two-item inventory with roster/slots/detail/equip; no diagnostics, minimum font 14. No live equip attempted. |
| [shop_tech-844.png](D:/Projects/YesSir/_Games/ashen-legion/tests/all-ui/shop_tech-844.png) | 20:29:42 | Research supply names and summary wrapping; no diagnostics, minimum font 14. Actual text includes raw IDs and a split decimal despite geometric pass. |

Map 1280×720/900×600 were read as mechanical cases, not separately visually inspected. All four map cases have no listed failures. Idle-map fixture explicitly forces `S.mapMoving=false` and `S.mapFrom=0`; it is not evidence of live movement or the automatically transitioning travel state.

[tests/all-ui/interactions.json](D:/Projects/YesSir/_Games/ashen-legion/tests/all-ui/interactions.json), modified 20:29:58, SHA-256 `52db3f6d5a2f868d4b1b3ac24e0c1218b5280ec6731e20edc8b32d201dff45b9`, reports `ok:true`, five check descriptions, no errors:

1. Menu/settings/profile/town detail focus and Escape.
2. Delete defaults to Keep; Escape preserves save.
3. Keyboard purchase, equip detail/return and equipment-slot icon hit.
4. Rune pagination, deployment, pause/guide, abandon and AUTO.
5. Chest down/up contract — explicitly an adapter fixture, NOT a real chest gameplay completion.

Read the test implementation, not a prior critique. [tools/verify-all-ui-interactions.cjs:11](D:/Projects/YesSir/_Games/ashen-legion/tools/verify-all-ui-interactions.cjs:11) programmatically focuses named controls before key activation, so it proves action activation more than a complete sequential Tab journey. Its final chest case builds a synthetic adapter. B did not rerun either script because the live interaction script creates a profile/changes settings, and the fixture script uses mutations/custom browser tooling outside this read-only native-browser audit.

## Five source-supported UX friction risks

### B1 — P1: Context is missing from repeated semantic button names

LIVE-confirmed: settings AX offers two indistinguishable “切換” buttons; empty profiles offer two “建立新檔” buttons. Their visual context exists, but a button list or sequential focus does not include the affected quality/language or profile slot. The generic group description concatenates the whole screen instead of associating each button with its own item. Extended risk for repeated “詳情”, “穿上”, and “拜訪” is source-supported, not live-tested here.

Locations: [ui/formal-ui.luau:422](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:422), [ui/formal-ui.luau:443](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:443), :446, :461, :569–570; [presentation/shop-accessibility.mjs:50](D:/Projects/YesSir/_Games/ashen-legion/presentation/shop-accessibility.mjs:50), :65–75. The adapter enriches volume, market and sale labels, but not these repeated controls.

Impact: assistive-technology users must remember group-level order or surrounding text to select the intended target. This is not “Canvas has no accessibility”; live AX demonstrated a useful semantic projection. Recommendation only: include object/setting/slot identity and value in the existing projected names. No fix implemented.

### B2 — P2: Language setting promises a translation that this UI does not consume

SOURCE-supported; deliberately NOT toggled because settings persist. [main.luau:3076](D:/Projects/YesSir/_Games/ashen-legion/main.luau:3076) cycles 繁中 / 简中 / English and :3077 persists it. [ui/formal-ui.luau:445](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:445) displays that value; surrounding controls and the rest of the inspected formal UI remain unconditional Chinese literals. Scoped search of main/formal UI found language normalization/storage/display, but no language-dependent UI string lookup. [index.html:2](D:/Projects/YesSir/_Games/ashen-legion/index.html:2) also stays zh-Hant.

Impact: non-Traditional-Chinese players can receive a success-looking changed preference without changed interface language. Confidence: strong source inference for this formal UI, not a live end-to-end localization test. Recommendation only: reflect actual supported languages or connect the saved preference to localized text.

### B3 — P2: Research comparison exposes implementation IDs and splits numeric conditions

FIXTURE + SOURCE-confirmed at 844×390. Research cards display `comrade_oath` and `short_fuse`; first condition renders `出生0.3\n5秒內不觸發…`. The stock builder uses `name=pick`, and the general card forwards item.name. A geometrically valid two-line/summarized string can still break the player's understanding of a 0.35-second condition.

Locations: [main.luau:480](D:/Projects/YesSir/_Games/ashen-legion/main.luau:480), [ui/formal-ui.luau:719](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:719), :723–724; character-count wrapping at [ui/formal-ui.luau:165](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:165). Evidence: shop_tech-844.png/.json.

Impact: additional decoding effort in an otherwise Chinese comparison flow, and possible misreading of combat conditions. Detail access exists and should be retained; this is not an objection to approved progressive disclosure. Recommendation only: human-readable research names and numeric-token-preserving summaries.

### B4 — P2: New-run entry is hidden behind “讀取進度”

LIVE + SOURCE-confirmed. Title offers only 讀取進度 / 系統設定 / 離開. Selecting 讀取進度 reveals empty-slot creation; no create/new cue exists before that selection. The baseline test's empty-profile fixture corroborates that new users encounter the same label.

Locations: [ui/formal-ui.luau:401](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:401), :407, :425; [main.luau:3082](D:/Projects/YesSir/_Games/ashen-legion/main.luau:3082).

Impact: first-time users can reasonably assume they lack the progress needed for the primary action. This is a discoverability risk, not an observed inability to create a save (B did not create one). Recommendation only: a neutral start/profile entry label or state-aware new/continue wording.

### B5 — P2: Baseline map communicates many destinations, but exposes one return-to-choice action

FIXTURE + SOURCE; not a live failed-click claim. Seven framed, numbered, named nodes dominate the current map. They are images/text, not actionable destinations. Both inspected map JSONs contain only VisitLocation; the actual destination choice is on another view. Current place is repeated in node text/progress and the same journal line appears again on the choice screen. The only actionable label is “查看景點建築”.

Locations: [ui/formal-ui.luau:269](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:269), :273–283, :449–461; [presentation/screen-layouts.mjs:69](D:/Projects/YesSir/_Games/ashen-legion/presentation/screen-layouts.mjs:69); [main.luau:3090](D:/Projects/YesSir/_Games/ashen-legion/main.luau:3090).

Impact/inference: players may search for selectable route nodes before recognizing this is an overview with one continuation action. Frame count is NOT counted as seven real choices. Important counterevidence: normal travel auto-advances to choice at [main.luau:3043](D:/Projects/YesSir/_Games/ashen-legion/main.luau:3043); this is not a claim that every run forces an extra idle-map click. Recommendation only: make overview/current-stop/actual next action unmistakable. Applies ONLY to the old map; parent rebuild supersedes its visual evidence.

## Repeated/hidden information and secondary observations

- Global resource chrome is drawn even on settings/profile pages via [ui/formal-ui.luau:193](D:/Projects/YesSir/_Games/ashen-legion/ui/formal-ui.luau:193). Live settings/profile AX contains both resource status “金幣 320，強化結晶 18” and repeated bare “320。18” in the concatenated group description. These are run resources, unrelated to changing settings or choosing a town profile. Source: shop-accessibility.mjs:49–50. Lower-priority information/noise issue, not an economic bug.
- Gear skill/enchantment detail is deliberately hidden behind detail views, consistent with DESIGN; not automatically a defect. Removing `active_slot` in screen-layouts.mjs:83 reduces repeated text, while the bag heading and selected slot remain. B does not recommend putting every full skill back on the compact screen.
- Two observed focus returns were generic, not origin-specific: settings Escape -> title Start; pointer-opened deletion Escape -> previously focused Enter. See shop-accessibility.mjs:53–57, :83–86. Cancellation works, but resuming the same task can require additional navigation. No claim that keyboard-opened shop details have this defect.
- No measured contrast ratio is claimed for textured PNG/Canvas text. Native screenshots are visual evidence, not contrast certification.

## Fresh guideline application

Fetched this run from the requested [Web Interface Guidelines source](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), not a cached skill excerpt.

Relevant review rules applied: contextual control names, keyboard operation, visible/unobscured focus, meaningful feedback, destructive-action safeguards, reduced-motion behavior, resilient content, and clear action copy. HTML-specific framework conventions were not blindly imposed on the game's Canvas or engine-owned renderer. These checks follow the [fresh guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).

File-oriented outcomes:

- presentation/shop-accessibility.mjs:65 — repeated contextual labels missing (B1).
- ui/formal-ui.luau:401 — first-use primary label conceals creation (B4).
- ui/formal-ui.luau:723 — raw research identifiers (B3).
- ui/formal-ui.luau:165 — token splitting seen in short research summary (B3).
- ui/formal-ui.luau:445 — saved language not connected to inspected interface copy (B2).
- presentation/shop-accessibility.mjs:10 — visible focus styling exists; live Tab confirmed it.
- presentation/shop-accessibility.mjs:24–33 — keyboard modal behavior; live cancel/wrap confirmed.
- presentation/shop-accessibility.mjs:6 — polite status region exists; no complete speech-output claim.
- index.html:12–18 — loading status, progress, error alert and retry present.
- presentation/landscape-host.css:1 / index.html:5 — dark scheme/theme color present.
- presentation/landscape-host.css:16 / host.mjs:22–23 — reduced-motion paths exist; not emulated in B.
- presentation/landscape-host.css:5 — touch-action:none is intentional for an aim/drag game canvas; not automatically replaceable by manipulation.
- URL-synchronized every-modal navigation, English Title Case, React hydration rules, and generic list virtualization were not treated as universal game requirements.

## Explicit untested and unsupported areas

- No injected detector overlay or browser detector console findings.
- No new map art/export assessment; no full natural game traversal, purchase, equip, save creation or destructive confirmation by B.
- No real phone/touch, Safari, native engine, gamepad, portrait rotation, 200% text/browser zoom, NVDA/VoiceOver speech, failure-network simulation, exhaustive hit-grid or performance trace.
- Existing 844×390 fixture is a rendered viewport, not a physical-device gesture test.
- No claim that all 188 fixture states were visually inspected; only four selected PNGs plus live states above.
- No claim that existing interaction JSON is freshly rerun B evidence; its mixed natural-navigation/adapter provenance is explicit.
- No source changes requested or implemented. No speculative fixes, dependency install, branch/commit, or server changes.

## Cleanup and disclosure handoff

CLI raw JSONs and this authored report are the intended retained artifacts; authored with apply_patch. No temporary evidence files need removal. Native B tab closed; no overlay server ever started; game server left untouched. No late repository-status sweep or prior-critique trend read.

Questions skipped: delegated Assessment B evidence-only contract; synthesis/questions belong to the parent after independent A completes. This is not a completed parent critique.

Disclosure update: after this report was saved, the parent authorized only the narrow map-related --scope layout status while A's whole-game review remains unfinished. That limited status is 0 findings, with Canvas/Luau layout not semantically analyzable by this static detector. All broader detector records and UX findings remain withheld until A completes.
