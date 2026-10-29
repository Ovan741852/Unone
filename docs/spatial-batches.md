# Generic spatial batches v1

Unone provides `api.spatial` for bounded batches of independent sphere geometry.
It owns data validation, geometry queries, scheduling and executor resources.
Callers own all selection policy, movement integration, responses and state changes.
The API neither reads nor changes scene entities or rigid bodies.

V1 supports CPU reference execution, native wgpu compute, and browser WebGPU
compute through the official host. All three use the same f32 query contract.
Both CPU and GPU currently scan the complete body batch per query, O(B × Q).
This is a correctness baseline, not a grid, BVH, rigid-body solver, navigation
system, or demonstrated performance improvement. GPU buffers are per dispatch;
v1 reads results back and does not provide GPU-resident rendering or simulation.

## Luau API

```lua
-- Canonical types are supplied by game api typings or project init.
local index = 0
local pending: number? = nil
return {
    start = function(api: EngineApi)
        index = api.spatial.create({
            {id=10, position={2,0,0}, radius=0.5, category=1},
            {id=20, position={8,0,0}, radius=1, category=2},
        })
    end,
    update = function(api: EngineApi, _dt: number)
        local ticket = pending
        if ticket then
            local result: SpatialBatchResult = api.spatial.take(ticket)
            local hits = result.results[1].hits
            api.observation.set("closest_id", hits[1] and hits[1].id or 0)
        end
        local nearest: SpatialNearestQuery = {
            kind="nearest", point={0,0,0}, max_distance=100, mask=3,
        }
        local overlap: SpatialOverlapQuery = {
            kind="overlap_sphere", center={2,0,0}, radius=1,
        }
        local sweep: SpatialSweepQuery = {
            kind="sweep_sphere", from={0,0,0}, to={12,0,0}, radius=0.25,
        }
        local queries: {SpatialQuery} = {}
        table.insert(queries, nearest)
        table.insert(queries, overlap)
        table.insert(queries, sweep)
        pending = api.spatial.submit(index, queries)
    end,
}
```

| Call | Meaning |
|---|---|
| `pack(bodies)` | Validate records and return a copied USB1 buffer. |
| `create(bodiesOrBuffer)` | Create an opaque numeric index handle, initially version 1. |
| `update(index,bodiesOrBuffer)` | Atomically replace all records; return the next version. |
| `destroy(index)` | Release the index; frozen submitted queries remain valid. |
| `submit(index,queries)` | Copy a versioned snapshot and return a ticket. |
| `take(ticket)` | Consume `{version,results={{hits={...}},...}}` in query order. |
| `cancel(ticket)` | Invalidate the ticket and ignore its late executor completion. |
| `info()` | Report actual backend, API/packed format, limits and usage. |
| `lastDiagnostic()` | Read the latest structured spatial failure, or nil before any failure. |
| `profile()` | Read bounded spatial work counts, host-wall phase costs and transfer bytes. |

Publish complete info and result records directly, including when using the
canonical strict Luau types; no conversion, cast or per-project adapter is needed:

```lua
local info: SpatialInfo = api.spatial.info()
local queryCapacity: number = info.limits.queries_per_batch
api.observation.set("spatial_info", info)
-- In update, at least one tick after submission:
local result: SpatialBatchResult = api.spatial.take(pending)
api.observation.set("spatial_result", result)
local closest: SpatialHit? = result.results[1].hits[1]
```

Observation numbers remain finite binary64 numbers on native and Web hosts.
Unsigned IDs and the numeric `limits.safe_integer` value are preserved; native
integral values beyond signed i32 use the same JSON floating representation as
Web. This observation-only rule does not widen save/input integer or array-key
limits. Result, query-result and hit records retain their typed numeric fields.
Treat returned info, result, profile and diagnostic records as read-only snapshots.
Their same-body string indexers permit direct observation publication; in pinned
Luau 0.734, writing through a dynamically indexed table alias can bypass named-field
checks. Static typing does not reject every such mutation. These records are detached
copies, so changing a returned table does not change engine state; publication still
validates serializable values at runtime. Keep ordinary typed arrays and named-field
access, without adding table intersections or replacing canonical declarations.

`SpatialInfo` and `SpatialLimits` provide named numeric capacity fields and typed
backend/delivery/format/usage fields. `fault` is an optional terminal manager error.
Each query variant has its own type; annotate stored queries before `table.insert`
so Luau preserves the literal `kind` rather than widening it to `string`.
The SDK bundles a complete strict example at
[`examples/spatial-diagnostics`](../examples/spatial-diagnostics/README.md).

