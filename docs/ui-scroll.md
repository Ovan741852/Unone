# ScrollView and virtual collections (Web)

Use `api.ui.scrollView` for small, irregular authored content. Use
`api.ui.virtualList` for long fixed-height rows, or `api.ui.virtualGrid` for
fixed-size cells. All three return a real `scroll_view` node; put that node
in the `children` of the screen passed to `api.ui.setRoot`.

## The coordinate rule

- `viewport={left,top,width,height}` is top-left/y-down in the containing space.
  At the screen level it is relative to the stage, not the browser window.
  Do not pass old stage `rect={x,y,...}` to a helper's viewport. The engine
  performs the y-up transport conversion; callers do not.
- Every content rect, including component children, is **local top-left/y-down**:
  `{x=0,y=0}` is the viewport's top-left before scrolling. x uses percent of stage
  width; y uses percent of stage height, not percent of the scroll viewport.
- Nested scroll viewports are local to the parent's content. Their children
  start a new local space. Anchors are rejected inside scroll content.
- All content x/y must be non-negative. Negative-origin content is rejected;
  author content from y=0 and let the controller move it upward. This is not
  an infinite pan/zoom surface.
- Ordinary ScrollView never arranges your content. Its extent is measured from
  the supplied rectangles. Do not set contentHeight, maxScroll or itemCount.

```lua
local help = api.ui.scrollView({
 id="help", viewport={left=10,top=15,width=80,height=70},
 content={
  {kind="text",id="intro",text="Introduction",rect={x=0,y=0,width=80,height=10}},
  {kind="text",id="more",text="More",rect={x=0,y=100,width=80,height=10}},
 },
})
api.ui.setRoot({kind="screen",id="settings",node="help",children={help}})
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

```lua
local list = api.ui.virtualList({
 id="inventory", viewport={left=10,top=15,width=80,height=70},
 items=items, key="id", rowHeight=8, gapY=1,
 renderItem=function(item,index,key)
  return {{kind="button",id="item_"..key,text=item.name,action="Inspect_"..key,
   rect={x=0,y=0,width=80,height=8}}}
 end,
})
api.ui.setRoot({kind="screen",id="inventory_screen",node="inventory",children={list}})
```

`items` is an array; `key` is a string field name or a function returning a
unique non-empty string. Keys describe the item, **not its array position**.
IDs of returned nodes must also be globally unique and stable across filtering.
Empty arrays are supported. Maximum 100,000 keys; normal node budgets still
apply to the materialized window. Lua items and callbacks are never serialized.

## VirtualGrid

Same options as VirtualList plus required `columns`, `columnWidth`, and optional
`gapX`. `rowHeight` means the cell's height, **not including gapY**. Columns are
an explicit author decision and must fit the viewport. No implicit reflow.

```lua
local grid = api.ui.virtualGrid({
 id="skills", viewport={left=10,top=15,width=80,height=70},
 items=skills, key="id", columns=8, columnWidth=9, gapX=1,
 rowHeight=16, gapY=1,
 renderItem=function(item,index,key)
  return {{kind="button",id="skill_"..key,text=item.name,action="Inspect_"..key,
   rect={x=0,y=0,width=9,height=16}}}
 end,
})
api.ui.setRoot({kind="screen",id="skill_screen",node="skills",children={grid}})
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
- Removal disposes the host controller and Lua data-source registration.
  Async requests carry a revision; removed/filtered stale requests are ignored.
- Render, pointer hit regions and keyboard reveal share one clipped projection.

## Web host integration

Use `createUiScrollHost` from `web/shared/ui-scroll.mjs` once per stage. Pass
`canvas`, `stage`, `onAction`, and `requestWindow(request)`; the latter sends
`backend.request({kind:"ui",request})`, accepts the returned snapshot and redraws.
Run `scroll.draw(snapshot)` before Canvas/UI motion/accessibility projection.
Route touch through `scroll.pointer(event,kind,hit)` before ordinary UI input;
Route pointercancel/lostpointercapture through `scroll.pointer(event,"cancel")`;
use `scroll.cancel()` for a whole-surface pause/blur and `dispose()` on removal.
Normal pointer capture release must not clear the last keyboard scroll owner.
Do not send a simulation tick to materialize rows.

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
rails are clipped to ancestor viewports. This release uses direct touch dragging,
not momentum, elastic overscroll or variable-height measurement.

## Images, actions and foreground dialogs

An image is visual-only; a sibling button owns the action. Assets are stable
IDs declared in the project's asset manifest, not file paths or remote URLs:

```lua
renderItem=function(item,index,key)
 return {
  {kind="image",id="icon_"..key,asset=item.asset,fit="contain",
   rect={x=0,y=0,width=9,height=16}},
  {kind="button",id="hit_"..key,text="",action="Inspect_"..key,
   rect={x=0,y=0,width=9,height=16}},
 }
end
```

Buttons use the existing action input protocol: host `onAction(action)` queues
that action using `createHostInput().queueAction(action)`. In `Game.update`,
read `api.input.isDown(action)`; game-owned edge detection prevents repeated
activation when held. There is no new Lua `onAction` hook:

```lua
local wasOpen=false
function Game.update(api,dt)
 local down=api.input.isDown("Inspect_known_item")
 if down and not wasOpen then selectedId="known_item" end
 wasOpen=down
 publish(api) -- Rebuild the view from game state; renderItem only reads it.
end
```

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

## Runnable checks

- `node --test web/shared/ui-scroll.test.mjs web/shared/ui-scroll-host.test.mjs web/shared/canvas-ui.test.mjs web/shared/runtime-core.test.mjs`
  checks shared projection, controller lifecycle, 100,000-key bounds and UI-only transport.
- `cargo test -p unone-engine virtual_ui_materializes_without_a_game_tick`
  checks actual Lua 10,000-item window requests, stale/invalid ranges and unchanged simulation/RNG.
- `cargo test -p unone-engine scroll_helpers_cover_empty_data_nested_views_and_fail_loudly`
  checks empty data, nested content and invalid helper configuration.
- `tests/scroll-parity-project` covers initial, modal-disabled, filtered and empty
  states through the official CLI/Web export parity gate. The parity fixture has
  10,000 Lua items; the 100,000-key controller test is not an end-to-end performance claim.
