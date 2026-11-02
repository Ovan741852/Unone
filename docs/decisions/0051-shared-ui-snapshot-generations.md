# 0051: Share validated Rust UI snapshot generations

Status: implemented; actual Linux Core and matching WASM validation passed

The UI package already owns immutable authored values and the host already
leases unchanged encoded publications. `EngineRuntime::observe` nevertheless
cloned the complete owned Rust `UiTree` on every tick. Snapshot capture is a
reusable engine responsibility, independent of game layout and gameplay rules.

Store the current validated tree and `WorldSnapshot.ui` as `Arc<UiTree>`.
Observing, cloning a snapshot and saving rollback state retain that generation.
Publishing authored data validates a fresh tree before installing a new Arc.
Developer candidate edits and retained-image count updates use copy-on-write;
resource validation succeeds before changing the active UI or registry. Old
snapshots keep their matching old tree and image-resource generations.

`UiTree` contains owned Rust data, without live Lua or interior-mutable handles.
Sharing it introduces no writable alias into the game. Mutable authored builders
and Luau APIs keep their existing ownership rules. Serde's Arc support serializes
the underlying tree, preserving the JSON structure and canonical digest.

The ownership tests cover unchanged sharing, authored detachment, snapshot
retirement, rejected updates, developer dry runs and reload/resource rollback.
Actual compilation/tests and paired emitted-WASM measurements must pass before
claiming this removes measured frame time. Rust Vec/String clone allocation,
Luau allocator growth, V8 GC and WASM linear capacity are different metrics.
This change alone does not certify all gameplay scenes at 60 FPS or GC frequency.

Actual execution and the bounded performance result are recorded in the
[validation review](../reviews/2026-11-03-shared-ui-snapshots.md). The battle
workload saves about 0.0082 ms per tick in UI cloning; its tail regression remains
open. A private immutable generation is useful ownership, but that result does
not justify presenting it as the solution to the reported frame-rate problem.
