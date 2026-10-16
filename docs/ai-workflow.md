# AI development workflow

For persistent Snapshot / Journal / Watch, transient Enact edits, input-driven
play sessions and measured replay experiments, see [developer sessions](developer-session.md).

This is the minimum workflow for an AI or human operating Unone. The CLI and `game mcp` are Developer Protocol clients; MCP is only a thin stdio adapter and does not reimplement engine logic in another layer.

## Default presentation route

Build game presentation with the official Unone player. With a portable SDK,
run `game --project <game-root> --json project preflight --target web`, then
`game --project <game-root> --json project prepare --target web --output <new-directory>`
for the synchronized export and launch descriptor. Direct
`export platform --target web` is also available; source developers use
[player build and export](player-export.md).
Inspect target capabilities and presentation settings before choosing an effect.
Do not create a game-owned canvas/WebGL/OpenGL/WebGPU renderer just to display
the runtime's snapshots. Replacing the official renderer is an explicit project
choice, not an implied part of using custom shaders.

Start exhaust, sparks, explosions, trails, smoke and auras with scene
`particle_effects` and `api.particle.*`; use [Particle Lab](native-particles.md)
to preview the declaration at a fixed frame and seed. Use
[shader materials](shader-materials.md) for custom shader resources and
`api.shader.*` for their parameters. GPU resource creation and
draw scheduling stay inside the engine presentation layer. When an effect needs
an unsupported feature, identify that gap before proposing a reusable engine
extension.

Use headless tests for gameplay and deterministic particle state, then inspect
the actual exported player's images, effects, shaders and input. Record the
selected renderer and tested target when reporting completion. Headless gates
alone do not certify a screen.

### Renderer selection and replacement

The starter's `player.presentation.json` selects the official player:

```json
{ "renderer_mode": "official", "bloom": true }
```

Omitting `renderer_mode` also selects `official`; ordinary games need no renderer
module. Do not set `renderer_module` or `renderer_files` in official mode. A
custom shader material or particle definition still uses official mode.

Renderer replacement must be an explicitly selected extension mode for a stated
project requirement. Declare the choice and its complete file inventory:

```json
{
  "renderer_mode": "custom",
  "renderer_module": "presentation/renderer.mjs",
  "renderer_files": [
    "presentation/renderer.mjs",
    "presentation/shaders.mjs"
  ]
}
```

Paths are relative to the game project. Include the entry module and every local
import/asset it needs in `renderer_files`; export copies this explicit inventory.
The module exports `createRenderer(canvas, options)` and returns the player
renderer contract (`draw`, `ready`, `metrics`, `setBloom`, `dispose`). The official player
shell still owns runtime, input, save, UI and audio. Native targets reject custom
renderers. The manifest records the choice and validates the interface; it cannot
prove that a custom renderer follows every engine
presentation contract. Report custom mode and its actual visual acceptance scope
when handing off the game.

`project preflight` checks target/runtime, project systems and presentation
compatibility without creating output or opening a GPU surface. Export records
`renderer_mode` and `renderer` (`three-webgl` or `custom-module` for Web);
the running Web player repeats the choice in `playerMetrics` and
`document.body.dataset.playerRenderer`. These labels make the selected route
reviewable. They are declarations, not proof that a particular sprite, particle
or shader was drawn. Combine them with evidence from the actual exported player;
`verify` and replay digests alone do not prove official GPU usage.

## -0. MCP stdio (optional)

When an MCP host is required, build the CLI binary first, then start it with a fixed project:

```powershell
cargo build -p unone-cli
target/debug/game.exe --project D:/Projects/Unone_Games/minimal-2d mcp
# Re-runnable protocol smoke
.\scripts\mcp-smoke.ps1
```

The MCP host configuration can use the same command and args. After connecting, complete `initialize` and `notifications/initialized`, then discover `tools/list`; tool names begin with `unone_`. `unone_run` accepts `frames`, `seed`, one `action`, or `input_sequence` directly. The latter matches the CLI and uses semantic actions plus a world-space pointer. `content[0].text` in a tool result is the complete `EngineResult` JSON; errors retain `code`, `explanation`, `facts`, `likely_causes`, and `suggested_actions`.

The only current asset contract is [asset-workflow.md](asset-workflow.md). MCP discovery should include `unone_asset_describe`; use `tools/list` as the authority for available tools and parameters instead of assuming a fixed count. Use describe when you need one asset's editing location, references, native-local active state, and freshness; do not assemble a second contract by combining `asset inspect` and `asset read` results.

Optional authoring tools are discovered through the same protocol. Run
`game --project <game> --json plugin list`, inspect a plugin before using it,
and call only the tools it declares. Plugins run out of process and return the
same structured result shape; they may write staging artifacts but must not
silently replace active game data. See [plugin-protocol.md](plugin-protocol.md).
For one current inventory, use the read-only `unone_platform_snapshot` MCP
tool; it includes plugin manifest capabilities and keeps renderer readiness
conservative until a host probe supplies evidence.

## -1. Check platform capabilities first

```powershell
cargo run -p unone-cli -- --project <game-root> --json platform snapshot
```

Read `game platform snapshot --json` first. It includes `target_family`,
`project_loaders`, `hot_reload_modes`, runtime/renderer/plugin readiness,
limitations, `verification_scope`, `checked_by`, evidence and minimal examples.
Platform `limitations` are for the current target; cross-target backlog is
listed separately as `other_target_gaps`. `wasm` capabilities are still
binary-level information; current Web live browser/WebGPU/bundle-storage
evidence comes from the `web/live/` smoke. Do not infer a complete Web release
package from a library compile or a single smoke fixture. Use the raw
`platform capabilities` result when a narrower target-only query is needed.

## 0. Create or obtain the project and API semantics

When a subagent receives only the engine package and a game plan, create the scaffold in its own game output directory first:

```powershell
powershell -File scripts/verify-ai-engine-package.ps1 -PackagePath .
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json project init --name "<game-name>"
```

`project init` accepts only a nonexistent or truly empty output directory and a non-empty name; it rejects even a directory containing only `.git` or `GAME_PLAN.md`. Keep the game plan and engine package outside the output, and run git init only after the project is successfully created. There is no force, overwrite, or merge mode. `..` paths and symlink/junction/reparse roots or ancestors are rejected; ordinary `.` and paths containing spaces or Unicode are allowed.
This protects against path misuse in a single-writer scenario; it is not a filesystem transaction that defends against another process maliciously replacing an ancestor between the check and the write. Do not run multiple writers against the same output.