## Structured rejection and repair

Existing thrown messages and error codes remain compatible. Immediately after a
failed `pcall`, read `api.spatial.lastDiagnostic()` to inspect `EngineDiagnostic`:

```lua
local query: SpatialOverlapQuery = {
    kind="overlap_sphere", center={0,0,0}, radius=-1,
}
local queries: {SpatialQuery} = {query}
local ok = pcall(function() api.spatial.submit(index, queries) end)
if not ok then
    local diagnostic: EngineDiagnostic? = api.spatial.lastDiagnostic()
    if diagnostic then
        api.observation.set("rejection", diagnostic)
        if diagnostic.path == "queries[1].radius"
            and diagnostic.recovery.retry == "after_correction" then
            query.radius = 1
            pending = api.spatial.submit(index, queries)
        end
    end
end
```

The envelope contains `api_version`, `code`, dotted `operation`, original `message`,
optional `path`/`actual`/`expected`, `recovery={action,retry}`, `recoverable`,
`terminal` and `context={frame,index?,ticket?}`. Paths use Luau's one-based indices.
For a missing field there may be no actual value; unknown details are nil rather
than invented values. `retry` is one of `after_correction`, `next_tick`,
`after_release`, `new_session` or `none`. `code` and `recovery.retry` are machine-readable;
`recovery.action` is human-readable guidance. Use the documented retry boundary;
the diagnostic does not automatically repair inputs or restart a failed device.
A terminal failure generally requires a new runtime session with a working executor.

Only the latest failure is retained. A successful call or diagnostic read leaves it
intact, so read it immediately after the relevant `pcall`, before another operation
can fail. A new runtime and successful reload clear it; failed reload preserves the
live diagnostic. A successful development reload resets the manager but retains
the selected executor, so it does not promise to repair a failed GPU/device.
Reads neither consume tickets nor change deterministic snapshots.
This spatial diagnostic envelope is separate from the CLI's existing `Diagnostic`
report type. It covers input, manager, executor and host failures, without game
policy. VM out-of-memory, output encoding and `create_buffer` allocation failures
are outside this structured envelope; do not assume every VM error creates one.

Embedders can read `EngineRuntime::spatial_diagnostic() -> Option<EngineDiagnostic>`
after a failed tick, when Lua cannot continue. The new Web ABI accepts
`{kind:"diagnostic"}` and the official JavaScript host exposes
`spatialHost.diagnostic()`; an older WASM runtime must be rebuilt for this operation.
The engine read is detached. The JavaScript method makes an actual bridge request,
so its transport measurement increments bridge counters; `spatialHost.report()`
remains a cloned read-only report and creates no bridge request.

## Observation JSON arrays

Engine-produced JSON arrays retain their identity in Luau and when republished.
Directly publishing `spatial.take(ticket)` therefore keeps `results=[]` for an
empty query batch and `hits=[]` for queries with no contacts. No spatial-specific
conversion or caller adapter is needed. Clearing and refilling an engine array
keeps that identity. Plain authored `{}` remains a JSON object.

For an authored array use the generic `api.observation.array(values?)`. It returns
the same supplied table, or a new empty array when omitted, with its element
types preserved. It changes neither elements nor the table's metatable:

```lua
local numbers: {number} = {1,2,3}
local values = api.observation.array(numbers)
local first: number = values[1]
api.observation.setArray("numbers", values)
api.observation.set("empty", api.observation.array()) -- []
api.observation.set("object", {}) -- {}
```

The helper validates serializable contents before marking. It marks only the
outer table; separately mark authored nested empty arrays. Serialization still
rejects holes, mixed string/integer keys, functions, buffers, cycles and nonfinite
numbers after mutation. The runtime keeps array identity with weak keys, so the
hint does not retain otherwise unreachable tables. Save round trips preserve
array shape through the same generic boundary without widening save numbers.

Use `api.observation.setArray(key, values?)` to publish a typed number/record array
directly, or omit values to publish `[]`. It validates and marks the array, then
stores its JSON snapshot atomically. A failed call preserves the prior observation.
This generic setter checks serializability at runtime without weakening the
existing recursive `observation.set` contract or array element read/write types.
Use ordinary `set` for complete canonical spatial records; no array helper is
needed for their engine-produced nested arrays.

## Spatial cost diagnostics

