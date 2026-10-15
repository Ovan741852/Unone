# Official UI typography and styling

Use the existing `api.ui.setRoot` transport, UI leaves and reusable `component`
wrappers. `style` extends those primitives; it does not introduce a second UI
library. A component function can return a button, decorative panel, label and
image with stable IDs. The game owns that composition, content, actions and
screen flow. The official player owns font loading, glyph shaping and painting.
See [formal host support](formal-ui-host.md) and [ADR 0038](decisions/0038-shared-ui-styling.md).

Start discovery with `game api search "font size"`, `"text alignment"`,
`"border padding"`, `"component styling"`, `"字體"`, `"排版"` or `"共用元件"`,
then describe `ui.setRoot` and inspect `game schema ui`.
`game api search "responsive"` leads to `ui.getViewport`. CLI and MCP search
use the same index. Regenerate strict types with `game api typings` after
upgrading an existing project; do not keep an old hand-copied `UiNode` union.
`component` is a node kind produced by a reusable Luau function, not an
`api.ui.component()` factory. Reuse the existing typed tree rather than guessing
an HTML/CSS or widget API from another framework.

## Coordinates and defaults

Stage rectangles keep the existing 0..100 coordinate system with y pointing up.
Typography and every style length use **vertical design units**: one unit is
1% of viewport height. This includes horizontal padding, letter spacing, border
width and radius. At a 900-pixel-high viewport, `font_size=2` is 18 pixels and
`padding.left=1` is 9 pixels. These units keep physical proportions stable when
the aspect changes. Scroll content retains its documented local coordinates.

Omitting `style` preserves legacy text fitting. Adding `style`, including `{}`,
selects explicit typography defaults: size 2, weight 400, line height 1.2,
letter spacing 0, white RGBA, centered horizontal and middle vertical alignment,
no wrapping, clipped overflow, zero padding/border/radius and opacity 1.
Background is transparent. An explicit font size is never reduced to fit.
Overflow is a presentation decision rather than an engine layout correction.

Styles apply locally to `text`, `button`, `slider`, `combobox`, `image` and
`panel`. Containers reject `style`; they do not inherit it or transform child
coordinates. Reuse a style table or component function in Luau when multiple
leaves share a theme.

| Field | Contract |
| --- | --- |
| `font_family` | Installed family name or comma-separated fallback list; package project fonts below. No URLs or CSS. |
| `font_size` | Positive vertical units, at most 100. |
| `font_weight` | Integer 100..900. Package the appropriate faces for predictable weight. |
| `line_height` | Font-size multiplier, 0.5..4. |
| `letter_spacing` | Vertical units, -10..10. |
| `color` | Four finite RGBA numbers, each 0..1. |
| `text_align` | `start`, `center`, `end`; left/center/right in this left-to-right box contract. |
| `vertical_align` | `top`, `middle`, `bottom` within the padded content rectangle. |
| `wrap` | `none` or `word`. Explicit newlines are retained; long words and CJK can break at grapheme boundaries. |
| `overflow` | `clip` or `ellipsis`. Ellipsis shortens overlong explicit lines horizontally; it requires `wrap=none`. Height overflow is clipped. |
| `padding` | `{left,top,right,bottom}`, omitted sides 0; finite non-negative vertical units, at most 100 each. |
| `background` | RGBA fill, default transparent. |
| `border_color` | RGBA border color, default white when width is positive. |
| `border_width` | Non-negative vertical units, at most 100; drawn inside the box. |
| `border_radius` | Non-negative vertical units, at most 100; clamped to half the shorter box edge. Clips content too. |
| `opacity` | 0..1 for the whole leaf, including image, text, background and border. |

`image` and `panel` accept box fields (`padding`, background, border and opacity),
not text fields. Image padding reduces its content rectangle before fit/slicing.
A `panel` is a decorative leaf with an ID, rectangle and optional style; it has
no text, action or children. Draw order follows leaf order. Decorative panel,
image and text leaves do not hide a semantic button behind them or capture world
input. Interactive button/combobox rectangles route semantic actions; clipping
and rounded corners do not change their rectangular hit regions.

