# @unone/ui

Official pure Luau UI constructors, versioned with the portable Unone SDK.
The package returns ordinary existing UI nodes and uses the official player.
It supplies no colors, fonts, responsive rules, automatic layout or game state.
The [full component guide](../../docs/ui-components.md), style contract and
canonical strict types accompany the portable SDK's verified package inventory.

Declare the exact installed version in `project.unone.json`:

```json
{"runtime_packages":{"@unone/ui":"0.1.0"}}
```

The SDK includes the manifest and source at `packages/unone-ui/`. The matching
runtime exposes `api.ui.components`; no `require`, network download or additional
renderer is involved. `api.ui.components.info()` reports the installed metadata
and whether the current project declared it. Other methods fail with
`UI_PACKAGE_NOT_DECLARED` until the project declares that exact version.

```luau
local ui = api.ui.components.create({
    text={font_size=2,color={0.9,0.95,1,1}},
    button={font_size=2,padding={left=1,right=1}},
})
local cardId = "settings"
local card = ui.component({
    id=cardId, component="app.settings_card",
    rect={x=10,y=10,width=80,height=60},
    surface={kind="panel",style={background={0.03,0.05,0.08,1}}},
    children={
        ui.text({id=ui.id(cardId,"heading"),text="Settings",
            rect={x=15,y=55,width=70,height=8}}),
        ui.button({id=ui.id(cardId,"apply"),text="Apply",action="ApplySettings",
            rect={x=60,y=15,width=25,height=8}}),
    },
})
api.ui.setRoot({kind="screen",id="settings_screen",node="settings",children={card}})
```

`create(theme?)` returns `text`, `button`, `panel`, `image`, `component`, `id` and
`composeStyle`. Theme fields are exactly `text`, `button`, `panel`, `image`, each
an optional `UiStyle`. Leaf props use their existing data fields and flattened
`UiPlacement` fields: either `rect` or `anchor`/`size` with optional `pivot` and
`offset`. Do not supply `kind`; the constructor supplies it. Panels/images also
accept canonical `background_for`. Plain `UiNode` children, including custom
components and existing scroll helpers, continue to compose normally.

`component` takes `id`, `component`, placement, optional dense `children`, and
optional `surface`. A surface is either `{kind="panel",style=...}` or
`{kind="image",asset=...,fit=...,slice=...,alt=...,style=...}`. It takes the
component's unchanged placement, receives the ID `componentId.."/surface"`, and
appears before the supplied children with `background_for={component=componentId}`.
That generated ID is reserved within the tree. The helper does not move children,
make coordinates relative, inherit styles, clip, reorder supplied children or
choose responsive arrangements. A scroll boundary still starts a separate
coordinate space.

`composeStyle(base?,override?)` copies its inputs; override fields win. Padding
merges by edge. Colors and all other values replace atomically. With no arguments
it returns `{}`. Constructors omit `style` when neither theme nor props specifies
one, preserving legacy unstyled text fitting; supplying `{}` opts into the
existing styled defaults. Ordinary authored data is copied, including theme,
rectangles, padding, color arrays, image slices and children. Registered nodes
returned by `api.ui.virtualList` and `api.ui.virtualGrid` retain their identity:
the engine scroll helper owns their viewport, materialized children and scroll
state, and updates that same node when the host requests another visible range.
Pass those live nodes through as children; do not manually mutate or clone them.
This exception applies only to the exact registered helper node, not a plain
authored table with the same kind or ID.

`id(instanceId,role)` returns the instance ID plus `/` plus the role, escaping `%`
as `%25` and `/` as `%2F` in the role. It uses no counter or array index. Supply
stable instance IDs and stable semantic roles; list item identity remains the
project's responsibility. The module also exports `id` and `composeStyle` so
they can be used without creating a kit.

Unknown constructor/theme/style fields and sparse children fail explicitly.
Copying rejects cycles, unsupported values, nesting above 64 levels and work
above 131072 visited values. These are bounded authoring checks; `api.ui.setRoot`
remains authoritative for numeric values, required fields, placement, IDs,
background scope, budgets and supported leaf styles. Strict layout diagnostics
still report foreground collisions. Publish the result through the normal
official player and verify its rendered text and input on the intended target.

The package is licensed `MIT OR Apache-2.0`, as recorded in
`package.unone.json`.