`api.spatial.profile()` returns typed `SpatialProfile` diagnostics, independently
of `info()` and geometry results. It retains one latest completed batch and
cumulative bounded totals since backend selection or successful reload. It never
consumes a ticket, selects a backend or changes query scheduling. Invalid API
attempts are excluded; `submitted_batches` counts accepted submissions,
`completed_batches` counts applied valid results, `failed_batches` counts pending
batches retired by a manager fault, and `cancelled_tickets` includes cancellation
of a completed but unconsumed ticket. A failed reload leaves live diagnostics intact.

```lua
-- In update, after at least one batch was completed:
local profile: SpatialProfile = api.spatial.profile()
local counts = profile.totals
if profile.last and profile.last.executor then
    local sample = profile.last.executor
    api.observation.set("batch_wall_ms", sample.total_ms)
    api.observation.set("batch_profile", profile)
end
```

`last` supplies ticket/version, body/query/hit counts, the body×query upper bound,
manager timings and optional executor diagnostics. `totals` includes corresponding
work/byte counters, accumulated manager/executor phase times and sample counts.
`input_body_bytes` is equivalent USB1 payload size, not a measurement of all
allocation traffic; GPU upload/readback bytes are actual transport buffer sizes.
Pair counts are an algorithmic upper bound, not instrumented candidate visits.

`bindings: SpatialBindingProfile` supplies a separate Lua boundary measurement.
Its `calls`/`failed_calls`, cumulative `input_decode_ms`/`output_encode_ms` and
optional latest `SpatialBindingSample` cover `pack`, `create`, `update`, `destroy`,
`submit`, `take` and `cancel`, including rejected attempts. The latest sample has
`operation`, `success`, the two timings and optional `index`/`ticket`. Input decode
measures Lua-to-validated-Rust boundary conversion; output encode measures a Rust
result/buffer-to-Lua conversion. They exclude manager/executor work and structured
diagnostic serialization. Counts and times reset on backend selection or successful
reload; failed reload preserves them. Read-only `info`, `profile` and `lastDiagnostic`
are excluded, so observing diagnostics does not increment them.

All times are milliseconds on the host monotonic clock. Manager phases measure
snapshot copying, accepted-batch validation, result validation and result storage.
The manager timings exclude Luau argument/result conversion (reported separately
in `bindings`), bridge JSON marshaling and caller application work.
CPU `cpu_execute` measures the reference executor call.
Native GPU phases measure packing, buffer upload/allocation, command encode/submit,
blocking readback wait and decode. Web GPU also exposes public preparation
(validation/snapshot) and queue wait; its total includes those and cleanup.
Setup/device/pipeline creation is outside per-batch execution. Subphases can be
nested or overlapping and must not be summed as independent GPU times.

For the official JavaScript host, `spatialHost.report().metrics` separately exposes
initialization and bridge overhead. This is a detached cloned host report, rather
than additional diagnostic traffic through Lua. It resets for each project load:

```text
metrics = {
  api_version: 1, clock: "host_monotonic", scope: string,
  setup: {
    success, total_ms, executor_create_ms, configure_ms, gpu_initialized
  } | null,
  bridge: {
    totals: counts,
    by_kind: { configure?, drain?, complete?, report?, profile?, diagnostic?, fault? }
  }
}
counts = {
  requests, failed_requests, request_bytes, response_bytes,
  json_encode_ms, copy_in_ms, abi_ms, response_decode_ms
}
```

All counts/byte sizes and timings are numbers; flags are booleans. Missing
`by_kind` entries mean no request of that kind. Bridge request/response sizes are
UTF-8 bytes, rather than allocation/copy totals. `abi_ms` includes synchronous
WASM execution and its internal serialization, not GPU execution. Initialization
`configure_ms` overlaps the configure request's bridge phases. CPU selection makes
no GPU create/configure call and records zero for those durations with
`gpu_initialized=false`. Setup/bridge measurements exclude project loading, Worker
messaging, caller work and cloning this report. Neither these overlapping phases
nor the Lua/manager/executor measurements should be summed as an end-to-end latency.
Kernel timestamps remain independently unavailable when stated below.

`gpu_kernel` is absent/nil in Luau (null in raw host profile JSON) when GPU
timestamp measurements are unavailable, with `gpu_kernel_unavailable_reason`.
Host encode/submit and readback-wait time are **not** GPU kernel time. Other
unavailable or inapplicable phases likewise have no numeric value. An older
custom executor/host may supply no phase diagnostics; `executor_unavailable_reason`
explains the missing sample. Cumulative zero values with zero sample counts mean
no measured work, not a measured zero-cost GPU operation.