Seven game-side files are created:

| File | Purpose |
|---|---|
| AGENTS.md | Official-player, declarative-particle and engine-shader authoring defaults |
| project.unone.json | Declares the script, scene, and two tests |
| player.presentation.json | Explicit official renderer selection and presentation defaults |
| scripts/main.luau | Inlines strict EngineApi types; holding Right moves example by dt; particle API guidance |
| scenes/main.scene.json | Image-free, non-rigidbody example with initial x/y=0 and an inline particle definition |
| tests/bootstrap-idle.test.json | 60 frames / seed42, no input, position stays at 0 |
| tests/bootstrap-input.test.json | 60 frames / seed42, Right produces x=1, y=0 |

The demonstration tests are headless onboarding checks, not gameplay or visual
acceptance. The game may replace `example`, `Right`, the particle definition and
the demonstration tests; when removing `example`, replace the demonstration
tests as well. Do not treat a green bootstrap as a game test or claim that the
screen is correct because the starter has no images. Init does not create art,
UI, save, an asset manifest or a bundle, and does not implicitly pack or install.
Use its official-player instructions and export actions to reach a playable
visual build.

The result includes absolute `root`, path-sorted `files[{path,role}]`,
`workflow_scope=new_unmodified_scaffold`, and `suggested_next_actions`.
Each action is `{executable,argv,reason,prerequisites}`: the logical executable is `game`, resolved inside a package to `bin/game.exe`; pass argv directly as a subprocess argument list, without constructing a shell command. `prerequisites` contains zero-based indexes of earlier actions.
For an unmodified starter, the suggested actions are verify → search particle
APIs → search shader APIs → list systems → Web preflight → Web prepare. Follow
the reported prerequisites; prepare composes synchronization and export rather
than requiring a second hand-assembled publication sequence. After adding
assets, follow [asset-workflow.md](asset-workflow.md): prepare bytes, declare them,
pack, then use the aggregated `verify` entry point (whose assets step already
performs strict inspection) before installing.

A partial write does not delete files or roll back automatically: diagnostic facts for `phase`, `failed_path`, `created_files` (`complete` distinguishes complete from partial), `created_directories`, and `effects` describe what was actually created. Inspect the record and handle it as the author; a later init rejects the remaining content rather than resuming.
The author can be an AI. On a write failure, report the diagnostic and resolve the disk or permission cause. If the game plan allows it, preserve the failed output and retry in another completely new output directory; ask the user when the specified output cannot be changed.
`created_files` and `created_directories` are historical write records, not permission to delete or proof that the paths are still safe to remove: later edits may have changed the content. Do not use them to automatically clear directories or recursively delete ancestors.

See [project.schema.json](project.schema.json), [scene.schema.json](scene.schema.json),
and [test.schema.json](test.schema.json) for the formats. UI rects use the 0..100 × 0..100 logical design space, not 960×540; a game plan that does not need UI does not need to create a UI tree.

```powershell
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json project inspect
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json asset inspect
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json api search "move entity"
bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json api describe entity.setPosition
```

`project inspect` reports the configuration and file facts visible to the engine; `api search` finds capabilities by intent; `api describe` returns parameters, return values, side effects, frame semantics, common errors, examples, and related APIs. Read these results before changing a game script; do not guess APIs.

`api search ""` lists the complete public index (the final subprocess argv item is a real empty string, not an omitted parameter). MCP's `unone_api_search` uses `meaning=""`. A no-match query is still successful and includes the `API_SEARCH_EMPTY` warning, `search_scope=public_engine_api`, `query`, and `match_count=0`. Its `value.suggested_next_actions` provides structured prompts for the complete index and systems list; gameplay verbs may be composed in the game, so no match does not prove that the engine lacks the capability. CLI and MCP use the same core result with different transport envelopes.

Each API-search action is `{action,ready,executable,argv,reason,diagnostic}`.
Execute only actions with `ready=true`; resolve logical executable `game` to the packaged `bin/game.exe`, and pass `argv` unchanged to a subprocess without constructing a shell command. The complete-index action preserves the real empty string in argv.
The systems action carries the caller-checked absolute project and does not select a project from the runtime cwd. If the project is unusable, search still succeeds, but the systems action has `ready=false` and `executable/argv=null` with the reason in `diagnostic`; fix that project and search again rather than switching to another directory. `diagnostic.suggested_actions` is explanatory only, with `command=null`; it is not a second set of shell commands.
Matched searches and complete-index queries do not include no-match actions. `ready` describes the conditions at query time and does not guarantee that another writer has not changed the project since; inspect the actual result after executing an action.

### Scene input and error locations

Scene JSON roots and nested typed objects reject unknown fields; entity ids cannot be blank or duplicated within one scene. A valid id is not trimmed or renamed; an empty scene `{}` / `entities=[]` is valid. A misspelled `position` is not guessed as `transform`. Disk run/test, asset inspect/describe, pack (even without an asset manifest), and Web/mobile scene payloads share the same checks; validation does not modify the world first or write pack output first. This is not a scene editor, a complete JSON Schema runtime, or validation of arbitrary dynamic Luau branches; existing cross-load merge behavior is unchanged.

Parsing and unknown-field failures use `SCENE_INVALID`; blank and duplicate ids use `SCENE_ENTITY_ID_INVALID` and `SCENE_ENTITY_ID_DUPLICATE`, respectively. In `facts`, `disk_scene` line/column refers to the original scene file; `host_payload_scene` locations refer to the `/scene` raw fragment, with `source=null` and `pointer_base=/scene`; `typed_scene` has no original JSON line/column. When no reliable location exists, return null; do not treat fragment line numbers as line numbers in the complete host payload. The `json_pointer` for an id semantic error points to `/entities/<index>/id`; a duplicate also reports `first_index`.

JSON for shared Vec2/Vec3 values also rejects extra fields, including an InputFrame pointer position. Web/mobile numeric pointer FFI parameters are unchanged. Opaque save/observation game data and manually read Luau tables are outside this serde strict-field-checking scope.

