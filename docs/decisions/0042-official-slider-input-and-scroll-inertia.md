# Official Slider interaction and optional scroll inertia

Status: accepted, 2026-10-16. Package: `@unone/ui` 0.3.0.

## Problem and ownership

The old `slider` constructor only returned a semantic leaf. Every project had
to implement pointer hit testing, capture, range mapping and release. A skin's
visible track could therefore sit outside its actual drag-start rectangle.
Moving that screen-pointer arithmetic into a package-only helper would still
fail for clipped or scrolled content, foreground controls and multiple pointers.

Pointer projection, clipping and ownership are reusable host primitives. Range,
step and transient control value are reusable UI behavior and belong to the
official pure Luau package. Whether a value changes game audio, equipment or
saved preferences remains project logic. No renderer replacement or layout
solver is introduced.

## Decision

`ui.components.createSlider(options)` creates one persistent control model.
`control.view(props)` publishes an ordinary Slider node with declarative `drag`
metadata: axis, reverse, enabled, track rectangle and hit rectangle. Rectangles
use their current stage or scroll-local coordinate space. Virtual materialization
translates leaf, track and hit geometry together; Web projection applies nested
scroll offsets and clips. Hit tolerance may protrude beyond a valid track and
is clipped by the host. Interactive IDs are limited to 1024 UTF-8 bytes so every
accepted control can produce valid normalized input.

Official Web and native adapters capture a pointer against the projected node
and deliver `ui_sliders[id]={phase,ratio}`. Phases are start/drag/end/cancel;
ratio is finite in 0..1, with axis/reverse applied once by the host. Queues retain
edges, coalesce adjacent motion and deliver at most one event per control per
tick. Cancellation never changes another pointer's control or leaks a partial
stream into world input. Native scrolling remains explicitly unsupported.

Core validates the bounded input, publishes a non-consuming per-tick snapshot
through `input.getSliderInteraction(id)` and clears pending events only after a
successful tick. The package's `control.update(api.input)` performs min-relative
step mapping, clamping and value/capture lifecycle. A view or virtual renderItem
must never update the control. Projects call update once per simulation tick
and can read getValue repeatedly. Programmatic setValue/cancel block the old
drag until another start. No UI callback or implicit application binding exists.

The low-level `slider(props)` leaf keeps its previous result shape and pointer
passthrough when drag metadata is absent. Numeric control searches and guides
lead to createSlider. Exact package/runtime version gates prevent an older
player from silently accepting a control it cannot operate.

## Scroll inertia

All shared scroll constructors accept `inertia=false` and `deceleration=8`.
Enabling inertia opts into host-time release motion with exponential decay
`v(t)=v0*exp(-deceleration*t)`; the finite decay rate is in `(0,100]` s^-1.
Position uses the analytic integral, making its path independent of display
rate. Motion stays clamped, has no elastic overscroll, and stops on new input,
wheel, native-rail acquisition, pause, reset, disable, removal or configuration /
geometry change. Velocity, low-speed termination, stale release and long-frame
limits are documented in the shared scroll guide.

This presentation motion does not advance Game.update, RNG or game state. Virtual
window requests keep their existing pure view-materialization boundary. Inertia
is off by default to retain existing scrolling behavior.

## Validation

Cover package numeric/lifecycle behavior, input snapshots and retry, raw transport
validation, virtual-row translation, disabled/clipped/nested controls, host queue
ordering, multi-pointer cancellation, native routing and fake-clock inertia.
Then validate the production official player at the actual served URL with
physical pointer input, including motion after release and interruption.
Headless ratio injection alone cannot prove host hit testing or visual quality.
