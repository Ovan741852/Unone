# Native-codegen release probe — 2026-09-17

## Result

The scoped Windows release probe is verified. This removes the previous
`native-codegen` **probe-build** blocker; it does not certify every game,
renderer, mobile package, or browser host.

- Rust: `rustc 1.95.0 (59807616 2026-04-14)`
- Target: Windows `x86_64`
- Production binary: `target/native-codegen-mode-20260917/production/release/examples/execution_probe.exe`
- Production SHA-256: `40938e26c466f06973d27ca69fc1fcbf45e884f9692a672d9930dbcbef7ebd71`
- Evidence: `target/native-codegen-evidence-20260917/result.json`
- Result: `passed: true`

The production report explicitly contained:

```json
{
  "rust_profile": "release",
  "native_codegen_requested": true,
  "native_codegen_supported": true,
  "native_codegen_compiled": true,
  "luau_execution": "native-codegen-eligible",
  "preview_tools": false,
  "failure": null
}
```

## Paired workload

Command:

```powershell
node scripts/verify-runtime-modes.mjs `
  --project D:/Projects/Unone/tests/fixtures/execution-probe-project.json `
  --scenario D:/Projects/Unone/tests/fixtures/execution-probe-scenario.json `
  --target-dir D:/Projects/Unone/target/native-codegen-mode-20260917 `
  --output D:/Projects/Unone/target/native-codegen-evidence-20260917 `
  --repeats 2
```

Both diagnostic and production builds used `--release`, were built from the
same pinned source and lockfile, and ran in alternating order twice. All 60
ticks completed in both modes; every checkpoint digest matched. Production
mean tick time was 0.2172 ms and 0.2181 ms in the two repetitions. These are
measurements of this headless CPU probe, not a speedup claim.

## Same-release baseline comparison

To answer the performance question without charging diagnostic probes to the
JIT, a third binary was built with `--release --features all-systems` and no
`native-codegen`. Three fresh runs per mode used the same project and scenario:

- native-codegen mean: **0.2160 ms/tick**;
- release interpreter mean: **0.8631 ms/tick**;
- measured difference: **0.6470 ms/tick**, approximately **75.0% lower tick
  time** for this probe.

Both modes completed 60 ticks with identical project/scenario hashes and
checkpoint digests. Full raw comparison is in
`target/native-codegen-evidence-20260917/comparison.json`.

This is a narrow Luau CPU micro-workload, not a claim that a real game, GPU,
renderer, startup time, or mobile build will be 75% faster.

## Native-player release artifact

The actual native-player package was also built with
`cargo build --manifest-path crates/unone-native-player/Cargo.toml --release
--features native-codegen --locked`. Its `--describe` output reported
`profile: release`, `renderer: wgpu-native-instanced`, and
`native_codegen_compiled: true`.

The player then loaded the exported YesSir `ashen-legion/dist/arcade` package
in headless mode for three runs (`--frames 60 --warmup 10 --fixed-tick`):

- all runs exited successfully with `error: null` and `dropped_ticks: 0`;
- all reported `profile: release` and `native_codegen_compiled: true`;
- all produced the same package hash and observation digest;
- mean tick times were 0.0137, 0.0140 and 0.0136 ms.

Raw evidence: `target/native-player-release-20260917/ashen-headless-result.json`.

The same YesSir export was then measured with a fresh release native-player
build without `native-codegen` (`target/native-player-interpreter-20260918`).
The three interpreter runs kept the same package hash and observation digest:

- native-codegen mean: **0.01376 ms/tick**;
- release interpreter mean: **0.01498 ms/tick**;
- measured difference: **0.00122 ms/tick**, approximately **8.1% lower tick
  time** for this small Ashen workload.

Raw comparison: `target/native-player-interpreter-20260918/ashen-comparison.json`.
This is the relevant game comparison; the 75% micro-probe result must not be
used as a general game-speed estimate.

## Visible Windows WGPU gate

The release native player rendered the same export for 60 frames on the RTX
5080 (Vulkan) with `renderer: wgpu-native-instanced`, `profile: release`, and
`native_codegen_compiled: true`. The report recorded 59.99 FPS, zero dropped
ticks, four draw calls, 70 submitted instances, and `error: null`.

Raw report and screenshot:
`target/native-player-release-20260917/ashen-visible-report.json` and
`target/native-player-release-20260917/ashen-visible-report.png`.

## Android NativeActivity gate

An x86_64 Android NativeActivity runtime was compiled with
`native-codegen_compiled: true`, packaged with the same Ashen content, and
installed with `adb install -r` on BlueStacks serial `127.0.0.1:5556`. The
process remained foreground with no fatal Android/runtime error; the captured
frame shows the actual Ashen scene rendered by
`renderer: wgpu-native-instanced` on the emulator's OpenGL backend.
The small test font is Latin-only, so Chinese UI labels render as missing-glyph
boxes in that screenshot; this is an asset/font-content limitation of the test
package, not a renderer pass. A production package must declare and ship a
licensed CJK-capable font through `presentation.ui.font_source`.

The first package attempt exposed duplicate content paths from shared asset
references and correctly failed with `NATIVE_DUPLICATE_PATH`. The exporter now
deduplicates identical content files and rejects a same-path/different-bytes
conflict (`PLAYER_CONTENT_CONFLICT`). The final APK has zero duplicate manifest
paths and includes a packaged font for Android UI text.

APK/evidence:
`target/ashen-native-android-20260918c/game.apk`,
`target/ashen-native-android-20260918c/apk.json`, and
`target/ashen-native-android-20260918c/android-evidence.json` /
`target/ashen-native-android-20260918c/bluestacks.png`.

This validates the Android x86_64 emulator path only. Android arm64 and iOS
still need their own device gates; iOS cannot be run from this Windows host
without macOS/Xcode (`xcodebuild`, `xcrun`, and `simctl` are unavailable).

## Remaining boundary

This evidence does not prove per-function native compilation counts, browser/
WebAssembly JIT tier, Android arm64 support, iOS support, or a universal game
speedup. Those require their own release artifact and device gates.