`asset inspect` lists static `sprite` / `mesh3d` / `animation` asset references in the main scene and compares them with the game-owned `asset_manifest` ids, project-relative sources, companion files, and bundle. It is an authoring-time advisory report. For handoff, CI, or release, use the aggregate `verify` entry point, whose assets step already runs `asset inspect --strict`. Use standalone `asset inspect --strict` for focused asset diagnosis or publication verification; it turns `ASSET_MANIFEST_MISSING`, `ASSET_REFERENCE_MISSING`, `ASSET_SOURCE_MISSING`, and `ASSET_BUNDLE_NOT_DECLARED` into `ok=false`. The manifest version is currently 1, and supported kinds are `texture2d`, `mesh3d`, `spine`, `effekseer`, and `audio`; an unknown version, typo, or unsafe path is not silently treated as usable. For one asset's authoring path, JSON pointer, references, active generation, publication freshness, and next actions, use `asset describe --id <id>`; see the [asset workflow contract](asset-workflow.md). It does not pretend to discover assets selected dynamically by Luau and does not replace the host's download, decoding, or GPU-resource responsibilities. If there are no scene asset references, the absence of a manifest is not an error.

For replayable game randomness, use `api.random.nextFloat()` or `api.random.nextInt(min, max)`. The CLI `--seed` becomes that runtime's Luau random seed; the same seed, input order, and random-call order are required for the same result. It is not a secure random source and must not be used for payments or secrets.

## 0.5 Decide which engine systems this game uses

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems list
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems search "物理"
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id physics2d --enabled false
```

`systems list` reports each system's default, effective value, source (`default` or `project`), Luau APIs, observation fields, and what disabling it removes. `systems search` finds systems by intent in the same style as `api search`. After deciding, use `systems set` to write the choice into that game's `project.unone.json`:

```json
{ "systems": { "physics2d": false } }
```

An undeclared system uses the engine default. Three cases fail directly: `SYSTEM_UNKNOWN` (the engine has no such id; a typo is not treated as disabling a system), `SYSTEM_NOT_OPTIONAL` (`world` / `input` / `observation` cannot be disabled), and `SYSTEM_NOT_IMPLEMENTED` (attempting to enable a system marked as unimplemented). `spine` / `effekseer` are currently enableable `host_required` systems, not unimplemented; presentation still depends on the selected host.

Disabling a system has real effects: with `physics2d` disabled, the engine no longer advances rigid bodies. The Luau APIs of a disabled system remain present, but calls return `SYSTEM_DISABLED` with a re-enable command instead of producing `attempt to index nil`. `systems` decides which engine mechanisms run; game numbers, levels, and content switches remain game-owned.

## 1. Check the project

Run the aggregated gate once:

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json verify
```

`verify` runs `check --types`, the strict `asset inspect --strict` step, the UI `layout` gate, and `test`, then returns one verdict plus each step's result. For a project with UI, the `layout` gate uses `ui preview --strict`; without published UI it is `not_applicable`. UI and save are applicable only when required by `GAME_PLAN`; do not create them just for a gate. A failed step does not stop the remaining steps, and each step includes a standalone `command`. The sections below describe individual gates when a focused query is useful; do not add a duplicate strict asset gate when `verify` is the selected entry point.

### The gate order is a default, not a law

The order above is what runs when the project says nothing. A project can
declare its own in `project.unone.json`:

```json
"verify": {
  "steps": [
    "types",
    { "step": "assets", "required": false },
    "tests"
  ]
}
```

- Order is the declared order, and only the declared gates run.
- `required: false` makes a gate **advisory**: it still runs, its diagnostics
  are still reported in full, its status is `advisory` instead of `failed`, and
  the run's effect line names it — but it does not fail the run. Use it for a
  gate that is genuinely not ready yet (assets still being acquired), not to get
  a green line. A gate people learn to read past is worse than one that says
  out loud that it was let through.
- A gate cannot go missing quietly: an empty `steps`, an unknown id and a
  duplicate are each an error (`VERIFY_STEPS_EMPTY`, `VERIFY_STEP_UNKNOWN`,
  `VERIFY_STEP_DUPLICATED`).
- The report says where the order came from in `step_source`: `default` or
  `project`.

`{ "step": ..., "command": ... }` is the reserved shape for a project-owned
command as a gate. It is **not implemented in this build**, and declaring it
fails with `VERIFY_STEP_NOT_IMPLEMENTED` rather than silently never running.

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check --types
```

The entry script produced by `project init` **inlines the engine's Luau type contract**, so `check --types` really rejects an API that does not exist (the engine runtime has no module require, so a single-file game must carry its own types). Use the canonical `EngineApi`, `UiApi` and `UiComponentKit` rather than handwritten `ui:any` shims. After an engine upgrade, run `game --project <game-root> api typings --update-script gameplay.luau` to replace only the explicitly marked canonical block; surrounding game code is preserved. New entries include own-line `-- BEGIN UNONE API TYPES` / `-- END UNONE API TYPES` markers. Missing, duplicate or malformed markers fail without writing. For older unmarked entries, print the contract with `game api typings` and review its initial integration; do not guess a replacement region. `--output <path>` writes a complete contract to a dedicated file, never an existing game entry script, and conflicts with `--update-script`. Tests protect the type contract and API index from drifting apart.

`check` guarantees Luau syntax and the Engine entrypoint contract: it confirms that the entry script returns a `Game` table with `start` and `update` functions. `--!strict` is reported as contract metadata. Only `--types` invokes the official `luau-analyze`; `bin/game.exe` in an engine package automatically looks for `bin/luau-analyze.exe` beside it. During engine development or when replacing the tool, set `UNONE_LUAU_ANALYZER` to the analyzer executable path. If the tool is missing, the command returns `LUAU_ANALYZER_NOT_FOUND` instead of hiding the lack of type checking.

The complete fields and assertion structure of `.test.json` are defined by the package's `test.schema.json`. `game test` treats each test file as an independent deterministic case and returns an observation digest, save payload, and assertion failures; save/restore fields are for `GAME_PLAN` requirements only. Do not use a UI screenshot as a test assertion.

For example, `project.unone.json` can set `"test_files": ["tests/opening.test.json"]`, and a test file consists of `name`, optional `frames` / `seed` / `input` / `input_sequence` / `load_save`, and `assertions`. `load_save` is only for a `GAME_PLAN` restore check. An assertion chooses exactly one of: `observation` for full JSON-value equality, `ui` for full typed UI-tree equality (including nested reusable components), or `entity` + `field` (currently `transform.x` / `transform.y`) for numeric comparison.

If only the runtime contract is needed, omit `--types`. A local Windows binary from an official Luau release can be used, or set:

```powershell
$env:UNONE_LUAU_ANALYZER = 'D:/tools/luau-analyze.exe'
```

## 1.5 Mobile host contract (separate track; not a Web prerequisite)

Android/iOS hosts should first validate lifecycle through the narrow `unone-mobile-ffi` ABI. Do not put JNI, UIKit, View, screen-pixel, or safe-area handling in game scripts:

```powershell
cargo test -p unone-mobile-ffi
.\scripts\check-android-engine.ps1
```

The native host sequence is `init → resize → load_project → set_pointer/set_action → tick → observe → pause → surface_lost/resize → resume → tick → shutdown`. Do not send ticks while `pause` is active; `resume` must not inject stale wall-clock time into the simulation. The ABI's JSON observation, C header, and ownership rules are documented in `docs/mobile-host-abi.md`. These commands validate only the adapter contract and Android cross-compilation. Without APK, emulator/device, or iOS hardware evidence, do not mark mobile complete.

This is a separate mobile track, not a prerequisite for the Web slice. Web-first delivery can be evaluated with the Web host; Android/iOS and mobile-lifecycle evidence remains deferred until those hosts are explicitly exercised.

On Windows, if the Android SDK build-tools and JDK are available, you can additionally validate the minimal APK host:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/run-android-apk-smoke.ps1
```

