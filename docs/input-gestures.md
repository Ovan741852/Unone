# Shared touch gestures

`@unone/gestures` **0.1.0** is the official pure Luau runtime package for
single-finger pan and two-finger translation, pinch and rotation. The input
system owns physical identities and delivery; this package owns reusable
recognition; the game owns picking, hit regions, cameras, commands and bounds.
There are no game rules or gesture math in Rust or the renderer.

## Enable and discover

```json
{"runtime_packages":{"@unone/gestures":"0.1.0"}}
```

In `player.presentation.json`, set `"physical_input":"ordered_physical_v1"`.
See [the input contract](ordered-physical-input.md). The official Web main and
Worker hosts support this live input. Core replay supports the same normalized
rows. Native/mobile/custom live hosts retain their existing explicit limits;
installing this library does not implement device support for those hosts.

`api.input.gestures.info()` returns frozen package metadata and `declared` even
without a declaration. `create` requires the exact version. It is available
with required Core input, independently of the optional UI system. Portable
SDKs contain the source/manifest/guide, canonical typings and package inventory.
Old player runtimes reject a declared package they do not contain; rebuild or
select a matching player rather than deleting the declaration.

## Persistent recognizer

```luau
local gestures: GestureRecognizer
local function start(api: EngineApi)
    gestures = api.input.gestures.create({
        panThreshold=6,
        minPinchDistance=2,
        accept=function(point: GesturePoint): boolean
            -- Authored hit region in physical canvas coordinates.
            return point.y >= point.viewport.height * 0.15
                and point.y < point.viewport.height * 0.75
        end,
    })
end
local function update(api: EngineApi, _dt: number)
    local batch=api.input.getPhysicalBatch()
    if not batch then return end
    for _,row in batch.events do
        local result=gestures.process(row)
        for _,event in result.events do
            if (event.phase=="change" or event.phase=="start") then
                -- Apply to game-owned state. Pixel delta -> world conversion,
                -- camera bounds, inverse span scaling and actions are authored.
                -- Pinch spread: event.scale > 1. A camera span normally divides.
                -- event.rotation is incremental radians; ignore if undesired.
            end
        end
        -- For a separate game tap/order handler, skip rows when result.consumed.
        -- Also cancel any pending single-pointer command on any gesture start
        -- or gesture cancellation. The package cannot undo a game action.
    end
end
return {start=start,update=update}
```

Refresh canonical `EngineApi`, `GestureOptions`, `GestureRecognizer`,
`GestureResult`, `GestureEvent` and readonly `GesturePoint` using `game api typings`; the example assumes
those types are in scope. Create once in start, process once per row in update.
Do not feed the same batch twice, skip control/UI rows, move resets ahead of
earlier rows, or synthesize legacy pointer events on an empty ordered batch.

Options are copied on construction: `panThreshold` defaults to 6 physical
canvas pixels (finite >= 0); `minPinchDistance` defaults to 2 (finite > 0);
`enabled` defaults true. Optional `accept(frozenPoint)->boolean` runs only for
game-owned touch down inside the canvas. Rejected starts remain rejected until
release. It must be pure, return boolean and never reenter recognizer methods.
Unknown options, nonfinite values and invalid predicates fail explicitly.

## Results and ownership

Each `process(row)` returns a detached frozen result:

| Field | Meaning |
| --- | --- |
| `events` | Dense ordered pan/transform events; one row may cancel pan then start transform |
| `consumed` | Advisory: skip this physical row in the game's separate tap/order handler |
| `captured` | Recognition or suppression active; not browser pointer capture |
| `contacts` | Number of tracked touch contacts, including rejected/UI starts |

No result changes Core input or prevents UI actions. Mouse/pen, key, wheel and
unrelated rows are ignored. UI-owned touch contacts cannot start gestures but
cancel a pending game pan if combined with another touch. A touch down below
the pan threshold remains unconsumed so the game can implement its own tap.
Tap/double-tap, swipe velocity, inertia and long-press policy are not in v0.1.
Use the existing UI slider/scroll controls for UI dragging.

Every event has `kind=pan|transform`, `phase=start|change|end|cancel`, `x/y`,
`previousX/Y`, `deltaX/Y`, `scale`, `rotation`, frozen `viewport` and optional
`reason`. Coordinates and pan thresholds use **physical canvas pixels**,
top-left/y-down, matching ordered input; not CSS pixels or normalized UI units.
Pinch distance uses both physical axes directly, including portrait canvases.
Rotation is incremental clockwise radians in [-pi, pi), with pair ordering by
stable numeric pointer ID. Pinch scale is new distance / previous distance.
The pan start includes displacement from its down position. Transform start,
end and cancel have zero deltas, scale 1 and rotation 0. Changes use admitted
move rows; release ends at the last admitted move. Tiny/overlapping contacts
retain translation but re-baseline scale/rotation, avoiding division by zero.

Starting a second touch cancels active pan and starts transform. After either
finger releases, the remaining finger cannot become a pan until every touch
lifts. A third finger cancels transform; returning to two valid contacts starts
a fresh baseline without a jump. Focus loss or global reset clears contacts.
Pointer cancel, active capture loss, viewport revision change, `cancel()` or
`setEnabled(boolean)` cancel recognition and suppress held contacts until fresh
starts. Re-enabling cannot resurrect a held gesture. `status()` returns a
detached frozen `{enabled,contacts,captured}` without advancing recognition.

The methods return their cancellation events immediately: process results from
`cancel()`/`setEnabled()` just like event results. Mutating a recognizer inside
a virtual render callback fails `UI_PURE_VIEW`. Result tables are immutable;
recognizers expose no mutable bookkeeping. Invalid authored input/predicates
fail and cancel the active gesture rather than leaving a half-started action.

## Browser ownership

The official ordered-input router sets `touch-action: none` on its canvas for
its lifetime, preventing page pan/pinch from stealing Pointer Events. Disposal
restores the previous inline value/priority unless another owner changed it.
This only applies when ordered input is enabled. It does not disable page
zoom globally or alter the legacy input path. Browser focus, iframe permissions
and actual device acceptance still follow the host contract.
