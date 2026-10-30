# Unone portable SDK

This coordinated release uses engine **0.2.0** and `@unone/ui` **0.6.0**.
Use the matching CLI/runtime/types/package together. Retained logical artwork is
available through `ui.imageBatch.define` and `image_batch` content references;
see `game api describe ui.imageBatch.define --json` and
`docs/ui-slice-and-budget.md`. Camera-only updates use instance transforms rather
than resubmitting vertices. GPU batching stays in the official player.
UI 0.6 ordinary constructor results and composed styles are recursively frozen;
authored inputs remain mutable. Refresh canonical types and use `UiRectInput` /
`UiStyleInput` for mutable builders. See the ownership migration in
`docs/ui-components.md`; engine ABI version remains 0.2.0.
Read-only production-player submission counters are documented in
[profiling](docs/profiling.md#official-production-player-completion-counters).

Start with this SDK's CLI and bundled documentation. The SDK contains the
official player runtimes, host templates, `@unone/ui` source and canonical Luau
types; ordinary consumer authoring and Web export need no engine checkout or
Rust build. Available targets and systems depend on the installed runtime packs.

The official Web player negotiates viewport support with the actual runtime.
Ordinary projects without an explicit physical presentation requirement may use
an older runtime's aspect-only interface; `backend.viewport.mode` reports this
limitation. A declared `physical_input`, `projected_raster: upper_left_checked`,
or projected frame profile still requires the physical-size ABI and rejects an
older runtime explicitly. New runtimes keep the full physical viewport path.

For a game-owned nonlinear or integer projector, use the reusable
[preprojected indexed-geometry transport](docs/projected-geometry.md). Native and
official Three WebGL accept clip-space batches; unsupported WebGPU paths reject
them explicitly. This capability does not establish a game's original-renderer parity.

## Select the SDK and discover its contract

PowerShell example: replace the paths with your SDK and game directories. Keep
`--sdk` and `--project` explicit when working from another directory. Read the
CLI location from `sdk.json` rather than assuming a binary name or using a
different CLI from `PATH`.

```powershell
$sdk = (Resolve-Path 'D:/Tools/unone-sdk').Path
$manifest = Get-Content (Join-Path $sdk 'sdk.json') -Raw | ConvertFrom-Json
$game = Join-Path $sdk $manifest.cli
$project = 'D:/Games/my-game'
& $game --sdk $sdk --help
& $game --sdk $sdk --json sdk inspect
& $game --sdk $sdk api search 'UI package'
& $game --sdk $sdk api describe ui.components.info
& $game --sdk $sdk api describe ui.components.create
& $game --sdk $sdk api typings
```

Use `api search '<meaning>'` before guessing an API, then `api describe <name>`
for parameters, examples and frame semantics. `api search ''` lists the public
index. Subcommand `--help` describes the flags accepted by this exact CLI.
`sdk inspect` verifies the SDK inventory and reports installed runtimes; it does
not demonstrate rendered pixels.

For numeric sliders, search `slider drag` / `滑桿拖曳` and start with
`ui.components.createSlider`: create once, call `control.update(api.input)` in
Game.update and publish `control.view(props)`. The low-level `slider` leaf alone
does not implement numeric interaction. For release scrolling search
`scroll inertia` / `慣性捲動`; shared scroll helpers accept `inertia=true` and
`deceleration=8` (s^-1). Read the bundled UI guides for defaults and host limits.

For responsive composition, search `responsive layout` / `自適應排版` and use
`ui.components.createResponsiveLayout`. Create a retained model from typed
variants, then call `resolve(api.ui.getViewport(),bounds?)` in a pure View.
Use named `rect(id)` for leaves and `viewport(id)` for scroll helpers. The shared
package handles explicit breakpoint and row/column/grid arithmetic; the project
authors semantic groups, thresholds and typed style values. Read
[the responsive guide](docs/ui-responsive.md) for defaults, coordinates and a
complete strict example. Components never lay out their children implicitly.

For immutable binary data (loaded tables, maps, palettes, original game images),
freeze an ordinary buffer with `api.bytes.freeze` and read it with `buffer.read*`;
see the bundled [immutable bytes guide](docs/immutable-bytes.md). Declare level, table and
binary files as `kind: "data"` assets and read them with `api.assets.load`; see the bundled
[data assets guide](docs/data-assets.md). Declare post-processing as a `render_pipeline` in
`project.unone.json` and tune it with `api.render.setPass`; see the bundled
[render pipeline guide](docs/render-pipeline.md).

For generic batched geometry, search `spatial` / `batch collision` / `空間查詢`
and describe `spatial.create`, `spatial.submit` and `spatial.take`. Read the bundled
[spatial batches guide](docs/spatial-batches.md) for sphere records, nearest/overlap/
sweep queries, fixed next-tick delivery, capacities and CPU/GPU host selection.
Use canonical `SpatialBody`, `SpatialQuery`, `SpatialBatchResult`, `SpatialInfo`
and `SpatialLimits` from `api typings`. Annotate a stored query as
`SpatialNearestQuery`, `SpatialOverlapQuery` or `SpatialSweepQuery` before inserting
it into a `{SpatialQuery}` array, preserving Luau's literal `kind` type.
The engine owns geometry and execution; callers own movement,
selection policy and responses.
For rejection and retry handling search `structured spatial error` / `結構化診斷`
and describe `spatial.lastDiagnostic`. After a failed `pcall`, its optional
`EngineDiagnostic` supplies a field path, actual/expected values and recovery hints.
`code` and `recovery.retry` are machine-readable; `recovery.action` is human guidance.
Success retains the latest failure; read it before another operation can fail.
The envelope covers input/manager/executor/host failures, rather than all VM or
allocation errors. Treat all returned records as detached read-only snapshots:
Luau 0.734 cannot reject every dynamic-key mutation through a table alias.
Copy the bundled [strict spatial example](examples/spatial-diagnostics/README.md)
to a new writable directory to run all three query kinds, invalid input repair,
next-tick results and direct typed observation publication with no API stubs.
For empty JSON arrays use `observation.array` or `observation.setArray`; engine-produced spatial arrays
already retain `[]` automatically. For cost attribution search `spatial profile`
or `效能定位` and describe `spatial.profile`. The same bundled guide documents
typed work/transfer counters, measured host-wall phases and unavailable GPU timing.
`profile.bindings` separates Lua conversion from manager/executor time. Official
JavaScript hosts additionally expose setup and JSON/copy/ABI costs through detached
`spatialHost.report().metrics`; these phases can overlap and are not kernel timings.
Embedders can inspect `EngineRuntime::spatial_diagnostic()` after a failed tick.
The official JavaScript `spatialHost.diagnostic()` uses the new runtime ABI and
records a bridge request; cloned `report()` reads create none. See the bundled guide
for terminal recovery limits and repeatable synthetic benchmark tool scopes.

For repeated CPU cost samples, the SDK includes `tools/benchmark-spatial.mjs`.
It uses this SDK's public CLI and official analyzer in a fresh synthetic OS-temp
project, with no engine checkout or Rust build. From PowerShell with `$sdk` set:

```powershell
node (Join-Path $sdk 'tools/benchmark-spatial.mjs') --sdk $sdk --bodies 4096 --queries 128 --warmup 3 --samples 9 --output 'D:/Experiments/new-spatial-report.json' --analyzer $env:UNONE_LUAU_ANALYZER
```

Choose an unused output path. The report separates warmed per-batch p50/p95 from
`process_total_ms`, which includes process/project setup and all ticks. This CPU
tool does not measure GPU kernels or establish a GPU speedup/crossover threshold.

## Create, check and prepare a project

Before strict verification, make the official **`luau-analyze` executable**
available. The CLI discovers an analyzer beside itself; if your distribution
does not include one, obtain an official Luau release binary separately and set
its absolute path. Treat it as an external executable; no Luau source build is
needed. The selected analyzer must be usable on this host.

```powershell
$env:UNONE_LUAU_ANALYZER = 'D:/Tools/Luau/luau-analyze.exe' # Replace if needed.
& $game --sdk $sdk --project $project project init --name 'My game'
& $game --sdk $sdk --project $project --json project inspect
& $game --sdk $sdk --project $project --json platform snapshot
& $game --sdk $sdk --project $project --json check --types
& $game --sdk $sdk --project $project --json verify
& $game --sdk $sdk --project $project --json project preflight --target web
& $game --sdk $sdk --project $project --json project prepare --target web --output 'D:/Exports/my-game-web'
```

`project init` requires a new or truly empty directory. For an existing project,
skip init, inspect its configuration and retain its state, assets, test files and
declared systems. The starter uses `scripts/main.luau`; use the entry path in
your project's configuration when editing an existing game. Strict analysis
fails explicitly if the analyzer is missing; plain `check` is not type checking.

Preflight is read-only. Prepare verifies, synchronizes bundles and exports to a
new output directory, returning a launch descriptor. Use its paths to serve or
launch the exported **official player** and inspect real input and screenshots.
For Windows, use `--target windows` with a matching installed pack. Inspect
preflight diagnostics before changing systems: disable only systems the project
does not use, or obtain a compatible pack. Preserve required exact package
versions. Use the same `--runtime-id` and `--development` choices for preflight
and prepare if selecting those options. Headless verification, schema checks
and renderer labels do not establish visual completion.

Serve the Web export with the bundled Python standard-library helper. Its
absolute script path works from any directory with the `$sdk` selected above:

```powershell
python (Join-Path $sdk 'scripts/serve-player.py') --directory 'D:/Exports/my-game-web' --port 8344 --bind 127.0.0.1 --no-cache
```

Open http://127.0.0.1:8344/ and leave that terminal running while inspecting the
player. From the SDK root, the script path is `scripts/serve-player.py`.
The helper serves `.js` and `.mjs` with a JavaScript MIME type and `.wasm` as
`application/wasm`. Configure the same MIME types on any external static host;
serving `.mjs` as `text/plain` prevents the official player modules from loading.

## Author shared UI with the bundled contract

Read [shared components](docs/ui-components.md), [responsive layouts](docs/ui-responsive.md), [typography and fonts](docs/ui-styling.md),
[scroll collections](docs/ui-scroll.md) and [host support](docs/formal-ui-host.md).
These paths are inside this SDK. The package manifest is
[packages/unone-ui/package.unone.json](packages/unone-ui/package.unone.json).

Discover `ui.components.info`, then call `api.ui.components.info()` in Luau to
read the bundled `name`, `version` and `declared` flag; it works before package
declaration. Project named API records into a portable observation literal so
canonical strict Luau types remain compatible:

```luau
local info = api.ui.components.info()
api.observation.set("ui_package", {name=info.name,version=info.version,declared=info.declared})
```

Use this in `Game.start`, then inspect
`game --project <game-root> --json run --frames 1` with this SDK's CLI.
Copy that exact version into `project.unone.json`'s
`runtime_packages["@unone/ui"]`, preserving the project's other fields. This
selects a bundled pure Luau package; it does not install an npm module.

Both `api.ui.components` and the kit returned by `create(theme?)` construct
typed text, button, slider, combobox, panel, image, component and screen nodes,
plus `createSlider`, `createResponsiveLayout` and scroll wrappers. Publish the result with `api.ui.setRoot`. Leaf/component
props use `rect` **or** `anchor` plus `size` directly; screen uses
`id`/`node`/`children` and has no placement. Components preserve child coordinates:
stage coordinates are 0..100/y-up, while scroll content is local top-left/y-down.
Project Luau owns themes, semantic groups, authored responsive choices, selected values, action
meanings and model changes. A slider has no `value`/`onChange` props; a combobox
does not create options automatically.

Search `api search 'button click'` and use `api.input.wasPressed(action)` in
`Game.update` for a press edge, `wasReleased` for release and `isDown` for held
state. These are non-consuming snapshots against the previous successful tick,
not `onClick` callbacks or an event queue. For virtual rows, use
`UiVirtualOptions<ProjectRow>` / `UiVirtualGridOptions<ProjectRow>` to retain the
row type in `key` and UI-pure `renderItem` callbacks.

Use canonical `EngineApi`, `UiApi`, `UiComponentKit` and node/style types from
`api typings`. After an SDK upgrade, refresh only the marked canonical block:

```powershell
& $game --sdk $sdk --project $project api typings --update-script scripts/main.luau
```

This requires exactly one own-line `-- BEGIN UNONE API TYPES` /
`-- END UNONE API TYPES` pair and preserves surrounding code. For an older
unmarked entry, print the types and review initial integration. Never point
`api typings --output` at an existing gameplay script or replace canonical types
with `any`. Strict analysis is not an exact object-schema validator: required
placement combinations and unknown props also need runtime validation. Run
strict analysis, verify, preflight and prepare after upgrading.

## Optional browser and font evidence

This SDK also includes `scripts/verify-ui-example-browser.mjs` and
`scripts/audit-ui-fonts.py`. They are optional external-tool checks, separate
from the project's `verify` gates. They require Node.js 22+, Playwright with an
installed browser, and Python with `fontTools` for the local-export font audit.
See the [runnable browser workflow and plan format](docs/ui-components.md#optional-browser-observation-tools).
Inspect the recorded screenshots as well as the JSON reports. Packaged glyph
coverage and structural checks do not prove visual quality.

For acceptance of the URL actually served above, run from the SDK root in a
second terminal after saving `{}` as `browser-plan.json`:

```powershell
node scripts/verify-ui-example-browser.mjs --url 'http://127.0.0.1:8344/' --plan browser-plan.json --out 'D:/Evidence/my-game-served-ui'
```

Use the actual hosted URL when validating an external host, and omit `--export`
for this run. Type checking, headless replay and the observer's `--export`
self-hosted check cannot verify another server's MIME configuration or prove
that its URL loads and renders. Review the screenshots and exercise real input
on that URL; use a separate `--export` run for the packaged font cmap audit.
# Explicit host-time inputs

For demand-sampled elapsed time and bounded deterministic record/replay, read
[host time](docs/host-time.md). The API is disabled unless the project opts in;
ordinary long sessions should use live mode, and SDK recordings capture every
ordered read before replaying it without resampling.


Projected material snapshots optionally support `alpha_compare="greater"`;
omission/"greater_equal" retain legacy cutout equality and serialized payloads.
Use a synchronized Core/Native/Web SDK for the nondefault field. Official Web
presentation optionally accepts boolean antialias as a construction request
(default true); changing it requires relaunch. Native remains single-sample
(omitted/false accepted, true rejected at preflight). The existing player READY
console reports requested and effective context antialias separately.

Official WebGL additionally supports the constructor-only
`projected_raster="upper_left_checked"` profile, with actual bounded GPU validation
per physical target/context generation. It is restricted to current opaque/cutout
projected batches, AAfalse, Bloom/AOoff and game-declared hidden normal world.
Omission retains host raster; unsupported hosts reject explicit declarations.
Read [projected raster](docs/projected-raster.md) for eligibility, failure and
current-validation diagnostics. Core/WASM APIs and the 40B format are unchanged.

For opt-in ordered key/pointer/wheel edges, per-edge modifiers and lifecycle
barriers, read [ordered physical input](docs/ordered-physical-input.md). Official
Web main/Worker live ingress and normalized Core replay share one schema;
Native/custom live and text/IME remain unsupported. Omission keeps legacy input.
