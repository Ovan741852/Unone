# Official shared UI package

`@unone/ui` is the official, versioned pure Luau component package bundled with
Unone Core and the portable SDK. It constructs the existing typed UI tree for
`api.ui.setRoot`; the official Web/native players render that tree. Start here
for shared components, button components, card components and theme styles.
The project owns themes, content, application state, action meanings and geometry.
For an interactive numeric slider, start with `createSlider`: the official
control owns reusable drag/value mechanics, while the project decides what that
value means. For responsive composition, use `createResponsiveLayout` to share
breakpoint selection and row/column/grid geometry from authored definitions;
see [the typed responsive guide](ui-responsive.md).

## Discover and declare

```powershell
game api search "UI package"
game api search "shared components"
game api search "button component"
game api search "card component"
game api search "官方UI套件"
game api search "共用元件"
game api search "主題樣式"
game api search "create button"
game api search "slider component"
game api search "slider drag"
game api search "slider value"
game api search "滑桿拖曳"
game api search "scroll inertia"
game api search "捲動慣性"
game api search "responsive layout"
game api search "自適應排版"
game api search "下拉選單"
game api search "virtual list"
game api search "button click"
game api search "按下瞬間"
game api describe ui.components.info
game api describe ui.components.create
game api describe ui.components.button
game api describe ui.components.createSlider
game api describe ui.components.createResponsiveLayout
game api describe input.wasPressed
game api typings
```

CLI and MCP discovery share the same index. These searches lead to actual
`ui.components.create` / `ui.components.info` entrypoints. Control queries lead
directly to callable `ui.components.button`, `createSlider`, `combobox`, `scrollView`,
`virtualList` or `virtualGrid` descriptors. `"responsive layout"`, `"breakpoints"`,
`"row column grid layout"` and `"自適應排版"` lead to
`ui.components.createResponsiveLayout`, with types and coordinates rather than a
bare viewport getter. `"button click"`, `"button pressed"`,
`"按鈕點擊"`, `"按钮点击"`, `"按一下"` and `"按下瞬間"` lead to
`input.wasPressed`; `"release"` / `"放開"` lead to `input.wasReleased`, while
`"hold"` / `"長按"` lead to `input.isDown`. `"UI types"` / `"UI 型別"`
discover the canonical type route, and `"component relative coordinates"`
explains the unchanged-coordinate contract. `"font size"`,
`"text alignment"` and `"border padding"` still lead to `ui.setRoot` and the
[style contract](ui-styling.md); `"card background"` and `"component overlap"`
explain the canonical background scope checks.

Declare the exact bundled version in `project.unone.json`:

```json
{
  "runtime_packages": {
    "@unone/ui": "0.4.0"
  }
}
```

This is a project configuration fragment; keep the project's other fields.
`api.ui.components.info()` returns `UiComponentsInfo`: the bundled manifest
metadata (`name`, `version`, `kind`, `entry`, `api`, `license`) plus `declared`.
This works before a project declares the package. The package name is `@unone/ui`
and its current version is `0.4.0`. Calling other package helpers without declaring the
package reports `UI_PACKAGE_NOT_DECLARED` with the required fix. Unknown package
names, unsupported versions and disabled declarations fail explicitly at load.
Use the version shipped with the selected Core/SDK; there is no npm installation,
`require` import, filesystem module loader or dynamic package download.

The SDK includes the package source, documentation and canonical Luau types in
its verified inventory. An older runtime without this package cannot satisfy
the declaration; SDK preflight rejects that mismatch. A passing authoring
`verify` / `prepare` alone does not prove the selected exported runtime supports
the package or that a player rendered the result. Refresh the SDK, regenerate
`game api typings`, prepare/export and inspect the official target player.
New `project init` entries already inline the current canonical type contract.

### What strict types do and do not prove