This places the selected game's project/script/scene into an APK, which the Java/Canvas host reads and runs through `unone-mobile-ffi`. It proves only the package/JNI/lifecycle/input boundary; it does not prove the production Android renderer, asset/bundle behavior, or the formal game gates.

## 2. Run deterministic simulation

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 60 --seed 42 --action Right
```

AI should read `world`, `observation_digest`, and `diagnostics` first, then inspect the screenshot. The same project, seed, frame count, and input should produce the same digest; do not use visual similarity as a substitute for state assertions.

To replay input frame by frame, use a JSON array. Each frame explicitly separates semantic actions from the optional world-space pointer:

```json
[
  {"actions": {"Right": true}},
  {"actions": {"Right": true}},
  {"actions": {}},
  {"actions": {"Right": false}},
  {"pointer": {"position": {"x": 2, "y": 1}, "down": true}}
]
```

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 4 --seed 42 --input-sequence D:/Projects/Unone_Games/minimal-2d/tests/input-sequence.json
```

`--action` and `--input-sequence` are mutually exclusive. If a sequence has fewer frames than requested, the missing frames clear the actions and pointer-down state. `pointer.position` is in world space; for UI clicks, you can also provide `pointer.screen_position`. The adapter normalizes both into normalized 0..100 UI space, and game scripts do not read key codes, pixels, DPI, or safe-area coordinates. When `screen_position` is omitted, the engine explicitly uses `position` as the headless fallback.