Invalid styles fail before replacing the previous tree. Unknown fields, invalid
RGBA, out-of-range values, container styles, typography on images/panels and
word-wrap combined with ellipsis report a semantic style diagnostic. Use
`api.ui.inspect()` for effective node budgets. Styling does not add extra logical
nodes for a border or background.

## Package a font catalog

Declare each licensed font face once in `player.presentation.json`:

```json
{
  "renderer_mode": "official",
  "ui": {
    "font_family": "Reading UI",
    "fonts": [
      {"family": "Reading UI", "source": "fonts/body-regular.ttf", "weight": 400},
      {"family": "Reading UI", "source": "fonts/body-semibold.ttf", "weight": 600},
      {"family": "Display UI", "source": "fonts/display.otf", "weight": 700}
    ]
  }
}
```

Catalog family names are aliases and need not match internal font metadata.
Family/weight pairs must be unique. TTF and OTF are the shared Web/native catalog
formats. `ui.font_family` selects the default family; when omitted the first
catalog family is used, then `sans-serif` if the catalog is empty.
Export verifies project-relative paths and copies the declared files
into the content package. Web waits for FontFace loading before starting the
player; native registers the same aliases and weights in its font database.
Malformed fonts fail explicitly. Font rights and character coverage remain the
project's responsibility; keep the font license beside the source asset.

The older `ui.font_source` plus `ui.font_family` declaration remains supported.
For shared target output prefer the catalog, which can express several families
and weights. A legacy browser-only format does not imply native support: native
reports `UI_FONT_FORMAT_UNSUPPORTED` for WOFF/WOFF2. Installed fallback fonts and
host rasterizers can still produce different glyph metrics; inspect real pixels
on each target before claiming visual parity.
Modern Web hosts use Canvas native letter spacing so whole-line shaping is
preserved. An older host lacking that capability reports
`UI_TEXT_TRACKING_UNSUPPORTED` for nonzero tracking on scripts that require
joining/shaping; use zero tracking or a supported host rather than unjoined text.

## Reuse existing components

This compact settings action uses the existing component boundary. It is useful
in any game; the engine does not know what the action means:

```luau
local function actionButton(id: string, text: string, action: string, rect: UiRect): UiNode
    return {
        kind="component", id=id, component="ui.action_button", rect=rect,
        children={{
            kind="button", id=id.."_action", text=text, action=action, rect=rect,
            style={font_family="Reading UI",font_size=2,font_weight=600,
                padding={left=1,right=1},color={0.92,0.97,1,1},
                background={0.04,0.09,0.14,0.92},border_color={0.25,0.65,0.8,0.8},
                border_width=0.12,border_radius=0.7},
        }},
    }
end
api.ui.setRoot({kind="screen",id="settings",node="settings",children={
    actionButton("apply","Apply settings","ApplySettings",
        {x=60,y=10,width=30,height=8}),
}})
```

A separate reading card demonstrates independent text hierarchy and wrapping:

```luau
api.ui.setRoot({kind="screen",id="reading",node="article",children={
    {kind="panel",id="paper",rect={x=10,y=10,width=80,height=80},
     style={background={0.03,0.04,0.06,0.95},border_radius=1}},
    {kind="text",id="heading",text="Field notes",rect={x=15,y=70,width=70,height=12},
     style={font_family="Display UI",font_size=4.5,font_weight=700,
        text_align="start",vertical_align="middle",color={1,0.9,0.65,1}}},
    {kind="text",id="body",text="A short report can keep a readable type size while its paragraph wraps inside an authored rectangle.",
     rect={x=15,y=20,width=70,height=45},style={font_family="Reading UI",font_size=2,
        text_align="start",vertical_align="top",line_height=1.5,wrap="word",
        color={0.8,0.85,0.9,1}}},
}})
```

Use the returned viewport aspect to select a game-authored composition:

```luau
local compact = api.ui.getViewport().aspect < 1
-- Choose a meaningful compact arrangement in your View function.
-- The engine does not move, resize or reorder these groups automatically.
```

MVVM, screen managers, themes and binding lifecycles stay in Luau/SDKs; see the
[UI architecture proposal](ui-mvvm-architecture.md). Existing
[nine-slice/budget](ui-slice-and-budget.md) and [scroll helpers](ui-scroll.md)
continue to compose with styled leaves. Native scrolling remains explicitly
unsupported; styling does not change that capability boundary.
