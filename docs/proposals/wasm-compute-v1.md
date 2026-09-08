# Game-owned WASM compute modules — proposed v1 contract

**Status: design only. The engine does not yet load gameplay WASM modules.** The APIs and manifest below are proposed, not callable today. Do not add module declarations to current `ProjectConfig`: its unknown-field rejection is intentional. Existing `unone.plugin.v1` plugins are AI-facing external processes, not gameplay compute modules.

Independent review has **not approved production implementation** of this
proposal. See [blocking findings](../reviews/2026-09-08-worker-ecs-blind-review.md).
The isolated [v0 contract model](../../experiments/compute-contract/README.md)
tests narrower lifecycle choices; it is not this proposed v1 ABI or a second
supported API. Before implementation, reconcile those choices and the remaining
host/executor/layout gates into one authoritative contract.

The separate [implemented Luau jobs API](../jobs.md) accepts Luau source and buffers. It does not implement this WASM module ABI or Web Worker backend.

## Ownership

Luau owns gameplay state, scheduling, rules and applying results. A game may package its own Rust/C/C++ algorithm as WASM without modifying engine Rust. The engine owns loading, ABI validation, buffer exchange, deterministic delivery, resource limits and measurement. Modules cannot access ECS, rendering, files, network, clocks or engine pointers.

V1 is **stateless batch computation**: all persistent state is explicit input/output. Scratch allocation and caches are permitted only if they cannot change results. Examples include neighbor queries, path batches, procedural geometry and numerical kernels. There is no per-entity callback ABI. Measure first: conversion, copying and worker dispatch may outweigh small kernels.

## Proposed module manifest

Store beside the module as `neighbors.module.json`; the future project declaration will explicitly reference manifests rather than scanning arbitrary WASM files.

```json
{
  "abi": "unone.compute.v1",
  "id": "neighbors",
  "wasm": "neighbors.wasm",
  "sha256": "<64 lowercase hexadecimal characters>",
  "memory_max_pages": 1024,
  "operations": [
    {
      "id": "nearest",
      "opcode": 1,
      "input_stride": 16,
      "output_stride": 4,
      "max_items": 100000,
      "layout": "nearest-v1.md"
    }
  ]
}
```

`wasm` and `layout` are relative paths contained within the module package. Unknown manifest fields, duplicate operation IDs/opcodes, hash mismatches, unsupported ABI versions and unsupported target hosts are errors at validation/export time. A layout document must specify byte offsets, units, coordinate space, scalar types, ordering, sentinel values and tie-breaking; stride alone does not describe an algorithm. A future machine-readable layout schema must be shared by validation and generated AI documentation.

The example input is a dense array of `{id:u32, x:f32, y:f32, z:f32}` records, little-endian, 16 bytes each. Output is one `u32` neighbor ID per input record; `0xffffffff` means no neighbor. Distance ties choose the smaller ID. IDs must be unique and coordinates finite. This is an example operation, not an engine-owned targeting rule.

## WASM ABI

Memory32 only, one exported unshared `memory`, no WASI or arbitrary imports. A module exports:

```text
unone_abi_version() -> u32                         // must return 1
unone_alloc(byte_length: u32) -> u32               // 0 means allocation failure
unone_free(pointer: u32, byte_length: u32)
unone_compute(opcode: u32, context_pointer: u32,
              input_pointer: u32, input_length: u32,
              output_pointer: u32, output_capacity: u32) -> i32
```

`unone_compute` returns written byte length (including zero), or a negative error: `-1` unknown operation, `-2` invalid input, `-3` insufficient output capacity, `-4` invalid numeric result, `-5` computation failure. Traps are host-level `COMPUTE_TRAP` diagnostics. Output length must fit capacity and the operation's stride/item limit. Pointers and length additions are validated without integer overflow, including after memory growth. The host frees each successful allocation exactly once using its original length; any failure cleans up remaining allocations before reuse or disposal.

Allocations must be disjoint, at least 8-byte aligned and valid for their entire requested length. Context, input and output may not overlap; output capacity is the checked product of output stride and the declared maximum item count. Input length must be a multiple of input stride; the derived item count must fit the operation limit. Zero-length input is allowed only when the operation layout defines its result. A module may not retain host job allocations after return. Host-side validation cannot make an arbitrary module's algorithm trustworthy: operation acceptance tests must check semantic correctness too.

The context is 32 little-endian bytes: magic `0x31434e55` (`UNC1`), ABI version `1`, tick low/high `u32`, seed low/high `u32`, item count `u32`, reserved zero `u32`. V1 has no hidden RNG; a randomized algorithm must derive its deterministic stream from the supplied seed and explicitly specified operation semantics.

