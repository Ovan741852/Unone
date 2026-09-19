# Player build and single-game export

For consumers without the Rust checkout, use the [portable Core SDK](portable-sdk.md)
and `game export platform --target web`. The commands below are publisher/source
development workflows.

The default export is production. Use `-Player -Development` when building and
`export web --development` when exporting to include the shared AI/human tools.
See [development player and native tools](development-player.md) for the variant
contract, Lua registrations and native companion panel.

The player is a separate Cargo workspace at `crates/unone-player` to prevent
workspace feature unification with the CLI. It depends on `unone-engine` with
default features disabled. A compile-time assertion rejects an engine built with
`dev-tools`. Schema generation, asset/bundle authoring, verification, MCP-facing
sessions and script reload are unavailable in that build. The Web bridge shares
input, save, viewport, ticking and observation with the developer host.

`player.presentation.json` includes the **web-wasm** overlay (bloom, worker backend,
interpolation) and shared UI/font settings. Native wgpu packages the UI/font
settings and fails closed on web-only keys. Host identities and capability tables live in `game sdk inspect --json`;
see [portable SDK](portable-sdk.md).

From the repository root:

```powershell
./scripts/install-binaryen.ps1
cargo build -p unone-cli
node scripts/build-three-player.mjs
./scripts/build-web-live.ps1 -Player -Project _Games/dragon-tycoon3
./target/debug/game.exe --project _Games/dragon-tycoon3 export web --output _Games/dragon-tycoon3/dist/release --json
python scripts/serve-export.py _Games/dragon-tycoon3/dist/release --port 8176 --gzip
```

Emscripten selection follows [platform toolchain](platform-toolchain.md).
Binaryen 131 is checksum pinned. The tested Unity Emscripten expects an older
Binaryen name-map format; release builds retain ABI names by enabling Emscripten
runtime assertions, then strip debug sections. This avoids producing a small
WASM that links successfully but fails browser instantiation. Rust/Luau still use
the size-optimized release profile with LTO. Runtime assertions are not editor code.

Export requires a new destination and a matching release runtime manifest/hashes;
`--runtime <directory>` overrides the default `<project>/dist/player-runtime`.
Build with `-Project <directory>` to select the project's declared systems and
exclude unused capabilities from WASM. See [optional systems](optional-systems.md).
It validates the exact HostProject ingestion before writing, rejects path escapes
and destination collisions, and creates an inventory with file hashes and sizes.
Only declared content is copied. The output has one game, local JS/WASM/assets,
no project switcher, no debug panel, no authoring source directory dependency,
and no CDN. It can be served from a subdirectory. Export currently requires this
source checkout's presentation files; a standalone installed CLI distribution
must ship them before it can support this command.

The player build requires Node.js 22+ and the current native CLI. Its acceptance
gate runs `game export web` on the replay fixture, loads the emitted
`content/project.json`, exported loader and exported release WASM, and compares
native observation digests. It also corrupts the emitted audio declaration and
requires the comparison to fail. Run it independently with
`node scripts/verify-player-parity.mjs`, or check an existing game export with
`node scripts/verify-host-parity.mjs --export <directory> --fixture <source-project>`.
Without replay tests, the latter compares a 60-frame replay. This is separate from the
developer-host gate, which assembles a payload from source and identifies itself
as `assembled-host`; it is not evidence for an exported player.

For a local emulator on the LAN, the measurement server supports an explicit
`--bind <your-LAN-IP>`; its default remains loopback. For example:
`python scripts/serve-export.py <export> --port 8187 --gzip --bind 192.168.0.100`.

Supported presentation: Three.js WebGL primitive boxes/spheres, textured
[static mesh JSON](static-mesh.md), image sprites, DOM UI, Web Audio, and native
3D particles, [legacy SKFE 1500 Effekseer and optional Bloom](sphere-sweeps-and-bloom.md).
Other mesh encodings, Spine and unsupported Effekseer encodings fail export.
The Effekseer JS/WASM is included only when declared by the game.
The WebGL export ships one minified, tree-shaken Three bundle instead of the two
dependent source modules. Rebuild it with the pinned esbuild script after changing
the renderer's Three API usage. Development hosts retain the original modules.

`document.body.dataset.playerMetrics` reports HTML-bootstrap-to-runtime readiness, first rendered
content and ResourceTiming bytes. `playerPerformance` reports sampled bridge/render
durations, draw calls, triangles, textures, particle count and dropped fixed steps.
These are raw measurements for AI investigation, not a bottleneck classifier.
Save restoration precedes Game.start; input/scheduler/UI/audio use shared host modules.

See the [probe report](../_Games/dragon-tycoon3/README.md) for actual measured
download/startup results and their limits. The local measurement server sends
correct WASM/MJS MIME types, no-store responses and optional gzip. It is a local
test utility, not a production server.
