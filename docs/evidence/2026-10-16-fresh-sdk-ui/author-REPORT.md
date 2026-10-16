# Fresh SDK-only author report

Status: source/export frozen for independent browser QA. This report does not
claim that a browser rendered the screen or that visual acceptance passed.

## Isolation and inputs

This was a fresh authoring exercise in `example/`, initialized by the SDK CLI.
I used only `sdk/sdk.json`, the SDK's public executable, packaged public docs,
package README, canonical typings, schema/describe/search output and my newly
created project/evidence. I did not inspect package source, engine source,
runtime JS/WASM implementations, templates, other projects, other agent files,
Git history or earlier solutions. Runtime stack traces in CLI diagnostics were
retained as output; their referenced implementation files were not opened.
No web search, Cargo, alternate renderer, hand-authored HTML/CSS/canvas,
handwritten EngineApi, `ui:any`, network asset or subagent was used.

The analyzer was executed opaquely via the provided `UNONE_LUAU_ANALYZER` path.
No adjacent engine files were inspected. The only non-SDK asset checks were
`Test-Path` for installed Segoe UI and Microsoft JhengHei font files; both
were present. They are used as installed families, with `sans-serif` fallback.
No font files were copied or downloaded.

The SDK manifest was first read to discover `bin/game.exe`, then snapshotted
into the document ledger. All SDK CLI calls, including help, empty searches and
expected failures, have exact argv, cwd, timestamps, exit code and merged raw
output in `commands/<name>.json` and `commands/<name>.raw.txt`. Document copies,
read paths and SHA-256 values are in `docs/` and `doc-reads.jsonl`. The public
`sdk inspect` verified the SDK inventory. SDK input and final script hashes are
included in the freeze outputs.

## Discovery findings

The first path was sdk.json → CLI `--help` → `api --help` / `project --help` →
package README / public component guide → search/describe/typings/schema →
project init → strict check → runtime/preview → verify/preflight/prepare.
No actual blocker was encountered; a compatible runtime was selected directly.

Natural task-language queries were deliberately tried before implementation:

| Query | Observed result |
| --- | --- |
| `settings screen` | Audio bus APIs; no UI construction match. Useful for applying audio state, less direct for building the screen. |
| `調整音量` | Empty, exit 0 plus `API_SEARCH_EMPTY`. |
| `選擇品質` | Empty, exit 0 plus warning. |
| `按住按鈕` | Empty, exit 0 plus warning. |
| `可捲動清單` | Empty, exit 0 plus warning. |
| `responsive layout` | `ui.setRoot`, `ui.getViewport`; explicit layout ownership explained. |
| `文字字重` | Empty, exit 0 plus warning. |
| `pointer position` | World and normalized screen pointer APIs; describing the latter clarified the intended route. |
| `system font` | Empty, exit 0 plus warning. |
| `兩個讀者按下瞬間` | Empty, exit 0 plus warning. |
| `create button` | Direct callable `ui.components.button`, plus kit/info descriptors. |
| `下拉選單` | Direct combobox route. |
| `虛擬清單` | Virtual helper route. |
| `按下瞬間`, `放開`, `長按` | Input press/release/held APIs. |
| `字體` | Styling/publication route. |

The short terms suggested by the guide are more discoverable than natural
Traditional Chinese action phrases. Empty queries made before initialization
also suggested listing systems but could only report PROJECT_CONFIG_NOT_FOUND;
the full-index fallback was still usable. All raw records remain available.

The README and component guide were explicit about otherwise surprising
contracts: slider has no numeric value props, combobox has no built-in option
model, component children keep stage coordinates, scrolling uses a different
local coordinate space, and action readers are non-consuming tick snapshots.
The example follows these rules rather than guessing widget callbacks.

The styling guide references `scripts/verify-ui-example-browser.mjs`,
`scripts/audit-ui-fonts.py`, `_Games/observatory-settings/README.md` and review
documents that are not in this SDK's sdk.json inventory. Those links cannot be
followed within the SDK-only boundary. I did not fetch them or substitute
another path. Independent browser QA is therefore a separate handoff.

## Typed and runtime probes

