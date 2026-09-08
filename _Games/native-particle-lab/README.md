# Native particle lab

Three moving mage orbs shed deterministic fairy dust. Dust spreads outward, falls under gravity, shrinks and fades over 36 ticks (0.6 s). A fixed seed/input/frame produces the same particle snapshot on each host.

`main.luau` owns the paths and three-tick emission cadence. `scene.json` owns the editable effect definitions. `api.particle.play_batch` copies packed XYZ positions; `api.particle.stats` exposes usage to AI. This is a presentation probe, not a troop benchmark.
