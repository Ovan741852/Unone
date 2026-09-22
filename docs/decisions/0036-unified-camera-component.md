# ADR 0036: Unified Camera component

## Decision

Unone's public camera model is one Camera with a 3D transform and a
projection mode:

- `projection = "orthographic"` is the 2D-compatible view. Its
  `orthographicSize` is the vertical world span and its `position.x/y` is the
  2D camera centre.
- `projection = "perspective"` is the 3D view. It uses `position`, `target`,
  and `fovDegrees`.

Luau uses `api.camera.getTransform`, `api.camera.setTransform`,
`api.camera.getProjection`, and `api.camera.setProjection`. This is the only
camera abstraction AI-authored code should learn.

## Compatibility boundary

Existing scene files and host snapshots still carry `camera` (orthographic
adapter) and optional `camera3d` (perspective adapter). They are boundary
formats, not two gameplay cameras: the runtime now owns one `CameraState` with
one transform, one projection, and both projection-specific settings. The
legacy `api.camera.getPosition/setPosition/getZoom/setZoom` and
`api.camera3d.*` calls remain available so old projects do not silently change
framing; new projects and generated code must use the unified API.

The adapter conversion is deterministic:

- switching to perspective preserves the current x/y centre and supplies a
  stable default z/target until the caller provides a transform;
- switching to orthographic preserves the perspective camera's x/y centre and
  keeps the current orthographic size;
- invalid projection, FOV, or orthographic size fails before mutating state.

Scene serialization writes the same unified `camera` object back out and omits
the internal `camera3d` adapter. That keeps job payloads, generated examples,
and future editor files from slowly reintroducing two competing camera
concepts. The reader still accepts the old split fields so existing projects
can migrate without a destructive rewrite.

## Why this shape

Unity's Camera is a single component whose projection changes between
orthographic and perspective. Copying that mental model reduces AI branching,
avoids duplicate camera-follow code, and lets editor/viewer tooling inspect one
camera node. Rust still owns projection math and host rendering; Luau owns
game-specific follow, smoothing, shake, and target selection.

## Verification

`unified_camera_api_switches_projection_without_a_second_camera_contract`
proves the new API can switch a default orthographic scene to perspective and
publish the perspective transform. Existing 2D and 3D camera tests remain in
the suite as compatibility coverage.
