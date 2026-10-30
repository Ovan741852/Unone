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

Shipped players seed `api.random` per session. The official Web player draws a
fresh 64-bit seed on every load and restart and publishes it as
`document.body.dataset.playerSeed`; open the page with `?seed=<u64>` to reproduce a
reported session. The native player does the same for interactive play and writes
the seed to its report (`measurement.seed`); `--seed` overrides it. Native tool runs
(replay, headless, `--frames`/`--seconds` measurement, capture) and development
hosts keep the fixed seed 42 unless one is given, so digests stay comparable.

Shipped players also persist `api.save`. The Web player keeps the payload in
`localStorage`; the native player keeps it in one JSON file, per user on Windows
(`%APPDATA%/Unone/<project name>/save.json`) and in the activity's internal data
directory on Android (`save.json`, removed with the app). Other desktops use
`$XDG_DATA_HOME` (or `~/.local/share`)`/Unone/<project name>/save.json`. Project
name characters that are not portable in a path (`% < > : " / \ | ? *`, controls,
a trailing dot or space, device names such as `CON`) are written as `%XX`.
Both players restore the payload before `Game.start` and write it again only when
the committed encoding changes: after `Game.start` and after each successful tick,
never on every frame. Native writes a synced `save.json.tmp` sibling and renames it
over the file, so an interrupted write leaves the previous or the new save. A save
that cannot be read or is not JSON stops startup with `NATIVE_SAVE_READ_FAILED` or
`NATIVE_SAVE_CORRUPT` and leaves the file untouched; the player never starts fresh
silently. An absent file means no save. The native report's `save` object records
the path, its source, whether a save was restored and how many writes happened;
`--describe` declares the contract under `save`.

Native tool runs neither read nor write the save, so replays and measurements
cannot depend on earlier play: `--input-sequence`, `--headless`, `--frames N>0`,
`--seconds S>0`, `--freeze-simulation`, `--prewarm-ticks N>0` and `--capture-dir`
report `save.enabled: false` with a `disabled_reason`. `--save <path>` selects an
explicit file and enables persistence for headless and bounded test runs; it is
rejected with `NATIVE_SAVE_REPLAY_CONFLICT` under `--input-sequence`. Projects that
disable the `save` system persist nothing on either player.

`player.presentation.json` includes the **web-wasm** overlay (bloom, worker backend,
interpolation) and shared UI/font settings. Native wgpu packages the UI/font
settings and fails closed on web-only keys. Host identities and capability tables live in `game sdk inspect --json`;
see [portable SDK](portable-sdk.md).
For shared UI fonts, declare named/weighted TTF or OTF faces in `ui.fonts` and
use typed styles on the existing UI leaves; see [typography and styling](ui-styling.md).

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
the speed-optimized release profile with LTO. This trades a larger download for
interpreter/publication throughput; compare the emitted runtime hashes, byte sizes
and actual player timings. Runtime assertions are not editor code.

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
[static mesh JSON](static-mesh.md), image sprites, official Canvas UI, Web Audio, and native
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

The official presentation wire retains unchanged ordinary UI as an immutable
encoded generation, alongside retained artwork and save publications. The shared
reader restores the complete public snapshot; game code does not manage these
leases or supply dirty IDs. Matching worker templates send a definition only
when that private generation changes. The renderer still validates new trees
and preserves scroll, input, asset/font and viewport invalidation. Encodings over
64 MiB use the ordinary inline path rather than changing Core admission limits.
See [the ownership and transaction contract](decisions/0046-immutable-ui-publication.md).

The official host also exposes the read-only
`window.unonePlayerPerformance.snapshot({windowMs:5000})` accessor. It reads cached
primitives from already accepted main/worker publications; it does not request a
tick, decode another world, pause, or reset the game. The detached frozen result
separates `simulation_frame`/`simulation_time_seconds` from
`completed_draws`/`last_presented_snapshot_frame`. A completed draw requires
explicit world, Canvas UI and required cursor readiness; pending resources and
older/custom renderer contracts are reported as skipped or unknown. Completion
means synchronous host submission, not GPU scanout acknowledgement.

`publication_at_ms` is the main host's snapshot-acceptance timestamp, paired with
`time_origin_ms`; it is not the worker's serialization time. Counters reset on a
successful project load/restart and include session-relative `dropped_steps_total`. Completed
interval quantiles use at most 512 samples ending within the requested window
(positive and at most 60000 ms), with retained count and endpoints reported;
they are not a complete history or an inferred FPS. Existing `playerPerformance`
dataset publication keeps its 30-draw cadence and includes a completion summary.
An absent accessor is an older host, not evidence of successful presentation.

`UNONE_PLAYER_READY` waits abortably for the renderer, current Canvas assets and
required cursor artwork, then verifies a fresh complete submission at the final
frame barrier. Startup does not tick simulation or poll RAF while assets are
pending. Selected custom renderers must return an explicit synchronous draw
outcome (`{status:'completed'}` or `{status:'skipped',reason:...}`); an unknown
outcome fails with `PLAYER_COMPLETION_CONTRACT_MISSING` instead of reporting
READY. This host submission contract still does not acknowledge GPU scanout.

See the [probe report](../_Games/dragon-tycoon3/README.md) for actual measured
download/startup results and their limits. The local measurement server sends
correct WASM/MJS MIME types, no-store responses and optional gzip. It is a local
test utility, not a production server.


## Raster construction request

Official Web presentation accepts optional `"antialias": false|true`. Omission
retains the existing true request. This is a renderer/context construction
option: re-export and relaunch with a new page/canvas to change it. A game
runtime restart does not rebuild the context. Native currently uses one sample:
omission and false retain that path, while true fails preflight/export with
`HOST_ANTIALIAS_UNSUPPORTED`. Explicit antialias on a custom renderer is rejected
with `ANTIALIAS_OFFICIAL_ONLY`; omit it for that extension contract. Null and
non-booleans are invalid.

The existing visible `UNONE_PLAYER_READY` console info includes `raster` with
`antialias_requested` and `context_antialias` (null when unavailable). This is
default framebuffer/context evidence, not a claim that every pass has MSAA;
Bloom/AO offscreen targets, texture filtering and UI/font rasterization keep
their own policies. The ordinary renderer metrics repeat this diagnostic.

Optional `projected_raster="host"|"upper_left_checked"` is an official WebGL
constructor policy. Checked mode requires requested/effective AAfalse,
Bloom/AOoff, a game-declared hidden normal world (including empty snapshots),
isolated projected depth, and an actual per-target/context conformance gate.
Omission retains host raster. Explicit declarations on Native/WebGPU/custom
are unsupported. See [the full profile and lifecycle contract](projected-raster.md).
Export/preflight eligibility is not target GPU validation; current epoch/status
metrics must be checked, rather than reusing a historical READY after restore.
