# HTML view importer

Convert one rendered DOM element into a native Unone UI tree at one or more design viewports. Chromium runs on the author's machine to resolve the HTML, CSS, fonts and image sizes. The game's shipped UI consists of native nodes, actions, text and PNG textures. Runtime JavaScript behavior stays in the source application and must be implemented in the game.

## Run the example

Use Node 20 or later. In `tools/html-view`, install the pinned browser client with `npm install`. With no browser override, the importer tries Playwright's installed Chromium, then system Chrome, Edge and Chromium. You can install the matching browser with `npx playwright-core install chromium` or specify an executable using `--browser /path/to/chrome` or `UNONE_CHROMIUM`. An existing Playwright installation can be selected with `UNONE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs`. The viewport defaults to 1280×720.

```sh
game ui import-html --file example/home.html --selector '#home' --out generated
node cli.mjs --file example/home.html --selector '#home' --actions example/actions.json --viewport 720x400 --viewport 400x720 --touch --out generated
node --test test.mjs
```

From a complete SDK, invoke the same entry point via `game ui import-html` with the same flags. All input and output paths resolve relative to the calling shell. Use `--url http://127.0.0.1:8080/scene` for a source project served by its development server, including pages that load ES modules. The selector must identify one visible element. A file URL works for self-contained HTML, CSS and local images.

## Set the source state

Use `--prepare ./setup.mjs` to open a specific dialog, populate example data, await app initialization or name content for later native updates. Preparation runs after navigation and before font and image measurement for each viewport. For example:

```js
export default async function prepare(page) {
  await page.locator('[data-profile]').waitFor();
  await page.locator('[data-profile] .name').evaluate(el => { el.dataset.unoneBind = 'userName'; });
}
```

`--touch` uses a touch-capable browser context. Viewports are CSS pixels with a device pixel ratio of 1. The source's media queries and flex/grid layouts run for each size. Animation playback pauses at capture time. Export additional source states explicitly for controls that change appearance.

## Wire the result into a game

- `views.json` and `views.luau` describe the same data. Choose a design view by its `WxH` key and pass `view.root` to `api.ui.setRoot`.
- Copy the generated PNGs at their declared paths, preserving `assets/` or adjusting the paths, and merge the root-level `assets` entries into your project's asset manifest. Entries use content-addressed texture IDs and can be shared by nodes or viewports.
- `view.viewport` records the source browser size. `view.bounds` records the selector's CSS-pixel rectangle in the browser viewport, with the origin at the upper left. `view.width` and `view.height` are that rectangle's dimensions. All native node rectangles are relative to the selected element, in Unone's 0–100 stage space with Y increasing upward. Use the bounds when placing the imported element into a larger scene.
- `view.bindings[name]` lists the generated node IDs in an element marked `data-unone-bind="name"` and its descendants. Update the text or asset for the relevant ID in game code. Node array order follows the source paint traversal.
- For a safe-area layout, select the design using the aspect ratio of the safe content. When stretching that design to a narrower aspect, multiply its text size and letter spacing by `min(1, contentAspect / designAspect)` before scaling to the safe height. Text uses height units while line boxes use the available width. This keeps trailing glyphs inside tight labels.
- Map CSS selectors to action strings in `--actions` as shown in `example/actions.json`. Alternatively set `data-unone-action` on a source element. The first matching selector takes precedence. Declare the actions in your project and handle them with the game's usual input API. Disabled controls retain their appearance. Anchors or buttons without a mapping retain their visuals and produce an authoring note.

```lua
local imported = require("./views")
local view = imported.views["720x400"]
api.ui.setRoot(view.root)
if api.input.wasPressed("StartGame") then
    startRound()
end
```

## What is transferred

Solid boxes and uniform solid borders become panels. Visible direct text nodes, including text inside inline spans and mixed text surrounding them, become separate native text runs at the measured line locations. Each run can use the free space to its right within the content box, up to the next visible element or clipping edge, so fonts with a larger advance can display their final glyph. CSS system UI and generic sans-serif families use the game's configured native presentation font. Named fonts retain the source family, size, weight, letter spacing, line height and color. Package the corresponding fonts and declare family/weight aliases for the desired native glyphs and metrics.

Single-line, text-only mapped buttons with simple box styles become native buttons. More complex controls retain their native image, decoration and text layers plus a measured input region for their action. Gradients, outlines, shadows, uneven borders and different corner radii are drawn into isolated box-only transparent PNGs. Children and text are never included in a decoration capture. Visible image elements become independent PNG textures.

## Scope

This is an authoring-time import of static, measured layouts. Between exported sizes the game chooses a design or implements responsive behavior. Browser layout, CSS reflow, DOM listeners, form editing, focus traversal, scrolling, hover effects and JavaScript state machines need corresponding native behavior. Embedded documents, video, canvas, inline SVG DOM, generated pseudo-element content, rotated shapes, CSS filters, complex overlapping stacking contexts and bidirectional or vertical text need individual review. SVG referenced by a regular image can be rasterized. Ancestor overflow clips to a rectangle. Compare `view.warnings` and review the resulting view in the official player, especially if its font differs from Chromium's.
