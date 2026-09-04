# Mobile host ABI

`unone-mobile-ffi` is the small C ABI adapter shared by Android and iOS hosts. It is not a second engine and it does not own UIKit, JNI, Android Views, GPU handles, storage, CDN, permissions or game rules.

## Host ownership

The host owns:

- app lifecycle and thread serialization;
- native surface creation and destruction;
- device scale, safe-area measurement and touch normalization;
- bundle fetch/cache/update policy;
- package, permission, audio-device and background policy.

The adapter owns only the bridge to `EngineRuntime`:

- one opaque session;
- host-normalized `InputFrame` delivery;
- fixed-step tick and semantic observation;
- opaque JSON-like save payload injection and observation;
- pause/resume without wall-clock catch-up;
- surface descriptor bookkeeping without resetting the runtime;
- Luau source reload with engine-state preservation.
- shared bundle size/SHA-256 verification; the host still owns storage and generation activation.

Include `crates/unone-mobile-ffi/include/unone_mobile.h` from the native wrapper. The host must serialize calls for one session and keep the observation pointer alive only until the next mutating call on that session.

## Lifecycle sequence

```text
init
  → resize (surface available)
  → load_project
  → optional set_save_payload
  → set_pointer / set_action / set_input_frame
  → tick → observe
  → pause
  → surface_lost / resize (rotation or recreation)
  → resume
  → tick → observe
  → shutdown
```

When paused, `tick` returns success with `event=tick_skipped`, `reason=paused`, and the same world frame. Resume does not replay elapsed wall-clock time; the host decides when to submit the next normal frame. Surface loss never destroys the loaded project or world.

## Bundle update sequence

The host downloads into its own staging area, feeds bounded chunks through `bundle_begin → bundle_write* → bundle_finish`, and commits the staged bytes plus a new generation only after `bundle_finish` returns success:

```text
host fetch → host staging
                 ↓ chunks
        mobile bundle verifier
                 ↓ verified
       host atomic cache/generation activate
```

The ABI intentionally does not expose a filesystem, IndexedDB, OPFS, Android storage API, iOS URLSession, CDN, retry policy or active-generation pointer. A failed verification leaves host state untouched; cache-only reopen and rollback remain host smoke requirements.

`set_pointer` and `set_action` are scalar/event paths for native input. The host must normalize raw touch coordinates into the engine's world-space pointer before calling them. `set_screen_pointer` optionally supplies a separate logical UI coordinate after `set_pointer`; the host owns pixel, DPI and safe-area conversion. `set_input_frame` accepts the same semantic JSON shape used by headless/Web replay and is useful for automation and contract tests. The adapter consumes pending input at the next tick, so an action is not silently sticky across frames.

## Observation and errors

Successful calls produce semantic JSON with `kind=mobile_observation`, `event`, `lifecycle`, `project`, `surface`, and optional `world`. Failure produces `kind=mobile_error` with either a message or the full engine diagnostic (`code`, `severity`, `explanation`, `facts`, `likely_causes`, and `suggested_actions`).

`unone_mobile_set_save_payload` injects a host-loaded JSON payload before a tick. A successful tick returns the latest `save_payload` alongside `world`; the game owns schema/version/migration and the host owns durable storage.

The ABI does not expose raw Rust or GPU objects. If a future mobile requirement needs a new capability, first reproduce it in a validation game; add the smallest host/adapter contract only when the need is shared.
