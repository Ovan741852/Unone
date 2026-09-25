# Circle broadphase

The existing 2D circle solver uses a deterministic dynamic uniform grid. Game
rules stay in Luau; candidate pruning is an engine implementation detail. This
does not turn the 3D engine into a 2D engine or add a 3D rigid-body solver.

Cell size follows the median diameter. Oversized and out-of-range bodies use a
conservative fallback. Candidates and responses preserve ascending entity-ID
order. The grid updates after corrections and visits newly entered cells so
correction-created contacts retain the former single-pass behavior.

Regression tests compare exact transforms, velocities and contact order against
the brute solver across seeded mixed-radius/static scenes. The release benchmark
is reproducible with:

```powershell
cargo test -p unone-engine --release --lib broadphase_benchmark -- --ignored --nocapture
```

On the measured sparse lattice, 1,000 bodies took 1.95 ms for grid physics versus
41.39 ms for the former collision phase; 4,000 took 11.21 versus 1,022.37 ms.
These medians are nine samples, not end-to-end FPS.

The solver resolves pairs through body indices instead of per-pair entity-ID map
lookups, and each body's grid occupancy is a cell rectangle rather than an
allocated key list. Arithmetic and pair order are unchanged; digests match the
prior solver exactly. Dense overlap is measured separately:

```powershell
cargo run -p unone-engine --release --example physics2d_stress -- 30 300
```

2026-09-25, same Windows x86_64 machine, before/after this change: dense 45x45
overlapping bodies 4.20-4.45 to 2.02-2.30 ms median tick (three runs each,
digest `sha256:0844bbda...` unchanged); sparse lattice grid physics 1.05 to 0.78 ms
at 1,000 bodies and 4.98 to 3.78 ms at 4,000. Grid maps/ordered sets add
logarithmic overhead; dense occupancy and oversized fallback can still approach
quadratic work. The Dragon probe disables physics2d, so these results do not
demonstrate a performance increase in that 3D scene. Raw values and scope are in
`_Games/dragon-tycoon3/release-measurements.json`.