All probes preserve the canonical type block. Invalid versions are retained in
`probes/`; the valid project was restored after every probe.

1. With `UiVirtualOptions<PresetRow>` and an unannotated contextual callback,
   replacing `item.label` with `item.lable` failed `check --types` precisely:
   `Key 'lable' not found in table 'PresetRow'`. This exercises row inference
   through the public generic contract rather than assigning the item `any`.
2. Adding `value=volume` to the slider constructor passed strict analysis, but
   `run --frames 1` failed with `UI_COMPONENT_PROP: unknown slider field value`.
   Canonical structural typing does not reject that extra constructor field.
3. Removing the slider's `rect` passed strict analysis, but runtime rejected
   the missing rect-or-anchor placement and named `audio/level`. The canonical
   placement type's optional fields cannot prove that runtime invariant.

The negative probes are intentional tests, not unresolved invalid project code.
No SDK edits or alternate path were used to make them pass. The authoring test
generator initially collided with PowerShell's automatic `$input` variable;
that project-owned script parameter was renamed to `actionSnapshot` before
generating the successful acceptance suite.

`api typings --update-script scripts/main.luau` reported no change. The separate
refresh proof records full source hashes and byte-identical project code after
the marked block. A final refresh/check was repeated on the final authored
source. There is one canonical marked block; Game.start/update use EngineApi,
the kit uses UiComponentKit, and project data/geometry/nodes retain named types.

## Implementation and verification

The dark teal/mint design uses themed official text/button/slider/combobox/panel
leaves, reusable component surfaces, style overrides and explicit typography.
The four sections are Audio, Display, Presets and Input Lab. The project authors
three complete compositions based on actual viewport aspect: portrait below
0.8, medium below 1.35, otherwise desktop. A helper only converts authored
top-left stage rectangles to the public y-up stage coordinates; it performs no
automatic layout. Virtual rows use the required cell-local top-left/y-down
rectangles and a registered live handle passed through the component kit.

The 120 row keys combine semantic space and mood names, e.g. `morning-calm`
and `travel-creative`; keys and control IDs do not depend on array position.
The pure virtual callback only reads a selected-key snapshot and constructs UI.

Press/release/held have two independent read sites per update. The UI displays
presses, releases and held/released state. Observations retain both readers,
their last edges, total held ticks and any mismatch count. Apply, Reset and
combobox activation use press edges, so sustained snapshots activate once.
Slider pointer mapping and capture, options, selection and applied values stay
in project code. Reset restores defaults while preserving the last applied
profile, which makes its dirty indication meaningful.

Eight deterministic acceptance cases pass:

- Initial settings and 120-item model (package metadata is also published by the runtime).
- Six held ticks: one press, no release, six held ticks, both readers equal.
- Two full cycles: two presses/releases, five held ticks, both readers equal.
- Five held combobox ticks: one expansion, rather than repeated toggling.
- Select Studio and the last semantic preset; hold Apply for three ticks: one save.
- Screen pointer mapping, drag capture beyond the rectangle, upper clamp to 100.
- Lower clamp to 0 without publishing an invalid zero-width fill panel.
- Reset held for three ticks: one reset while retaining saved profile data.

The public final prepare ran five required gates: strict types, asset readiness,
collapsed strict preview, expanded strict preview, deterministic tests. All
passed; both strict previews have zero findings. Preflight verified runtime
`web-production-0` with `@unone/ui` 0.2.0. The final Web export is official.
The headless preview explicitly does not measure actual fonts or prove visual
quality. Browser screenshots and real pointer/keyboard/scroll input remain
required at the three requested viewports.

## Freeze and handoff

Use **`example/dist/player-final`**, entry `index.html`, release root
`releases/486df17578ee5384f53b8c665018c9e47787acfb034ee8edd76ed7cb997d20d5/`.
The earlier `dist/player` is a retained intermediate, not the selected QA export.
`browser-handoff.json` contains exact control IDs, actions, geometries and
observation fields. `BROWSER-HANDOFF.md` gives the human test sequence.
`freeze/` contains source, selected export, full project and evidence hashes.
No commit, push, deployment or browser QA was performed by this author.
