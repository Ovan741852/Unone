# Frame Atelier AI-native editor protocol

Frame Atelier exposes semantic editor state and commands through
window.frameAtelier. An AI can inspect and edit the hierarchy without
Computer Use, screenshots, or browser-driving instructions.

```js
const snapshot = window.frameAtelier.inspect();
const next = await window.frameAtelier.command("add_element", {
  type: "container",
  parentId: "el-004",
  name: "資源列",
  layoutMode: "horizontal",
  gap: 3,
  rect: { x: 8, y: 70, width: 80, height: 16 },
});
const row = next.elements.find((item) => item.name === "資源列");
await window.frameAtelier.command("add_element", {
  type: "progressbar", parentId: row.id, name: "生命值", value: 72,
});
```

Run python scripts/serve-frame-atelier.py from the Unone checkout and open
http://127.0.0.1:8001/Unone/web/frame-atelier/. The loopback server permits
only the editor's static resources and authenticated local bridge requests.
It must not be exposed to the LAN.

The snapshot protocol is unone.frame-atelier.v2. It contains project settings,
the active desktop/mobile profile, elements with parent IDs and per-profile
rectangles, reusable prefabs, and a semantic unone_ui tree.

Generic node kinds are `container`, `panel`, `scrollview`, `progressbar`,
`button`, `label`, `image`, `input`, and `checkbox`. Every node kind can own
children; `parentId` describes hierarchy independently from visual type, and
children are positioned relative to their parent. A visual node renders behind
its children. Container's `layoutMode` is one of `free`, `horizontal`,
`vertical`, `grid`, or `overlay`; `gap`, `padding`, and `columns` configure its
automatic child layout. Children in automatic layouts use their `order` value
and preferred width/height; the snapshot's `rect` is the resulting preview
rectangle and `preferred_rect` preserves the authored size. ScrollView has a
vertical content area controlled by `contentLength`. ProgressBar uses a
0–100 `value`.

Every node has a `visible` flag; `update_element` accepts `{id, visible}` and
the layer tree has an eye toggle. Image nodes reference imported project assets
and may contain children rendered over the image. AI decomposition may return
nested `children` (up to five levels); existing IDs can be reused when nodes
move within the selected subtree. Initial visibility is preview state; runtime
logic still decides which state is active.

Lists, inventory slots, cards, and other product/game-specific patterns are
not engine node kinds. Build them from generic containers and visual nodes,
then save the composition as a project Prefab.

Core commands are inspect, select_element, set_profile, add_element,
update_element, delete_element, duplicate_element, set_parent, save_prefab,
insert_prefab, panel_plan, decompose_panel, and get_change_history. Legacy frame
command names remain accepted as aliases where possible.

The editor keeps the latest 100 changes in browser-local project storage.
AI entries include the user's prompt, selected target, provider, and before/after
hierarchy changes; manual edits are summarized from saved state differences.
Read them without computer use:

```js
const history = await window.frameAtelier.command("get_change_history", { limit: 20 });
```

For older local bridges that allow `inspect` but not `get_change_history`, use
`inspect` with `{ includeHistory: true, historyLimit: 20 }`; the response adds a
`change_history` field to the regular hierarchy snapshot.

The command can optionally filter by `targetId`; pass `allProjects: true` to
include other projects kept in this browser's local history.

Structure planning and selected-node decomposition are separate requests; a
decomposition receives the current hierarchy and component registry to reduce
repeated content. Structure generation uses the authenticated local Codex CLI;
image assets are generated in Codex with ImageGen and imported into the editor.
The editor stores drafts locally and keeps working when Codex CLI is not ready.
