# Asset cursor on the official Web host

`api.ui.setCursor(cursor)` declares presentation only. Games choose resource,
state and timing in Luau; the engine does not choose gameplay cursor meanings.

```lua
api.ui.setCursor({kind="image",asset="texture://pointer",width=17,height=17,
    hotspot_x=0,hotspot_y=0,filter="nearest"})
api.ui.setCursor({kind="hidden"})
api.ui.setCursor({kind="default"})
```

Image width/height are integer drawing-buffer pixels in1..512. The integer
hotspot lies within the declared image; coordinates point right/down. `filter`
is explicit `nearest` or `linear`. Assets must be declared image resources;
the official Web host resolves them through the existing asset manifest and
image encoding guard. Schema-invalid changes preserve the previous state.

The Web host draws the image after the UI on its own passive2D overlay. Real
mouse/pen coordinates are mapped using the current canvas CSS rectangle and
drawing-buffer extent, including DPR/resize. The overlay never creates input
events, captures a pointer, adds hit regions or changes simulation coordinates.
It clips to the canvas. Touch, leave, blur, pending images and default mode
restore the canvas's prior CSS cursor. Stale asynchronous images cannot revive
a cleared cursor. Hidden mode hides only while a real mouse/pen is inside.

Absent/default omits `ui_cursor` from Core snapshots and keeps existing games'
snapshot shape. New scenes clear cursor state. This version implements the
official **Web host** only; native cursor presentation is not implemented.
Core declarations/headless replays do not prove a host painted a cursor.
There is no pointer-lock, OS acceleration or game-specific policy here.

The player's public `data-player-cursor` metrics report mode, visibility,
resource and pixel rectangle. The cursor layer is not a source-game raster
equivalence claim: source palette conversion, hotspot and selection policy
must be separately established by the project.