## 3. Run tests

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json test
```

The test manifest lives in the game project and contains frames, seed, input, optional per-frame `input_sequence`, and assertions. Each `input_sequence` frame may contain `actions` and `pointer`; missing frames clear the actions and pointer-down state to prevent sticky input. When a test fails, first classify it as:

- game logic: change the Luau or content in `Unone_Games`.
- engine contract: change the engine, tests, and documentation.
- architecture: change the architecture when the same blocker affects multiple games or prevents platform/reload support.

When restore behavior must be verified, the test manifest may also provide a `load_save` JSON payload. It is restored **before** `Game.start`, so the game can rebuild state with `api.save.get()` inside `start` without waiting for the first update. The output also includes `save_payload`, but the engine does not decide the game's version or migration behavior.
- tooling/docs: change the protocol, metadata, or documentation when the CLI, diagnostics, or tutorial is noisy.

If the game has dialogue, battle results, or other state that does not belong in Entity Transform, publish a semantic projection as a typed ViewModel with `api.observation.set(key, value)`. A test assertion can use `{"observation":{"key":"view_model","equals":{...}}}` for full JSON equality. The game should publish the minimal View tree with `api.ui.setRoot(root)` only when GAME_PLAN requires host display.

**Both design-space axes are 0..100, and the y axis points upward**: `y = 0` is the bottom of the screen, `y = 100` is the top, and a rect grows upward from its `y`. Most UI systems use a downward y axis, so this is the easiest thing to reverse when a layout is invisible. The symptom is two rows stacked on top of each other, which the `ui preview` ASCII output shows directly.

Each node must use **exactly one** of these positioning forms:

- `rect`: absolute coordinates in the 0..100 design space. Use this for layouts that are not edge-anchored, such as a ring of lights arranged with trigonometric functions.
- `anchor` + `size` (optionally `offset` and `pivot`): edge-anchored positioning. `anchor` is one of nine named positions (`top_left`…`bottom_right`). Numeric values use **vertical units on both axes** (a percentage of viewport height), so the same declaration preserves its shape and margins at any screen aspect ratio. The engine resolves it to a rect from the viewport reported by the host; the host still receives only a rect.

Declaring both forms, or declaring neither, is rejected. Headless tests use a 16:9 reference aspect ratio; the host reports the actual aspect ratio with `unone_web_set_viewport_aspect`, and tests can use a `{"ui":{"equals":{...}}}` assertion. The game owns the meaning of the ViewModel, View, hit-test, and actions; the engine only validates and transports the tree, while the host handles the viewport and actual rendering.

Use `api.save.set(value)`/`api.save.get()` only when GAME_PLAN requires persistence. The game defines the payload version and migration; the engine provides JSON-like transport, and the host owns file/platform storage. Do not treat observation as save data or add save slots, cloud sync, or a game-specific schema to the engine.

## 3.3.1 Official UI components, typography and style discovery

Start shared controls with the official [`@unone/ui` package](ui-components.md),
which ships as pure Luau with Core and the portable SDK. Search
`game api search "UI package"`, `"shared components"`, `"button component"`,
`"card component"`, `"官方UI套件"`, `"共用元件"` or `"主題樣式"`; describe
`ui.components.info` and `ui.components.create`. Declare the exact bundled version
in `project.unone.json`: `"runtime_packages":{"@unone/ui":"0.4.0"}`. `info()` is
available before declaration and reports the name, version and `declared` flag.
No npm install, import or filesystem module loader is involved.

`api.ui.components.create(theme?)` returns a typed kit with `text`, `button`,
`createSlider`, `createResponsiveLayout`, low-level `slider`, `combobox`, `panel`, `image`, `component`, `screen`, `scrollView`,
`virtualList`, `virtualGrid`, `id` and `composeStyle` methods. Every constructor
also exists directly on `api.ui.components`, without theme defaults; both
`kit.button(props)` and `api.ui.components.button(props)` are valid. These
construct existing nodes for `api.ui.setRoot`, which remains the explicit
publication step. Leaf/component props use explicit flattened `rect` or
`anchor`+`size` fields. Per-kind theme styles are copied, overrides win, padding
merges by edge and RGBA arrays replace. The project owns themes, content, application state,
action meanings, screen flow and geometry. Custom Luau factories remain valid.

Search `"create button"` / `"建立按鈕"`, `"slider drag"` / `"slider value"` /
`"滑桿拖曳"` for the button and `ui.components.createSlider` descriptors.
Search `"combobox"` / `"下拉選單"` and `"scroll view"` / `"虛擬清單"` for the
corresponding constructors. Search `"button click"` / `"button pressed"` /
`"按下瞬間"` for `input.wasPressed(action)`, `"release"` / `"放開"` for
`input.wasReleased(action)`, and `"hold"` / `"長按"` for `input.isDown(action)`.
Edges compare the current action snapshot to the previous successful tick;
repeated reads do not consume them. There are no `onClick`/`onChange` function
props. The official `createSlider` control owns numeric clamp/step and drag
mechanics; the project applies its value to an application setting. Combobox
options and application model changes remain project-owned. Read the
[action lifecycle](ui-components.md#read-semantic-actions)
before inventing callback or event-queue behavior.

Create each `UiSliderControl` once in `Game.start`, retain it, publish its pure
`view({rect=...,trackRect=...})`, and call `update(api.input)` once per control in
`Game.update`. Do not recreate controls during rendering or duplicate pointer
mapping. Hosts project the shared geometry, clip scroll content and capture
the pointer; this supports local controls inside scroll views as well as stage
controls. Read `value`, `changed`, `dragging`, `started`, `released` and
`cancelled` from the update result. Use `getValue()` for repeated reads and
`setValue` only for explicit external changes/resets; `setValue` and `cancel`
stop the old held gesture until a new start. Virtual `renderItem` callbacks may
call only `view`, never input update. See the
[typed slider lifecycle](ui-components.md#interactive-sliders) for defaults,
step/endpoints, `axis`, `reverse`, hit-padding units and a complete entry body.
The low-level `slider(props)` remains a semantic leaf with no numeric controller;
do not put `value`/`min`/`max`/`step` or callbacks on that leaf.

Search `"scroll inertia"` / `"deceleration"` / `"捲動慣性"` for
`ui.components.scrollView`. `scrollView`, `virtualList` and `virtualGrid` accept
`inertia=true,deceleration=8` on the supported Web host. Inertia defaults to
`false`; deceleration defaults to exponential velocity decay of 8 inverse
seconds and must be finite in `(0,100]`. There is no elastic overscroll. Follow
[the scroll contract](ui-scroll.md) for cancellation and host limits.

For responsive UI, search `"responsive layout"`, `"adaptive UI layout"`,
`"breakpoints"`, `"row column grid layout"` or `"自適應排版"` and describe
`ui.components.createResponsiveLayout`. Use canonical
`UiResponsiveLayoutOptions<T>` / `UiResponsiveLayout<T>` and retain a model created
once from explicit semantic regions. In the pure View call
`model.resolve(api.ui.getViewport(),bounds?)`; pass `result.rect(id)` to leaves
and `result.viewport(id)` to scroll helpers. Projects own thresholds and complete
typed `values` records, including font-size choices. The package owns highest
inclusive aspect selection, fixed/grow row/column sizing, equal-cell grids and
explicit stage/scroll conversion. The first threshold is `0`; later thresholds
strictly increase. Stage bounds fit `0..100`; explicit `space="scroll"` supports
local content beyond that range. Lengths are per-axis rectangle units, not style
vertical units or parent percentages. Do not copy breakpoint conditionals and
geometry arithmetic per project, add `layout` props to components, mutate virtual
nodes or assume text measurement/automatic wrapping. Read the
[complete typed lifecycle](ui-responsive.md) and verify at boundaries and
intermediate aspects in the official player.

For font and canonical leaf details, search `"font size"`, `"text alignment"`,
`"border padding"` or `"字體"`, describe `ui.setRoot`, and inspect `game schema ui`.
The [style guide](ui-styling.md) covers vertical design units, explicit sizes,
font catalogs and host limits. `api.ui.getViewport()` supplies the current aspect
to the shared responsive model. Refresh `game api typings` and the SDK
when upgrading. A package declaration needs a runtime containing that version;
SDK preflight rejects older runtimes. Standard `verify` / `prepare` remain
authoring gates. Inspect the exported official player at the target sizes to
validate glyph coverage, visual hierarchy and font metrics.

Use `ui.component({...surface={kind="panel"}})` or an image surface for a card's
background. The helper prepends `id.."/surface"` with
`background_for={component=id}` and the component's unchanged placement. Children
retain authored coordinates and order. A direct custom factory may declare the
same metadata on its own image/panel leaf; screen backgrounds use
`background_for={screen=true}`. Search `"card background"` / `"component overlap"`
for canonical scope checks. Strict inspection exempts only later fully contained
descendants; foreground collisions, partial coverage, unrelated siblings and
later occlusion remain findings. Keep exact-pair version-1 overlap policies for
skin layers that need them. See [the scope contract](ui-styling.md#explicit-background-scopes).

Component children do not gain a relative origin: stage coordinates stay
0..100/y-up. Scroll content uses its existing local top-left/y-down contract;
the package's scroll wrappers preserve lifecycle, registration and host limits.
No constructor moves or reflows children. Search `"component relative coordinates"`
when a container assumption is unclear. For font coverage, use packaged fallback
faces and the [existing cmap audit](ui-styling.md#package-a-font-catalog) alongside
real player screenshots. A pasted `<body data-player-...>` is diagnostic HTML,
not the Canvas pixels; use screenshots for appearance and the runtime's published
tree plus `ui.components.info()` for semantic/package evidence.

## 3.4 Declarative particles (default visual-effects path)

Search by the intended effect before choosing an implementation:

```powershell
game --project <game-root> --json api search "explosion"
game --project <game-root> --json api describe particle.play
game --project <game-root> --json api describe particle.play_batch
```

Keep `systems.particle` enabled and declare the effect under scene
`particle_effects`. Luau selects the effect, origin and seed with
`api.particle.play`; `move` changes the origin for future births, `finish` lets
existing particles fade out, and `stop` cancels immediately. `play_batch` shares
one handle across static origins; inspect the API contract before selecting it
for a moving trail. The engine samples emissions deterministically and the
official Web/native players render the samples. Use the
[particle guide](native-particles.md), generated schema and Particle Lab presets
for authored shapes, timing, color, size and blend settings.

## 3.5 Skeletal animation and external effects (Spine / Effekseer)

These two systems are disabled by default and have status `host_required`. Use
them when the game needs external Spine/Effekseer assets. For effects authored
directly as scene data, use the built-in particle system above. The dedicated
`web/presentation` host connects to both external runtimes; release Web export
also supports the declared legacy SKFE 1500 Effekseer subset described in
[player export](player-export.md). The generic Web runner, native preview and
native Android player do not gain these external runtimes automatically. This
is not cross-platform acceptance evidence. Enable them when needed:

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id spine --enabled true
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id effekseer --enabled true
cargo run -p unone-cli -- --json api describe animation.play
cargo run -p unone-cli -- --json api describe effect.spawn
```

