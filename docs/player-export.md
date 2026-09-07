# Player build and single-game export

The player is a separate Cargo workspace at `crates/unone-player` to prevent
workspace feature unification with the CLI. It depends on `unone-engine` with
default features disabled. A compile-time assertion rejects an engine built with
`dev-tools`. Schema generation, asset/bundle authoring, verification, MCP-facing
sessions and script reload are unavailable in that build. The Web bridge shares
input, save, viewport, ticking and observation with the developer host.

From the repository root:

```powershell
./scripts/install-binaryen.ps1
./scripts/build-web-live.ps1 -Player
cargo build -p unone-cli
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
`--runtime <directory>` overrides the default `artifacts/player-runtime`.
It validates the exact HostProject ingestion before writing, rejects path escapes
and destination collisions, and creates an inventory with file hashes and sizes.
Only declared content is copied. The output has one game, local JS/WASM/assets,
no project switcher, no debug panel, no authoring source directory dependency,
and no CDN. It can be served from a subdirectory. Export currently requires this
source checkout's presentation files; a standalone installed CLI distribution
must ship them before it can support this command.

Supported presentation: Three.js WebGL primitive boxes/spheres, textured
[static mesh JSON](static-mesh.md), image sprites, DOM UI, Web Audio, and native
3D particles. Other mesh encodings, Spine and Effekseer asset declarations fail
export explicitly. Their development presentation host
support does not imply a production player decoder exists.

`document.body.dataset.playerMetrics` reports HTML-bootstrap-to-runtime readiness, first rendered
content and ResourceTiming bytes. `playerPerformance` reports sampled bridge/render
durations, draw calls, triangles, textures, particle count and dropped fixed steps.
These are raw measurements for AI investigation, not a bottleneck classifier.
Save restoration precedes Game.start; input/scheduler/UI/audio use shared host modules.

See the [probe report](../_Games/dragon-tycoon3/README.md) for actual measured
download/startup results and their limits. The local measurement server sends
correct WASM/MJS MIME types, no-store responses and optional gzip. It is a local
test utility, not a production server.
