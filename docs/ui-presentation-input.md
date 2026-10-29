# Text shadow and nonvisual input regions

`UiStyle.text_shadow = {offset_x, offset_y, color}` paints a sharp copy of the
same shaped glyph layout before the foreground. Offsets are finite values in
`-100..100`, in viewport-height units: one unit is 1% of viewport height on both
axes. Positive x paints right; positive y paints down, including on a y-up stage.
Color is four finite RGBA values in `0..1`. Unknown fields, blur, missing values
and invalid colors are rejected. No font size, weight, padding, wrapping, tracking
or foreground baseline is changed. Each pass clips to its translated content
rectangle, then the parent clip and viewport. Opacity composites the complete
leaf once. Inspection reports the union paint rectangle, using the actual
viewport aspect, separately from the unchanged authored rectangle.

This new capability is implemented and tested in the official Web Canvas host
for `text`, `button`, `slider`, and `combobox`. Editable `text_input`, native text
shadow, and the legacy DOM host explicitly reject it. It is not yet a verified
platform-neutral presentation capability.

`ui.inputRegion({id, action, rect})` (also `api.ui.components.inputRegion`) is a
typed nonvisual leaf. It accepts ordinary placement and a nonempty action, no
text, style, asset, children, or implicit layout. It consumes one logical/leaf
node and zero render regions. The official Canvas host uses the same half-open
rectangle, clip, reverse input order, full-stream capture, shared-action holds,
removal/action-change cancellation, reset and release tails as a button. The
host does not invent keyboard focus/navigation; project input owns those
policies exactly as it does for Canvas buttons. Disabled scroll ancestors remove
the region from host input projection. Native input-region source support is
present, but requires a separate native build/player acceptance before claiming
cross-platform parity. Legacy DOM explicitly rejects the new leaf.

An input region cannot visually occlude text or art, so it has no visual
collision with them. Region/region and region/other-interactive overlaps remain
errors at their authored capture rectangles. Ordinary text/button and all other
visual collision checks remain active. There are no overlap-policy exceptions,
budget changes, relocated glyphs, inferred transparent buttons, or text images.

```luau
local ui = api.ui.components.create()
local rect = {x=20,y=40,width=30,height=10}
api.ui.setRoot(ui.screen({id="menu",node="menu",children={
    ui.text({id="label",text="Continue",rect=rect,style={
        font_size=3,font_weight=400,padding={},
        text_shadow={offset_x=.15,offset_y=.15,color={0,0,0,1}},
    }}),
    ui.inputRegion({id="capture",rect=rect,action="Continue"}),
}}))
```
