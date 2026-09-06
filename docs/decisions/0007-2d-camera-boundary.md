# Decision 0007: The Engine Owns Camera2D; Follow Policy Stays in Luau

## Decision

The engine owns the active Camera2D's position and zoom and passes camera state to the renderer; Luau operates on the semantic state through `camera.getPosition`, `camera.setPosition`, `camera.getZoom`, and `camera.setZoom`. Character following, camera bounds, level cuts, and shake policy are decided by game-side Luau.

## Rationale

Camera projection is an engine mechanism shared across games and platforms; the follow target and camera narrative are game policy. This boundary lets Angry Birds, AVG, and RTS use the same camera contract without putting a specific game's player id or camera flow into the renderer.

## Minimal Scope

For now, provide only one Camera2D, position, zoom, and renderer projection. Add multiple cameras, a cinematic timeline, shake presets, a 3D camera, or editor gizmos only when a validation game is actually blocked by them.
