# Unone Scatter

Scatter trees, grass, rocks and props over an area or a
[heightfield](../../docs/heightfields.md): evenly spaced random points
(Poisson-disk sampling) filtered by height, slope and your own rule, with
random yaw and scale, packed for `api.instances3d.set`. It is a pure,
deterministic Luau module: the same options and seed always give the same
points, so replays and tests stay exact.

```powershell
game --project <game> plugin call --id org.unone.scatter --tool scatter.install --input empty.json
```

copies `unone-scatter.luau` beside the entry script. Then:

```luau
local Scatter = require("./unone-scatter")

local trees = Scatter.points({
    heightfield = terrain,          -- the definition you passed to api.heightfield.set
    spacing = 3, seed = 7,
    maxSlope = 30, minHeight = 1,
    scale = {min = 0.8, max = 1.3},
    accept = function(x, y, z) return not isRoad(x, z) end,
})
api.instances3d.set("trees", "mesh://tree", Scatter.pack(trees))
```

| Option | Default | Meaning |
|---|---|---|
| `area` | heightfield extent | `{x, z, width, depth}` |
| `spacing` | required | minimum distance between points |
| `seed` | 1 | any integer |
| `heightfield` | none | places points on it; enables height and slope rules |
| `minHeight`, `maxHeight` | none | world height range |
| `maxSlope` | none | degrees from flat |
| `scale` | `{min = 1, max = 1}` | uniform scale range |
| `yaw` | true | random rotation around up |
| `limit` | 100000 | at most this many points |
| `accept` | none | `function(x, y, z) -> boolean` |

`Scatter.heightAt(field, x, z)` gives the ground height on the same triangles
the engine draws (nil outside the field).

Tests: `luau plugins/org.unone.scatter/test/scatter.test.luau`.
