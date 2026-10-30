# Sprite sheets and frame animation

A sprite can draw one cell of a sprite sheet, and the engine can step through
cells on the fixed tick. This is ordinary frame (flipbook) animation: walk
cycles, swimming fish, flapping wings, attack swings, blinking icons. Skeletal
Spine clips are a different contract and keep using `api.animation.play`.

The engine owns the timing. Every observation carries the resolved cell in
`sprite.frame`, so the Web player (Three.js, raw WebGPU and the runner's DOM
layer) and the native wgpu player only map that cell to texture coordinates.
Replays, `game test` and digests see exactly the cells the player draws.

## Sheets

`sheet` splits the whole texture into equal cells; `frame` picks one. Cells are
numbered from 0, left to right, then top to bottom:

```json
{
  "id": "hero",
  "sprite": {
    "asset": "texture://hero",
    "size": { "x": 1, "y": 1.5 },
    "sheet": { "columns": 4, "rows": 2 },
    "frame": 0
  }
}
```

A 4x2 sheet has cells 0..7; cell 6 is the third cell of the bottom row. The cell
is stretched to `size` like a whole texture would be. Without `sheet`, a sprite
draws the whole texture and `frame` must be 0. Sheets may have at most 65,536
cells. Cells must be laid out edge to edge with no padding; atlases with packed
or trimmed regions are not part of this contract.

## Clips

`sprite_animation` (in a scene entity or `entity.spawn` components) and
`api.entity.playSpriteAnimation` take a clip:

```lua
local SWIM = {frames = {0, 1, 2, 3}, fps = 8}               -- loops by default
local BITE = {frames = {4, 5, 6, 6, 7}, fps = 12, loop = false}

local fish = api.entity.spawn("fish", {
    sprite = {asset = "texture://fish", sheet = {columns = 4, rows = 2}},
    sprite_animation = SWIM,
})

-- later, in update
api.entity.playSpriteAnimation(fish, BITE)
local frame, finished = api.entity.getSpriteFrame(fish)
if finished then api.entity.playSpriteAnimation(fish, SWIM) end
```

- `frames` lists 1 to 1,024 sheet cells in play order. Repeat a cell to hold it.
- `fps` is cells per second of fixed-tick time (60 ticks per second), any finite
  number above 0. A clip that does not divide 60 evenly still steps on exact,
  replayable ticks.
- `loop` defaults to `true`. A non-looping clip stays on its last cell and
  reports `finished` once that cell has been shown for its full duration.

At observation frame `f` the clip shows step `floor((f - start) * fps / 60)`,
wrapped for a loop or clamped to the last cell otherwise. A clip declared in the
scene or started in `start` begins at the first observation. A clip started
during `update` shows its first cell in the next observation, so even a 60 fps
clip never skips its first cell.

## Script API

| Call | Effect |
|---|---|
| `entity.playSpriteAnimation(id, clip)` | Start a clip. Playing the clip that is already playing, even a finished one, changes nothing, so a game can call it every update for its current state. |
| `entity.setSpriteFrame(id, frame)` | Draw one cell and stop any clip. Use it to show a chosen state, to freeze, or before replaying the same finished clip. |
| `entity.getSpriteFrame(id)` | Return the cell drawn now and whether a non-looping clip has finished. Both are fixed-tick state, identical in replays. |
| `entity.setSprite(id, sprite)` | Swap the sprite. A running clip keeps its timing if its cells exist in the new sheet; a sprite without a sheet, or `nil`, stops it; a sheet that lacks the clip's cells fails. |

Errors fail loudly: `SCENE_SPRITE_INVALID` and `SCENE_SPRITE_ANIMATION_INVALID`
for scene and `spawn` data, `SPRITE_FRAME_INVALID` and `SPRITE_ANIMATION_INVALID`
for the calls above (no sheet, a cell outside the sheet, a fractional frame, an
empty clip, a non-positive fps or a wrong field type), and
`OPTION_UNKNOWN_FIELD` for a misspelled clip field.

Cost, measured with `profile_native` (release) on 1,000 sheet sprites: running
clips adds no measurable tick time and no Luau allocation over static sprites
(about 0.24 ms per tick either way). Calling `playSpriteAnimation` for all
1,000 every update adds about 0.5 ms per tick and `getSpriteFrame` about
0.1 ms; neither allocates Luau memory. On the Web, the Three.js path rewrites a
sprite's uv only on a cell step (about 250 of 1,000 sprites per frame at 8-24
fps, 8 KB of uploads) and allocates nothing per frame.

## Hosts

Hosts read `sprite.sheet` and `sprite.frame` from the snapshot and sample the
image-space rectangle `(column / columns, row / rows, 1 / columns, 1 / rows)`;
`spriteCellRect` in `web/shared/webgpu-snapshot.js` is the shared Web helper.
The Three.js renderer gives a sheet sprite its own copy of the sprite plane and
rewrites its uv only when the cell changes, so the shared texture is never
offset. [Shader materials](shader-materials.md) on a sheet sprite receive the
cell's uv, not the whole sheet's. Native instances carry the rectangle as four
extra floats.

Not included: per-cell durations, events at a cell, blending between clips,
flipping, packed atlases or a timeline editor. Game rules that react to a cell
read `getSpriteFrame`.
