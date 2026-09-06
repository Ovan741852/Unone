# Decision 0017: The Host Drives Mobile Lifecycle; the Engine Remains Replayable

- Date: 2026-09-05
- Status: accepted (Android headless + minimal APK host smoke; production Android/iOS pending)

## Context

iOS and Android pause, resume, recreate surfaces, change safe areas, switch touch states, and restrict background execution; these are not game rules and must not be placed directly in `unone-engine`. Conversely, if two mobile hosts each maintain their own frame/input semantics, native, Web, and headless replay will diverge again.

## Decision

The mobile host provides only a platform adapter, using the same engine boundary as Web/native:

- The host owns app lifecycle, window/surface, safe area, device scale, touch normalization, platform storage, permissions, the audio device, and package/update policy.
- The engine owns `EngineRuntime`, fixed-step simulation, world state, Luau, semantic diagnostics, the bundle-integrity primitive, and `tick_with_input`.
- Each host frame first sends a normalized `InputFrame` and then calls one fixed tick; while paused, stop sending ticks without silently changing simulation time. On resume, the host chooses either to discard stale wall-clock time or replay it under an explicit catch-up budget; do not pass uncontrolled elapsed time into game rules.
- Surface recreation rebuilds only renderer/resource bindings and must not rebuild the game session; apply a bundle generation only after successful verification at a safe point, retaining the previous generation on failure.
- The first mobile FFI needs only a narrow adapter for `init/load`, `resize/surface_lost`, `set_input_frame`, scalar `set_pointer/set_action`, `tick`, `observe`, and `pause/resume`; it also provides `reload_script` matching the existing runtime. Do not expose UIKit, Android View, JNI, Objective-C objects, or GPU handles to Luau. Record ABI and lifecycle ordering in `docs/mobile-host-abi.md`.

## Acceptance

The same Luau Scene must pass at least cold start, pause/resume, surface recreation, rotation/safe-area resize, touch pointer normalization, cache-only bundle load, failed hot update retaining the previous generation, and headless replay digest comparison. The `unone-mobile-ffi` native contract tests and Android headless harness have validated lifecycle, surface descriptors, the scalar pointer bridge, and script reload; the minimal Android APK host has additionally validated the project payload, Canvas entity snapshot, foreground Activity, process, pause/resume, and touch visualization on API 34 `Pixel_8`. The Android production renderer/assets/bundle policy, mobile smoke for the seven games, and the iOS host remain unfinished; do not mark the mobile product complete.

## Consequences

Do not create a second game API for mobile; concentrate host differences in the adapter. Add host capabilities only when real needs such as audio, background fetch, push, or OS-specific permissions arise; do not preload platform services into the engine core.
