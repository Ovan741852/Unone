# Fresh-context public SDK UI authoring

Both independent projects use the maintained official `@unone/ui` **0.1.0** package. No SDK, documentation, runtime, renderer or package implementation was edited. Both sources and exports are frozen; hashes for 172 files are in `frozen-files.json`.

Discovery used only the supplied public SDK and official documentation. Primary queries were `api search "UI package"` and `api search "card component"`, followed by `api describe ui.components.info`, `api describe ui.components.create` and `api typings`. The exact declaration is `"runtime_packages":{"@unone/ui":"0.1.0"}`. The public entry point `api.ui.components.create(theme)` supplies the typed kit used by both projects. The official `ui-components.md`, `ui-styling.md`, `portable-sdk.md` and `ai-workflow.md` supplied the authoring contracts.

| Project | Composition | Source | Official Web export |
| --- | --- | --- | --- |
| Lantern Greenhouse | Warm ivory and herb green; two harvest cards, one `harvestCard` factory | `D:/TSProject/UnoneUiPackage-20261016/project-a/scripts/main.luau` | `D:/TSProject/UnoneUiPackage-20261016/project-a/dist/player/index.html` |
| Night Train Dispatch | Midnight blue and amber; two boarding strips, one `serviceCard` factory | `D:/TSProject/UnoneUiPackage-20261016/project-b/scripts/main.luau` | `D:/TSProject/UnoneUiPackage-20261016/project-b/dist/player/index.html` |

Themes, text, counters, actions and explicit rectangles belong to each project. The official kit supplies text/button/panel/component constructors, stable IDs, copied styles and scoped card surfaces. There are no images, added fonts, package implementation copies, custom HTML, replacement renderers or layout engines. Each project has two independent semantic counter buttons and edge detection so held input counts once.

Both projects passed standalone `check --types` and normal `verify` (all four gates, zero layout findings, 2/2 project-specific deterministic tests). Both `project prepare --target web` calls returned exit code 0 and `status: ready`, using `web-production-0` with `@unone/ui: 0.1.0` and renderer mode `official`. Strict checking used the explicitly configured `UNONE_LUAU_ANALYZER=D:/TSProject/Voidwake/engine/.toolcache/luau-0.734/luau-analyze.exe`. No Cargo was used. Browser interaction/rendering remains the parent QA step; authoring gates do not claim visual completion.

Browser QA should start with a fresh load, click the first button twice with a release between clicks, then the second once:

| Project | First button ID / action | Second button ID / action | Observation key | Expected initial → after clicks 1, 2, 3 |
| --- | --- | --- | --- | --- |
| A | `greenhouse/mint/gather` / `GatherMint` | `greenhouse/basil/gather` / `GatherBasil` | `greenhouse_counters` | `{mint:0,basil:0}` → `{mint:1,basil:0}` → `{mint:2,basil:0}` → `{mint:2,basil:1}` |
| B | `dispatch/harbor/board` / `BoardHarbor` | `dispatch/summit/board` / `BoardSummit` | `rail_counters` | `{harbor:0,summit:0}` → `{harbor:1,summit:0}` → `{harbor:2,summit:0}` → `{harbor:2,summit:1}` |

Design-space button centers (0–100, y points up): A first `(28.5,30)`, A second `(71.5,30)`; B first `(77.5,60)`, B second `(77.5,30)`. Both publish `ui_package={name:"@unone/ui",version:"0.1.0",declared:true}`. A's count leaf IDs are `greenhouse/mint/count` and `greenhouse/basil/count`; B's are `dispatch/harbor/count` and `dispatch/summit/count`.

Initial failures and corrections are retained honestly in `commands.ndjson`:

- Query `"button pressed"` returned no match (exit 0, `API_SEARCH_EMPTY`). An initial guessed `input.isActionJustPressed` describe failed (record 9, exit 1, `API_NOT_FOUND`). I then read the complete `api search ""` index and described the actual `input.isDown` API; project-owned edge detection uses that public method.
- Unmodified starter preflight failed for each project (records 14 and 24, exit 1, `SDK_RUNTIME_UNAVAILABLE`), naming missing `camera3d`, `physics2d` and `save`. Public `sdk inspect`/`systems list` diagnostics identified the installed capabilities. The final UI-only scenes use none of those systems, so documented `systems set --id ... --enabled false` calls disabled them. Starter particles were removed and that unused system explicitly disabled too. Package declarations remained intact; subsequent preflights and prepares passed.
- No authored Luau, layout or project-specific test gate failed. Additional PowerShell evidence-harness issues are documented in `tooling-notes.md`; they were not SDK failures.

`commands.ndjson` contains 41 CLI records with actual executable, argv, UTC start, exit code and complete raw output; `command-index.json` is the compact index. `prepare-a-summary.json` and `prepare-b-summary.json` retain runtime, launch, release root and gate results. Initial general CLI help was read before the logger existed and was rerun into record 41. The two initial public directory/document reads were read-only and are visible in the task tool transcript. No engine source, Rust, history, existing game, earlier agent output, Internet source or SDK `packages/*/src/*.luau` implementation was read. No agents, commits or pushes were created.
