# ScrollView and virtual collections (Web)

Start with the official [`@unone/ui` package](ui-components.md), declaring
`"runtime_packages":{"@unone/ui":"0.3.0"}` in `project.unone.json`. Use
`api.ui.components.scrollView` for small, irregular authored content,
`api.ui.components.virtualList` for long fixed-height rows, or
`api.ui.components.virtualGrid` for fixed-size cells. The same methods exist on
the `UiComponentKit` returned by `api.ui.components.create(theme?)`; use that kit
when the leaves share per-kind styles. Module constructors have no theme defaults.
All three helpers return a real `scroll_view` node; put it in the `children` of
a screen and publish with `api.ui.setRoot`.

The existing `api.ui.scrollView`, `api.ui.virtualList` and `api.ui.virtualGrid`
entrypoints remain compatible. Package wrappers forward the existing options,
registration and lifecycle; they add no layout, scroll-container theme style or
host capability. Search `game api search "scroll view"` / `"virtual list"` /
`"虛擬清單"` / `"scroll inertia"` / `"慣性減速"` and describe the matching
`ui.components.*` entrypoint.
Keep canonical `EngineApi`, `UiComponentKit` and `UiNode` types from
`game api typings`; see the [safe type refresh guide](ui-components.md#keep-the-official-types-when-upgrading).

## The coordinate rule

- `viewport={left,top,width,height}` is top-left/y-down in the containing space.
  At the screen level it is relative to the stage, not the browser window.
  Do not pass old stage `rect={x,y,...}` to a helper's viewport. The engine
  performs the y-up transport conversion; callers do not.
- Every content rect, including component children, is **local top-left/y-down**:
  `{x=0,y=0}` is the viewport's top-left before scrolling. x uses percent of stage
  width; y uses percent of stage height, not percent of the scroll viewport.
  A component does not introduce another relative origin or transform its
  children. Outside scroll content, ordinary stage children remain 0..100/y-up.
- Nested scroll viewports are local to the parent's content. Their children
  start a new local space. Anchors are rejected inside scroll content.
- All content x/y must be non-negative. Negative-origin content is rejected;
  author content from y=0 and let the controller move it upward. This is not
  an infinite pan/zoom surface.
- Ordinary ScrollView never arranges your content. Its extent is measured from
  the supplied rectangles. Do not set contentHeight, maxScroll or itemCount.

```luau
local ui = api.ui.components
local help = ui.scrollView({
 id="help", viewport={left=10,top=15,width=80,height=70},
 content={
  ui.text({id="intro",text="Introduction",rect={x=0,y=0,width=80,height=10}}),
  ui.text({id="more",text="More",rect={x=0,y=100,width=80,height=10}}),
 },
})
api.ui.setRoot(ui.screen({id="settings",node="help",children={help}}))
```

## VirtualList

`renderItem(item,index,key)` returns a **non-empty array** of UI nodes with
cell-local rects. It does not include the row/column position. It must be a
pure view function: no gameplay mutation, randomness, input, saves or jobs.
It may run on a host UI request while simulation is paused.

`index` is one-based. The key function is also UI-pure and may be called on
every republish; keys are validated before materializing nodes. Sizes are
finite positive numbers; gaps finite non-negative numbers; columns are integer
1..1024. Unknown helper options are errors, not silently ignored.

```luau
local ui: UiComponentKit = api.ui.components.create({
 button={font_size=2,text_align="start",padding={left=1,right=1}},
})
type Row = {id: string, name: string}
local rows: {Row} = items -- Project-owned inventory data.
local options: UiVirtualOptions<Row> = {
 id="inventory", viewport={left=10,top=15,width=80,height=70},
 items=rows, key="id", rowHeight=8, gapY=1,
 renderItem=function(item,index,key)
  return {ui.button({id="item_"..key,text=item.name,action="Inspect_"..key,
   rect={x=0,y=0,width=80,height=8}})}
 end,
}
local list = ui.virtualList(options)
api.ui.setRoot(ui.screen({id="inventory_screen",node="inventory",children={list}}))
```

Use a project-owned item type such as `Row` with `UiVirtualOptions<Row>` or
`UiVirtualGridOptions<Row>`. Both the module and kit methods preserve the item
type in `key` and `renderItem` callbacks, so `item.name` is checked and a typo
such as `item.missing` is rejected by strict analysis. Do not replace the
callback's item with `any` to silence an error. Bare option types retain their
legacy default for compatibility; new views should name their data type.

`items` is an array; `key` is a string field name or a function returning a
unique non-empty string. Keys describe the item, **not its array position**.
IDs of returned nodes must also be globally unique and stable across filtering.
Empty arrays are supported. Maximum 100,000 keys; normal node budgets still
apply to the materialized window. Lua items and callbacks are never serialized.

## VirtualGrid

Same options as VirtualList plus required `columns`, `columnWidth`, and optional
`gapX`. `rowHeight` means the cell's height, **not including gapY**. Columns are
an explicit author decision and must fit the viewport. No implicit reflow.

```luau
local ui = api.ui.components
local grid = ui.virtualGrid({
 id="skills", viewport={left=10,top=15,width=80,height=70},
 items=skills, key="id", columns=8, columnWidth=9, gapX=1,
 rowHeight=16, gapY=1,
 renderItem=function(item,index,key)
  return {ui.button({id="skill_"..key,text=item.name,action="Inspect_"..key,
   rect={x=0,y=0,width=9,height=16}})}
 end,
})
api.ui.setRoot(ui.screen({id="skill_screen",node="skills",children={grid}}))
```

## Shared optional settings and lifecycle

- `enabled=false`: retain offset but disable scroll input and content actions;
  use while a foreground modal blocks the collection.
- `resetKey="filter-name"`: change to explicitly return to the beginning.
  Otherwise, the same node ID retains its position: unchanged data retains the
  numeric offset; edits retain the first visible key where possible, then clamp.
- `wheelRect={left,top,width,height}`: optional wider stage rectangle receiving wheel input, e.g. a
  panel's blank area. Nested ScrollViews use their viewport only.
- Ordinary ScrollView additionally accepts `axis="vertical"` (default),
  `"horizontal"` or `"both"`. Virtual collections are vertical only.
- `inertia=true`: continue a released mouse, touch or pen content drag with
  momentum. The default is `false`, preserving immediate-stop behavior.
- `deceleration=8`: finite exponential velocity decay in **per second** units,
  greater than 0 and at most 100. It applies only when `inertia=true`; a larger
  value stops sooner. This is a decay rate, not a 0..1 friction multiplier or a
  duration in milliseconds. A rate of 8 has a 125 ms time constant; 12 stops
  more quickly. Helpers and raw `scroll_view` nodes reject invalid values.
- Removal disposes the host controller and Lua data-source registration.
  Async requests carry a revision; removed/filtered stale requests are ignored.
- Render, pointer hit regions and keyboard reveal share one clipped projection.

The same settings work on the module and themed-kit constructors, including
`virtualList` and `virtualGrid`:

```luau
local help = api.ui.components.scrollView({
 id="help", viewport={left=10,top=15,width=80,height=70},
 inertia=true, deceleration=8,
 content={
  api.ui.components.text({id="intro",text="Introduction",
   rect={x=0,y=0,width=80,height=10}}),
  api.ui.components.text({id="more",text="More",
   rect={x=0,y=100,width=80,height=10}}),
 },
})
```

Momentum is host presentation state. It uses animation-frame time, leaves game
state and simulation frames unchanged, and uses the same clipped projection,
native rails and bounded virtual-row requests as ordinary dragging. Velocity
decays as `v(t)=v0*exp(-deceleration*t)` and distance is integrated analytically;
different display rates cover the same path. Offsets clamp at the content
boundary, with no elastic overscroll or bounce. Release velocity is capped at
300 stage-axis units per second and settles below 0.5 units per second. A hold
with no movement for more than 100 ms before release does not coast.

A new pointer press, wheel input over the view, native rail press, keyboard
navigation, focus reveal or explicit host cancellation stops momentum. Disabling,
removing or resetting the view, changing its viewport/axis/momentum settings or
content extent/revision, and resizing the stage also stop it. Re-enabling a view
does not revive old velocity. A frame gap over 250 ms cancels the coast without
catch-up; the official player also cancels it when paused or blurred. Normal
post-release `lostpointercapture` cleanup retains the coast.

## Web host integration

Use `createUiScrollHost` from `web/shared/ui-scroll.mjs` once per stage. Pass
`canvas`, `stage`, `onAction`, and `requestWindow(request)`; the latter sends
`backend.request({kind:"ui",request})`, accepts the returned snapshot and redraws.
Run `scroll.draw(snapshot)` before Canvas/UI motion/accessibility projection.
Route mouse, pen and touch through `scroll.pointer(event,kind,hit)` before
ordinary UI input. Pass the current hit test's `nodeId` and `action`; the
controller resolves control ownership from the projected tree. Keep pointer
capture from down through up so a drag can finish outside the viewport.
Route pointercancel/lostpointercapture through `scroll.pointer(event,"cancel")`;
use `scroll.cancel()` for a whole-surface pause/blur and `dispose()` on removal.
Normal pointer capture release must not clear the last keyboard scroll owner.
Do not send a simulation tick to materialize rows.
The controller owns its animation-frame scheduling while momentum is active.
Custom hosts may inject `now()` (monotonic milliseconds), `requestFrame(fn)` and
`cancelFrame(id)` for a host scheduler or deterministic tests; these are host
adapter options, not Luau node props. A cancelled frame must not be delivered.

Default semantic controls identify themselves with `data-ui-control="node-id"`.
Hosts using another control projection pass `getFocusedNode(): nodeId?` and
`focusNode(nodeId): boolean` (true if focus succeeded). The controller has no
game-specific selector or node-name convention. Focus restoration is deferred
until after the host synchronizes its current controls.

The controller offers `scrollToKey(viewId,key)`, `ensureVisible(nodeId)`,
`navigate(nodeId,code)` and `report()`. Host semantic controls should call
ensureVisible on focus and use navigate for arrow/Home/End collection navigation.
Only materialized controls exist: do not expose 100,000 hidden DOM buttons.
When the host reorders/recreates semantic controls, suppress automatic old-focus
restoration while `scroll.isNavigating()` is true; otherwise it can scroll back
to the previous row before the requested target is materialized. Sliders,
comboboxes and editable fields retain their own keyboard input. Nested wheel
input chains to an outer view when the inner view reaches its edge, and nested
rails are clipped to ancestor viewports. Primary mouse buttons, pen tips and
touches can drag content directly. Movement must exceed 8 CSS pixels before
scrolling starts; smaller movement remains a tap. The deepest enabled view under
the pointer owns the drag, including its release outside the viewport. A second
pointer cannot replace that gesture. Sliders and combobox fields retain their
own pointer capture, and foreground controls
outside the collection retain their normal input.

Buttons inside draggable content activate once on release when the same node
and action are still under the pointer. A drag never activates its starting row,
even if it ends there. Use `wasPressed` for row selection; these deferred taps
do not expose continuous held duration. Buttons outside scroll content keep their
ordinary down/held/up input. Cancellation, blur, disabling or removing a view
abandons its pending tap. Momentum is opt-in as described above; elastic
overscroll and variable-height measurement are not supported.

## Images, actions and foreground dialogs

An image is visual-only; a sibling button owns the action. Assets are stable
IDs declared in the project's asset manifest, not file paths or remote URLs:

```luau
renderItem=function(item,index,key)
 return {
  ui.image({id="icon_"..key,asset=item.asset,fit="contain",
   rect={x=0,y=0,width=9,height=16}}),
  ui.button({id="hit_"..key,text="",action="Inspect_"..key,
   rect={x=0,y=0,width=9,height=16}}),
 }
end
```

Buttons use the existing semantic action input protocol: host `onAction(action)`
queues that action using `createHostInput().queueAction(action)`. That callback
belongs to the host adapter, not to a Luau node. In `Game.update`, read
`api.input.wasPressed(action)` for one activation per press,
`api.input.wasReleased(action)` for the end of that action pulse. Scroll-row taps
are deferred until pointer release; `isDown` is true for the queued pulse rather
than for the physical hold. Search `"button click"` / `"按下瞬間"`, `"release"` /
`"放開"` or `"hold"` / `"長按"` for those real APIs. There is no Luau `onClick`
or `onAction` function prop:

```luau
local selectedId: string? = nil
function Game.update(api: EngineApi,dt: number)
 if api.input.wasPressed("Inspect_known_item") then selectedId="known_item" end
 publish(api) -- Rebuild the view from game state; renderItem only reads it.
end
```

Edge reads compare the current action snapshot with the previous successful
tick and never consume the result. Repeated readers see the same edge; reads,
rendering and virtual-scroll requests do not advance that snapshot or run a
gameplay tick. Initially actions are released. These are snapshot transitions,
not a queued platform-event stream. Selection, held-duration meaning, dialog
state, filters and actions remain project-owned; virtual callbacks only read
that state to construct the visible UI.

Keep a modal-blocked collection in the root with `enabled=false`, and keep its
node ID/resetKey unchanged. Disabling only affects this collection, not the
simulation or other UI. Publish foreground dialog nodes **after** the collection:
array order is paint order. Reuse your project's dialog/overlay and focus trap;
this API does not invent a modal node or a second game flow. Close the dialog,
republish with enabled=true, then restore focus to the same stable item key.
For key-preserving edits above the viewport, the Web controller retains the
first visible key when it still exists; deleting that key falls back to clamped
offset. Filtering `items` alone follows that edit-preservation rule. To reset
on filtering, explicitly change resetKey.
None of the three minimal examples automatically changes a filter: the caller
owns its filter state and resetKey.

Screen `id` is its stable identity; `node` is an inspectable game-defined route
label, not a reference to a child. Both are required non-empty strings.

Canvas hosts without a controller project offset zero. The legacy DOM and
native hosts currently report `UI_HOST_CAPABILITY_UNSUPPORTED`; native input,
screen-reader certification and variable-height virtualization are not claimed.

## Source-checkout developer checks

The following are engine-source developer tests and fixtures. They require a
source checkout and its development toolchains; these paths are not bundled SDK
files or consumer CLI subcommands. SDK consumers use `game verify`, target
preflight/prepare and the [optional exported-player observer](ui-components.md#optional-browser-observation-tools).
Structural and headless checks do not prove rendered pixels.

- `node --test web/shared/ui-scroll.test.mjs web/shared/ui-scroll-host.test.mjs web/shared/canvas-ui.test.mjs web/shared/runtime-core.test.mjs`
  checks shared projection, controller lifecycle, 100,000-key bounds and UI-only transport.
- `cargo test -p unone-engine virtual_ui_materializes_without_a_game_tick`
  checks actual Lua 10,000-item window requests, stale/invalid ranges and unchanged simulation/RNG.
- `cargo test -p unone-engine scroll_helpers_cover_empty_data_nested_views_and_fail_loudly`
  checks empty data, nested content and invalid helper configuration.
- `tests/scroll-parity-project` covers initial, modal-disabled, filtered and empty
  states through the official CLI/Web export parity gate. The parity fixture has
  10,000 Lua items; the 100,000-key controller test is not an end-to-end performance claim.
