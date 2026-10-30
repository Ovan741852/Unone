# VOIDWAKE · Deep-space embers

A top-down space roguelike authored in Luau and presented by the official Unone
player. Clear three sectors, choose upgrades, and defeat the capital ship.

This example declares the official `@unone/ui` 0.6.0 package and composes its
text, button, panel, component and screen constructors through the typed
`api.ui.components` default kit. `api.input.wasPressed` handles one-shot actions;
`isDown` remains the held-input query.
The same package, typography/styles, declared font faces, particle effects and
sprite Shader API are available to any Unone project. Gameplay and the screen
composition remain game code. There is no game-owned renderer, HTML overlay,
GPU context, or copied player runtime.

## Build and run

The source checkout requires Rust, Node.js 22+, PowerShell, the Web toolchain
described in [platform toolchain](../../docs/platform-toolchain.md), and Binaryen.
The generated player and compiler outputs are intentionally ignored by Git.
The project points to a generated bundle manifest under `bundles/`;
the official `project prepare` workflow synchronizes it. `export.ps1` can also
prepare a local `.unone/bundles/` manifest for a source build. Generated manifests and content
archives are local build products and are not checked in.

From the repository root:

With a matching portable official SDK, no engine rebuild is needed for game
changes. Compose the entry, prepare a production player, and serve the export:

```powershell
$Sdk = '/path/to/unone-sdk'
node _Games/voidwake/tools/compose-game.mjs
& "$Sdk/bin/game.exe" --sdk $Sdk --project _Games/voidwake project prepare --target web --output _Games/voidwake/dist/player --json
python "$Sdk/scripts/serve-player.py" --directory _Games/voidwake/dist/player --port 8341
```

For a source-checkout build:

```powershell
cargo build -p unone-cli
node scripts/build-three-player.mjs
./scripts/build-web-live.ps1 -Player -Project _Games/voidwake
./_Games/voidwake/export.ps1
./_Games/voidwake/Play.ps1
```

Open the printed local URL. `Play.ps1 -Port 8342` selects another port. The
launcher serves only the exported official player under `dist/player`.

If the CLI and release runtime were built elsewhere, pass their paths explicitly:

```powershell
./_Games/voidwake/export.ps1 -Cli /path/to/game.exe -Runtime /path/to/player-runtime
```

The runtime directory must contain its matching `runtime.json`, JavaScript and
WASM. The CLI validates the runtime manifest, enabled systems, assets and official
renderer selection during export. Re-exporting preserves the previous player
under `.unone/`; it never serves authoring files.

## Authoring and verification

`gameplay.luau` contains the simulation and markers for the audio, presentation
and UI fragments. Edit these source files and compose the checked-in entry point:

```powershell
./target/debug/game.exe --project _Games/voidwake api typings --update-script gameplay.luau
node _Games/voidwake/tools/compose-game.mjs
./target/debug/game.exe --project _Games/voidwake project sync --json
```

The safe type refresh updates only the marked canonical contract in
`gameplay.luau`; project types and logic stay outside that block. Compose afterward
to refresh the generated entry point. `project sync` runs the normal verification
gates and updates the configured source bundle; `export.ps1` also composes and
prepares source bundles before exporting. The replay
tests and four UI previews cover the menu, flight HUD, pause screen and upgrade selection. The overlap policy
explicitly names decorative background layers; it does not waive overlapping
controls or text. Visual layout choices belong to `ui.fragment.luau`, using the
shared [UI styling API](../../docs/ui-styling.md) and existing semantic components.
The [official package contract](../../docs/ui-components.md) documents the exact
`runtime_packages` declaration and SDK/runtime compatibility checks. The package
constructs the existing tree while retaining type sizes, colors, desktop positions,
IDs, action meanings and child order; project factories still own the
mission introduction, vessel card, stat bars and upgrade cards. Decorative
background leaves keep their existing IDs and overlap policies.

## Responsive layout and effects