Pointers always belong to **that module's memory**. They are never Luau pointers, engine WASM pointers or GPU pointers. The initial implementation copies batch inputs into module memory and copies validated results out. Sharing/importing engine memory is not a v1 assumption. Browser memory growth invalidates old JS views; callers recreate them before access. Raw pointers are not exposed as persistent Lua handles.

## Proposed Luau scheduling contract

```lua
-- Proposed, not implemented:
local job = api.compute.submit("neighbors", "nearest", inputBuffer)
-- At the next simulation tick, after the engine's compute barrier:
local outputBuffer = api.compute.take(job)
-- The game validates domain meaning and applies the IDs to its own state.
```

Submission copies/freezes input at tick N. All jobs from N are delivered before `Game.update` at N+1, ordered by submission ordinal rather than wall-clock completion. A slow worker delays simulation advancement; it does not cause Lua to receive a machine-dependent `not ready` result. Rendering may continue to show the last completed frame. Job handles include runtime generation; reload/unload invalidates old handles and rejects stale results explicitly. `take` is one-shot, and unknown, stale or already consumed handles produce distinct errors.

V1 does not support synchronous reentrant Lua → JS → module → engine calls. Browser work runs in Workers; native uses a separately hosted WASM executor. Both must implement the same barrier, input snapshot and error semantics. This introduces one explicit simulation-tick latency; games that cannot tolerate it should retain that calculation in Luau or use an existing engine primitive.

## Limits, failures and replay

Start with host-enforced limits: 16 jobs/tick, 8 MiB input/job, 8 MiB output/job, and at most 1,024 memory pages (64 MiB) per module instance. Manifest limits may only reduce host caps. Exact defaults remain subject to measured implementation acceptance. Browser Workers allow watchdog termination; a deadline is an operational failure, not deterministic gameplay input. Native must likewise be interruptible. Do not pretend native fuel accounting and browser wall-time limits are equivalent.

Invalid outputs, traps, deadline failures and missing modules stop the affected simulation with structured diagnostics; they do not apply partial output, skip a job or fall back to a different algorithm silently. There is no automatic retry that could apply a result twice. Diagnostics include module hash, operation, job, tick, input digest and phase; no arbitrary memory dump is required.

Replay pins module bytes, ABI, operation layout, engine/host versions, seed and submitted inputs. Validate deterministic ordering and finite values; do not promise arbitrary WASM is automatically deterministic. Threading, relaxed SIMD, ambient imports and nondeterministic outputs are excluded from v1. Test identical byte output on Web/Node and native before advertising cross-host support.

Operation layouts must define output cardinality, float rounding, signed-zero handling and overflow policy. Reject NaN/infinity in declared float fields; do not compare unspecified NaN payloads as deterministic output. Compiler options that reassociate arithmetic or change floating-point semantics require a new validated artifact. Finite-value checks do not replace byte-for-byte reference and cross-host tests.

## AI discovery and diagnostics (proposed)

Before calling an extension, an AI should query a future `compute.capabilities` operation for supported ABI versions, executor availability, limits and target-host support, then `compute.describe` for a module's pinned hash, operation layouts and scheduling contract. These names are reserved here as design vocabulary, not current Developer Protocol methods. Human menus should consume the same descriptions.

Each completed job should expose queue/barrier, input-copy, execution, output-validation and output-copy timings through development-only profiling, plus input/output byte counts. Gameplay must never branch on those measurements. Failures should include a stable code, module/operation/job/tick identity and an actionable next step: for example, hash mismatch means rebuild/re-export the pinned module; unsupported host means choose a supported target or explicitly change the game implementation. Unknown operations must fail before submission, not return an empty buffer.

## AI implementation checklist

1. Profile the actual game. Identify a bounded kernel and retain a Luau reference implementation/test corpus.
2. Define the operation's binary layout and behavior, including boundary cases and tie-breaking. Keep game-specific behavior in the game package.
3. Build for `wasm32-unknown-unknown` (or a compatible non-WASI toolchain); verify exports, imports, maximum memory and artifact hash.
4. Implement the host loader and scheduling barrier behind an optional runtime capability; unsupported export targets must fail explicitly. Do not ship a browser-only loader as native support.
5. Validate module results against the Luau reference, including malformed pointers/lengths, growth, traps, cancellation and stale handles. Replay with both hosts and matching module hashes.
6. Measure queue/barrier time, input copy, module execution, output validation/copy and Lua application separately. Include transfers and module bytes in the report. Keep the extension only if the end-to-end gain justifies its cost.

Future work must turn this proposal into a single authoritative manifest/ABI schema, implementation, generated API descriptions and tests together. A document alone is not implementation acceptance.
