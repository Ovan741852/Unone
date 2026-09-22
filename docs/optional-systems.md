# Optional runtime systems

System selection is an engine capability. Gameplay stays in Luau. The existing
`project.unone.json` `systems` map owns selection; no second project feature list
is needed. Defaults remain backward compatible: omission does **not** mean off.
Use `game --project <dir> systems list --json` to inspect effective defaults,
`enabled`, `compiled` and `build_feature` before building.

For a game without physics:

```json
{"systems":{"physics2d":false,"physics3d":false}}
```

Both physics backends, camera projection backings, random, UI, save, audio, Spine,
native particles and Effekseer have optional Cargo features. World, input and
observation remain required. Configuration/schema data types remain readable in
all builds; a capability switch is not a promise to delete every mention of its
name from a binary. A no-physics3d build does not depend on Rapier/Parry/Nalgebra.

## Build and export

```powershell
cargo build -p unone-cli
./scripts/build-web-live.ps1 -Player -Project _Games/my-game
./target/debug/game.exe --project _Games/my-game export web --output _Games/my-game/dist/web --json

./scripts/build-web-live.ps1 -Player -Development -Project _Games/my-game
./target/debug/game.exe --project _Games/my-game export web --development --output _Games/my-game/dist/web-dev --json
```

The build asks the CLI to resolve the engine's system descriptors, forwards their
Cargo features with `--no-default-features`, builds release, and verifies the
**actual exported host payload** against the CLI replay digest. With no test
files, verification compares a 60-frame replay. It never succeeds by comparing
zero frames. Development and production use identical system selection; only
the developer protocol differs.

Artifacts live in the project's `dist/player-runtime` or
`dist/player-development-runtime`. Use `-OutputRoot` to override. Export uses
these directories by default. `--runtime <dir>` explicitly allows reusing a
compatible runtime with additional capabilities. Without `-Project`, the build
script retains the full-system artifact mode for regression tests and SDK hosts.

The runtime manifest records `compiled_systems` and Cargo features. Export fails
before writing output when capabilities are missing. The WASM reports its own
compiled capabilities outside the observation digest; the parity gate compares
those with the manifest, so editing a manifest does not prove binary support.
Legacy manifests without capability metadata must be rebuilt.

Web export omits disabled audio, UI, particle and Effekseer JS modules. Disabled
save does not read or write browser storage. Effekseer decoder assets cannot be
packaged under a disabled system. Three rendering remains the shared renderer;
this is not per-class tree shaking. Spine remains unavailable in this single-game
export host; enabling the core transport does not add a renderer decoder.

## Runtime contract

- Enabled but not compiled: load fails with `SYSTEM_NOT_COMPILED` and a rebuild
  action. This is enforced inside Rust for every host, not only by export.
- Compiled but disabled: Lua calls fail with `SYSTEM_DISABLED`.
- Compiled out: Lua namespace access fails with `SYSTEM_NOT_COMPILED`; there is
  no solver or real binding hidden behind a no-op implementation.
- Unknown system names remain errors. Project defaults do not change according
  to what happened to be compiled into a host.
- Physics3D scene data cannot initialize a solver that was compiled out.
- Static schema/scene transport is retained (including camera defaults and
  animation declarations). Disabling a capability does not erase game assets.

Native Rust integrations use the same engine Cargo features and validation:
`unone-engine = { ..., default-features = false, features = ["camera3d"] }`.
For a normal host that can switch projections at runtime, use the unified
`camera` feature instead; it enables both projection backings as one build
capability. The `camera2d`/`camera3d` names remain only for intentionally lean
legacy hosts.
The general-purpose native CLI intentionally carries all systems. The Android
player built from a web export inherits that export's selected WASM/modules;
this change does not replace its WebView renderer with a native renderer.
The public Luau surface is nevertheless one `api.camera` component with
orthographic or perspective projection. `camera2d`/`camera3d` are build and
legacy storage backings; `api.camera3d` is retained only as a compatibility
namespace.

## Verification

`crates/unone-engine/tests/system_features.rs` is run with default features,
no features, and physics3d alone. It checks missing/disabled calls, scene rejection,
required capabilities and Cargo forwarding. `tests/optional-systems-project`
provides a real 60-tick, physics-free host parity fixture. Artifact measurements
and verified variants are recorded separately after building.

## Measured artifacts (2026-09-08)

Same release toolchain; byte counts cover WASM only, not Three or game assets.

| Runtime | WASM bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| full | 2,393,583 | 910,848 | 702,055 |
| minimal | 1,349,613 | 508,084 | 406,380 |
| development | 1,457,461 | 544,872 | 431,033 |

The production minimal binary is 43.6% smaller than the full-system binary.
Its gzip payload is 44.2% smaller. Five same-process Node initializations are
recorded in [raw evidence](evidence/2026-09-08-optional-systems.json); medians
were about 13.0 ms full, 12.6 ms minimal, and 17.0 ms development. These are
runtime initialization observations, **not browser startup/network/first-paint
measurements** and do not establish a meaningful speedup. First project load
includes cold Luau/runtime setup effects and is reported separately.

The actual Legion Fall game also passed native/exported WASM parity with both
physics systems removed, in production and development. Its selected runtime
keeps camera, seeded randomness, audio, particles, UI and save defaults; this is
separate from the all-options-off measurement above.

Reproduce artifact checks after building full and selected runtimes:

```powershell
node scripts/verify-optional-systems.mjs --full artifacts/optional-full-runtime --minimal artifacts/optional-minimal-runtime --development artifacts/optional-development-runtime --output artifacts/optional-measurements.json
```
