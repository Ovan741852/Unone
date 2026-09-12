# Portable Core SDK

Core publishers build the CLI and platform runtimes privately. Consumers receive
binaries, Web host templates and `sdk.json`; Web export requires no Rust sources,
Cargo, Emscripten, Node or original checkout. This is release tooling, not an Editor.

## Consumer workflow

```powershell
& ./sdk/bin/game.exe sdk inspect --json
& ./sdk/bin/game.exe --project ./my-game export platform --target web --output ./game-web --json
& ./sdk/bin/game.exe --project ./my-game export platform --target web --development --output ./game-dev --json
```

Discovery: explicit `--sdk`, then `UNONE_SDK_ROOT`, then executable-relative
`sdk.json` (beside the binary or one directory above). An invalid selected SDK
never falls back to checkout files. The supplied CLI's exact hash must match.
The legacy `export web --runtime ...` command remains available with SDK templates;
source developers can run it from the checkout root without an SDK. No compiled-in
checkout path is used. Plugin discovery also uses executable-relative paths.

`sdk inspect --json` verifies the manifest version, CLI version and host,
confined paths, file hashes/sizes, runtime metadata and template inventory.
It lists installed runtimes and supported/unavailable targets for AI or Editor use.
Selection requires the requested target, development/production variant and all
enabled project systems. Smallest matching runtime wins, then runtime ID; use
`--runtime-id` to pin one. Incompatible systems or missing targets fail before
creating output. The CLI response includes `sdk_selection`; normal export.json
retains the selected runtime/content hashes.

Hashes detect corruption, not publisher authenticity. Use a trusted distribution
channel. Capability matching does not by itself prove renderer/decoder parity.

## Publisher workflow

Build the desired production/development release runtimes with
`scripts/build-web-live.ps1 -Player [-Development] -Project ...`, then:

```powershell
cargo build --release -p unone-cli
./target/release/game.exe sdk pack --source-root . --runtime ./dist/player-runtime --runtime ./dist/player-development-runtime --output ./dist/core-sdk --json
```

Repeat `--runtime` for installed variants/system combinations. IDs are stable for
a fixed input order. The new output directory contains `bin/`, `templates/web/`,
`runtimes/` and `sdk.json`. Host templates use an explicit allowlist: no Rust source,
Cargo cache, games or test files are bundled. Developer panel templates support
development exports but are excluded from production game exports. Vendor Web
license files accompany their code. Final publisher licensing/notices and signing
remain distribution responsibilities; this command does not publish anything or
change repository visibility.

The SDK host equals the publisher CLI's OS/architecture. This is not a
cross-compiler: a Windows SDK exporting Web does not imply native Windows game
export. Validate supplied runtime builds against intended games before releasing.

## Platform extension boundary

The manifest separates SDK host from game target, variant, capabilities and files.
New packagers reuse discovery, verification and project inspection. Web, Windows native and Android native targets are implemented in this SDK route.
The native host currently supports meshes/instances, PNG palettes and native particles;
UI, audio playback and Spine/Effekseer rendering remain unsupported and fail explicitly.
Android packaging requires a platform runtime plus SDK/Java/signing tools.
See [native validation](native-battle.md).

| Target | Work needed |
|---|---|
| Windows native | Implemented; wgpu native renderer and verified content package |
| Android | NativeActivity packager implemented; x86_64 tested on BlueStacks, arm64 not device-tested |
| iOS | iOS host/runtime and rendering integration, Xcode/macOS, provisioning/signing |

Add versioned packager code and report toolchain prerequisites. Do not execute
arbitrary manifest-provided shell commands. Native and WebView should have distinct
target/runtime identities. Core gameplay contracts remain shared.

## Acceptance

```powershell
python scripts/verify-portable-sdk.py --sdk ./dist/core-sdk --project ./_Games/jobs-lab --output <new-directory-outside-checkout>
```

Copies only the SDK/game into a new directory and runs the packaged CLI from an
empty cwd. Checks both Web variants, unsupported targets, missing runtime ID,
missing physics capability, corrupt files and unknown manifest keys. Outputs and
JSON evidence remain for review. Browser acceptance separately exercises the
exported host payload in real Workers and compares its digests with packaged CLI.
