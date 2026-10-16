# Harbor Controls

A fresh-context SDK-only author built this UI from an empty project using public
search/describe/schema/typings commands and the bundled official guides. The
maintained copy keeps its game-owned design, interaction rules and strict types.
Every control and surface uses the official `@unone/ui` 0.4.0 kit and player.

Audio level, display choice, Apply/Reset, input counters and 120 semantic-key
presets are project state. They do not change hardware volume/display settings
or persist data. Three explicit compositions target desktop, intermediate and
portrait viewports. One persistent official `createResponsiveLayout` model,
typed as `UiResponsiveLayout<LayoutValues>`, selects those project-authored
variants at aspect ratios `0.8` and `1.35`.
Shared row/column partitions provide the card and action-button rectangles;
the project supplies its colors, typography, spacing and control details.
Virtual rows use `UiVirtualOptions<PresetRow>`; two separate
input readers publish non-consuming press/release/held results each update.
The official layout package returns ordinary rectangles for the existing UI
transport; it does not add an HTML overlay or replace the renderer.

## Prepare with an official SDK

Use this SDK's root README and read the executable path from `sdk.json`. Install
an official `luau-analyze` for this host and supply its absolute path. Replace
these example paths, then run from the repository root:

```powershell
$sdk = (Resolve-Path 'D:/Tools/unone-sdk').Path
$manifest = Get-Content (Join-Path $sdk 'sdk.json') -Raw | ConvertFrom-Json
$game = Join-Path $sdk $manifest.cli
$project = (Resolve-Path './_Games/harbor-controls').Path
$env:UNONE_LUAU_ANALYZER = 'D:/Tools/Luau/luau-analyze.exe'
& $game --sdk $sdk --project $project api typings --update-script scripts/main.luau
& $game --sdk $sdk --project $project --json verify
& $game --sdk $sdk --project $project --json project preflight --target web
& $game --sdk $sdk --project $project --json project prepare --target web --output (Join-Path $project 'dist/player')
python (Join-Path $sdk 'scripts/serve-player.py') --directory (Join-Path $project 'dist/player') --port 8344 --bind 127.0.0.1 --no-cache
```

Open http://127.0.0.1:8344/ . Choose a new output directory for another prepare;
exports, bundle archives and reports are generated and not checked in. No Rust
build or engine checkout is needed when this example is copied elsewhere.

The bundled helper fixes JavaScript module and WebAssembly MIME types across
hosts. External static servers must serve `.js`/`.mjs` with a JavaScript MIME
type and `.wasm` as `application/wasm`; `text/plain` for `.mjs` prevents loading.
Validate this served URL with the SDK observer's `--url` workflow in
[the UI guide](../../docs/ui-components.md#optional-browser-observation-tools).
Headless checks and the observer's separate `--export` server cannot prove that
the URL above loads and renders.

Nine deterministic cases and two strict preview states cover edges, held input,
repeat readers, stable keys, visible-track slider capture/clamps, release and
project model semantics. One persistent official `createSlider` control owns
range/step/value and drag lifecycle. Its view declares the labelled field and
thin track together; the project contains no pointer mapping/capture logic.
Preset rows use the shared scroll controller with `inertia=true,deceleration=8`
for release motion. The engine default remains inertia off. Mouse, pen and touch
content dragging use the same host controller.
Independent real-browser QA also exercises physical pointer/wheel input, option
selection, long holds, Apply/Reset and three viewport sizes. The fresh author's
frozen original export remains separate from this maintained copy. Integration
refreshes the canonical type block, adopts the official Slider control and
enables optional scroll inertia; the historical original is unchanged.

Typography uses installed Segoe UI and Microsoft JhengHei with sans-serif
fallback. No fonts or images are redistributed. Real Windows browser screenshots
were readable; the absence of packaged font faces means no packaged cmap
coverage or identical typography on other operating systems is claimed.
For reproducible cross-machine fonts, declare licensed local files through the
shared [font catalog API](../../docs/ui-styling.md#package-a-font-catalog).

See the [fresh authoring and validation record](../../docs/reviews/2026-10-16-fresh-sdk-ui.md)
for actual search misses, negative type probes, shared fixes, browser evidence
and the SDK/source freeze boundary. Headless tests alone are not visual proof.
