# Unone portable SDK

Start with this SDK's CLI and bundled documentation. The SDK contains the
official player runtimes, host templates, `@unone/ui` source and canonical Luau
types; ordinary consumer authoring and Web export need no engine checkout or
Rust build. Available targets and systems depend on the installed runtime packs.

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

Read [shared components](docs/ui-components.md), [typography and fonts](docs/ui-styling.md),
[scroll collections](docs/ui-scroll.md) and [host support](docs/formal-ui-host.md).
These paths are inside this SDK. The package manifest is
[packages/unone-ui/package.unone.json](packages/unone-ui/package.unone.json).

Discover `ui.components.info`, then call `api.ui.components.info()` in Luau to
read the bundled `name`, `version` and `declared` flag; it works before package
declaration. For example, publish the result with
`api.observation.set("ui_package", api.ui.components.info())` in `Game.start`
and inspect `game --project <game-root> --json run --frames 1` with this SDK's CLI.
Copy that exact version into `project.unone.json`'s
`runtime_packages["@unone/ui"]`, preserving the project's other fields. This
selects a bundled pure Luau package; it does not install an npm module.

Both `api.ui.components` and the kit returned by `create(theme?)` construct
typed text, button, slider, combobox, panel, image, component and screen nodes,
plus scroll wrappers. Publish the result with `api.ui.setRoot`. Leaf/component
props use `rect` **or** `anchor` plus `size` directly; screen uses
`id`/`node`/`children` and has no placement. Components preserve child coordinates:
stage coordinates are 0..100/y-up, while scroll content is local top-left/y-down.
Project Luau owns themes, geometry, responsive choices, selected values, action
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
