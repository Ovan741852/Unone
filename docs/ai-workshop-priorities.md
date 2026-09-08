# AI workshop: what to strengthen next

This is a design assessment, not a claim that Worker/ECS APIs are implemented.
The workshop should let AI discover capabilities, run controlled experiments,
inspect evidence and choose changes. Human tools should consume the same APIs.

## Existing playtesting is useful

The developer API already supports input, pause/step, snapshots, screenshots,
journal and registered Luau test controls. Exported-payload parity and alternating
profile comparison runners already exist. These are sufficient for targeted
reproduction and regression, provided the game supplies meaningful scenarios
and assertions. They do not prove arbitrary gameplay is bug-free. Improve
reproducible scenario coverage and evidence correlation before inventing another
automatic tester. Current profiling additions correlate wake/tick/render spans
with actual VM allocation and incremental-GC measurements.

## Shipping reliability is broader than compressed scripts

`export.rs` currently embeds Luau **source text** in `content/project.json`, with
config and scene. It does not export Luau bytecode. The local measurement server
supports gzip transport; production hosting must configure compression itself.
Compression reduces transfer size, not script computation cost or source access.
Bytecode would need a pinned compiler/VM version, build metadata and debug/source
mapping decisions; evaluate startup savings before adding a second script format.

The important release guarantees are the selected production feature set,
absence of developer ABI/UI, hash-verified files, actual exported-host replay
parity, asset completeness, and measured cold download/startup on target devices.
Cache/version upgrades and interrupted loads deserve failure tests. Compression
does not substitute for any of these.

## Worker/job contract before parallel world mutation

Candidate work: one worker owning the whole simulation VM; independent asset
decode/preparation; batched path/neighbor computation; procedural geometry.
Moving simulation can free the main thread but does not eliminate simulation
cost. It adds scheduling/transport and may compete for limited mobile CPU time.
DOM input/UI and current audio/render integration need an explicit host boundary.
Do not promise an OffscreenCanvas backend without implementing and testing it.

A useful optional job abstraction should have operation/schema discovery,
bounded packed inputs/results, ownership rules, job ID, input revision, seed,
submit/apply tick, cancellation/invalidation, errors and capability discovery.
Gameplay results apply in a fixed order at a defined tick/barrier, never according
to completion speed. Reset invalidates outstanding work. Transfers, queue wait,
compute, validation, result application and deadline failures must be separately
measurable. Native may use a thread pool under the same contract. Unsupported
targets fail explicitly or use a declared equivalent synchronous backend.

Keep this aligned with the existing [WASM compute proposal](proposals/wasm-compute-v1.md),
which is still a proposal. Avoid two unrelated worker and WASM job APIs. Start
with one measured batch kernel and prove end-to-end gain against Luau.

## Optional ECS: useful only where data access dominates

The 10,000-unit example already stores game data in Luau arrays and publishes
packed instance batches. The renderer's instance count is not the core entity
count. Adding an ECS label does not automatically accelerate targeting, hashing,
GPU work or Lua arithmetic.

A reusable optional component store/query/batch-update primitive could help
games with many individually managed entities and repeated component iteration.
First measure lookup/iteration/bridge allocation cost. If justified, specify
component schemas, stable handles/generations, spawn/despawn, query ordering,
mutation barriers, save/replay and AI inspection together. Gameplay systems stay
in Luau. Compare the same workload and outputs against current arrays before
committing to migration. Do not require ECS for games that benefit from simpler
data ownership.
