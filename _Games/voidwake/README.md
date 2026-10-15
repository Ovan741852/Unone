# VOIDWAKE · Deep-space embers

A top-down space roguelike authored in Luau and presented by the official Unone
player. Clear three sectors, choose upgrades, and defeat the capital ship.

This example uses the same reusable engine UI components, typography/styles,
declared font faces, particle effects, and sprite Shader API available to any
Unone project. Gameplay and the screen composition remain game code. There is
no game-owned renderer, HTML overlay, GPU context, or copied player runtime.

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
node _Games/voidwake/tools/compose-game.mjs
./target/debug/game.exe --project _Games/voidwake bundle pack --output .unone/bundles/manifest.json --json
./target/debug/game.exe --project _Games/voidwake verify --json
```

`export.ps1` composes and prepares source bundles before exporting. The replay
tests and four UI previews cover the menu, flight HUD, pause screen and upgrade selection. The overlap policy
explicitly names decorative background layers; it does not waive overlapping
controls or text. Visual layout choices belong to `ui.fragment.luau`, using the
shared [UI styling API](../../docs/ui-styling.md) and existing semantic components.

All PNG artwork was created with ImageGen; exact prompts and generation IDs are
recorded in [ART-PROMPTS.md](ART-PROMPTS.md). The original synthesized WAV assets
can be verified or regenerated without third-party Python modules:

```powershell
python _Games/voidwake/tools/generate-audio.py --check
```

Only the font faces declared by `player.presentation.json` are included. Their
SIL Open Font License files are under `fonts/`. They are packaged locally by
Unone, with no font network request during play.

## Controls

- WASD or arrow keys: steer; aim with the pointer.
- Mouse button: fire; Q: electromagnetic pulse; Space: dodge.
- F: automatic targeting; Escape: pause; Enter: start or restart an expedition.
- Use the HUD sound button to toggle audio.
- Click an upgrade to continue. Touch controls appear on compact layouts.
