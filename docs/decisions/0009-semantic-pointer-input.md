# Decision 0009: Pointer Input Enters the Game Layer as a World-Space Snapshot

## Context

Angry Birds needs dragging and release; pointer events, screen pixels, device scale, and multitouch details differ across iOS, Android, Web, and native. If Luau reads platform coordinates directly, game rules become polluted by platform details and deterministic replay becomes difficult.

## Decision

- The platform adapter converts the primary pointer/touch input into engine world space.
- Luau reads only `input.getPointerPosition()` and `input.isPointerDown()`.
- Headless `InputFrame` expresses the same snapshot with `actions` and an optional `{ position, down }`.
- An omitted frame clears actions and pointer-down state; pointer position retains its last coordinate but no longer means that the pointer is down, preventing sticky input.
- Multitouch, gestures, and mouse-button differences stay in the platform adapter; when game semantics are needed, the game side uses named actions.

## Consequence

Drag gameplay can use the same sequence for native, Web, and headless replay; the engine does not need to know Angry Birds' sling rules. If a validation game later needs multi-finger gestures, first add an explicit semantic action or an additional snapshot schema in the adapter; do not expose raw platform events directly to Luau.
