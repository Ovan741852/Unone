# Independent fresh UI browser QA — frozen result

PASS on the tested Windows host. The selected frozen official player was exercised in real Microsoft Edge 155.0.4283.45, using Playwright mouse down/hold/up, mouse movement, click and wheel input. The browser was headless; no mocked renderer, substitute runtime, injected game action, payload/state/API write, or manual virtual-row materialization was used.

## Evidence and scope

- Only target: `D:/TSProject/UnoneFreshUi-20261016/example/dist/player-final/index.html`.
- Baseline official renderer and advancing production WASM verified at 1440×900, 1020×884 and 390×844. Actual layouts were desktop, medium and portrait respectively.
- Full run: 363 passing recorded checks, 0 failures, 48 input/resize steps. Zero page errors, error-level console messages, failed requests, HTTP errors or fatal player diagnostics.
- Observer reads only the public `unone_web_observation_ptr/len` ABI. Canvas instrumentation records real text calls without changing draw arguments.
- Browser results: [validation/browser-report.json](validation/browser-report.json). Compact observations: [result-summary.json](result-summary.json). Harness and declarative plans are retained beside this report.

## Actual input results

Each viewport completed two sustained probe cycles. While the physical mouse was down, held stayed true and hold ticks increased: desktop 16→39 then 16→38; medium 16→37 then 16→36; portrait 16→36 then 15→34. After release, held was false, hold_ticks was 0, and presses/releases were exactly 2/2. Both separately published runtime reader press counters and release counters were 2/2, with mismatches=0. These are distinct author-published API-reader observations; repeated reads of one observer snapshot are not treated as multiple input readers.

Slider drag reached 75, and dragging beyond its right boundary retained capture and clamped at 100. Combobox expansion revealed all three actual option controls, and selecting Studio closed it. Real wheel input reached the final virtual window (desktop/medium rows 115–120 with six materialized children; portrait rows 117–120 with four). A real click on the actually painted Travel / Creative text within the list clip selected stable key travel-creative. The model remained 120 rows and materialization stayed bounded. Selection republishing preserved the scrolled window.

Apply held across multiple ticks activated once and copied 100/Studio/travel-creative into the applied profile. After selecting Eco, Reset held across multiple ticks activated once, restored 72/Balanced/morning-calm and retained the applied profile. Changing volume to 75 and resizing through all three compositions retained current and applied settings, selection and action counts.

## Visual and font review

The independent reviewer actually opened the 21 PNGs listed in result-summary.json with view_image: all three initial layouts, expanded combobox, held probe, final-row selection, applied and reset states, plus a three-size resize sequence. English and Traditional Chinese were readable, the compositions fit their viewports, and reviewed states showed no missing glyph boxes, unintended text truncation, overlapping controls or escaping text. Partial rows at the top/bottom of the virtual viewport are intentional scrolling clips. Selection labels and action buttons remain outside that clip and readable. Screenshots are retained as emitted by the browser.

The design uses installed system font families Segoe UI / Microsoft JhengHei / sans-serif. There are zero packaged font faces. The independent cmap audit is therefore **not a packaged-coverage pass**: strict=false, 60 visible text samples, 88 codepoints without packaged-face proof. [font-coverage.json](validation/font-coverage.json) preserves this result. The successful visual result applies to this host; appearance and glyph coverage on other machines are not established.

Keyboard navigation and touch were not tested. Delayed held snapshots normally miss the single press/release edge frame; separate reader counters and mismatch observations supply the edge-consistency evidence. Raw held-reader A/B booleans are not separately exposed.

## Integrity and freeze

Author source manifest (16 selected source files) and selected export manifest (all 72 export files) were checked before each browser run. Whole example tree (166 files) and export tree were hashed before and after each run and remained byte-identical. Exact manifests are in initial/sha-before.json, initial/sha-after.json, validation/sha-before.json and validation/sha-after.json. The prelaunch author-manifest checks are also retained. No source/export repair or re-export was performed.

Hash-label clarification: 4188aa0a… is the hash of the author's freeze/export-final.json manifest. The exported export.json file is 34330f78…; both the manifest and its exported file entries matched. This was a labeling clarification, not evidence of an export mutation.

All QA artifacts are frozen after this report; qa-freeze.json records their SHA-256 values. No Cargo, commit or push was used.