The low-level `slider(props)` leaf's `value`/`min`/`max`/`step`/`onChange` and combobox
`value`/`options`/`selected`/`onChange` are typed as absent (`never?`). They are not
binding APIs. Put numeric configuration on `createSlider(options)`, publish
`control.view(props)` and call `control.update(api.input)` in `Game.update`;
see [the complete slider lifecycle](#interactive-sliders). The project authors
combobox option nodes and selection rules. A callback in any of these fields
fails strict analysis; no `onChange` callback is needed for slider dragging.

Luau uses structural table types, not an exact object schema. Strict analysis
alone does not reject every unknown field or prove the conditional placement
rule. Always supply `rect` or `anchor` plus `size`, then run `verify` and inspect
the actual official player. Missing/mixed placement and unknown props are
rejected by the shared constructor/runtime validation. Do not cast to `any` to
bypass a diagnostic or treat a successful type check as a runnable UI proof.

## Keep the official types when upgrading

Use `EngineApi` for `Game.start`/`Game.update`, `UiApi` for the publication API,
`UiComponentKit` for a created kit, and `UiNode`, `UiScreen`, `UiStyle` and the
per-constructor props for authored data. These are the canonical types returned
by `game api typings`; do not maintain a second handwritten `EngineApi` or use
`ui:any` to bypass mismatches. For example:

```luau
function Game.update(api: EngineApi, dt: number)
    local ui: UiComponentKit = api.ui.components.create()
    local action: UiButtonNode = ui.button({id="apply",text="Apply",
        action="ApplySettings",rect={x=60,y=10,width=30,height=8}})
    api.ui.setRoot(ui.screen({id="settings",node="settings",children={action}}))
end
```

New project entry scripts contain an explicitly marked canonical block. After
upgrading the SDK, safely refresh that block while preserving the surrounding
game code:

```powershell
game --project <game-root> api typings --update-script gameplay.luau
```

This command requires exactly one own-line `-- BEGIN UNONE API TYPES` /
`-- END UNONE API TYPES` pair. It rejects missing, duplicate or malformed
markers without writing. For an older unmarked script, obtain the contract
with `game api typings`, review its initial integration and add the marker pair
around only that canonical block. `--output <file>` writes a complete type
contract file; never point it at an existing game entry script. It cannot be
combined with `--update-script`. Run strict Luau analysis and the project's
normal verify/prepare gates after refreshing. A compositor must preserve these
types when it inlines game fragments.

## Construct typed leaves and components

```luau
local ui: UiComponentKit = api.ui.components.create({
    text={font_size=2.4,text_align="start",color={0.9,0.95,1,1}},
    button={font_size=2,background={0.08,0.2,0.3,1},border_radius=0.6},
    panel={background={0.025,0.045,0.07,1},border_color={0.2,0.4,0.6,1},
        border_width=0.1,border_radius=1},
})

local function actionCard(id: string, x: number, title: string, action: string): UiComponentNode
    return ui.component({
        id=id,component="game.action_card",rect={x=x,y=30,width=35,height=45},
        surface={kind="panel"},
        children={
            ui.text({id=ui.id(id,"title"),text=title,
                rect={x=x+2,y=60,width=31,height=8}}),
            ui.button({id=ui.id(id,"action"),text="Open",action=action,
                rect={x=x+2,y=35,width=31,height=8}}),
        },
    })
end

api.ui.setRoot(ui.screen({id="menu",node="menu",children={
    actionCard("menu/inventory",10,"Inventory","OpenInventory"),
    actionCard("menu/settings",55,"Settings","OpenSettings"),
}}))
```

The numbers and action names above are project choices. The package supplies no
default palette, fonts, breakpoint policy, manager or business behavior. Its
opt-in responsive model resolves authored region trees; components never arrange
their children implicitly.
A custom Luau factory such as `actionCard` composes the official kit; existing
factories that return canonical nodes directly remain valid.

`create(theme?)` returns a `UiComponentKit` with these methods:

| Kit method | Result and input contract |
| --- | --- |
| `ui.text(props)` | `UiTextNode`; canonical text fields including `id`, `text`, placement and optional `style`. |
| `ui.button(props)` | `UiButtonNode`; canonical button fields including `id`, `text`, `action`, placement and optional `style`. |
| `ui.createSlider(options)` | `UiSliderControl`; persistent numeric control with `view`, `update`, `getValue`, `setValue` and `cancel`. Preferred interactive slider. |
| `ui.createResponsiveLayout<T>(options)` | `UiResponsiveLayout<T>`; create once, then pure `resolve(viewport,bounds?)` selects authored variants and returns named rectangles/viewports and typed values. [Full contract](ui-responsive.md). |
| `ui.slider(props)` | `UiSliderNode`; low-level compatible semantic leaf with `id`, optional `text`, `action`, placement and optional `style`. It does not create a numeric controller. |
| `ui.combobox(props)` | `UiComboBoxNode`; `id`, optional `text`, semantic `action`, optional `expanded`, placement and optional `style`. The project authors the option list and selected value. |
| `ui.panel(props)` | `UiPanelNode`; canonical decorative panel fields, placement, optional box style and `background_for`. |
| `ui.image(props)` | `UiImageNode`; canonical image fields including `asset`, placement, optional `fit`/`slice`/`alt`, box style and `background_for`. |
| `ui.component(props)` | `UiComponentNode`; `id`, `component`, placement, optional `children` and `surface`. |
| `ui.screen(props)` | `UiScreen`; `id`, `node`, `children` and optional `budget`. A root has no placement or style; call `api.ui.setRoot(root)` explicitly. |
| `ui.scrollView(options)` | `UiScrollNode`; delegates to the existing finite-content helper with unchanged `UiScrollOptions`. |
| `ui.virtualList(options)` | `UiScrollNode`; delegates to the existing registered virtual-list helper with `UiVirtualOptions<T>`. |
| `ui.virtualGrid(options)` | `UiScrollNode`; delegates to the existing registered virtual-grid helper with `UiVirtualGridOptions<T>`. |
| `ui.id(instanceId,role)` | Stable `instanceId.."/"..escapedRole` string; role escapes `%` as `%25` and `/` as `%2F`. Both inputs must be non-empty. Also available as `api.ui.components.id`. |
| `ui.composeStyle(base?,override?)` | A fresh `UiStyle`; also available as `api.ui.components.composeStyle`. |

For virtual rows, use `UiVirtualOptions<ProjectRow>` or
`UiVirtualGridOptions<ProjectRow>` to check project-specific fields in `key` and
`renderItem` callbacks. Both the kit and legacy helper methods preserve the row
type. Bare options retain the previous `any` default for compatibility; prefer an
explicit row type for new code.

Every constructor above also exists directly on `api.ui.components`, with the
same props and no theme defaults: `api.ui.components.button({...})` is valid.
Use a created kit when sharing a theme, or module constructors when no theme is
needed. `api.ui.component` does not exist. Props omit `kind`; each constructor chooses its
canonical kind. Placement is **flattened**: pass `rect={...}` or both
`anchor="top_right",size={...}` directly on props, exactly as in `UiPlacement`.
A nested `placement` table, missing placement, or both forms is invalid for a
leaf/component. Responsive geometry is an explicit model result passed to these
placement fields, never a `layout` prop on a component. `createSlider` takes control configuration, and its `view`
requires an explicit `rect` in the current coordinate space. `screen` instead uses root props, and scroll wrappers retain
their `viewport` options. All canonical leaf fields remain available; virtual
wrappers retain the existing engine-managed scroll registry and add no gameplay
state or manager.

Components do not transform child coordinates. A component at `x=40` with a
child at `x=5` still places that child at stage `x=5`, outside the component; it
does not place it at `x=45`. In stage space children keep 0..100 coordinates with
y pointing up. Scroll content instead uses local top-left coordinates with y
pointing down; its viewport belongs to the containing coordinate space. Follow
[the scroll contract](ui-scroll.md) rather than adding a component-relative
transform. Child order is retained. Call
`responsiveModel.resolve(api.ui.getViewport())` in the project's pure View, then
use `result.rect(id)` for leaves and `result.viewport(id)` for scroll helpers.
Declare semantic groups and thresholds once; the official package performs the
shared selection and region arithmetic. Stage/scroll choice is explicit on the
model and does not transform a UI node. Read [responsive layouts](ui-responsive.md)
for fixed/grow sizing, equal-cell grids, padding/gaps, typed values and diagnostics.

## Read semantic actions

Buttons and comboboxes publish their `action` through the existing input system.
The same action can come from a mapped key or a headless test. Read it in
`Game.update` rather than passing an `onClick` function:

```luau
if api.input.wasPressed("ApplySettings") then
    applySettings() -- project-owned model change
end
if api.input.isDown("MoveRight") then
    moveRight(dt) -- project-owned continuous behavior
end
if api.input.wasReleased("Charge") then
    releaseCharge() -- project-owned release behavior
end
```

`wasPressed(action)` means down now and not down in the previous successful
tick; `wasReleased(action)` means up now and down previously. `isDown(action)`
means held now. All reads are non-consuming and stable within an update, so two
readers see the same edge. Only successful ticks advance the prior snapshot;
rendering, observations and virtual-scroll requests do not. Initially actions
are released, and omitted actions are released on the next input snapshot.
These are snapshot transitions, not a queued OS-event stream: an entire pulse
between snapshots is not buffered. Keep action meanings, selected options,
application model changes and screen transitions in project Luau. The kit does
not install callbacks or automatically modify an application model. A combobox's
`expanded` flag and option nodes remain authored state.

## Interactive sliders

Use `api.ui.components.createSlider(options)` or the same method on a themed
kit. Its stable ID must fit 1024 UTF-8 bytes. Create a control once in `Game.start` and retain it across updates; do not
recreate it while publishing a view or rendering a virtual row. Use canonical
`UiSliderControl`, `UiSliderOptions`, `UiSliderViewProps` and `UiSliderUpdate`
from `game api typings`.

The following is a complete entry body after the canonical type block. Its
rectangles, colors and initial setting are project choices. The separate track
panel demonstrates reusing the same rectangle for art and interaction; the
package does not invent a skin or arrange the controls.

```luau
local Game = {}
local kit: UiComponentKit? = nil
local gain: UiSliderControl? = nil
local volume = 72
local track: UiRect = {x=12,y=38,width=76,height=0.6}

local function publish(api: EngineApi)
    local ui = kit
    local control = gain
    assert(ui ~= nil and control ~= nil)
    local children: {UiNode} = {
        ui.panel({id="master_gain/track",rect=track,
            style={background={0.2,0.4,0.5,1},border_width=0}}),
        control.view({rect={x=12,y=42,width=76,height=8},trackRect=track,
            text="Master level: "..tostring(volume).."%"}),
        ui.button({id="reset_gain",action="ResetGain",text="Reset",
            rect={x=12,y=20,width=25,height=8}}),
    }
    api.ui.setRoot(ui.screen({id="audio_settings",node="settings",children=children}))
end

function Game.start(api: EngineApi)
    local ui = api.ui.components.create({slider={font_size=2,text_align="start"}})
    kit = ui
    gain = ui.createSlider({id="master_gain",value=volume,min=0,max=100,step=1})
    publish(api)
end

function Game.update(api: EngineApi, _dt: number)
    local control = gain
    assert(control ~= nil)
    local result: UiSliderUpdate = control.update(api.input)
    volume = result.value -- Apply this to the project's setting/model as needed.
    if api.input.wasPressed("ResetGain") then
        control.setValue(72)
        volume = control.getValue()
    end
    publish(api)
end

return Game
```

`createSlider` requires a stable nonblank `id` and finite initial `value`.
`min=0` and `max=1` are the defaults; `max` must exceed `min` with a finite
range. `step` is optional, positive and finite. Values are clamped and rounded
to the nearest step measured from `min`; both exact endpoints remain reachable
when the range is not divisible by the step. Omit `step` for continuous values.
Use `axis="vertical"` for a vertical track and `reverse=true` to invert the
direction; defaults are `axis="horizontal"` and `reverse=false`. After host
projection, horizontal values increase to the right and vertical values increase
upward before applying `reverse`.

`view({rect=...,trackRect=...,text=...,style=...,enabled=...,action=...,hitPadding=...})`
returns a `UiSliderNode`. It copies the explicit rectangles and themed slider
style, without changing the control's value or advancing interaction. `rect`
is required and locates the semantic label/field; `trackRect` defaults to `rect`.
Supply the rectangle used by the visible track when the skin places it
elsewhere. `hitPadding` defaults to `0.65`, must be finite and non-negative,
and expands all four track edges for input only. The final hit region contains
both this padded track and the field. These distances use the current rectangle
coordinate units, not CSS pixels or style vertical units: stage rectangles are
0..100/y-up, and scroll content is local top-left/y-down. Keep field, track and
padding within that coordinate space's valid bounds.

`enabled` defaults to `true`; `action` defaults to the control ID and is semantic
metadata, not a button-press binding for value changes. The official host projects
the field, track and hit region together, applies scroll clipping and foreground
hit testing, and captures the pointer until release or cancellation. Projects
do not duplicate pointer-down bookkeeping, screen-to-local conversion or drag
mapping. Keep geometry/configuration stable during a drag: removal, disablement,
viewport/clip or interaction-geometry changes cancel capture; text, style and
value updates do not.

Call `update(api.input)` once per control in `Game.update`. It reads the host's
non-consuming `getSliderInteraction(id)` snapshot and returns `value`, `changed`,
`dragging`, `started`, `released` and `cancelled`. Phase/ratio snapshots are stable
within the successful tick and absent on a later tick without new input; absence
does not end an active drag. A cancel never applies its ratio. Multiple readers
may inspect the input snapshot; they should not call the stateful control's
`update` repeatedly. `getValue()` is safe for repeated reads.

Use `setValue(number)` for an explicit model reset or external setting change;
it applies the same clamp/step policy. `setValue` and `cancel()` stop the current
control drag and ignore its remaining held drag/end snapshots until a new start.
Do not call `setValue` every frame to echo the control's own value. Virtual-list
controls must retain stable models by item key, update them during `Game.update`,
and call only `view` from UI-pure `renderItem` callbacks. Materialization must
never advance input or mutate project state.

The old `slider(props)` remains a low-level semantic constructor. Its
`value`/`min`/`max`/`step` and callbacks are unsupported; it does not create this
controller. New numeric controls should use `createSlider`, and skins can still
compose ordinary official panels/images around its view. Verify real dragging
on the visible track, movement outside the field, release/cancel and sliders
inside clipped scroll content on the intended official host.

### Scroll wrappers

Both the module and themed kit expose the same existing helpers. For example,
`ui.scrollView({id="help",viewport={left=10,top=10,width=80,height=80},content={}})`
uses the same options as `api.ui.scrollView`. The legacy `api.ui.scrollView`,
`virtualList` and `virtualGrid` entrypoints remain compatible. Container wrappers
have no theme `style`; virtual `renderItem` callbacks remain UI-pure, use stable
keys and return local nodes. Scrolling does not run `Game.update`. Current
native/legacy DOM hosts reject scrolling explicitly; package wrappers do not
expand host support.

Scroll helpers support optional drag inertia on the official Web host:

```luau
local list = ui.scrollView({id="help",viewport={left=10,top=10,width=80,height=60},
    content=helpNodes,inertia=true,deceleration=8})
```

The default is `inertia=false`; `deceleration=8` is the default exponential
velocity decay in inverse seconds, with a finite allowed range `0 < value <= 100`.
Higher values stop sooner. The same options exist on `virtualList` and
`virtualGrid`. Offsets remain clamped: there is no elastic overscroll or bounce.
See [scroll input, inertia and lifecycle](ui-scroll.md) for cancellation,
virtualization and host limits. Search `"scroll inertia"`, `"deceleration"`,
`"捲動慣性"` or `"慣性捲動"` to discover `ui.components.scrollView`.

## Theme copying and surfaces

`theme: UiComponentsTheme` accepts only optional `text`, `button`, `panel`, `image`,
`slider` and `combobox` `UiStyle`
defaults. There is no component-level style inheritance. Each leaf copies its
kind's defaults and then its explicit style; explicit fields win. Padding merges
by edge, while RGBA arrays replace as a whole. Neither style input, the theme,
props nor an earlier result is mutated. An omitted theme/style leaves `style`
omitted and retains canonical legacy fitting; an explicit empty style selects
[explicit typography defaults](ui-styling.md#coordinates-and-defaults).

Ordinary authored tables are copied. Nodes returned by the official
`virtualList` and `virtualGrid` helpers are engine-managed live handles: the
composer preserves their exact registered identity so later viewport requests
update the published tree. Do not clone or manually mutate those handles. The
exception is recognized by the engine's private registry, not by a node name or
an ID pattern; ordinary hand-authored nodes remain independent copies. Existing
[scroll lifecycle and purity rules](ui-scroll.md) continue to apply.

```luau
local base: UiStyle = {padding={left=1,right=1},color={1,1,1,1}}
local variant = ui.composeStyle(base,{padding={right=2},color={1,0.8,0.2,1}})
-- variant padding is left=1,right=2; base and both RGBA arrays remain independent.
```

A component's optional `surface` chooses `kind="panel"` or `kind="image"` and
accepts that kind's canonical `style`, `asset`, `fit`, `slice` and `alt` fields as
applicable. Image surfaces require an asset. The helper prepends one background
leaf with ID `id.."/surface"`, copies the component's explicit placement unchanged,
and adds `background_for={component=id}`. The remaining children keep their
coordinates and order. Reserve that generated ID when choosing child roles.
Omitting `surface` adds no background node.

The surface is ordinary canonical data. `setRoot` checks its ancestor, coordinate
space and bounds; strict preview exempts only later fully contained descendants.
Foreground collisions, partial coverage, unrelated siblings and later occlusion
still fail inspection. See [explicit background scopes](ui-styling.md#explicit-background-scopes).
The helper does not move, resize, clip, auto-layout or weaken overlap checks.
Canonical styles, bounds, image slicing and node budgets remain authoritative.

## Verify the actual player and fonts

Keep `renderer_mode: "official"` and inspect the exported player, including
readable type, overlap and real input at the target viewport sizes. See
[font packaging and coverage](ui-styling.md#package-a-font-catalog). A loaded
font face does not prove coverage for CJK, punctuation or arrows. The existing
`scripts/verify-ui-example-browser.mjs` observer can record real Web input,
screenshots, Canvas text and semantic snapshots; its local-export path runs
`scripts/audit-ui-fonts.py` against packaged font cmap tables. Both scripts are
included in newly packed SDKs. A project's plan can require packaged glyph
coverage. Inspect the screenshots as well as reports.

A pasted `<body data-player-...>` block is a host diagnostic HTML snapshot. It
can identify the official renderer and expose timings, but Canvas pixels are
not included in that text and the renderer marker does not prove a particular
UI package version. Use a screenshot to assess appearance, the read-only runtime
snapshot for the published tree/actions, and `ui.components.info()` for package
metadata. Do not replace the renderer or reconstruct the UI with DOM to make
these diagnostics readable.

### Optional browser observation tools

These tools are optional and do not add a mandatory project `verify` gate.
External prerequisites are **Node.js 22+**, **Playwright with an installed
browser** (its Chromium or a compatible installed browser), and **Python with
`fontTools`** for the font audit invoked by `--export`. The observer currently
requires a main-thread production Web runtime and an already published UI tree.
Prepare the official Web export first. To inspect it at a stable local URL,
run the bundled Python standard-library helper from the SDK root:

```powershell
python scripts/serve-player.py --directory 'D:/Exports/my-game-web' --port 8344 --bind 127.0.0.1 --no-cache
```

Or use `python (Join-Path $sdk 'scripts/serve-player.py')` with the same
arguments from another directory after selecting `$sdk` as in the SDK README.
Open http://127.0.0.1:8344/ and keep the server running. External static hosts
must also serve `.js` and `.mjs` with a JavaScript MIME type and `.wasm` as
`application/wasm`; a `.mjs` response with `text/plain` prevents module loading.

For acceptance of this actual served URL, save `{}` as `browser-plan.json` in
the SDK root, then run in a second terminal:

```powershell
node scripts/verify-ui-example-browser.mjs --url 'http://127.0.0.1:8344/' --plan browser-plan.json --out 'D:/Evidence/my-game-served-ui'
```

Replace the URL with the actual hosted address for external-host acceptance.
Omit `--export` in this run: it starts the observer's own server and overrides
`--url`. Type checking, headless replay and a passing self-hosted observer run
cannot verify the actual host's MIME configuration or prove that URL renders.
Review its screenshots and real input outcomes.

For a separate local-export check and packaged font cmap audit, the observer
can serve the export itself. From the SDK root, use the same plan and run the
following, replacing the export/evidence paths:

```powershell
node scripts/verify-ui-example-browser.mjs --export 'D:/Exports/my-game-web' --plan browser-plan.json --out 'D:/Evidence/my-game-ui'
```

Or use the script's absolute path from any directory. Plan, export and evidence
paths are relative to the working directory unless absolute. Playwright must be
resolvable from the script: when installed elsewhere, set
`$env:UNONE_PLAYWRIGHT_MODULE = 'D:/Tools/browser-qa/node_modules/playwright'`
to that installation. To use an installed Edge browser, set
`$env:UNONE_BROWSER_CHANNEL = 'msedge'`; otherwise Playwright uses its Chromium.
If `python` does not select the environment with `fontTools`, add
`--python 'D:/Tools/python/python.exe'` with its actual interpreter path.

The minimal `{}` plan visits desktop, intermediate and portrait sizes, records
screenshots, requires the official renderer and an advancing production runtime,
checks any declared font faces load, and rejects browser/asset errors. It does
not require packaged fonts, repeated components, wrapping or ellipsis. Font cmap
coverage is reported for a local export but becomes a failing requirement only
with `"requirePackagedGlyphCoverage": true`. This does not measure shaping or
prove appearance; review the screenshots. A `--url` run does not invoke the
local-export cmap audit.

To exercise a project action, replace **every `REPLACE_...` value** below with an
actual initial label, a unique public control ID and the resulting visible label.
`click` is a semantic node matcher; `name` labels the evidence step. This example
expects the same action to be available at all three viewport sizes.

```json
{
  "title": "Project UI acceptance",
  "initialExpect": {"text": ["REPLACE_WITH_INITIAL_LABEL"]},
  "steps": [
    {
      "name": "activate-primary-action",
      "click": {"kind": "button", "id": "REPLACE_WITH_CONTROL_ID"},
      "expect": {"text": ["REPLACE_WITH_RESULT_LABEL"]}
    }
  ]
}
```

The tool sends real pointer input and reads the resulting runtime tree; a match
does not change game state itself. Keep action handling in project Luau. For a
separate rerun of the audit with a recorded browser report:

```powershell
python scripts/audit-ui-fonts.py --export 'D:/Exports/my-game-web' --report 'D:/Evidence/my-game-ui/browser-report.json' --output 'D:/Evidence/my-game-ui/font-coverage.json'
```
