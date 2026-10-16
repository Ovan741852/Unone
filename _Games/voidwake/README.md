# VOIDWAKE · Deep-space embers

A top-down space roguelike authored in Luau and presented by the official Unone
player. Clear three sectors, choose upgrades, and defeat the capital ship.

This example declares the official `@unone/ui` 0.2.0 package and composes its
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
The project points to a generated bundle manifest under `.unone/bundles/`;
`export.ps1` prepares it with the official CLI. Generated manifests and content
archives are local build products and are not checked in.

From the repository root:

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
./target/debug/game.exe --project _Games/voidwake bundle pack --output .unone/bundles/manifest.json --json
./target/debug/game.exe --project _Games/voidwake verify --json
```

The safe type refresh updates only the marked canonical contract in
`gameplay.luau`; project types and logic stay outside that block. Compose afterward
to refresh the generated entry point. `export.ps1` composes and prepares source
bundles before exporting. The replay
tests and four UI previews cover the menu, flight HUD, pause screen and upgrade selection. The overlap policy
explicitly names decorative background layers; it does not waive overlapping
controls or text. Visual layout choices belong to `ui.fragment.luau`, using the
shared [UI styling API](../../docs/ui-styling.md) and existing semantic components.
The [official package contract](../../docs/ui-components.md) documents the exact
`runtime_packages` declaration and SDK/runtime compatibility checks. The package
constructs the existing tree while retaining type sizes, colors, positions,
IDs, action meanings and child order; project factories still own the
mission introduction, vessel card, stat bars and upgrade cards. Decorative
background leaves keep their existing IDs and overlap policies.

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