The game selects a clip for an Entity with `api.animation.play(id, name, {loop = true, speed = 2.0})`. The snapshot's `world.entities[].animation` includes `started_frame`; replaying the same asset/name/loop/speed does not reset it, so the host does not restart it every frame. `api.effect.spawn(asset, {x = 0, y = 1})` returns a handle. `world.effects` contains the currently existing effect instances, with handles assigned in creation order and a simultaneous limit of 256. A scene can also declare an entity's `animation` directly.

For assets, the asset manifest supports `spine` and `effekseer` kinds and uses `files` to declare required companion sources (Spine atlases and texture pages). They are packaged with the source in the same bundle and can be retrieved with `asset read --id <id> --file <declared file>`; an undeclared file reports `ASSET_FILE_NOT_DECLARED`.

Tests can use `{"animation": {"entity": "reel-3", "equals": {...}}}` and `{"effects": {"equals": [...]}}` for full JSON equality, making presentation state assertable without looking at the screen.

To see them play, use `web/presentation/`: first run `scripts/build-web-live.ps1`, then from the engine repo root (`D:/Projects/Unone` in this example) start `python scripts/serve-player.py --directory .. --port 8001 --no-cache` and open `http://127.0.0.1:8001/Unone/web/presentation/?project=/Unone_Games/slot-machine/`. The parent-directory server root contains both `Unone` and `Unone_Games`, preserving those URL prefixes. It plays the same snapshot with spine-webgl and Effekseer for WebGL; native preview and the Android host currently do not render them. Vendored runtime and licensing requirements are documented in `web/vendor/README.md` (Spine requires a license; Effekseer is MIT).

These source hosts are development probes. For a distributable game, use
[official player export](player-export.md) and point the same helper's
`--directory` at the export directory. The helper fixes JavaScript MIME types
for `.js` and `.mjs`, and `application/wasm` for `.wasm`; alternative static
servers must provide those types too. A raw `python -m http.server` can inherit
Windows MIME settings that serve `.mjs` as `text/plain`, causing module loads to
fail before the player starts.

Core does not evaluate Spine skeletons, blend their animations, report external
animation completion, or simulate Effekseer's particles. Those tasks belong to
the external host runtimes. Core does simulate its own declarative particles;
the two effect paths have different contracts. If gameplay must settle after an
external animation, define that timing in Luau using fixed frames.

## 3.6 Sound

`audio` is on by default and has status `host_required`: the engine decides what
should be heard and publishes it, while each host decodes and mixes it. Web
uses Web Audio; the native player uses the verified asset bundle with
`rodio/cpal` for Windows and NativeActivity hosts. A host report includes
device availability, decoded asset count, live handles and failures, so a
green simulation is not confused with audible output on a machine without an
audio device.

```powershell
cargo run -p unone-cli -- --json api describe audio.loop
```

One-shots and loops are published differently, and the difference matters:

- `api.audio.play(asset, options?)` fires a one-shot. It appears in
  `world.audio_events` for exactly one frame and is gone from the next, like a
  contact. The engine never learns when the clip finished — that would need a
  decoder or a duration constant it cannot verify — so nothing reports back.
- `api.audio.loop(asset, options?)` returns a handle and appears in
  `world.audio_loops` until `api.audio.stop(handle)` or `api.audio.stopAll()`,
  like an effect. At most 64 loops may be live at once.

`options` takes `volume` (0–1), `speed` (>0), `category`, and `x`/`y` for a
positional sound the host may pan on.

### Categories are the part the engine owns

The engine does not name `bgm` or `sfx`; the taxonomy is the game's. What it
owns is what happens **between** sounds, declared in `project.unone.json`:

```json
"audio": {
  "categories": {
    "bgm": { "exclusive": true, "fade_in_frames": 30, "fade_out_frames": 30 }
  }
}
```

`exclusive` means starting a loop in that category begins stopping the ones
already in it. A fade is counted in frames by the engine, so a stopped loop
stays in `world.audio_loops` marked `fading_out` for exactly
`fade_out_frames` more frames and then leaves — the same frame in every replay.
Each loop publishes `phase`, `phase_started_frame` and `phase_frames`, so a host
reads the gain off the frame it is drawing instead of scheduling a ramp.

`max_concurrent`, `on_limit`, `ducking`, `priority` and `exclusive_group` are
**reserved names this build does not implement**. Declaring one fails the load
with `AUDIO_RULE_NOT_IMPLEMENTED` rather than doing nothing quietly.

The asset manifest takes an `audio` kind. Tests assert sound without listening:

```json
{"audio": {"events": [...]}}
{"audio": {"loops": [...]}}
```

A game that never calls `api.audio` observes exactly what it did before these
fields existed — both are omitted from the snapshot, so existing digests are
unchanged.

### The parts every engine has

- **Bus volumes.** A category is also a mixer group: it has a `volume`, and
  `api.audio.setCategoryVolume(name, v)` / `api.audio.setMasterVolume(v)` move it
  at runtime — the two sliders on a settings screen. The host multiplies source
  volume by category level by master level. The mix is published as `audio_mix`
  **only once it leaves its declared default**, so a game that never touches it
  observes what it always did.
