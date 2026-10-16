# Official shared UI package

`@unone/ui` is the official, versioned pure Luau component package bundled with
Unone Core and the portable SDK. It constructs the existing typed UI tree for
`api.ui.setRoot`; the official Web/native players render that tree. Start here
for shared components, button components, card components and theme styles.
The project owns themes, content, state, action meanings and geometry.

## Discover and declare

```powershell
game api search "UI package"
game api search "shared components"
game api search "button component"
game api search "card component"
game api search "官方UI套件"
game api search "共用元件"
game api search "主題樣式"
game api describe ui.components.info
game api describe ui.components.create
game api typings
```

CLI and MCP discovery share the same index. These searches lead to actual
`ui.components.create` / `ui.components.info` entrypoints. `"font size"`,
`"text alignment"` and `"border padding"` still lead to `ui.setRoot` and the
[style contract](ui-styling.md); `"card background"` and `"component overlap"`
explain the canonical background scope checks.

Declare the exact bundled version in `project.unone.json`:

```json
{
  "runtime_packages": {
    "@unone/ui": "0.1.0"
  }
}
```

This is a project configuration fragment; keep the project's other fields.
`api.ui.components.info()` returns `UiComponentsInfo`: the bundled manifest
metadata (`name`, `version`, `kind`, `entry`, `api`, `license`) plus `declared`.
This works before a project declares the package. The package name is `@unone/ui`
and its current version is `0.1.0`. Calling other package helpers without declaring the
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

api.ui.setRoot({kind="screen",id="menu",node="menu",children={
    actionCard("menu/inventory",10,"Inventory","OpenInventory"),
    actionCard("menu/settings",55,"Settings","OpenSettings"),
}})
```

The numbers and action names above are project choices. The package supplies no
default palette, fonts, layout, responsive policy, manager or business behavior.
A custom Luau factory such as `actionCard` composes the official kit; existing
factories that return canonical nodes directly remain valid.

`create(theme?)` returns a `UiComponentKit` with these methods:

| Kit method | Result and input contract |
| --- | --- |
| `ui.text(props)` | `UiTextNode`; canonical text fields including `id`, `text`, placement and optional `style`. |
| `ui.button(props)` | `UiButtonNode`; canonical button fields including `id`, `text`, `action`, placement and optional `style`. |
| `ui.panel(props)` | `UiPanelNode`; canonical decorative panel fields, placement, optional box style and `background_for`. |
| `ui.image(props)` | `UiImageNode`; canonical image fields including `asset`, placement, optional `fit`/`slice`/`alt`, box style and `background_for`. |
| `ui.component(props)` | `UiComponentNode`; `id`, `component`, placement, optional `children` and `surface`. |
| `ui.id(instanceId,role)` | Stable `instanceId.."/"..escapedRole` string; role escapes `%` as `%25` and `/` as `%2F`. Both inputs must be non-empty. Also available as `api.ui.components.id`. |
| `ui.composeStyle(base?,override?)` | A fresh `UiStyle`; also available as `api.ui.components.composeStyle`. |

Use methods on the returned kit. There is no `api.ui.components.button` or
`api.ui.component` entrypoint. Props omit `kind`; each constructor chooses its
canonical kind. Placement is **flattened**: pass `rect={...}` or both
`anchor="top_right",size={...}` directly on props, exactly as in `UiPlacement`.
A nested `placement` table, missing placement, or both forms is invalid.
All canonical leaf fields remain available; the package adds no hidden state.

Components do not transform child coordinates. In stage space children keep
0..100 coordinates with y pointing up. In scroll content, use the existing local
coordinate contract. Child order is retained. Use `api.ui.getViewport()` in the
project's View to choose a responsive composition and explicit dimensions.

Buttons publish their `action` through the existing semantic input system. Read
it with `api.input.isDown(action)` in `Game.update`, and keep the previous down
state in project Luau when the action should fire once per press. Discover the
contract with `game api describe input.isDown`; the kit does not install
callbacks, automatically change a model or define an `onClick` property.

## Theme copying and surfaces

`theme: UiComponentsTheme` accepts only optional `text`, `button`, `panel` and `image` `UiStyle`
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
