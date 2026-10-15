# Stationary pointer with a following player camera

A space-game migration to the official player exposed stale pointer coordinates:
move the camera more than 90 world units to the right while holding the mouse
90 units right of the viewport center. The mouse stayed physically stationary,
but its stored world position moved behind the ship, reversing manual aim.

The official player now projects each consumed browser pointer's normalized
screen position against the latest simulation camera before ticking. It keeps
the consumed edge's own position and button state. Manual developer input retains
its supplied world coordinates, and no projection occurs before a routed world
pointer event. The shared projection helper also serves DOM pointer events.

Validation:

- `node --test web/shared/player-pointer.test.mjs web/shared/webgpu-snapshot.test.mjs web/shared/host-input.test.mjs`
  passed. Cases cover camera/zoom/aspect, consecutive following-camera ticks,
  queued edges, release, initial input and manual replay bypass.
- The exported production space game passed an actual Chrome/WebGL regression:
  hold the cursor 90 pixels right of center, move the ship for 650 ms and verify
  aim remains rightward. Launch, firing, pulse, dodge, pause, mute and abandon
  cancellation also passed, without browser or shader compiler errors.
- Independent read-only review found no concrete defect; its reviewer separately
  ran all six focused pointer tests successfully. No completed Claude CLI review
  is claimed for this follow-up.

This changes browser input projection only. It does not change Core input-frame
semantics, recorded world coordinates, gameplay rules or the WASM binary.
