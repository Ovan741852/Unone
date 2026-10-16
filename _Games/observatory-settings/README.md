# Aster Observatory settings

A UI-only example built with the official Unone player and the SDK-bundled
[`@unone/ui` package](../../docs/ui-components.md), using typed constructors for
existing UI leaves and `component` trees. The scene contains no world
entities. There is no HTML/CSS UI, replacement renderer, direct drawing API or
image asset. Five licensed TTF faces supply Chinese reading text, display type
and monospaced data labels.

The initial UI and state logic came from a fresh AI author using an immutable
portable SDK and its public CLI/type/documentation surface, without reading engine
source or receiving implementation hints. Independent visual acceptance later
identified a clipped heading at an intermediate aspect ratio; the author corrected
its type size through the same documented API. The current copy retains those
authored coordinates, typography and state behavior, with the official-package
migration described below and the matching canonical strict type prelude.
The launcher, documentation and ignore rules are integration files. The parent
validation's real desktop/portrait browser evidence is recorded separately;
the source tests below do not certify rendered pixels or mobile performance.

## Export from a portable SDK

Use an extracted compatible **Windows portable Unone SDK**, the official
`luau-analyze` executable, PowerShell and any static HTTP server. No Cargo, Rust
checkout, Node.js or source-built runtime is required. `-Sdk` is always explicit.
The analyzer may be supplied with `-Analyzer` or the documented
`UNONE_LUAU_ANALYZER` environment variable.

From the repository root:

```powershell
./_Games/observatory-settings/export.ps1 -Sdk C:/Tools/UnoneSDK -Analyzer C:/Tools/Luau/luau-analyze.exe
python -m http.server 8196 --bind 127.0.0.1 --directory ./_Games/observatory-settings/dist/player
```

From this example folder:

```powershell
./export.ps1 -Sdk C:/Tools/UnoneSDK -Analyzer C:/Tools/Luau/luau-analyze.exe
python -m http.server 8196 --bind 127.0.0.1 --directory ./dist/player
```

Open `http://127.0.0.1:8196/`. A `file://` URL is not the Web player launch route.
The optional `Play.ps1` combines export and the Python standard-library server;
pass `-OpenBrowser` to open the URL and press Ctrl+C to stop its foreground server:

```powershell
./Play.ps1 -Sdk C:/Tools/UnoneSDK -Analyzer C:/Tools/Luau/luau-analyze.exe -OpenBrowser
```

`export.ps1` calls the SDK's public `project prepare --target web` workflow. The
SDK CLI owns verification, bundle synchronization, runtime selection and the
official export inventory. A unique staging generation is published to the stable
`dist/player` directory only after preparation succeeds. A prior generation is
retained under `.unone/` and restored if publication fails. Preparation failures
leave a previous playable export available. The raw preparation response is
saved at `.unone/last-prepare.json`; its launch path describes the staging
generation before promotion, while the script reports the stable final path.

Font notices are copied separately to `dist/font-licenses/`. Keep that companion
directory beside a redistributed player. The script does not modify the official
player's generated files or inventory. The source `fonts/*-LICENSE.txt` notices
are also retained here.

## Interactions and state

- Toggle **Sound ON/OFF** to change draft state once per press.
- Choose **MOON**, **DEEP** or **METEOR** observation mode.
- Use **− / +** in steps of five, or drag the skinned semantic slider, to set
  brightness from 0 to 100. The game owns the value calculation.
- **Apply** copies draft settings into applied state and increments a
  confirmation counter. **Reset** restores draft defaults: sound on, deep sky,
  brightness 65. Applied values remain until the next Apply.
- The status line demonstrates ellipsis. Paragraphs demonstrate word wrapping;
  cards and actions reuse ordinary component trees. Aspect below 1.1 selects
  the author's portrait grouping through `api.ui.getViewport()`.

