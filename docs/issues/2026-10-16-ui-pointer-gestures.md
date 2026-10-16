# Visible slider track and desktop content dragging

Date: 2026-10-16. Baseline: `594ca455ae2800ca4dd5d8a903f42a0c0972b569`.

## Reproduction and ownership

After the separate module-MIME correction, the actual Harbor preview loaded but
two natural mouse gestures still failed. Dragging the thin progress line in 01
left volume at 72; dragging a row in 03 left the native rail and virtual range
at zero/first item. Earlier checks dragged only the grey slider label field and
used wheel scrolling. They did not establish either visible-track or desktop
content-drag behavior. Preserve those historical results with that limitation.

The slider failure belongs to the example's authored skin and input mapping:
the visible progress line was outside the only drag-start rectangle. The scroll
failure belongs to the reusable Web host primitive: its pointer controller
explicitly accepted touch only. Neither requires a renderer replacement, a
Harbor-specific runtime rule, or a different UI package constructor.

## Correction

Harbor now authors one track rectangle per composition and uses it for painting
and horizontal value mapping. Both the labelled field and the visible track
start the same project-owned gesture; a small vertical tolerance makes the thin
line easier to acquire. Holding outside retains the gesture, release ends it,
and entering the track after pressing elsewhere does not start a late drag.
The original visual composition and frozen fresh-author project are preserved.
The maintained copy has an additional deterministic release/no-late-capture case
and starts its upper-clamp regression directly on the visible track.

The shared scroll host accepts primary mouse, pen and touch content dragging.
An 8 CSS-pixel threshold distinguishes tapping a row from panning. A row tap
activates once on release over the same node/action; a drag does not activate a
row. Sliders, comboboxes and foreground controls retain their own pointer route.
Nested ownership, cancellation, reset, disable and unmount use the same shared
controller. The official player also cancels pending scroll gestures on host
pause and visibility transitions.

Independent source review identified three multi-pointer ownership gaps in the
initial patch: a newly scrolling touch could swallow an earlier outside
control/world release, and a rejected second pointer could leak into world input
after the owner released. Switching to a native scrollbar also had to abandon
the previous gesture through the same ownership path. Regression coverage now
exercises complete ownership through each stream's own release/cancel. All three
findings were corrected and rechecked by that reviewer, with no further concrete
finding in its bounded scope. This is source review, not device testing.

## Validation scope

The maintained example passes all five normal verify gates, including strict
types, two strict layouts and 9/9 deterministic cases. The shared controller,
projection, canvas router and runtime-core suite passes 26 tests. The release CLI
build passes; the previously completed MIME/SDK Rust tests and workspace Clippy
remain separately scoped to their recorded changes.

At the actual port-8344 URL, 54 physical-mouse assertions pass across 1440x900,
1020x884 and 390x844. Visible-track dragging changes 72 to 23; dragging outside
clamps to 100, release prevents further changes, and another track drag works.
Row dragging changes native scroll offsets and WASM virtual ranges without
selecting a row; a small-motion tap still selects one. Wheel scrolling, Studio
selection and the external held-button press/release still work. All 25 JS/MJS
and one WASM response per viewport have correct MIME, the official renderer
advances, and no browser/HTTP errors occur. All three result screenshots were
actually inspected. Four additional assertions exercise a physical drag followed
by explicitly synthetic platform pause/resume events; the cancelled gesture does
not resume or select a row. No game-state or runtime ABI mutator was used.

The first narrow-viewport harness assertion incorrectly required the first
virtual item to increase. Overscan can retain that first item while the last
changes; the corrected assertion checks a change to either end plus an increased
physical scroll offset. The failed trial is preserved and distinguished from a
product failure. Final QA made no changes to any exported file.

The final SDK has 65 hash-verified inventory files and exact source parity for
the shared controller, player lifecycle, UI guides and server helper. Its CLI
prepared the final official export, release
`888f0370bcd2165f851227632a7419d592889d7c3514ca7059424ca206b08f3a`.
Both named and legacy SDK helper invocations passed six real HTTP module/WASM
byte/MIME/cache checks. Existing production WASM is retained; the host templates
and project Luau change. The prescribed Claude 2.1.280 fixed-diff attempt timed
out after 56.0 seconds with exit 124 and no output. It is not a completed review.

See [gesture evidence](../evidence/2026-10-16-ui-pointer-gestures/summary.json)
and [SDK/build/review record](../evidence/2026-10-16-ui-pointer-gestures/validation.json).
Browser mouse checks at a portrait
viewport do not establish real mobile hardware/pen acceptance; those pointer
types have controller-level regressions. No momentum or variable-height
measurement is introduced.