- **Pause.** `api.audio.pause(handle)` / `resume` / `pauseAll` / `resumeAll`. A
  paused loop is still there and still holds its place in a fade: the deadline
  moves with it, so leaving a pause menu continues from exactly where it stopped.
  Pause is not stop; a paused loop still counts against the 64 and still needs a
  stop.
- **A sound attached to an entity.** Pass `entity` in the options and the engine
  keeps the source on that entity's position every frame, and stops it when the
  entity is gone — leaving it playing where the entity used to be is the
  behaviour nobody wants and everybody has to write around.

There is deliberately no mute switch: remembering the volume you had before is
game state, not engine state.

The engine does not decode, mix, resample, apply attenuation, or know a clip's
length, and it never reports whether a sound is audible: a muted player is still
in the same game state.

## 3.8 Understand the screen (when the game plan requires UI)

Headless observation is not actual screen validation. Publish a UI tree and use the preview below only when GAME_PLAN requires UI. A project without UI receives `not_applicable` for the layout gate in `verify`; do not create UI or save data just to satisfy the gate. For projects with UI, rendering the UI tree as character cells gives people and models a deterministic diagnostic that can be included in tests without a GPU, fonts, or a window; the actual host screen still requires separate validation.

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary ui preview
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary --json ui preview --frames 60 --strict
```

Without `--json`, the command outputs Markdown: an ASCII diagram, a node table, and findings. `--frames` controls how many frames run before rendering (default 1), while `--cols`/`--rows` adjust the grid size.

For projects with UI, `verify` renders only the **opening screen** by default (1 frame with no input), so win and lose screens are not checked. To cover other screens, declare `ui_previews` in `project.unone.json`, using the same approach as `test_files`:

```json
"ui_previews": [
  { "name": "aim",  "frames": 1 },
  { "name": "win",  "frames": 540, "seed": 42, "input_sequence": "tests/win-sequence.json" },
  { "name": "lose", "frames": 540, "seed": 42, "input_sequence": "tests/lose-sequence.json" }
]
```

Each declaration becomes an independent `layout:<name>` gate. **Each step lists the node IDs actually present on that screen**. If two declarations list exactly the same nodes, they almost certainly ran the same screen twice, creating a gate that proves nothing. The engine reports this fact but does not judge it for you.

`UI_NODES_OVERLAP` reports two node rectangles intersecting; the diagram marks
the intersection with `#`. Explicit scoped backgrounds accept only their later,
fully contained descendants, and exact-pair policies accept only their validated
artwork pairs. Remaining collisions still make `--strict` return `ok=false` and
a non-zero exit code. A project without UI is `not_applicable` in `verify`;
direct `ui preview --strict` may return `UI_TREE_NOT_PUBLISHED`, so do not add UI
for that reason. Overlap findings recommend an axis and direction for review;
the engine does not move the nodes. Diagnostic work limits can also make an
inspection incomplete; they do not certify a clean layout.

The node table also includes `text fit`: a rough estimate of how many times the
text occupies the declared width. It assumes a 16:9 viewport and 0.5 character
advance, uses explicit styled font size/letter spacing/padding when present, and
otherwise uses legacy box height. It does not measure host fonts or wrapping and
is never a pass/fail verdict. Above 1.0 calls for visual review and an authored
size/wrap/clip choice; styled text never auto-shrinks. The entry conditions for
adding a rule are in Decision 0029.

It checks only **structure**: rectangle intersections and explicit background
intent, rather than visual quality or measured glyph coverage. The world layer
(sprites and entity positions) does not yet have a corresponding textual check.

## 3.7 Find what one change changed

A changed digest means only that “something is different”; it does not identify the frame, field, or value. Record a baseline, then replay and compare after the change:

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json replay record --output baseline.json --frames 90 --seed 42 --input-sequence tests/spin-sequence.json
# ...modify the game...
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine replay diff --baseline baseline.json
```

Report the **first frame that differs**, along with the dotted path of every differing field in that frame:

```text
## Replay diverged at frame 59 of 90

| field | baseline | current |
| entities.reel-3.animation.animation | "run" | "idle" |
| observations.view_model.last_win | 0 | 1 |
| ui.children[3].text | "2" | "4" |
```

Compare fields only at the **first** divergent frame. Every later frame inherits the difference, so listing all of them would bury the cause in noise. Recordings contain no wall-clock time, so a slower machine is not misclassified as a divergence.

## 3.9 Measure performance

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary perf --frames 600 --seed 3
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary --json perf --frames 600
```

Report where a frame's time goes: total time, mean, and share for the `script`/`physics`/`observe` phases; frame-time mean/median/p95; the index of the slowest frame and its phase breakdown; the number of frames over the fixed-timestep budget; Luau heap size; and the amount of content in one frame (entities, rigidbodies, UI nodes, effects, and observations).

The `run --json` result includes the same `performance` report.

Two properties are important:

- **Measurement uses wall clock and does not enter the observation digest.** Measuring performance does not change the meaning of a run; the digest for the same seed and input is exactly the same as without measurement.
- **It provides numbers, not a verdict.** Whether it is “fast enough” depends on targets unknown to the engine. `frames_over_budget` is a fact measured against the fixed timestep, not a passing threshold.

A debug build measures debug costs; compare versions using the same build type.

## 4. Inspect bundles

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle pack
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle install script
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle inspect
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle install --all
```

For a new project, start with `bundle pack` to generate the minimal project/script/scene manifest. If an asset manifest exists, it also produces a deterministic, uncompressed content bundle and rejects unresolved main-scene asset references. The tool writes `bundle_manifest` into `project.unone.json` automatically; it does not increment the manifest version when content is unchanged, and increments it only when content changes. Bundle success means more than that files exist: confirm the manifest hash, cache hash, active generation, dependencies, and `available`. Use `bundle install --all` when the whole generation is required; use `bundle install <id>` for one bundle, and do not treat single-bundle installation as full activation. The engine's `BundleFetcher` accepts only a reader supplied by the host, then performs streaming size/hash verification, staging, and atomic activation. The native CLI uses a local source; Web/mobile fetching, retries, storage quota, and background-download policy remain in the host adapter. The generic Web runner resolves image assets from the verified content bundle and keeps URL lifetime in the host; production CDN, OPFS, large-file streaming, and quota policy are still outside engine core. The Web sample's browser generation/cache smoke is documented in `docs/decisions/0016-bundle-generation-and-browser-storage.md`.

## 4.5 Create, publish, and inspect assets

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset init --id asset://characters/bird/red --source assets/characters/bird/red.svg
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json bundle pack
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset inspect --strict
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json bundle install --all
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset describe --id asset://characters/bird/red
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset read --id asset://characters/bird/red
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset read --id asset://characters/bird/red --output D:/tmp/red.svg
```