Timing is deliberately excluded from canonical spatial state, ordinary `info()`
and geometry results. Merely reading a profile preserves replay digests. Publishing
wall-clock diagnostics through observation intentionally adds nondeterministic
data to that observation; keep diagnostic runs separate from deterministic replay
assertions. Counters saturate at the published safe-integer bound. This API locates
measured batch costs; it does not choose gameplay policy, claim a universal GPU
speedup or automatically select a crossover threshold.

## Repeated synthetic measurements

The tool below uses only a selected portable SDK's public CLI to create a
new OS-temp synthetic CPU project, obtain canonical types, run strict checking and
measure warmed batches. It does not read a game project. Select an unused output
path; the tool refuses to overwrite it. An official analyzer is required:

```text
node <SDK>/tools/benchmark-spatial.mjs --sdk <SDK> --bodies 4096 --queries 128 --warmup 3 --samples 9 --output <new-report.json> --analyzer <luau-analyze>
```

The checkout source of the same tool is `scripts/benchmark-spatial.mjs`. The SDK
copy requires no checkout or Rust toolchain. Use your host's normal path quoting.
The report separates manager/executor/binding distributions with nearest-rank p50
and p95 from bounded samples in one process. Warmups are excluded from per-batch
distributions. `process_total_ms` includes process launch, project/VM setup, warmups,
all ticks, final observation serialization and parsing; it is not per-batch latency.
This CPU tool does not select or test a GPU.

For a checkout with the preinstalled Rust toolchain and native GPU dependencies,
the separate executor example supports `--backend both`, `cpu` or `gpu`:

```text
cargo run --manifest-path crates/unone-spatial-gpu/Cargo.toml --offline --example benchmark -- --bodies 4096 --queries 128 --warmup 3 --samples 9 --backend both
```

It measures setup separately from direct executor calls, retaining individual
wall/phase samples and nearest-rank quantiles. It excludes Luau, bridge traffic,
caller application work and rendering. GPU selection requires a working actual
adapter and fails when one is unavailable; it does not silently substitute CPU.
Neither tool establishes a universal GPU benefit, an automatic crossover threshold,
cross-device determinism or frame-rate improvement. Do not add overlapping phases
or compare the CPU CLI process total with a native direct-executor sample.

Tables are the convenience form; `pack` is optional. Each record contains a
unique `id` (u32), three-element `position` array, nonnegative `radius`, optional
u32 `category` (default 1), and optional `previous_position` array. Category and
query mask bits have no domain meaning. A body matches when their bitwise AND is
nonzero; `exclude_id` optionally excludes one exact ID, including ID zero.
Coordinates and radii are finite f32 with magnitude at most 1,000,000.
Values arriving from Luau are rounded to f32 before validation and execution.
Unknown fields, duplicate IDs, malformed arrays and invalid numbers fail explicitly.

Create/update/destroy are permitted in start/onReload or update. Submit/take/cancel
are update-only. No operation chooses or integrates motion. `previous_position`
is an explicit input to continuous geometric sweep tests.

## Query and result semantics

- `nearest`: inclusive center distance `max_distance`; radius is ignored for
  selection. Returns zero or one hit; equal distances choose the lowest numeric ID.
- `overlap_sphere`: touching counts as overlap. Returns all hits sorted by ID.
  More than 64 contacts faults the batch rather than silently truncating it.
- `sweep_sphere`: query `from` → `to` against each body's
  `previous_position` → `position` (stationary when omitted). Returns only the
  earliest contact in normalized time `[0,1]`; ties choose the lowest numeric ID.

Every hit is `{id,distance,fraction,point,normal}`. For nearest/overlap, distance
is center distance and fraction is zero. For sweep, distance is query travel
length multiplied by fraction. Point is on the body's surface toward the query;
normal points from body to query. Coincident centers use +Z. Initially overlapping
sweeps return fraction zero and +Z. The core and GPU kernels share the same
closest-approach sweep formulation to avoid large-coordinate discriminant cancellation.

Limits: 8 indices, 65,536 records/index, 131,072 indexed records/runtime,
1,024 queries/submission, 4 submissions/tick, 16 outstanding tickets, and
64 overlap contacts/query. Failed replacements preserve the old version.
Version counters are u32 and refuse overflow. Handles/tickets are runtime-local,
one-shot where applicable, and must not be stored as persistent save state.

## Fixed tick delivery

Tick N submits a frozen snapshot. Work dispatches only after its script and
physics phases succeed. Results are usable no earlier than tick N+1, including
on the inline CPU backend. The official Web host waits for GPU completion before
advancing that next tick. Native local executors currently wait during dispatch.
There is no timing-dependent `isReady` branch. Same-tick take is an error.

