# SDK-only UI author report

Status: frozen after successful normal verify and official Web prepare. Browser rendering/input QA belongs to the parent task and is not claimed here.

## Boundary

The author used only the frozen SDK's executable, official README/docs, public API search/describe/schema/typings commands, and the project created by public project init. The supplied luau-analyze executable was invoked indirectly by official verification; its surrounding checkout was not inspected. No SDK packages/*/src implementation, engine checkout source, Rust, history, other games, other agents' files, web research, Cargo, custom renderer, HTML UI, canvas UI code, automatic layout, or new images were read or authored. No subagents were spawned. This was an instruction-enforced boundary, not an OS sandbox.

## Deliverable and validation

- Project: ../probe
- Source: ../probe/scripts/main.luau (canonical EngineApi/UiComponentKit; strict mode).
- Export: ../probe/dist/player/index.html
- Package: @unone/ui exactly 0.2.0; runtime web-production-0; renderer_mode official.
- All control nodes, decorative panels, components, virtual list and screen use the official themed kit. No hand-built UiNode literals or public API bypasses.
- Four normal verify gates passed: strict types, assets, strict layout with zero findings, and 6/6 deterministic acceptance cases.
- Prepare reran all four gates and returned status ready, official renderer, trusted static launch descriptor.
- Acceptance covers one press across five held ticks plus release, two separated presses, repeated non-consuming edge reads, project-owned pointer drag to 80%, combobox expansion/selection, and stable preset-120 selection.
- These headless tests validate project behavior, not browser input delivery or rendered text.
- Input/source SHA-256 records: source-input-hashes.json. Prepare's complete output inventory and release hash are in commands.json.
- Source script SHA-256: a51bbd67452a70251e918309df63371520b221f57afcf97099727db61b25dd76.
- Release root: releases/f86f7e7f493b4351ad71b6316a1160bfdf11db78a1ab43d285e34b3255911e02/.

## Recorded errors and corrections

1. First scaffold verify reported LUAU_ANALYZER_NOT_FOUND. Set UNONE_LUAU_ANALYZER to the supplied executable D:/TSProject/Voidwake/engine/.toolcache/luau-0.734/luau-analyze.exe; untouched scaffold verify then passed.
2. First preflight reported SDK_RUNTIME_UNAVAILABLE, identifying missing camera3d, physics2d and save in the frozen runtime. The UI probe needs none, so those three are explicitly false. Particle was also disabled after removing the starter particle scene and call. Required @unone/ui declaration remains exact.
3. API search "test sequence" returned API_SEARCH_EMPTY. The API index addresses runtime APIs; public game schema test provided the actual input_sequence/assertion contract. No guessed test keys were used.
4. Some shell commands yielded a session ID before output. The following completion records contain final raw output; one interim preservation=false compares an empty pending output and is superseded by the completed preservation=true record.

## Safe official type refresh

Ran game --sdk <frozen-sdk> --project <probe> --json api typings --update-script scripts/main.luau after authoring game code. It recognized the single canonical marker pair and reported changed:false, 28778 bytes before/after. SHA-256 of the entire script with only the marked canonical block replaced by a fixed token matched before/after: 525BA184F86AAACB58ED66254057EC9C8389F48223CEECDF2CBBA22C56FE06E7. Followed with normal strict analysis, verify and prepare. No ui:any or handwritten EngineApi replacement was added. Canonical upstream types retain their own any fields in unrelated APIs and the virtual helper contract.

## Remaining ergonomic findings and limits

- The public project init scaffold enables three systems absent from this SDK's only runtime. Preflight gives specific diagnostics and a working correction, but a fresh UI author must discover and edit this mismatch.
- Portable verification still needs an external official analyzer or UNONE_LUAU_ANALYZER configuration; this run used the parent-provided executable.
- ui-scroll.md's older action example recommends project-owned edge detection, whereas ui-components.md and search expose the newer wasPressed/wasReleased queries. The newer route works and is used here.
- Canonical virtual-list items/callback types use any, so element typing is not preserved generically by the official contract. The project uses a concrete Preset callback annotation without weakening the EngineApi.
- The kit deliberately supplies constructors and style composition. A numerical slider requires project pointer capture/drag mapping; options and combobox selection also require project code. This probe adds those explicitly and does not claim a complete keyboard-accessible settings widget.
- A small single-file project carries about 20 KB of canonical API types. The marked official update command avoids overwriting game code but the block remains substantial.
- Layout is explicit stage geometry. This probe targets desktop Web; no responsive narrow-screen policy or CJK font coverage is claimed. Browser screenshots, scrolling, actual input and accessibility remain to be assessed by the parent.

## Browser QA handoff

Screen id settings-screen, route settings-probe. Stage coordinates are x-right/y-up 0..100; scroll viewport coordinates are top-left/y-down.

| Control | ID / action | Geometry |
| --- | --- | --- |
| Button | settings/apply / ApplySettings | rect x7 y64 width38 height8 |
| Slider | settings/volume / AdjustVolume | rect x7 y43 width38 height7 |
| Combobox | settings/quality / ToggleQuality | rect x7 y27 width38 height7 |
| Quiet option | settings/quality-Quiet / Quality_Quiet | rect x7 y20 width38 height5 |
| Balanced option | settings/quality-Balanced / Quality_Balanced | rect x7 y13 width38 height5 |
| Studio option | settings/quality-Studio / Quality_Studio | rect x7 y6 width38 height5 |
| Virtual list | preset-list | viewport left55 top28 width38 height60; rowHeight7 gapY1 |
| Preset rows | preset/preset-001 .. preset/preset-120 / Preset_preset-001 .. Preset_preset-120 | local x0 y0 width38 height7; helper positions them |

Initial state: volume45, quality Balanced, closed combobox, list selection none. Drag slider from stage (10.8,46) to (37.4,46) while pointer down to obtain 80. Continue dragging outside rect after initial capture to confirm clamping. Release clears slider_dragging.

Observations:
- ui_package_name, ui_package_version, ui_package_declared
- button_press_count, button_release_count, button_held_ticks, button_pressed, button_released, button_is_down, edge_readers_agree
- slider_value, slider_dragging, pointer_x, pointer_y
- combo_expanded, combo_selection
- list_row_count (120), list_selected_key, list_selection_count
- update_ticks (use to distinguish UI-only materialization from project ticks if the browser observer can pause the simulation)

For the button, inspect cumulative counters because pressed/released are one-tick observations. Hold should not create repeated project activations. A host may emit a one-tick semantic action pulse rather than maintain an action while the physical pointer is held; browser QA should report actual delivery semantics separately. List keys are stable semantic IDs generated once for named preset records, not derived from visible-row positions.

