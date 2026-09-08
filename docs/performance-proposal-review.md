# Profiling proposal review — 2026-09-08

The explicit debug/release marker and opt-in canonical serialization probe already exist and are useful. This review retains them, but corrects interpretation and window accounting. It does not change canonical observation bytes or replay baselines.

## Corrections

- `luau_allocated_bytes_per_frame` was calculated as `max(used_memory_after - used_memory_before, 0)`, not allocator throughput. Allocations collected inside the same frame disappear from this estimate. Rename it to `luau_positive_heap_delta_bytes_per_frame`; the misleading old diagnostic key is removed. This is a profiler output migration, not a game-state/schema change. Existing historical reports retain their old keys and must be interpreted as positive net heap deltas.
- Heap-delta and synthetic serialization counters now respect the same active/stopped window as frame timings. Previously they could continue accumulating after profile.stop while the frame denominator stayed frozen.
- Serialization mean uses the number of explicitly measured serialization frames. Phase shares include measured serialization in their denominator so reported shares remain coherent.
- `observation_bytes` means canonical snapshot JSON bytes, not actual Web presentation bytes or compressed network transfer. A binary instance presentation can be much smaller. JSON encode and browser decode timings are separate measurements, not equal costs.

These counters alone cannot establish that GC caused a p95 spike. Exact allocator traffic, GC pauses and per-function allocation attribution need separate instrumentation. The existing `publication` and `host_window` phases remain the appropriate tools for the exported Web player.

## Proposed representation changes

A local CLI snapshot of the current Legion Fall game at tick 3 is 535,927 bytes after JSON compaction. Recursively omitting object properties with null values leaves 535,896 bytes: 31 bytes, **0.0058%**. Arrays are not compacted. This diagnostic transformation was measured outside the engine and was not applied to runtime state. It is a single workload sample, not a general compression benchmark.

The screenshot's 17% / 62% claims have no supplied fixture or measurement methodology, so they cannot be treated as this game's savings or as FPS gains. Null omission has negligible benefit here and would change byte-level digests, so it is not adopted.

Separating static declarations from per-frame presentation has architectural value, especially for scenes with many full entity objects. The current game already uses WASM-memory instance transport and canonical SHA prefix reuse. A further static/dynamic transport should preserve full canonical verification independently, have explicit revisions/resynchronization semantics, and first demonstrate an end-to-end bottleneck on representative exports. Do not remove data from the authoritative snapshot simply to obtain a smaller payload.

The useful immediate change is more trustworthy profiling, not a new snapshot contract. Source tests cover stopped-window freezing, measured-frame denominators, phase shares and existing runtime behavior. Existing served WASM exports remain the previously built versions; this review does not silently replace them or claim a new FPS result.
