# Official responsive UI layout

Use `api.ui.components.createResponsiveLayout(options)` or the same method on a
themed `UiComponentKit` for shared, explicit responsive composition. Declare
`"runtime_packages":{"@unone/ui":"0.6.0"}` in `project.unone.json`. The package
selects an authored aspect variant and calculates slot, row, column and grid
regions; projects supply semantic groups, breakpoint thresholds, content and
styles. Existing leaf/component constructors keep their explicit placement
contract. Calling this helper is the opt-in layout step.

```powershell
game api search "responsive layout"
game api search "adaptive UI layout"
game api search "breakpoints"
game api search "row column grid layout"
game api search "自適應排版"
game api search "響應式斷點"
game api describe ui.components.createResponsiveLayout
game api typings
```

CLI and MCP share these discovery routes. Use the canonical
`UiResponsiveLayoutOptions<T>`, `UiResponsiveVariant<T>`, `UiResponsiveLayout<T>`,
`UiResponsiveLayoutResult<T>`, `UiLayoutNode` and `UiViewport` types. Refresh the
marked type block with the [safe upgrade command](ui-components.md#keep-the-official-types-when-upgrading)
instead of inventing a handwritten `any` wrapper. Use the exact package version
bundled with the selected Core and SDK; a declaration cannot upgrade an older
runtime.

## Create once, resolve in a pure View

`createResponsiveLayout` snapshots its options. Retain the model and call
`model.resolve(api.ui.getViewport(), bounds?)` when building a View. The result
has `variant`, a copied `values:T`, `rect(id)` and `viewport(id)`. Resolve does
not publish UI, mutate nodes, advance a simulation tick, consume input or RNG,
or change a virtual collection's registration. It is safe in a UI-pure
`renderItem` callback; create reusable models outside that callback.

The following complete entry body goes **after the canonical API type block**.
It creates the kit and model once, then explicitly publishes ordinary official
nodes. The two variants share semantic region IDs. Font sizes are authored
values, independently of the rectangle calculation.

```luau
type Presentation = {fontSize: number}
local Game = {}
local kit: UiComponentKit? = nil
local model: UiResponsiveLayout<Presentation>? = nil

local function layoutTree(wide: boolean): UiLayoutNode
    if wide then
        return {id="root",kind="column",gap=3,
            padding={left=4,top=4,right=4,bottom=4},children={
                {id="heading",kind="slot",size=12},
                {id="body",kind="row",gap=4,children={
                    {id="apply",kind="slot",size=28},
                    {id="items",kind="slot"},
                }},
            }}
    end
    return {id="root",kind="column",gap=3,
        padding={left=4,top=4,right=4,bottom=4},children={
            {id="heading",kind="slot",size=12},
            {id="body",kind="column",gap=3,children={
                {id="apply",kind="slot",size=8},
                {id="items",kind="slot"},
            }},
        }}
end

local function publish(api: EngineApi)
    local ui = assert(kit)
    local resolved: UiResponsiveLayoutResult<Presentation> =
        assert(model).resolve(api.ui.getViewport())
    local rows: {UiNode} = {
        ui.text({id="first",text="First item",
            rect={x=0,y=0,width=40,height=8},
            style={font_size=resolved.values.fontSize}}),
        ui.text({id="last",text="Last item",
            rect={x=0,y=120,width=40,height=8},
            style={font_size=resolved.values.fontSize}}),
    }
    local list = ui.scrollView({id="items_scroll",
        viewport=resolved.viewport("items"),content=rows,
        inertia=true,deceleration=8})
    api.ui.setRoot(ui.screen({id="settings",node="settings",children={
        ui.text({id="title",text="Settings",rect=resolved.rect("heading"),
            style={font_size=resolved.values.fontSize,font_weight=700}}),
        ui.button({id="apply_button",text="Apply",action="ApplySettings",
            rect=resolved.rect("apply"),
            style={font_size=resolved.values.fontSize}}),
        list,
    }}))
    api.observation.set("ui_variant",resolved.variant)
end

function Game.start(api: EngineApi)
    kit = api.ui.components.create()
    local options: UiResponsiveLayoutOptions<Presentation> = {
        variants={
            {name="compact",minAspect=0,layout=layoutTree(false),
                values={fontSize=2}},
            {name="wide",minAspect=1.3,layout=layoutTree(true),
                values={fontSize=2.6}},
        },
    }
    model = assert(kit).createResponsiveLayout(options)
    publish(api)
end

function Game.update(api: EngineApi, _dt: number)
    if api.input.wasPressed("ApplySettings") then
        api.observation.set("applied",true)
    end
    publish(api)
end

return Game
```

The sample's breakpoint and font sizes are examples of project policy. The
package ships no default device categories, theme, font scale or card width.
For virtual collections, pass `resolved.viewport("items")` to `virtualList` or
`virtualGrid`; retain the existing live node and stable item identities. The
layout model returns geometry, never copies or replaces a registered node.

## Variants and typed values

`options` has `space?:"stage"|"scroll"` (default `"stage"`) and a dense,
nonempty `variants` array. Each variant requires `name`, `minAspect`, `layout`
and `values:T`; use `{}` for values if no presentation values are needed.

- Names are nonblank and unique. Thresholds are finite and nonnegative, the
  first is exactly `0`, and subsequent thresholds are strictly increasing.
  Declaration order is meaningful; unsorted variants are rejected.
- Resolve requires a finite positive `viewport.aspect` and selects the highest
  `minAspect <= aspect`. The boundary is inclusive: at exactly `1.3` the sample
  selects `wide`; below it the fallback is `compact`. There is always a declared
  fallback, rather than a hidden desktop/mobile rule.
- `values` is a complete project-owned typed record for each variant. It is not
  merged with another variant. Use it for font sizes or other authored View
  choices; keep domain state and mutable controls outside the model.
- Mutating the original options after creation does not change the model.
  Returned values and rectangles are defensive copies. Resolve again for a new
  snapshot; no implicit subscription or reactive scheduler is installed.

## Region tree and sizing

Every node has a nonblank stable `id` unique **within its variant** and a `kind`.
IDs can repeat across variants to give a View one stable semantic lookup.
`rect(id)` and `viewport(id)` reject unknown IDs. Regions describe bounds only;
they create no UI nodes, IDs, styles, action bindings, clipping or backgrounds.

| Kind | Required fields | Optional fields and sizing |
| --- | --- | --- |
| `slot` | `id`, `kind="slot"` | Child `size` or `grow`; no children, padding, gap or columns. |
| `row` | `id`, `kind="row"`, nonempty dense `children` | `padding`, `gap`; children go left-to-right. |
| `column` | `id`, `kind="column"`, nonempty dense `children` | `padding`, `gap`; children go top-to-bottom. |
| `grid` | `id`, `kind="grid"`, nonempty dense `children`, `columns` | `padding`, `gap`; equal cells in row-major order, with fixed declared columns. |

The root fills `bounds`; it rejects `size` and `grow`. A row/column child may
declare a positive finite `size` on its parent's main axis, or a positive finite
`grow` weight. The two fields are mutually exclusive. When neither is supplied,
the weight is `1`. After padding, gaps and fixed sizes, grow children divide the
remaining extent proportionally and fill the cross axis. A row's fixed `size`
means width; a column's means height. This also applies when a child is itself a
row, column or grid.

`padding={left,top,right,bottom}` has finite nonnegative edges, omitted edges
defaulting to zero. `gap` is finite nonnegative and defaults to zero. A
container's own returned region is its **outer** bounds; its children use the
padded inner bounds. Use a separate slot when you need a named inner area.
Fixed sizes, padding and gaps must leave positive child extents; overflow is a
diagnostic, not a request to shrink or clip children silently.

Grid `columns` must be an integer `1..256`. Rows are `ceil(childCount/columns)`;
columns remain as declared even when the last row is incomplete. Each child
gets the same cell size; grid children reject both `size` and `grow`. The one
`gap` applies between both rows and columns. Grids do not infer columns from
width, wrap content, measure text or perform masonry layout. Choose different
`columns` in explicit variants when the semantic arrangement calls for it.

Unknown fields, malformed/sparse arrays, duplicate IDs, invalid combinations,
non-finite values and invalid geometry fail with named diagnostics. A failed
resolution does not silently switch variants or rewrite the published tree.
The canonical recursive record preserves contextual `kind` literal inference in
ordinary nested authoring tables. Strict Luau guides field names, kind values
and generic presentation values; the factory validates kind-dependent fields,
numeric and cross-field rules. Do not cast to `any` to bypass diagnostics.

Models accept at most 4096 total layout nodes across all variants, with a layout
depth limit of 32. Arrays are dense, plain and nonempty, with at most 4096
entries. Options, geometry and values reject metatables and cycles. Presentation
values contain portable strings, booleans, finite numbers and plain tables;
functions, controls and engine objects belong outside the model. Values copying
has a depth limit of 32 and a work budget of 131072 visited keys/values.

## Coordinates, scroll content and style lengths

`resolve(viewport,bounds?)` takes `bounds` as a `UiViewport`:
`{left,top,width,height}`, top-left/y-down in both spaces. It defaults to
`{left=0,top=0,width=100,height=100}`. Width and height are finite and positive;
origins are finite and nonnegative. Stage bounds must fit `0..100`. In explicit
`space="scroll"`, bounds may extend beyond `100` for local scroll content.

| Lookup | Default `space="stage"` | Explicit `space="scroll"` |
| --- | --- | --- |
| `result.rect(id)` | Stage `UiRect`, y-up: `y=100-top-height` | Scroll-local `UiRect`, y-down: `y=top` |
| `result.viewport(id)` | Top-left/y-down viewport in stage space | Top-left/y-down viewport in current scroll content |

Use `rect` for ordinary leaves and `viewport` for scroll helper options. Do not
convert y a second time. A component still preserves its children's coordinates;
the responsive helper does not establish a component-relative origin. A nested
scroll viewport starts its own content space according to the
[scroll contract](ui-scroll.md).

Layout lengths are **per-axis rectangle units**: x, widths, horizontal gaps and
horizontal padding use percent of stage width; y, heights, vertical gaps and
vertical padding use percent of stage height. They are not percentages of the
parent region and are not `UiStyle` vertical design units. For example a grid
`gap=2` uses two horizontal units between columns and two vertical units between
rows. It need not appear square in pixels. Font size, border width and style
padding keep their separate [vertical design unit contract](ui-styling.md).

To arrange a finite scroll body, create a separate model with `space="scroll"`
and resolve explicit content bounds such as
`{left=0,top=0,width=60,height=160}`. Its rectangles can be supplied to ordinary
scroll content. For a virtual row, use `space="scroll"` and cell-local bounds;
the virtual helper adds the row/column offset. Do not add that offset yourself.
The helper does not measure content extent or choose virtual row heights.

## Validate the official player

Run strict analysis and normal `verify` / `project prepare` gates with the
matching SDK/runtime, then inspect the exported official player. Check below,
at and above every threshold, intermediate aspects, and desktop/portrait sizes.
Keep actual text, long translations, scroll clipping, Slider capture and stable
virtual identities in the sample. Headless geometry checks do not prove target
glyph coverage or text fit. Layout support does not extend host capabilities;
the official native player still explicitly rejects scrolling.