These controls demonstrate UI/state changes only. They do not play audio, change
screen hardware brightness or persist data between launches. The audio system is
enabled in the preserved author's project configuration but no audio asset or
playback call is present; saves are disabled.

## Reproduce the source checks

With `UNONE_LUAU_ANALYZER` set to the official analyzer:

```powershell
$Sdk = 'C:/Tools/UnoneSDK'
& "$Sdk/bin/game.exe" --sdk $Sdk --project . --json verify
```

Use a current SDK whose CLI and Web runtime both bundle `@unone/ui` version
`0.1.0`. The project declares `"runtime_packages":{"@unone/ui":"0.1.0"}`;
`api.ui.components.info()` exposes the installed version and declaration flag.
No npm install, `require` import or filesystem module loader is involved. An
older runtime cannot satisfy the package declaration; updating types alone does
not update the player. SDK preflight checks runtime compatibility, while
`verify` / `prepare` remain authoring gates. From the repository root, replace `--project .` with
`--project ./_Games/observatory-settings`. Verification includes strict types,
the explicit component backgrounds, six reviewed slider-skin overlap pairs and
nine deterministic interaction cases:
defaults, held-toggle edges, draft changes, Apply, Reset, slider maximum/clamping,
and the lower/upper bounds. The CLI layout preview uses its desktop reference
aspect; actual portrait rendering and pointer interaction require browser QA.

## Backgrounds belong to their components

The example calls `api.ui.components.create` inside its View publication, with
project-owned shared button style defaults. Its `label`, `panel`, `actionButton`
and `settingCard` factories compose the kit's typed constructors; the kit owns
style copying/merging and ordinary component surface declarations. The factories
still own the text, fonts, colors, geometry, semantic action IDs and application
state. The slider skin and its value calculations remain authored Luau.

`settingCard` uses `ui.component({...surface={kind="panel",style=...}})`.
Three card instances reuse that package-backed factory; the preset card uses
the same surface helper. The package prepends `id.."/surface"` with
`background_for={component=id}` and the component's unchanged placement. Child
coordinates and paint order are preserved. The full-screen panel explicitly uses
`background_for={screen=true}`. These five instances replace 62 external pairs;
the policy file contains only six deliberate slider-skin pairs instead of 68.
The factory no longer exposes every label/control ID to an external policy.

The inspector only accepts later, fully contained leaves of the declared scope.
Text/control collisions and protruding content still fail. This metadata does
not alter rectangles, paint order, typography or interactions. All responsive
choices remain in the example's Luau code. See the shared
[background contract](../../docs/ui-styling.md) and
[design decision](../../docs/decisions/0039-component-background-intent.md).

## Reproduce real-player acceptance

The repository's optional browser gate requires Node.js 22+, Playwright with
Chromium installed, and Python with `fonttools`. From the repository root, after
exporting this example:

```sh
node scripts/verify-ui-example-browser.mjs --export _Games/observatory-settings/dist/player --plan _Games/observatory-settings/tests/browser-plan.json --out artifacts/ui-usability/observatory-check
```

It uses real browser input and read-only observation of the production WASM ABI.
The plan checks public setting outcomes at 1440 by 900, 1020 by 884 and 390 by 844,
along with reused components, actual font painting/character coverage, wrapping,
ellipsis and heading extent. It saves screenshots for visual inspection; logical
layout and font registration alone do not prove that text is readable.
`UNONE_PLAYWRIGHT_MODULE`, `UNONE_BROWSER_CHANNEL` or `UNONE_BROWSER_PATH` may
select an existing test installation. See the
[validation record](../../docs/reviews/2026-10-16-ui-authoring-usability.md) for the
fresh-author input boundary, preserved failed attempts and independent results.

Generated `dist/`, `bundles/`, `.unone/` and reports are ignored. The stable
`bundles/manifest.json` path in `project.unone.json` belongs to generated SDK
synchronization output; it is not a checked-in engine/runtime dependency.
