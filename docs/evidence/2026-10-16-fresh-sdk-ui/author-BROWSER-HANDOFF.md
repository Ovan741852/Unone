# Independent browser QA handoff

The source and export are frozen. Serve `example/dist/player-final` statically
and open its `index.html`. Do not reconstruct, patch or replace the player.
The official prepare report and exact release are recorded in command 039.
The author has not inspected browser pixels or claimed visual completion.

Test browser viewport sizes 1440×900, 1020×884 and 390×844. Record the actual
runtime `layout.aspect`/`layout.name`, since browser chrome/stage sizing can
otherwise make a nominal window size select a different composition. Inspect
screenshots for legible English/Traditional Chinese, missing glyphs, tracking,
truncation, overlaps and the three complete authored arrangements. Inspect
both collapsed and expanded quality states. The smallest authored portrait
font is 1.45 vertical units, about 12.2 pixels at height 844.

`browser-handoff.json` is the machine-readable contract. Standard normalized
stage rects are x/y-up/width/height. Browser pixel top is
`(100-y-height)/100 * stageHeight`; left is `x/100 * stageWidth`. Scroll viewport
uses left/top/y-down; virtual rows are local top-left/y-down. Components do not
transform children. There is no project-specific HTML, DOM control or canvas.

Suggested real-input checks on a fresh reload at each viewport:

1. Baseline: root `harbor-settings`, route `settings`, package `@unone/ui` 0.2.0
   declared; volume 72, quality Balanced, preset morning-calm, 120 rows.
2. Click `quality/choice` (ToggleQuality). Confirm expanded=true, three option
   controls appear. Click `quality/option/Studio`; expect Studio and expanded=false.
3. Drag `audio/level` from 25% to 75% of its width. Expect `settings.volume`
   near 75 and its text/progress bar updated. Continue beyond its right edge to
   confirm capture/clamp. The project maps the public normalized screen pointer.
4. Scroll `presets/list` through all 120 rows. The final stable key is
   `travel-creative`, control `preset/travel-creative`, action
   `SelectPreset_travel-creative`. Select it and confirm `settings.preset` and
   the selection label. Inspect bounded materialization, stable IDs, clipping
   and scrolling after a project republish. Do not infer success only by
   injecting the final action; the browser test must reach the actual row.
5. Click Apply; expect apply_count incremented once, applied values matching
   current values and dirty=false. Hold for multiple simulation ticks, release,
   and confirm one activation. Change something, then Reset; expect default
   current values with the previously applied profile retained.
6. Hold `probe/hold` for multiple simulation ticks. While down, capture
   `input_probe.held=true`, one new press, increasing hold_ticks and both
   readers' matching press counts. Release; expect one release, held=false,
   hold_ticks=0. Repeat and confirm exactly two cycles. `mismatches` must stay 0.
   Observe actual input, rather than assuming a browser click pulse represents
   a sustained hold. Headless held snapshots already pass, but real host routing
   is explicitly part of this independent QA.
7. Resize between the three sizes while values are changed; verify the project
   retains settings/selection and chooses the documented composition. Confirm
   keyboard focus and actions through the official host where supported.

Read semantic state through the official player's read-only snapshot/debug
surface available to the QA harness. No private runtime file inspection or
game mutation is needed. Keep screenshots, input timings, semantic snapshots,
console/host errors and export/source hash verification beside the QA report.
Report any browser failure as observed; do not silently repair the SDK or use
another player/export. Font coverage depends on installed Segoe UI/Microsoft
JhengHei and therefore needs screenshot inspection on this host.