The View retains official `createResponsiveLayout` models for the frame, menu,
telemetry, instruments, dialogs, upgrade grid and touch controls. Each model
selects the authored portrait, intermediate or desktop variant at aspect
thresholds `0`, `0.85` and `1.4`. Named slots, rows, columns and grids own region
allocation; typography, copy and optional panels remain explicit game choices.
`resolveVoidwakeUi` supplies the same authored showcase values to the View and
presentation. Portrait gives the ship its own menu region, stacks upgrades,
and exposes touch steering and abilities. No viewport geometry is applied by
a project renderer or DOM overlay.

The official native declarative particle system supplies directional engine
plumes, afterburners, projectile tracers, hit sparks, blast debris, embers and
delayed smoke. Ship materials, shield ripples, short dash echoes, the graded
nebula and brief blast/EMP accents use the engine Shader API and official Bloom.
Presentation reads simulation state and uses its own visual seed sequence;
it never consumes gameplay RNG. Fixed sprite/material pools and conservative
particle reservations bound presentation work. `presentation` observations
report actual native budgets, dropped decorative plays and effect counters.

The two new ImageGen PNGs are single transparent images, not Sprite Sheets.
The fireball accent lasts 12 presentation frames; independently moving native
debris and embers outlive it. The wave front uses a separate image through the
engine Shader API, accompanied by native flashes and independently moving
sparks. This example does not claim texture-atlas or Flipbook particle
support. Pausing freezes gameplay while transient presentation effects drain;
it does not continually retrigger the same explosion or ability.

The geometry regression executes the actual official package and game View
across all authored variants and phases. The browser regression drives physical
inputs against an exported production player, inspects observations and real
WebGL draws, and saves screenshots. It does not inject gameplay state:

```powershell
node _Games/voidwake/tests/responsive-layout.mjs
# Install Playwright or set UNONE_PLAYWRIGHT_MODULE to its installed module.
node _Games/voidwake/tests/verify-responsive-fx.cjs
```

Set `VOIDWAKE_QA_URL`, `VOIDWAKE_QA_EXPORT` and `VOIDWAKE_QA_OUT` to select another
served export and evidence directory. Browser tests cover desktop 1440×900,
intermediate 1020×884, portrait 390×844 and live resizing. These are browser
viewport checks, not claims of verification on physical mobile hardware.

After exporting, the real-browser acceptance plan exercises pointer/keyboard
actions at desktop, intermediate and portrait sizes and audits the packaged
font glyphs. With Playwright available (or `UNONE_PLAYWRIGHT_MODULE` pointing
to its installed module), run from the repository root:

```powershell
node scripts/verify-ui-example-browser.mjs --export _Games/voidwake/dist/player --plan _Games/voidwake/tests/browser-plan.json --out artifacts/voidwake-browser
python _Games/voidwake/tools/build-supplemental-fonts.py --check
```

Screenshots in the browser output are separate visual acceptance evidence;
headless replay and structural preview alone do not establish appearance.

All PNG artwork was created with ImageGen; exact prompts and generation IDs are
recorded in [ART-PROMPTS.md](ART-PROMPTS.md). The original synthesized WAV assets
can be verified or regenerated without third-party Python modules:

```powershell
python _Games/voidwake/tools/generate-audio.py --check
```

Only the font faces declared by `player.presentation.json` are included. Their
SIL Open Font License files are under `fonts/`. They are packaged locally by
Unone, with no font network request during play.
Explicit fallback lists preserve the original Latin faces and package the CJK
and symbol fallbacks. Small, separately named Noto supplemental subsets cover
previously missing pause, upgrade, result and touch-arrow glyphs; the original
three Noto subsets remain unchanged. See [font provenance and rebuild checks](fonts/README.txt).

## Controls

- WASD or arrow keys: steer; aim with the pointer.
- Mouse button: fire; Q: electromagnetic pulse; Space: dodge.
- F: automatic targeting; Escape: pause; Enter: start or restart an expedition.
- Use the HUD sound button to toggle audio.
- Click an upgrade to continue. Touch controls appear on compact layouts.