Device failure, contact overflow and execution failure fault the manager. Invalid
host completions are rejected; the official Web host treats rejection as a fault.
They never supply empty/default results. Cancellation and hot reload
retire old tickets; late replies cannot complete a newer ticket. Successful reload
preserves indices, versions and executor selection; failed reload preserves the
live manager. Canonical snapshots include used indices and frozen submitted
inputs and the future handle sequence, excluding backend identity, timing and
early completion state. A failed reload leaves that allocator unchanged.

GPU floating-point operations are not promised bit-identical to CPU or other
devices. Differential tests require the same hit IDs/order on non-ambiguous inputs
and tolerances for contact values. Near geometric boundaries, f32 differences can
change contact membership or tie order. Use CPU for exact replay requirements;
v1 does not provide cross-device deterministic lockstep or persistent spatial saves.

## Host configuration

The default is CPU and allocates no GPU device. The official exported players
read this host execution policy from `player.presentation.json`:

```json
{"spatial_backend":"gpu"}
```

`cpu` always uses the Rust reference; `gpu` requires a working GPU and bridge;
`auto` attempts GPU initialization and falls back to CPU when unavailable.
Execution failure after initialization remains an error. Web host reports include
the initialization fallback reason. Native also accepts
`--spatial-backend cpu|gpu|auto` as an override.

Embedders can call `EngineRuntime::set_spatial_executor` before the first tick.
`unone-spatial-gpu::SpatialGpuExecutor::new()` creates a native compute device;
`from_device(device,queue)` reuses host-owned wgpu resources. The engine core
contains no GPU device or renderer dependency. Native callers use the separate
`crates/unone-spatial-gpu` crate (its own Cargo workspace).

Async hosts select an external backend, drain immutable `SpatialTask`s after a
successful tick, execute them, and complete them before the next tick. The Web
bridge exports `unone_web_spatial_request`; older WASM must be rebuilt for GPU.
V1 host packets use bounded JSON; packing and marshaling still copy data. No
end-to-end zero-copy or throughput claim is made. The official export includes
`spatial-host.mjs`, `spatial-gpu.mjs` and their shared `spatial.wgsl`.

## USB1 packed bodies

All words are little endian. Header: four bytes `USB1`, then u32 record count.
Each 40-byte record is: u32 ID, u32 category, xyz f32 position, f32 radius,
xyz f32 previous position, u32 previous-position-present (0 or 1).
When the flag is zero, encode the current position in the previous-position slots.
The exact length and every record are validated before creating/replacing an index.

## Verification

Run engine reference/lifecycle tests:

```text
cargo test -p unone-engine --test spatial_core --test spatial_runtime
cargo test -p unone-engine spatial --lib
node --test web/shared/spatial-host.test.mjs web/shared/spatial-gpu.test.mjs web/shared/runtime-core.test.mjs
cargo test --manifest-path crates/unone-spatial-gpu/Cargo.toml
node scripts/verify-spatial-webgpu.mjs
node scripts/verify-spatial-runtime.mjs artifacts/spatial-v1-runtime
```

The native GPU differential test requires an adapter and fails when unavailable;
it never silently skips GPU execution. Browser verification also requires actual
WebGPU. Mock host tests establish scheduling semantics only. Successful kernel
checks do not establish a rendered player or a performance improvement.

Local verification on 2026-10-23 used NVIDIA GeForce RTX 5080 (native Vulkan)
and Edge 155.0.4283.62 (WebGPU, NVIDIA Blackwell). Results:

| Check | Result |
|---|---|
| Engine library | 316 passed; 3 existing ignored tests |
| Geometry / Luau integration | 14 / 8 passed |
| CLI host policy | 6 passed |
| JS host / GPU contract / runtime core | 13 passed |
| Native shader / GPU differential / Luau GPU integration | 3 passed; actual GPU required |
| Browser GPU differential | 9 fixture cases passed, plus validation/lifecycle checks |
| Fresh release WASM integration | CPU and WebGPU passed in both main and Worker hosts |
| Exported player parity | Both five-frame fixtures passed; deliberate audio/physics mutations detected |
| Native player | Cargo check passed |

The standalone GPU cases include 65,536 records, 1,024 queries, a seeded query
cloud, ties, masks, moving sphere contacts and explicit overlap overflow. Browser
reports are written to `.cache/spatial-webgpu-report.json` and
`.cache/spatial-runtime-report.json`; the fresh release runtime was built under
`artifacts/spatial-v1-runtime`. These checks establish computation and transport
behavior, not rendered appearance, benchmark speedups or other-device coverage.
