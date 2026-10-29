# Official UI typography and styling

Start reusable controls with the official [`@unone/ui` package](ui-components.md),
a versioned pure Luau kit bundled with Core and the portable SDK. Declare
`"runtime_packages":{"@unone/ui":"0.4.0"}` in `project.unone.json`, inspect
`ui.components.info`, and call `api.ui.components.create(theme?)`. The returned
kit constructs typed text/button/slider/combobox/panel/image leaves, component
and screen wrappers, the `createSlider` numeric control, `createResponsiveLayout`, plus the existing scroll
helpers through one namespace for the existing `api.ui.setRoot` transport.
Themes, content, application state, action meanings
and geometry remain project-owned. Custom Luau factories remain valid.
The official player owns font loading, glyph shaping and painting.
See [formal host support](formal-ui-host.md) and [ADR 0038](decisions/0038-shared-ui-styling.md).

Search `game api search "UI package"`, `"shared components"`, `"button component"`,
`"card component"`, `"官方UI套件"`, `"共用元件"` or `"主題樣式"` to discover the kit.
For the canonical leaf contract, search `"font size"`, `"text alignment"`,
`"border padding"`, `"card background"`, `"component overlap"`, `"字體"`,
`"排版"`, `"卡片背景"` or `"元件重疊"`, describe `ui.setRoot`, and inspect
`game schema ui`. `"responsive layout"`, `"breakpoints"` and `"自適應排版"` lead
to `ui.components.createResponsiveLayout`; read [the typed guide](ui-responsive.md)
for shared selection and region arithmetic. `ui.getViewport` supplies its aspect
input. CLI and MCP share the
same index. Regenerate strict types with `game api typings` and use a matching
SDK after upgrading; new projects inline the canonical contract.
Search `"slider drag"` / `"slider value"` / `"滑桿拖曳"` for
`ui.components.createSlider`. Its pure `view` uses the themed slider style;
the persistent control handles numeric values while the official host handles
projected/clipped pointer capture. Use the
[typed control lifecycle](ui-components.md#interactive-sliders), including one
`update(api.input)` per `Game.update`; do not implement pointer mapping in each
skin or advance input from a virtual `renderItem` callback. `rect`, `trackRect`
and `hitPadding` use rectangle coordinate units, independently of the vertical
units used by `UiStyle` lengths. Artwork and layout remain authored explicitly.
All constructors are also directly callable on `api.ui.components` with no
theme defaults. `component` is an existing tree node kind;
`api.ui.components.component(props)` and `kit.component(props)` construct it,
while `api.ui.component()` does not exist. Search `"button click"` for
`input.wasPressed(action)` instead of guessing an `onClick` property. Use the
[canonical typed upgrade flow](ui-components.md#keep-the-official-types-when-upgrading)
instead of handwritten `ui:any` wrappers.

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
coordinates. Use per-kind theme defaults in `api.ui.components.create(theme?)` or custom
Luau factories when several leaves share a theme. The kit copies styles with
override precedence, padding-edge merging and whole RGBA-array replacement.

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
| `text_shadow` | Sharp same-layout glyph copy `{offset_x,offset_y,color}`; offsets are vertical units in -100..100, positive y downward. Official Web Canvas nonediting text only; see [shadow and input regions](ui-presentation-input.md). |

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
For predictable CJK and symbols, package a licensed fallback face and use an
explicit family list on text styles, such as `font_family="Reading UI, CJK UI"`.
Register the fallback's required weights in the same catalog. A family list is
not a network download and does not guarantee an installed host font exists.
Export verifies project-relative paths and copies the declared files
into the content package. Web waits for FontFace loading before starting the
player; native registers the same aliases and weights in its font database.
Malformed fonts fail explicitly. Font rights and character coverage remain the
project's responsibility; keep the font license beside the source asset.
Export copies the declared font faces. Include their accompanying license
notices in the distribution too; neighboring source files are not copied
automatically.

Check the actual rendered strings against the packaged fonts, including Chinese
characters, arrows, punctuation and ellipsis. FontFace `loaded` status and a
successful export only show that the file is usable, not that it contains those
glyphs. Newly packed SDKs include `scripts/verify-ui-example-browser.mjs` and
`scripts/audit-ui-fonts.py`. These optional tools require Node.js 22+, Playwright
with an installed browser, and Python with `fontTools` for the font audit; they
do not add a mandatory project `verify` gate. From the SDK root (or using the
browser script's absolute path), run
`node scripts/verify-ui-example-browser.mjs --export <player-dir> --plan <plan.json> --out <evidence-dir>`.
It records real player input, Canvas text and screenshots, then invokes the cmap
audit. See [the runnable plan and external-tool setup](ui-components.md#optional-browser-observation-tools)
for a minimal `{}` plan, project-specific interaction matchers, `--python` and
Playwright module/browser selection. Set `requirePackagedGlyphCoverage: true` in the project's QA plan to make
missing packaged glyphs fail the audit. The audit covers observed text, so visit
every relevant screen/state and inspect the screenshots; it cannot prove an
unvisited string or visual shaping quality. Native appearance requires separate
native player validation.

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

Prefer the [official kit and two-instance card example](ui-components.md#construct-typed-leaves-and-components)
for new shared controls. Its typed constructors reduce repeated schema data;
`ui.component({...surface={kind="panel"}})` carries the background declaration
with the component. Project factories can compose the kit or return canonical
nodes directly. The following direct factories remain valid and show the
underlying transport; the engine does not know what their actions mean:

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

A reusable reading card keeps its decorative background intent beside its own
text hierarchy and wrapping. `background_for` is metadata on the image or panel
leaf, separate from `style.background` which paints a fill:

```luau
local function readingCard(id: string, heading: string, body: string): UiNode
    return {
        kind="component",id=id,component="ui.reading_card",
        rect={x=10,y=10,width=80,height=80},
        children={
            {kind="panel",id=id.."_paper",rect={x=10,y=10,width=80,height=80},
             background_for={component=id},
             style={background={0.03,0.04,0.06,0.95},border_radius=1}},
            {kind="text",id=id.."_heading",text=heading,rect={x=15,y=70,width=70,height=12},
             style={font_family="Display UI",font_size=4.5,font_weight=700,
                text_align="start",vertical_align="middle",color={1,0.9,0.65,1}}},
            {kind="text",id=id.."_body",text=body,rect={x=15,y=20,width=70,height=45},
             style={font_family="Reading UI",font_size=2,text_align="start",
                vertical_align="top",line_height=1.5,wrap="word",color={0.8,0.85,0.9,1}}},
        },
    }
end
api.ui.setRoot({kind="screen",id="reading",node="article",children={
    readingCard("notes","Field notes",
        "A short report keeps a readable type size while its paragraph wraps inside an authored rectangle."),
}})
```

### Explicit background scopes

An `image` or `panel` may declare exactly one `background_for` scope:

- `{component="ancestor_id"}` names an actual ancestor component's **node ID**,
  such as `notes` above, rather than its component name `ui.reading_card`.
- `{screen=true}` declares a screen background in the screen's coordinate space.

The parser checks that the background fits its scope and uses the same coordinate
space. A declaration cannot target a sibling, an unrelated component, or an
ancestor across a scroll coordinate boundary. Other leaf kinds cannot declare
background intent. Omit the field when a leaf is ordinary foreground artwork.

Strict layout diagnostics exempt an overlapping pair only when the background
comes first, the other leaf belongs to that declared scope, and the other leaf's
whole rectangle fits inside the background. Foreground text/control collisions,
partly covered leaves, unrelated siblings outside a component scope, and a later
background occluding an earlier leaf remain findings. Invalid scope declarations
fail before publishing the tree: `UI_BACKGROUND_KIND` rejects unsupported node
kinds, `UI_BACKGROUND_SCOPE` reports an invalid scope/ancestor or coordinate
space, and `UI_BACKGROUND_BOUNDS` reports a background outside its scope.
Structural errors can use the general `ui.setRoot` tree-parse diagnostic.
These rules do not move, resize, clip, reorder
or inherit styles; hosts keep the same authored drawing and input behavior.

Put the declaration inside the reusable Luau function so every instance carries
its background intent with its internal IDs. Normal card backgrounds then need
no external list of internal background/text pairs. Existing version-1 exact-pair
overlap policies remain available for deliberate layers that do not meet scope
containment, such as a slider's track/fill/handle skin. They retain their existing
validation and do not waive foreground text/control collisions; see
[the host overlap contract](formal-ui-host.md#intentional-art-overlaps-without-disabling-strict-checks).

For a skinned slider, give `control.view` the same `trackRect` used by its art.
The control combines the labelled field with a padded track hit region;
`hitPadding` defaults to `0.65` rectangle units and changes input tolerance only.
Do not enlarge or move the artwork to compensate for a separate project-owned
hit test. See [interactive sliders](ui-components.md#interactive-sliders) for
stage/scroll coordinates, vertical/reverse direction and cancellation behavior.

Create a retained official responsive model from authored variants, then resolve
it in the View:

```luau
local resolved = responsiveModel.resolve(api.ui.getViewport())
local title = ui.text({id="title",text="Settings",rect=resolved.rect("heading"),
    style={font_size=resolved.values.fontSize}})
```

This fragment assumes a model with a `heading` slot and a typed `fontSize` value;
the [complete lifecycle example](ui-responsive.md#create-once-resolve-in-a-pure-view)
shows its declaration. The project chooses semantic groups, thresholds and font
sizes. The package owns inclusive breakpoint selection and explicit row, column
and grid arithmetic. It does not measure text, choose a type scale or reflow
nodes implicitly. Layout padding/gaps use per-axis rectangle units; style
padding and fonts retain vertical design units. A component's children still
keep their coordinates.

Inspect the actual player at intermediate aspect ratios as well as desktop and
portrait. Explicit font sizes can clip at a narrower width even when the same
rectangles pass the default headless 16:9 preview. Choose a different authored
composition or type size, word wrapping, or intentional ellipsis for that case.
Headless layout reports are not glyph measurements on a different viewport.

In strict Luau, annotate a constructed leaf before inserting it into a typed
child list if the analyzer widens its `kind` literal to `string`:

```luau
local title: UiNode = {kind="text",id="title",text="Settings",
    rect={x=10,y=75,width=80,height=12},style={font_size=4}}
local children: {UiNode} = {}
table.insert(children,title)
```

The source-checkout example `_Games/observatory-settings/README.md` (not bundled
in the SDK)
demonstrates reusable cards, several font families/weights, selection, a draggable
level control, Apply/Reset state, wrapping and ellipsis in the official player.
It was first authored from a precompiled SDK and public documentation without
access to engine source or existing games; see the
[bounded usability validation](reviews/2026-10-16-ui-authoring-usability.md).

MVVM, screen managers, themes and binding lifecycles stay in Luau/SDKs; the
source-checkout reference `docs/ui-mvvm-architecture.md` is an architecture
proposal, not a bundled SDK file. Existing
[nine-slice/budget](ui-slice-and-budget.md) and [scroll helpers](ui-scroll.md)
continue to compose with styled leaves. Native scrolling remains explicitly
unsupported; styling does not change that capability boundary.
