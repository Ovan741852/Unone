# 3D physics measurements — 2026-09-08

Machine: AMD Ryzen 9 9900X, Windows. Native numbers use Rust release builds;
WASM numbers use the optimized development player. These are local measurements,
not Android/BlueStacks or low-end hardware guarantees. Background applications
and development builds can affect tail latency. No timing assertion is installed
as a flaky machine-independent unit test.

## Native physics wrapper

120 measured ticks after 60 warmup ticks (240 for sleeping). Active sparse bodies
are radius-0.5 spheres in a 3-unit lattice, touching a large static floor, moving
at 0.1 units/s with gravity disabled and sleeping disabled. Dense stacks use
1.01 spacing, 20x20 per layer, gravity enabled and sleeping disabled. Sleeping
bodies settle on the floor. Each row adds one static floor to the listed count.

| Bodies | Active sparse median / P95 | Dense active median / P95 | Sleeping median / P95 |
| ---: | ---: | ---: | ---: |
| 250 | 0.424 / 0.836 ms | 0.414 / 0.692 ms | 0.0005 / 0.0005 ms |
| 1,000 | 2.352 / 3.894 ms | 2.301 / 3.969 ms | 0.0021 / 0.0023 ms |
| 4,000 | 16.867 / 20.167 ms | 16.834 / 20.064 ms | 0.0115 / 0.0218 ms |

This includes the persistent solver, state checks, contact reporting and sleeping
fast path. The benchmark has no entity map to synchronize; entity Transform3D
updates, Lua, snapshots, JSON, input and rendering are excluded. The 4,000-active
case already exceeds a 16.67 ms 60 Hz budget before adding those costs.

The first measurement found 4,000 sleeping bodies still cost about 7.55 ms/tick.
An unchanged sleeping-world fast path now skips the solver, query-tree rebuild and
contact-list allocation. Collider/joint changes, wake commands and kinematic motion
invalidate that path. Tests cover sensor lifecycle after static teleport/query and
body removal so the optimization cannot consume a pending collision change.

## Actual exported WASM

`node scripts/benchmark-physics3d-player.mjs --export <development export>` uses
the emitted loader/WASM, 10 warmup ticks and 60 samples. This is free flight without
contacts or sleep, and **includes** observation/digest publication. No renderer,
GPU, input transport or human panel polling is included.

| Bodies | Tick + publish median / P95 | JS JSON decode median / P95 | WASM capacity |
| ---: | ---: | ---: | ---: |
| 250 | 2.595 / 3.605 ms | 1.039 / 1.696 ms | 16 MiB |
| 1,000 | 10.879 / 12.782 ms | 4.193 / 6.795 ms | 16 MiB |

These observations identify an additional budget constraint: full world JSON
publication and decoding across the host boundary. Faster collision detection
alone does not make 1,000 rendered active bodies comfortably fit every 60 Hz frame.
WASM capacity is allocated linear-memory capacity, not live physics usage.

The browser Physics Lab (44 bodies, moving platform, active human panel, 1280x720)
showed simulation P50/P95 1.00/2.30 ms, physics mean 0.55 ms, renderer CPU 0.40 ms
at sampling and GPU median 1.845 ms. These asynchronous samples are not additive
per-frame measurements and do not establish a device-independent FPS guarantee.

## Acceptance

Final uncompressed core WASM: production 2,364,984 bytes, development 2,458,190
bytes. Physics adds approximately 0.93 MB to the previous core player, with no
additional physics WASM download. These sizes exclude JavaScript, Three and assets.

243 workspace tests passed, 2 manual benchmarks ignored by the ordinary suite.
All 10 focused physics behavior tests pass; the manual release benchmark also
passes. Native pacing tests cover 30/60/144/240 Hz and bounded catch-up.
Both player variants compare the actual emitted physics payload at frames
0/1/30/120/360 against native CLI. Mutating emitted gravity must fail parity;
the earlier exported-audio negative control remains active as well.

There is no claim of full native/Web rendering parity, Android ARM replay parity,
arbitrary dense-scene scalability, or a complete resumable physics save format.