The order above is “create the actual source/companion bytes first, declare them with `asset init`, then `pack`, strict inspect, `install --all`, describe, and read.” `asset init` is append-only and adds a declaration only for a new ID. To modify an existing stable ID, edit the original manifest entry's `source`/`files` (and any other required declaration fields) directly, preserve the ID, and do not use `asset init` to change the existing entry. It does not create images or other art; it reports the actual `changed_files` for this operation, and failure effects still list writes that already occurred if a later write fails. Replacing the source for the same stable ID does not require changing scene references; moving a source or companion requires changing the manifest path; scene size, pivot, and placement are separate authoring changes.

`asset describe --id` is a read-only, single-asset workflow query. It reports the manifest entry, primary/companion paths, roles, existence, readable size/hash, shared paths, main-scene JSON pointers, the `main_scene_only` static scope, `native_local` active verified files, and `matches_authoring` plus ordered `required_next_actions` for the `selected_asset_native_local` scope. `matches_authoring=true` means only that this asset's active bytes match authoring; it does not mean all game content, other hosts, or the whole release has been updated. Do not treat `false` or `null` as true. When the manifest, source, or companion is missing, fix authoring and then run pack, strict inspection, install, describe, and read in order. If the latest formal active record is damaged, `install`, `describe`, and `read` all fail closed. This is a manual prerequisite for the host/operator to repair from a trusted backup based on diagnostics; report a blocker when no backup exists. Do not clear the cache, delete `.unone`, roll back to an older generation, or fabricate a record. Only cache/archive corruption or an authoring bundle manifest that has not yet been published follows `pack → strict → install --all → describe → read`.

`asset read` retrieves one declared asset from the verified bundle in the current active generation and reports `size_bytes`, `sha256`, and `bundle_generation`. It writes a file only when `--output` is provided. It uses the same archive contract and error codes as the Web host's `readActiveAsset`: `BUNDLE_GENERATION_MISMATCH` (not installed or the manifest changed), `BUNDLE_CACHE_MISS`, `BUNDLE_CACHE_CORRUPT`, `ASSET_ID_NOT_DECLARED`, `ASSET_NOT_IN_BUNDLE`, `ASSET_ARCHIVE_INVALID`, and `ASSET_CONTENT_CORRUPT`. Both sides also validate the archive entry's own sha256, so the same asset ID must produce the same `sha256` on Web and native; a mismatch is a bundle or host problem, not a screen problem. See the [asset workflow contract](asset-workflow.md) for the complete fields and safe-path rules.

The engine returns only verified bytes and facts. Decoding, texture upload, downloading, retries, cache capacity, and CDN/OPFS policy remain in the host. The packaged native player resolves verified `sprite.asset` bytes and renders PNG, JPEG, WebP, and bounded static SVG textures; it also provides the built-in `mesh://primitive/box` and `mesh://primitive/sphere` meshes without requiring manifest entries. `asset read` remains a data-integrity result, not a visual acceptance result: use the native report or a captured frame to prove that a specific host actually drew the asset.

## 5. Native preview

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview --watch
```

`--watch` waits for file metadata changes, then attempts to load the entry Luau script on the next waiting frame. On success it preserves Rust-owned world state and switches the script generation; on failure it prints a semantic diagnostic and continues using the last working script until the file changes again. Script generation counts reloads in that runtime; it is not the bundle active generation or another host's generation, so do not compare the numbers to decide whether content is synchronized. Arrow keys or A/D update Luau input. Escape or closing the window exits. This preview is a runtime smoke client, not an Editor. The packaged native player is the visual acceptance path for textured meshes, sprites, particles, Bloom and native audio; Spine/Effekseer still require their dedicated host runtimes.

Without `--watch`, you can also start a one-shot native preview; use `--watch` when AI needs rapid edit-and-observe iteration.

Use the single semantic Camera for both 2D and 3D projects. Choose
`orthographic` for a 2D-compatible view and `perspective` for a 3D view; the
old `camera3d.*` calls are compatibility aliases only. Inspect the semantics
before writing the script:

```powershell
cargo run -p unone-cli -- --json api describe entity.getTransform3D
cargo run -p unone-cli -- --json api describe entity.setTransform3D
cargo run -p unone-cli -- --json api describe camera.getTransform
cargo run -p unone-cli -- --json api describe camera.setProjection
cargo run -p unone-cli -- --json api describe camera.setTransform
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json test
```

To validate the Web source host for an actual game project, start `python scripts/serve-player.py --directory .. --port 8001 --no-cache` from the engine repo root (`D:/Projects/Unone` in this example), then open `http://127.0.0.1:8001/Unone/web/runner/?project=/Unone_Games/3d-racing/`. The server root is `D:/Projects`, containing both engine and game directories. For a project with a bundle manifest, the same runner installs the content-addressed generation, reads the verified project/script/scene, consumes 2D/3D snapshots and UI, and can reinstall the current generation and run Luau hot reload with `Install / reload active bundle`. When the game publishes a save payload, the host persists it in a project-isolated IndexedDB store and outputs `save_store.loaded` so AI can confirm that it was actually loaded; use `?bundle=0` only to diagnose source fallback. This is generic host smoke. It does not require mobile validation for the Web slice. Without asset CDN, OPFS/production quota policy, or content-change hot-update evidence, do not mark the Web final gate passed; actual mobile-host evidence is a separate deferred track.

## Output rules

- Use `--json` when a machine action is needed.
- `facts` are facts observed by the engine; `likely_causes` are inferences; `suggested_actions` must map to the next CLI/protocol action.
- By default, the trace records semantic events rather than every frame, so AI context is not overwhelmed by noise.
- `run` retains lifecycle traces from runtime load/reload, such as `api.log` and `script_reloaded`; these events are not per-frame telemetry.
- If a tutorial command cannot be rerun from a clean checkout, fix the documentation or create an issue; do not retain an incorrect claim.
