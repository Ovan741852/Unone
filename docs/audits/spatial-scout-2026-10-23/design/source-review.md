# Spatial v1 independent source/design review

Date: 2026-10-23. Scope: the uncommitted pure-engine spatial implementation, its
CPU/native GPU/WebGPU executors, Luau binding, tick/reload integration and API
discovery. This is a read-only review. Only new audit artifacts in this directory
were written. No source correction, rebuild, account access or real game use was
performed.

The evidence runner is `probe.mjs`; its complete existing-debug/release CLI
commands, executable hashes, exit statuses and raw output are retained in
`numeric-repro-output.json`. The generic project is `tiny-normal/`. The standalone
Rust source `numeric-repro.rs` was prepared but was not compiled or executed.

## Confirmed findings

### P2: accepted tiny coordinates produce an invalid CPU result and fault the manager

Location: `crates/unone-engine/src/spatial.rs:274-277`, with rejection at
`:255-259` and manager faulting at
`crates/unone-engine/src/runtime/spatial.rs:230-236`.

Create one body `{id=1,position={3e-23,0,0},radius=0}` and submit nearest from
`{0,0,0}` with `max_distance=1`. This obeys the documented finite f32 range and
passes input validation. Both existing debug and release CLIs fail on tick 1 with
`spatial result[0] contains invalid contact geometry` (exit 1).

`normal_or_z` squares the tiny displacement before normalization. The squared
length rounds to the minimum f32 subnormal, giving a normal x of about 0.8014122
and squared normal length about 0.6422616. The executor therefore produces a
result rejected by its own envelope validator, and the manager becomes faulted.
The scenario is far below ordinary world scales, but no minimum scale is part of
the accepted input contract. This is a concrete numeric-contract defect, not
CPU/GPU differential tolerance at a collision boundary.

Correction: normalize after scaling by the largest absolute component (including
the shared WGSL normal function), or explicitly reject a documented unsupported
numeric scale before accepting a batch. Add a bounded regression that requires
the CPU executor's valid-input output to pass `validate_result`.

### P2: portable SDK omits the full spatial authoring contract

Locations: `crates/unone-cli/src/sdk.rs:646-660` and `:745-753`,
`crates/unone-engine/src/runtime_packages.rs:61`, and
`crates/unone-engine/src/api.rs:2409-2427`.

Static source tracing confirms SDK packing takes compiled `runtime_package_files`,
four fixed `authoring_files`, Web templates and runtime binaries. None includes
`docs/spatial-batches.md`. The new API descriptors also do not direct readers to
that document. Thus an AI author given only a newly packed SDK cannot read the
complete contract delivered in the repository: host `spatial_backend` policy,
moving-body `previous_position` interval, surface-point semantics, full capacity
and reload rules. The Web adapter files are distributed, but reading adapter
implementation is a poor substitute for a public contract.

Correction: include the spatial guide as a compiled canonical SDK authoring file,
link it from `spatial.submit`/`info` discovery, and verify the packed inventory.
This finding is established by the complete pack inventory in source; no new SDK
package was built during this review. A blind author explicitly supplied the
guide exercises docs-assisted API use rather than this SDK discovery path.

### P3: public JavaScript vector validation accepts sparse arrays and packs NaN

Location: `web/shared/spatial-gpu.mjs:9` (the `vector` predicate), used by
`validateSpatialGpuBatch` and `packSpatialGpuBatch`.

For a public JS batch whose body position is `new Array(3)`, validation succeeds
because `Array.prototype.some` skips holes. Packing then converts the missing
coordinates into NaN. The isolated Node repro records
`{accepted:true,packedPosition:["NaN","NaN","NaN"]}`. This violates the exported
validator's finite-input promise. Canonical batches emitted by Rust have dense
arrays, so the official Luau/Web path does not expose this particular malformed
input.

Correction: check all three explicit indexed elements, including their presence
and finite numeric values, before GPU allocation. A direct JS validator regression
is sufficient.

### P3: common collision discovery phrase misses the new capability

Location: `crates/unone-engine/src/api.rs:2409-2427`.

The existing debug CLI returns no matches for
`game api search 'batch collision' --json`. The descriptors use spatial/sphere/sweep
but do not mention collision or CCD. An AI starting from the user's ordinary
wording can consequently miss the primitive. The fallback advises listing the
whole index, so this is a recovery/discovery cost rather than a false claim that
the capability is unavailable.

Correction: add scoped generic collision/continuous collision/CCD search wording
and point discovery results at the complete spatial guide. Keep gameplay-specific
verbs and policies outside the engine.

## Other source observations and bounded conclusions

- The primitive ownership boundary is sound: the spatial modules have no scene
  mutation, movement integration, targeting policy, damage or game content.
- Ticket snapshots, next-tick delivery, atomic replacements, no wraparound,
  deferred dispatch after script/physics success and transactional reload are
  explicit and supported by targeted existing tests. No new P1 lifecycle or
  memory-safety defect was confirmed in the reviewed paths.
- The CPU nearest comparator uses squared distance while WGSL compares rounded
  square roots. This can collapse nearby distinct distances into a GPU tie.
  The guide explicitly permits near-boundary membership/tie differences, so this
  review does not present it as a new contract violation. Aligning comparison
  arithmetic would remove one avoidable source of differences.
- Dense overlap overflow faults the whole manager after update rather than
  returning a recoverable ticket error. The guide states this policy clearly;
  it remains a design tradeoff for v1, not an undisclosed bug in this report.
- Local native execution waits and WebGPU readback blocks the next fixed tick;
  all kernels scan the complete batch and allocate per dispatch. These are
  documented v1 limits. No speedup or cross-device deterministic lockstep was
  inferred.
- The main reviewer reported a separate blind-author observation/type failure.
  Source tracing supports that `info().limits.safe_integer` (2^53-1) meets the
  i32-only integer branch in `runtime/bindings/value.rs:22-27,106-110`, despite
  `info` being typed as an observation-value map. That runtime reproduction and
  the distinct result-to-observation type mismatch belong to the blind report;
  they were not independently re-executed here.

No score was assigned. No fixes were applied.
