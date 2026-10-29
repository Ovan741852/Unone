## Operation 3: Public spatial guide and CLI query discovery

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "powershell",
  "args": [
    "-NoProfile",
    "-Command",
    "Get-Content -LiteralPath 'D:\\Projects\\Unone\\docs\\spatial-batches.md'; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' --json api search spatial; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' run --help; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' api typings --help; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' session --help"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
# Generic spatial batches v1

Unone provides `api.spatial` for bounded batches of independent sphere geometry.
It owns data validation, geometry queries, scheduling and executor resources.
Callers own all selection policy, movement integration, responses and state changes.
The API neither reads nor changes scene entities or rigid bodies.

V1 supports CPU reference execution, native wgpu compute, and browser WebGPU
compute through the official host. All three use the same f32 query contract.
Both CPU and GPU currently scan the complete body batch per query, O(B ? Q).
This is a correctness baseline, not a grid, BVH, rigid-body solver, navigation
system, or demonstrated performance improvement. GPU buffers are per dispatch;
v1 reads results back and does not provide GPU-resident rendering or simulation.

## Luau API

```lua
local index, pending
return {
    start = function(api)
        index = api.spatial.create({
            {id=10, position={2,0,0}, radius=0.5, category=1},
            {id=20, position={8,0,0}, radius=1, category=2},
        })
    end,
    update = function(api, dt)
        if pending then
            local result = api.spatial.take(pending)
            local hits = result.results[1].hits
            api.observation.set("closest_id", hits[1] and hits[1].id or 0)
        end
        pending = api.spatial.submit(index, {
            {kind="nearest", point={0,0,0}, max_distance=100, mask=3},
            {kind="overlap_sphere", center={2,0,0}, radius=1},
            {kind="sweep_sphere", from={0,0,0}, to={12,0,0}, radius=0.25},
        })
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
- `sweep_sphere`: query `from` ??`to` against each body's
  `previous_position` ??`position` (stationary when omitted). Returns only the
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
{
  "ok": true,
  "value": {
    "query": "spatial",
    "matches": [
      {
        "name": "spatial.pack",
        "category": "spatial",
        "purpose": "Encode generic sphere records into a validated USB1 Luau buffer.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "bodies",
            "type_name": "SpatialBody[]",
            "meaning": "Unique numeric IDs, xyz f32 positions, radius, opaque category bits and optional previous_position"
          }
        ],
        "returns": "buffer",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "local packed = api.spatial.pack({{id=1,position={0,0,0},radius=1}})",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.create",
        "category": "spatial",
        "purpose": "Create a generic spatial batch independent of scene entities.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "bodies",
            "type_name": "SpatialBody[] | buffer",
            "meaning": "Table convenience form or USB1 packed buffer; at most 65536 records"
          }
        ],
        "returns": "number",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "local index = api.spatial.create({{id=1,position={0,0,0},radius=1}})",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.update",
        "category": "spatial",
        "purpose": "Atomically replace a spatial batch and advance its snapshot version.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "index",
            "type_name": "number",
            "meaning": "Live index handle"
          },
          {
            "name": "bodies",
            "type_name": "SpatialBody[] | buffer",
            "meaning": "Validated replacement records"
          }
        ],
        "returns": "number: version",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "local version = api.spatial.update(index, packed)",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.destroy",
        "category": "spatial",
        "purpose": "Release a spatial index; already submitted queries retain their frozen snapshot.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "index",
            "type_name": "number",
            "meaning": "Live index handle"
          }
        ],
        "returns": "nil",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "api.spatial.destroy(index)",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.submit",
        "category": "spatial",
        "purpose": "Submit batched nearest, sphere overlap or continuous moving-sphere sweep queries.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "index",
            "type_name": "number",
            "meaning": "Live index handle"
          },
          {
            "name": "queries",
            "type_name": "SpatialQuery[]",
            "meaning": "0..1024 queries; mask and exclude_id are generic geometric filters"
          }
        ],
        "returns": "number: ticket",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "ticket = api.spatial.submit(index, {{kind=\"nearest\",point={0,0,0},max_distance=10}})",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.take",
        "category": "spatial",
        "purpose": "Consume a completed batch at a fixed later simulation tick.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "ticket",
            "type_name": "number",
            "meaning": "Unconsumed ticket from an earlier successful update"
          }
        ],
        "returns": "SpatialBatchResult",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "local result = api.spatial.take(ticket)",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.cancel",
        "category": "spatial",
        "purpose": "Cancel a batch ticket and ignore its late host completion.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [
          {
            "name": "ticket",
            "type_name": "number",
            "meaning": "Live ticket"
          }
        ],
        "returns": "nil",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "api.spatial.cancel(ticket)",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "spatial.info",
        "category": "spatial",
        "purpose": "Report the selected spatial executor, capacities and current usage.",
        "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
        "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
        "parameters": [],
        "returns": "table",
        "side_effects": [
          "Updates bounded spatial handles and frozen batch snapshots"
        ],
        "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
        "common_errors": [
          "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
        ],
        "example": "local info = api.spatial.info()",
        "related_apis": [
          "spatial.create",
          "spatial.pack",
          "spatial.submit",
          "spatial.take",
          "spatial.info"
        ]
      },
      {
        "name": "physics3d.raycast",
        "category": "physics3d",
        "purpose": "Query the closest collider along from/to using a spatial index; returns nil or id, fraction, point and normal.",
        "when_to_use": "For opt-in 3D rigid-body games and AI physics inspection.",
        "when_not_to_use": "Enable systems.physics3d. Gameplay rules, damage and effect selection remain in Lua. Physics owns registered transforms; use teleport/moveKinematic instead of setTransform3D.",
        "parameters": [
          {
            "name": "arguments",
            "type_name": "typed",
            "meaning": "request:Ray3D (game schema ray3d)"
          }
        ],
        "returns": "QueryHit3D or nil",
        "side_effects": [
          "Read physics state; no implicit step"
        ],
        "frame_semantics": "Fixed 60 Hz, single-threaded Rapier enhanced-determinism. Snapshot is an observation, not a complete resumable solver save. Contacts are read on the following Game.update.",
        "common_errors": [
          "SYSTEM_DISABLED",
          "PHYSICS3D_BODY_MISSING",
          "invalid/unknown fields",
          "PHYSICS3D_OWNERSHIP"
        ],
        "example": "local state = api.physics3d.snapshot()",
        "related_apis": [
          "physics3d.snapshot",
          "physics3d.contacts",
          "physics3d.raycast"
        ]
      }
    ],
    "suggested_next_actions": []
  },
  "diagnostics": [],
  "effects": []
}
Usage: game.exe run [OPTIONS]

Options:
      --frames <FRAMES>
          [default: 60]
      --sdk <SDK>
          Portable SDK root (otherwise environment or executable-relative discovery)
      --project <PROJECT>
          [default: .]
      --seed <SEED>
          [default: 42]
      --action <ACTION>
          
      --json
          
      --input-sequence <INPUT_SEQUENCE>
          
  -h, --help
          Print help
Print canonical Luau types, write a contract file, or refresh an explicitly marked script block

Usage: game.exe api typings [OPTIONS]

Options:
      --output <OUTPUT>                Write the type contract to this path instead of stdout
      --sdk <SDK>                      Portable SDK root (otherwise environment or executable-relative discovery)
      --project <PROJECT>              [default: .]
      --update-script <UPDATE_SCRIPT>  Refresh exactly one marked API type block in this existing project-relative script
      --json                           
  -h, --help                           Print help
Stateful developer protocol: one JSON request and EngineResult per line on stdio

Usage: game.exe session [OPTIONS]

Options:
      --schema             Print the request JSON schema instead of starting a session transport
      --sdk <SDK>          Portable SDK root (otherwise environment or executable-relative discovery)
      --project <PROJECT>  [default: .]
      --json               
  -h, --help               Print help

~~~~

stderr:

~~~~text

~~~~

## Operation 4: Public session and authoring contracts

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "powershell",
  "args": [
    "-NoProfile",
    "-Command",
    "Get-Content -LiteralPath 'D:\\Projects\\Unone\\docs\\developer-session.md'; rg -n -C 6 'scene|project.unone|scripts/main|observation|entry' 'D:\\Projects\\Unone\\docs\\ai-workflow.md'; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' --json api describe observation.set; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' --json api describe spatial.take"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
# Persistent developer sessions

An AI can play through inputs, inspect the same runtime between actions, try
transient edits, and replay an experiment. The engine supplies observations and
measurements. The AI decides where to investigate and what code to optimize;
there is no automatic bottleneck classifier or optimizer.

## Entry points

Build `cargo build -p unone-cli`. Both transports use the same core dispatcher:

- `game --project <absolute-game-path> session`: one JSON request per stdin line,
  one complete `EngineResult` per stdout line, flushed immediately. Keep the
  process alive across requests. EOF releases the runtime.
- `game --project <absolute-game-path> mcp`: the `unone_session` tool accepts the
  same request objects. Keep the MCP connection alive.
- `game session --schema`: print all request/selector/operation/input schemas.
  MCP advertises the same schema in `tools/list`. It is generated from Rust
  request DTOs, including recording types; `game schema developer` exports it.

One connection owns one headless runtime. This does **not** attach to a separately
running native preview or Web page. Existing `observe`, `run`, `preview --watch`
and replay commands retain their behavior. In particular, `preview --watch`
watches source files, not a developer event stream.

## Observe and play

Send `{"command":"open","seed":42}`. The result includes a fresh `session` id,
revision, event cursor, frame, script generation/digest, engine version, snapshot
and observation digest. File-backed sessions load authoring content; this metadata
does not establish bundle freshness or renderer capability.

Replace `SESSION` with the returned id. Use the latest returned revision for edits
and steps; do not assume the illustrative revision/cursor below fits your session.

```json
{"command":"snapshot","session":"SESSION","selector":{"kind":"entity","id":"player"},"paths":["/transform","/rotation"]}
{"command":"step","session":"SESSION","expected_revision":0,"frames":30,"input":{"actions":{"Right":true}}}
{"command":"journal","session":"SESSION","after":0,"limit":100}
{"command":"watch","session":"SESSION","after":1,"selector":{"kind":"entity","id":"player"},"paths":["/transform/x"]}
{"command":"perf","session":"SESSION"}
```

Read operations never advance simulation. `step` repeats one explicit input for
1..600 fixed ticks. Actions are a name-to-boolean map that replaces the previous
set each tick. For a tap, send one pressed tick followed by a released tick.
Pointer input accepts world `position`, optional logical UI `screen_position`,
and `down`. Omitted pointer input releases the button while retaining its
position, matching normal replay. A frame limit is not a wall-clock timeout;
callers must still time out and terminate a process if game code never returns.

`expected_revision` rejects obsolete observations. Each completed or failed tick
increments the revision; a committed edit batch increments it once. Dry runs do
not. A script failure can already have changed Lua/Rust state: the session exposes
that partial state and diagnostic, then refuses further mutations. Inspection,
measurement, recording and close still work. Correct the source and open a new
session to continue.

## Diagnose a failed tick

`{"command":"diagnose","session":"SESSION","limit":20}` is a read-only
failure evidence pack. It returns execution mode, fault status, the failed
attempted frame versus last completed frame, original diagnostic/source location,
input, bounded partial state changes, zero-based recording command/tick indices,
recent journal entries and concrete next request objects. Missing line numbers
are not guessed; only exact entry-chunk locations reported by Luau are promoted.
The failure evidence is capped at 64 KiB with explicit truncation, independently
of the rotating journal. `limit` is 1..256. Clean sessions report failure=null.

Diagnose never ticks, fixes, resumes, replays or exports files automatically.
Export `recording`, correct the source, then explicitly replay in an independent
runtime; partial state is not rolled back. The pack declares line breakpoints,
all-Luau-locals inspection and external-preview attachment unsupported. Paired
diagnostic/production validation is required before inferring performance gains;
see [runtime mode validation](runtime-mode-validation.md).

## Journal and watch

Entries contain sequence, revision, frame, kind and data. They cover state deltas,
semantic script traces, contacts, ground contacts, audio one-shots, committed
edits and runtime failures. Tick deltas omit frame/time-only changes. This is
diagnostic history, not an event-sourced replacement for world state.

Watch is incremental **polling**, with no background ticks or push subscription.
The client chooses its cadence. Each reply includes a journal page plus the
latest selected snapshot, which may be newer than the last event in that page.
State deltas are filtered by selector and relative JSON pointers. Semantic events
are retained. UI/effect arrays use parent deltas because numeric array indices
are not stable identities. Removed selections return `selection_exists=false`
while retaining the removal delta.

Resume from `next_cursor`, not `cursor`: the latter is the newest available event
and can skip unread pages. Drain pages while `has_more=true`. Reopening creates a
new session identity; old ids, revisions and cursors do not transfer.

Retention is bounded to 1,024 entries, each with at most 16 KiB of data. Oversized
entries explicitly report truncation. Deltas retain at most 128 changes and report
`omitted_changes`. Overflow reports `lost_events`, `dropped_count` and
`oldest_cursor`; get a fresh snapshot when a gap occurs. Pages accept 1..256
entries. A truncated page or gap is not a complete change history.

## Enact

Enact selects exact stable ids, validates typed operations against candidate Rust
state, and commits the batch between ticks. It invokes no Lua callback and makes
no filesystem/renderer side effect. A failed operation rejects the entire batch,
including UI, camera and effect handle allocation. Unknown fields, missing
targets, incompatible operations and disabled systems produce semantic errors.
Successful animation/effect edits establish semantic state, not asset existence,
loading or rendered output.

```json
{"command":"enact","session":"SESSION","expected_revision":30,"dry_run":true,"operations":[{"selector":{"kind":"entity","id":"player"},"change":{"op":"set_position","position":{"x":10,"y":0}}}]}
```

Review the before/after JSON-pointer changes, then send `dry_run=false` with the
still-current revision to commit. Results include newly allocated effect handles.

| Selector | Operations |
| --- | --- |
| `entity` + `id` | `set_transform3d`, `set_position`, `set_transform2d`, `set_velocity`, `set_visible`, `play_animation`, `stop_animation` |
| `ui` + node `id` | `set_text`, `set_rect` on an existing published node |
| `scene` | Camera3D `set_camera3d`, Camera2D `set_camera`, `spawn_effect` |
| `effect` + `handle` | `stop_effect` |

Scene selection means the current world, not generalized scene CRUD. Effects use
the existing Effekseer semantic contract; animation uses Spine. Batches accept
1..64 operations. Serialized mutation input/operations are limited to 64 KiB;
snapshot selection accepts at most 64 relative JSON pointers.

Metadata declares `mutation_policy=temporary_debug_state_patch` and
`gameplay_authority=luau_and_input`. Enact is a developer experiment, never a
gameplay command bus. For authoritative actions, send input or implement an
explicit game-owned command in Luau. `set_transform3d` uses position/rotation/scale
Vec3 fields; `set_camera3d` uses the existing Camera3D position/target/FOV contract.
Neither changes the 2D transform, and neither creates missing entities/cameras.

Edits are **transient runtime edits**. Luau can overwrite them on the next tick;
closing/reopening loses them. To keep an experiment, edit the game's authoring
scene/Luau/assets and run `verify`. Never serialize a runtime snapshot over an
authoring file, generated bundle or active cache. This version adds neither an
authoring save operation nor a general transaction framework.

## Reproduce and measure

`{"command":"recording","session":"SESSION"}` returns a versioned recording
value to save as JSON. It includes seed, initial state digest, script/version
context, accepted input/Enact commands, every attempted tick's observation digest,
and expected failure codes. Queries, dry runs and rejected edits are not recorded.
Limits are 4,096 commands, 60,000 requested ticks and 16 MiB. At a limit, mutations
are rejected before application: export and reopen rather than lose replay.

Send `{"command":"replay","recording":RECORDING_VALUE}` on either transport.
Replay uses an independent runtime and leaves any open session unchanged. It
compares observations and failure codes, reporting the first divergent
command/tick (zero-based) with expected/actual digests. The existing `replay record`
and `replay diff` remain the full-snapshot field-diff workflow for input-only
recordings. Developer recordings use a different schema and include Enact;
the formats are not interchangeable.

Replay can check changed source: `script_changed` identifies entry-script changes,
while equality follows observable behavior. Keep source/assets in version control.
The recording is not a source archive or serialized Lua heap, and entry-script
hashes do not identify every dependency or asset.

`perf` exposes existing phase timings (`script`, `physics`, `observe`), frame
statistics, entity/body/UI/effect counts and Luau heap size for the session.
Totals are cumulative; percentile samples cover the latest bounded 1,024 frames.
Replay returns its own measured runtime report. These are measurements without
bottleneck verdicts, automated optimization or speedup claims. Rendering, GPU work,
transport and developer diff overhead are outside the phase measurements. Failed
ticks are not completed timing samples. Compare repeated equivalent workloads;
timing is excluded from deterministic equality.

## Deferred presentation direction

The requested next particle direction is a choice between Effekseer and an Unone
AI-native particle implementation, with inspectable/editable parameters, explicit
seeded time control and declared renderer capabilities. Do not silently translate
arbitrary Effekseer assets or promise pixel determinism. No new particle runtime
or DSL is implemented here. Spine remains an external authored format/runtime
consumed by Unone.

## Verification (2026-09-07)

- `cargo test --workspace --quiet`: 207 tests passed, including 12 new core
  session regressions and two real CLI/MCP subprocess tests. Coverage includes
  atomic failure, dry-run handle allocation, stale revisions, journal overflow,
  removed selections, structured input rejection, failed-tick inspection/replay,
  system switches and read-only measurement.
- The separate Angry Birds validation game ran its 200-tick drag/launch/hit
  scenario through the new session transport. The expected score was 1,000 with
  two pigs and two birds remaining. Watch returned the final ViewModel; a
  temporary camera edit and all inputs replayed identically. Hashes confirmed
  that project/script/scene authoring files were unchanged. This was headless
  evidence, not rendered-screen validation.
- That game exercise found a Watch panic when array-shaped collision events
  were indexed as delta objects. It is fixed and covered by a physics regression
  with both body contacts and ground contacts.
- Local experiment artifacts are under the ignored
  `artifacts/developer-session/` directory: the driver, recording and measured
  report. The portable automated tests do not require the external game folder.
- New Rust files pass rustfmt checks and the tracked diff passes whitespace
  checks. Strict repository clippy is still blocked by existing
  `unnecessary_map_or` in `performance.rs` and `collapsible_if` /
  `result_large_err` in CLI `plugins.rs`. Clippy passes for engine/CLI all-targets
  when only those existing lint categories are allowed; this is not a claim
  that the unrestricted strict clippy gate passes.
15-[player build and export](player-export.md).
16-Inspect target capabilities and presentation settings before choosing an effect.
17-Do not create a game-owned canvas/WebGL/OpenGL/WebGPU renderer just to display
18-the runtime's snapshots. Replacing the official renderer is an explicit project
19-choice, not an implied part of using custom shaders.
20-
21:Start exhaust, sparks, explosions, trails, smoke and auras with scene
22-`particle_effects` and `api.particle.*`; use [Particle Lab](native-particles.md)
23-to preview the declaration at a fixed frame and seed. Use
24-[shader materials](shader-materials.md) for custom shader resources and
25-`api.shader.*` for their parameters. GPU resource creation and
26-draw scheduling stay inside the engine presentation layer. When an effect needs
27-an unsupported feature, identify that gap before proposing a reusable engine
--
55-    "presentation/renderer.mjs",
56-    "presentation/shaders.mjs"
57-  ]
58-}
59-```
60-
61:Paths are relative to the game project. Include the entry module and every local
62-import/asset it needs in `renderer_files`; export copies this explicit inventory.
63-The module exports `createRenderer(canvas, options)` and returns the player
64-renderer contract (`draw`, `ready`, `metrics`, `setBloom`, `dispose`). The official player
65-shell still owns runtime, input, save, UI and audio. Native targets reject custom
66-renderers. The manifest records the choice and validates the interface; it cannot
67-prove that a custom renderer follows every engine
--
131-
132-Seven game-side files are created:
133-
134-| File | Purpose |
135-|---|---|
136-| AGENTS.md | Official-player, declarative-particle and engine-shader authoring defaults |
137:| project.unone.json | Declares the script, scene, and two tests |
138-| player.presentation.json | Explicit official renderer selection and presentation defaults |
139:| scripts/main.luau | Inlines strict EngineApi types; holding Right moves example by dt; particle API guidance |
140:| scenes/main.scene.json | Image-free, non-rigidbody example with initial x/y=0 and an inline particle definition |
141-| tests/bootstrap-idle.test.json | 60 frames / seed42, no input, position stays at 0 |
142-| tests/bootstrap-input.test.json | 60 frames / seed42, Right produces x=1, y=0 |
143-
144-The demonstration tests are headless onboarding checks, not gameplay or visual
145-acceptance. The game may replace `example`, `Right`, the particle definition and
146-the demonstration tests; when removing `example`, replace the demonstration
--
155-Each action is `{executable,argv,reason,prerequisites}`: the logical executable is `game`, resolved inside a package to `bin/game.exe`; pass argv directly as a subprocess argument list, without constructing a shell command. `prerequisites` contains zero-based indexes of earlier actions.
156-For an unmodified starter, the suggested actions are verify → search particle
157-APIs → search shader APIs → list systems → Web preflight → Web prepare. Follow
158-the reported prerequisites; prepare composes synchronization and export rather
159-than requiring a second hand-assembled publication sequence. After adding
160-assets, follow [asset-workflow.md](asset-workflow.md): prepare bytes, declare them,
161:pack, then use the aggregated `verify` entry point (whose assets step already
162-performs strict inspection) before installing.
163-
164-A partial write does not delete files or roll back automatically: diagnostic facts for `phase`, `failed_path`, `created_files` (`complete` distinguishes complete from partial), `created_directories`, and `effects` describe what was actually created. Inspect the record and handle it as the author; a later init rejects the remaining content rather than resuming.
165-The author can be an AI. On a write failure, report the diagnostic and resolve the disk or permission cause. If the game plan allows it, preserve the failed output and retry in another completely new output directory; ask the user when the specified output cannot be changed.
166-`created_files` and `created_directories` are historical write records, not permission to delete or proof that the paths are still safe to remove: later edits may have changed the content. Do not use them to automatically clear directories or recursively delete ancestors.
167-
168:See [project.schema.json](project.schema.json), [scene.schema.json](scene.schema.json),
169-and [test.schema.json](test.schema.json) for the formats. UI rects use the 0..100 × 0..100 logical design space, not 960×540; a game plan that does not need UI does not need to create a UI tree.
170-
171-```powershell
172-bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json project inspect
173-bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json asset inspect
174-bin/game.exe --project D:/Projects/Unone_Games/<game-output> --json api search "move entity"
--
183-Execute only actions with `ready=true`; resolve logical executable `game` to the packaged `bin/game.exe`, and pass `argv` unchanged to a subprocess without constructing a shell command. The complete-index action preserves the real empty string in argv.
184-The systems action carries the caller-checked absolute project and does not select a project from the runtime cwd. If the project is unusable, search still succeeds, but the systems action has `ready=false` and `executable/argv=null` with the reason in `diagnostic`; fix that project and search again rather than switching to another directory. `diagnostic.suggested_actions` is explanatory only, with `command=null`; it is not a second set of shell commands.
185-Matched searches and complete-index queries do not include no-match actions. `ready` describes the conditions at query time and does not guarantee that another writer has not changed the project since; inspect the actual result after executing an action.
186-
187-### Scene input and error locations
188-
189:Scene JSON roots and nested typed objects reject unknown fields; entity ids cannot be blank or duplicated within one scene. A valid id is not trimmed or renamed; an empty scene `{}` / `entities=[]` is valid. A misspelled `position` is not guessed as `transform`. Disk run/test, asset inspect/describe, pack (even without an asset manifest), and Web/mobile scene payloads share the same checks; validation does not modify the world first or write pack output first. This is not a scene editor, a complete JSON Schema runtime, or validation of arbitrary dynamic Luau branches; existing cross-load merge behavior is unchanged.
190-
191:Parsing and unknown-field failures use `SCENE_INVALID`; blank and duplicate ids use `SCENE_ENTITY_ID_INVALID` and `SCENE_ENTITY_ID_DUPLICATE`, respectively. In `facts`, `disk_scene` line/column refers to the original scene file; `host_payload_scene` locations refer to the `/scene` raw fragment, with `source=null` and `pointer_base=/scene`; `typed_scene` has no original JSON line/column. When no reliable location exists, return null; do not treat fragment line numbers as line numbers in the complete host payload. The `json_pointer` for an id semantic error points to `/entities/<index>/id`; a duplicate also reports `first_index`.
192-
193:JSON for shared Vec2/Vec3 values also rejects extra fields, including an InputFrame pointer position. Web/mobile numeric pointer FFI parameters are unchanged. Opaque save/observation game data and manually read Luau tables are outside this serde strict-field-checking scope.
194-
195:`asset inspect` lists static `sprite` / `mesh3d` / `animation` asset references in the main scene and compares them with the game-owned `asset_manifest` ids, project-relative sources, companion files, and bundle. It is an authoring-time advisory report. For handoff, CI, or release, use the aggregate `verify` entry point, whose assets step already runs `asset inspect --strict`. Use standalone `asset inspect --strict` for focused asset diagnosis or publication verification; it turns `ASSET_MANIFEST_MISSING`, `ASSET_REFERENCE_MISSING`, `ASSET_SOURCE_MISSING`, and `ASSET_BUNDLE_NOT_DECLARED` into `ok=false`. The manifest version is currently 1, and supported kinds are `texture2d`, `mesh3d`, `spine`, `effekseer`, and `audio`; an unknown version, typo, or unsafe path is not silently treated as usable. For one asset's authoring path, JSON pointer, references, active generation, publication freshness, and next actions, use `asset describe --id <id>`; see the [asset workflow contract](asset-workflow.md). It does not pretend to discover assets selected dynamically by Luau and does not replace the host's download, decoding, or GPU-resource responsibilities. If there are no scene asset references, the absence of a manifest is not an error.
196-
197-For replayable game randomness, use `api.random.nextFloat()` or `api.random.nextInt(min, max)`. The CLI `--seed` becomes that runtime's Luau random seed; the same seed, input order, and random-call order are required for the same result. It is not a secure random source and must not be used for payments or secrets.
198-
199-## 0.5 Decide which engine systems this game uses
200-
201-```powershell
202-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems list
203-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems search "物理"
204-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id physics2d --enabled false
205-```
206-
207:`systems list` reports each system's default, effective value, source (`default` or `project`), Luau APIs, observation fields, and what disabling it removes. `systems search` finds systems by intent in the same style as `api search`. After deciding, use `systems set` to write the choice into that game's `project.unone.json`:
208-
209-```json
210-{ "systems": { "physics2d": false } }
211-```
212-
213:An undeclared system uses the engine default. Three cases fail directly: `SYSTEM_UNKNOWN` (the engine has no such id; a typo is not treated as disabling a system), `SYSTEM_NOT_OPTIONAL` (`world` / `input` / `observation` cannot be disabled), and `SYSTEM_NOT_IMPLEMENTED` (attempting to enable a system marked as unimplemented). `spine` / `effekseer` are currently enableable `host_required` systems, not unimplemented; presentation still depends on the selected host.
214-
215-Disabling a system has real effects: with `physics2d` disabled, the engine no longer advances rigid bodies. The Luau APIs of a disabled system remain present, but calls return `SYSTEM_DISABLED` with a re-enable command instead of producing `attempt to index nil`. `systems` decides which engine mechanisms run; game numbers, levels, and content switches remain game-owned.
216-
217-## 1. Check the project
218-
219-Run the aggregated gate once:
220-
221-```powershell
222-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json verify
223-```
224-
225:`verify` runs `check --types`, the strict `asset inspect --strict` step, the UI `layout` gate, and `test`, then returns one verdict plus each step's result. For a project with UI, the `layout` gate uses `ui preview --strict`; without published UI it is `not_applicable`. UI and save are applicable only when required by `GAME_PLAN`; do not create them just for a gate. A failed step does not stop the remaining steps, and each step includes a standalone `command`. The sections below describe individual gates when a focused query is useful; do not add a duplicate strict asset gate when `verify` is the selected entry point.
226-
227-### The gate order is a default, not a law
228-
229-The order above is what runs when the project says nothing. A project can
230:declare its own in `project.unone.json`:
231-
232-```json
233-"verify": {
234-  "steps": [
235-    "types",
236-    { "step": "assets", "required": false },
--
257-fails with `VERIFY_STEP_NOT_IMPLEMENTED` rather than silently never running.
258-
259-```powershell
260-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check --types
261-```
262-
263:The entry script produced by `project init` **inlines the engine's Luau type contract**, so `check --types` really rejects an API that does not exist (the engine runtime has no module require, so a single-file game must carry its own types). Use the canonical `EngineApi`, `UiApi` and `UiComponentKit` rather than handwritten `ui:any` shims. After an engine upgrade, run `game --project <game-root> api typings --update-script gameplay.luau` to replace only the explicitly marked canonical block; surrounding game code is preserved. New entries include own-line `-- BEGIN UNONE API TYPES` / `-- END UNONE API TYPES` markers. Missing, duplicate or malformed markers fail without writing. For older unmarked entries, print the contract with `game api typings` and review its initial integration; do not guess a replacement region. `--output <path>` writes a complete contract to a dedicated file, never an existing game entry script, and conflicts with `--update-script`. Tests protect the type contract and API index from drifting apart.
264-
265:`check` guarantees Luau syntax and the Engine entrypoint contract: it confirms that the entry script returns a `Game` table with `start` and `update` functions. `--!strict` is reported as contract metadata. Only `--types` invokes the official `luau-analyze`; `bin/game.exe` in an engine package automatically looks for `bin/luau-analyze.exe` beside it. During engine development or when replacing the tool, set `UNONE_LUAU_ANALYZER` to the analyzer executable path. If the tool is missing, the command returns `LUAU_ANALYZER_NOT_FOUND` instead of hiding the lack of type checking.
266-
267:The complete fields and assertion structure of `.test.json` are defined by the package's `test.schema.json`. `game test` treats each test file as an independent deterministic case and returns an observation digest, save payload, and assertion failures; save/restore fields are for `GAME_PLAN` requirements only. Do not use a UI screenshot as a test assertion.
268-
269:For example, `project.unone.json` can set `"test_files": ["tests/opening.test.json"]`, and a test file consists of `name`, optional `frames` / `seed` / `input` / `input_sequence` / `load_save`, and `assertions`. `load_save` is only for a `GAME_PLAN` restore check. An assertion chooses exactly one of: `observation` for full JSON-value equality, `ui` for full typed UI-tree equality (including nested reusable components), or `entity` + `field` (currently `transform.x` / `transform.y`) for numeric comparison.
270-
271-If only the runtime contract is needed, omit `--types`. A local Windows binary from an official Luau release can be used, or set:
272-
273-```powershell
274-$env:UNONE_LUAU_ANALYZER = 'D:/tools/luau-analyze.exe'
275-```
--
280-
281-```powershell
282-cargo test -p unone-mobile-ffi
283-.\scripts\check-android-engine.ps1
284-```
285-
286:The native host sequence is `init → resize → load_project → set_pointer/set_action → tick → observe → pause → surface_lost/resize → resume → tick → shutdown`. Do not send ticks while `pause` is active; `resume` must not inject stale wall-clock time into the simulation. The ABI's JSON observation, C header, and ownership rules are documented in `docs/mobile-host-abi.md`. These commands validate only the adapter contract and Android cross-compilation. Without APK, emulator/device, or iOS hardware evidence, do not mark mobile complete.
287-
288-This is a separate mobile track, not a prerequisite for the Web slice. Web-first delivery can be evaluated with the Web host; Android/iOS and mobile-lifecycle evidence remains deferred until those hosts are explicitly exercised.
289-
290-On Windows, if the Android SDK build-tools and JDK are available, you can additionally validate the minimal APK host:
291-
292-```powershell
293-powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1
294-powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/run-android-apk-smoke.ps1
295-```
296-
297:This places the selected game's project/script/scene into an APK, which the Java/Canvas host reads and runs through `unone-mobile-ffi`. It proves only the package/JNI/lifecycle/input boundary; it does not prove the production Android renderer, asset/bundle behavior, or the formal game gates.
298-
299-## 2. Run deterministic simulation
300-
301-```powershell
302-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json run --frames 60 --seed 42 --action Right
303-```
304-
305:AI should read `world`, `observation_digest`, and `diagnostics` first, then inspect the screenshot. The same project, seed, frame count, and input should produce the same digest; do not use visual similarity as a substitute for state assertions.
306-
307-To replay input frame by frame, use a JSON array. Each frame explicitly separates semantic actions from the optional world-space pointer:
308-
309-```json
310-[
311-  {"actions": {"Right": true}},
--
334-- engine contract: change the engine, tests, and documentation.
335-- architecture: change the architecture when the same blocker affects multiple games or prevents platform/reload support.
336-
337-When restore behavior must be verified, the test manifest may also provide a `load_save` JSON payload. It is restored **before** `Game.start`, so the game can rebuild state with `api.save.get()` inside `start` without waiting for the first update. The output also includes `save_payload`, but the engine does not decide the game's version or migration behavior.
338-- tooling/docs: change the protocol, metadata, or documentation when the CLI, diagnostics, or tutorial is noisy.
339-
340:If the game has dialogue, battle results, or other state that does not belong in Entity Transform, publish a semantic projection as a typed ViewModel with `api.observation.set(key, value)`. A test assertion can use `{"observation":{"key":"view_model","equals":{...}}}` for full JSON equality. The game should publish the minimal View tree with `api.ui.setRoot(root)` only when GAME_PLAN requires host display.
341-
342-**Both design-space axes are 0..100, and the y axis points upward**: `y = 0` is the bottom of the screen, `y = 100` is the top, and a rect grows upward from its `y`. Most UI systems use a downward y axis, so this is the easiest thing to reverse when a layout is invisible. The symptom is two rows stacked on top of each other, which the `ui preview` ASCII output shows directly.
343-
344-Each node must use **exactly one** of these positioning forms:
345-
346-- `rect`: absolute coordinates in the 0..100 design space. Use this for layouts that are not edge-anchored, such as a ring of lights arranged with trigonometric functions.
347-- `anchor` + `size` (optionally `offset` and `pivot`): edge-anchored positioning. `anchor` is one of nine named positions (`top_left`…`bottom_right`). Numeric values use **vertical units on both axes** (a percentage of viewport height), so the same declaration preserves its shape and margins at any screen aspect ratio. The engine resolves it to a rect from the viewport reported by the host; the host still receives only a rect.
348-
349-Declaring both forms, or declaring neither, is rejected. Headless tests use a 16:9 reference aspect ratio; the host reports the actual aspect ratio with `unone_web_set_viewport_aspect`, and tests can use a `{"ui":{"equals":{...}}}` assertion. The game owns the meaning of the ViewModel, View, hit-test, and actions; the engine only validates and transports the tree, while the host handles the viewport and actual rendering.
350-
351:Use `api.save.set(value)`/`api.save.get()` only when GAME_PLAN requires persistence. The game defines the payload version and migration; the engine provides JSON-like transport, and the host owns file/platform storage. Do not treat observation as save data or add save slots, cloud sync, or a game-specific schema to the engine.
352-
353-## 3.3.1 Official UI components, typography and style discovery
354-
355-Start shared controls with the official [`@unone/ui` package](ui-components.md),
356-which ships as pure Luau with Core and the portable SDK. Search
357-`game api search "UI package"`, `"shared components"`, `"button component"`,
358-`"card component"`, `"官方UI套件"`, `"共用元件"` or `"主題樣式"`; describe
359-`ui.components.info` and `ui.components.create`. Declare the exact bundled version
360:in `project.unone.json`: `"runtime_packages":{"@unone/ui":"0.4.0"}`. `info()` is
361-available before declaration and reports the name, version and `declared` flag.
362-No npm install, import or filesystem module loader is involved.
363-
364-`api.ui.components.create(theme?)` returns a typed kit with `text`, `button`,
365-`createSlider`, `createResponsiveLayout`, low-level `slider`, `combobox`, `panel`, `image`, `component`, `screen`, `scrollView`,
366-`virtualList`, `virtualGrid`, `id` and `composeStyle` methods. Every constructor
--
394-controls. Read `value`, `changed`, `dragging`, `started`, `released` and
395-`cancelled` from the update result. Use `getValue()` for repeated reads and
396-`setValue` only for explicit external changes/resets; `setValue` and `cancel`
397-stop the old held gesture until a new start. Virtual `renderItem` callbacks may
398-call only `view`, never input update. See the
399-[typed slider lifecycle](ui-components.md#interactive-sliders) for defaults,
400:step/endpoints, `axis`, `reverse`, hit-padding units and a complete entry body.
401-The low-level `slider(props)` remains a semantic leaf with no numeric controller;
402-do not put `value`/`min`/`max`/`step` or callbacks on that leaf.
403-
404-Search `"scroll inertia"` / `"deceleration"` / `"捲動慣性"` for
405-`ui.components.scrollView`. `scrollView`, `virtualList` and `virtualGrid` accept
406-`inertia=true,deceleration=8` on the supported Web host. Inertia defaults to
--
464-```powershell
465-game --project <game-root> --json api search "explosion"
466-game --project <game-root> --json api describe particle.play
467-game --project <game-root> --json api describe particle.play_batch
468-```
469-
470:Keep `systems.particle` enabled and declare the effect under scene
471-`particle_effects`. Luau selects the effect, origin and seed with
472-`api.particle.play`; `move` changes the origin for future births, `finish` lets
473-existing particles fade out, and `stop` cancels immediately. `play_batch` shares
474-one handle across static origins; inspect the API contract before selecting it
475-for a moving trail. The engine samples emissions deterministically and the
476-official Web/native players render the samples. Use the
--
478-for authored shapes, timing, color, size and blend settings.
479-
480-## 3.5 Skeletal animation and external effects (Spine / Effekseer)
481-
482-These two systems are disabled by default and have status `host_required`. Use
483-them when the game needs external Spine/Effekseer assets. For effects authored
484:directly as scene data, use the built-in particle system above. The dedicated
485-`web/presentation` host connects to both external runtimes; release Web export
486-also supports the declared legacy SKFE 1500 Effekseer subset described in
487-[player export](player-export.md). The generic Web runner, native preview and
488-native Android player do not gain these external runtimes automatically. This
489-is not cross-platform acceptance evidence. Enable them when needed:
490-
--
492-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id spine --enabled true
493-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json systems set --id effekseer --enabled true
494-cargo run -p unone-cli -- --json api describe animation.play
495-cargo run -p unone-cli -- --json api describe effect.spawn
496-```
497-
498:The game selects a clip for an Entity with `api.animation.play(id, name, {loop = true, speed = 2.0})`. The snapshot's `world.entities[].animation` includes `started_frame`; replaying the same asset/name/loop/speed does not reset it, so the host does not restart it every frame. `api.effect.spawn(asset, {x = 0, y = 1})` returns a handle. `world.effects` contains the currently existing effect instances, with handles assigned in creation order and a simultaneous limit of 256. A scene can also declare an entity's `animation` directly.
499-
500-For assets, the asset manifest supports `spine` and `effekseer` kinds and uses `files` to declare required companion sources (Spine atlases and texture pages). They are packaged with the source in the same bundle and can be retrieved with `asset read --id <id> --file <declared file>`; an undeclared file reports `ASSET_FILE_NOT_DECLARED`.
501-
502-Tests can use `{"animation": {"entity": "reel-3", "equals": {...}}}` and `{"effects": {"equals": [...]}}` for full JSON equality, making presentation state assertable without looking at the screen.
503-
504-To see them play, use `web/presentation/`: first run `scripts/build-web-live.ps1`, then from the engine repo root (`D:/Projects/Unone` in this example) start `python scripts/serve-player.py --directory .. --port 8001 --no-cache` and open `http://127.0.0.1:8001/Unone/web/presentation/?project=/Unone_Games/slot-machine/`. The parent-directory server root contains both `Unone` and `Unone_Games`, preserving those URL prefixes. It plays the same snapshot with spine-webgl and Effekseer for WebGL; native preview and the Android host currently do not render them. Vendored runtime and licensing requirements are documented in `web/vendor/README.md` (Spine requires a license; Effekseer is MIT).
--
544-`options` takes `volume` (0–1), `speed` (>0), `category`, and `x`/`y` for a
545-positional sound the host may pan on.
546-
547-### Categories are the part the engine owns
548-
549-The engine does not name `bgm` or `sfx`; the taxonomy is the game's. What it
550:owns is what happens **between** sounds, declared in `project.unone.json`:
551-
552-```json
553-"audio": {
554-  "categories": {
555-    "bgm": { "exclusive": true, "fade_in_frames": 30, "fade_out_frames": 30 }
556-  }
--
603-The engine does not decode, mix, resample, apply attenuation, or know a clip's
604-length, and it never reports whether a sound is audible: a muted player is still
605-in the same game state.
606-
607-## 3.8 Understand the screen (when the game plan requires UI)
608-
609:Headless observation is not actual screen validation. Publish a UI tree and use the preview below only when GAME_PLAN requires UI. A project without UI receives `not_applicable` for the layout gate in `verify`; do not create UI or save data just to satisfy the gate. For projects with UI, rendering the UI tree as character cells gives people and models a deterministic diagnostic that can be included in tests without a GPU, fonts, or a window; the actual host screen still requires separate validation.
610-
611-```powershell
612-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary ui preview
613-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary --json ui preview --frames 60 --strict
614-```
615-
616-Without `--json`, the command outputs Markdown: an ASCII diagram, a node table, and findings. `--frames` controls how many frames run before rendering (default 1), while `--cols`/`--rows` adjust the grid size.
617-
618:For projects with UI, `verify` renders only the **opening screen** by default (1 frame with no input), so win and lose screens are not checked. To cover other screens, declare `ui_previews` in `project.unone.json`, using the same approach as `test_files`:
619-
620-```json
621-"ui_previews": [
622-  { "name": "aim",  "frames": 1 },
623-  { "name": "win",  "frames": 540, "seed": 42, "input_sequence": "tests/win-sequence.json" },
624-  { "name": "lose", "frames": 540, "seed": 42, "input_sequence": "tests/lose-sequence.json" }
--
639-
640-The node table also includes `text fit`: a rough estimate of how many times the
641-text occupies the declared width. It assumes a 16:9 viewport and 0.5 character
642-advance, uses explicit styled font size/letter spacing/padding when present, and
643-otherwise uses legacy box height. It does not measure host fonts or wrapping and
644-is never a pass/fail verdict. Above 1.0 calls for visual review and an authored
645:size/wrap/clip choice; styled text never auto-shrinks. The entry conditions for
646-adding a rule are in Decision 0029.
647-
648-It checks only **structure**: rectangle intersections and explicit background
649-intent, rather than visual quality or measured glyph coverage. The world layer
650-(sprites and entity positions) does not yet have a corresponding textual check.
651-
--
663-
664-```text
665-## Replay diverged at frame 59 of 90
666-
667-| field | baseline | current |
668-| entities.reel-3.animation.animation | "run" | "idle" |
669:| observations.view_model.last_win | 0 | 1 |
670-| ui.children[3].text | "2" | "4" |
671-```
672-
673-Compare fields only at the **first** divergent frame. Every later frame inherits the difference, so listing all of them would bury the cause in noise. Recordings contain no wall-clock time, so a slower machine is not misclassified as a divergence.
674-
675-## 3.9 Measure performance
676-
677-```powershell
678-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary perf --frames 600 --seed 3
679-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/xiao-mary --json perf --frames 600
680-```
681-
682:Report where a frame's time goes: total time, mean, and share for the `script`/`physics`/`observe` phases; frame-time mean/median/p95; the index of the slowest frame and its phase breakdown; the number of frames over the fixed-timestep budget; Luau heap size; and the amount of content in one frame (entities, rigidbodies, UI nodes, effects, and observations).
683-
684-The `run --json` result includes the same `performance` report.
685-
686-Two properties are important:
687-
688:- **Measurement uses wall clock and does not enter the observation digest.** Measuring performance does not change the meaning of a run; the digest for the same seed and input is exactly the same as without measurement.
689-- **It provides numbers, not a verdict.** Whether it is “fast enough” depends on targets unknown to the engine. `frames_over_budget` is a fact measured against the fixed timestep, not a passing threshold.
690-
691-A debug build measures debug costs; compare versions using the same build type.
692-
693-## 4. Inspect bundles
694-
--
697-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle inspect
698-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json bundle install script
699-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle inspect
700-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json bundle install --all
701-```
702-
703:For a new project, start with `bundle pack` to generate the minimal project/script/scene manifest. If an asset manifest exists, it also produces a deterministic, uncompressed content bundle and rejects unresolved main-scene asset references. The tool writes `bundle_manifest` into `project.unone.json` automatically; it does not increment the manifest version when content is unchanged, and increments it only when content changes. Bundle success means more than that files exist: confirm the manifest hash, cache hash, active generation, dependencies, and `available`. Use `bundle install --all` when the whole generation is required; use `bundle install <id>` for one bundle, and do not treat single-bundle installation as full activation. The engine's `BundleFetcher` accepts only a reader supplied by the host, then performs streaming size/hash verification, staging, and atomic activation. The native CLI uses a local source; Web/mobile fetching, retries, storage quota, and background-download policy remain in the host adapter. The generic Web runner resolves image assets from the verified content bundle and keeps URL lifetime in the host; production CDN, OPFS, large-file streaming, and quota policy are still outside engine core. The Web sample's browser generation/cache smoke is documented in `docs/decisions/0016-bundle-generation-and-browser-storage.md`.
704-
705-## 4.5 Create, publish, and inspect assets
706-
707-```powershell
708-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset init --id asset://characters/bird/red --source assets/characters/bird/red.svg
709-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json bundle pack
--
711-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json bundle install --all
712-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset describe --id asset://characters/bird/red
713-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset read --id asset://characters/bird/red
714-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/angry-birds-2d --json asset read --id asset://characters/bird/red --output D:/tmp/red.svg
715-```
716-
717:The order above is “create the actual source/companion bytes first, declare them with `asset init`, then `pack`, strict inspect, `install --all`, describe, and read.” `asset init` is append-only and adds a declaration only for a new ID. To modify an existing stable ID, edit the original manifest entry's `source`/`files` (and any other required declaration fields) directly, preserve the ID, and do not use `asset init` to change the existing entry. It does not create images or other art; it reports the actual `changed_files` for this operation, and failure effects still list writes that already occurred if a later write fails. Replacing the source for the same stable ID does not require changing scene references; moving a source or companion requires changing the manifest path; scene size, pivot, and placement are separate authoring changes.
718-
719:`asset describe --id` is a read-only, single-asset workflow query. It reports the manifest entry, primary/companion paths, roles, existence, readable size/hash, shared paths, main-scene JSON pointers, the `main_scene_only` static scope, `native_local` active verified files, and `matches_authoring` plus ordered `required_next_actions` for the `selected_asset_native_local` scope. `matches_authoring=true` means only that this asset's active bytes match authoring; it does not mean all game content, other hosts, or the whole release has been updated. Do not treat `false` or `null` as true. When the manifest, source, or companion is missing, fix authoring and then run pack, strict inspection, install, describe, and read in order. If the latest formal active record is damaged, `install`, `describe`, and `read` all fail closed. This is a manual prerequisite for the host/operator to repair from a trusted backup based on diagnostics; report a blocker when no backup exists. Do not clear the cache, delete `.unone`, roll back to an older generation, or fabricate a record. Only cache/archive corruption or an authoring bundle manifest that has not yet been published follows `pack → strict → install --all → describe → read`.
720-
721:`asset read` retrieves one declared asset from the verified bundle in the current active generation and reports `size_bytes`, `sha256`, and `bundle_generation`. It writes a file only when `--output` is provided. It uses the same archive contract and error codes as the Web host's `readActiveAsset`: `BUNDLE_GENERATION_MISMATCH` (not installed or the manifest changed), `BUNDLE_CACHE_MISS`, `BUNDLE_CACHE_CORRUPT`, `ASSET_ID_NOT_DECLARED`, `ASSET_NOT_IN_BUNDLE`, `ASSET_ARCHIVE_INVALID`, and `ASSET_CONTENT_CORRUPT`. Both sides also validate the archive entry's own sha256, so the same asset ID must produce the same `sha256` on Web and native; a mismatch is a bundle or host problem, not a screen problem. See the [asset workflow contract](asset-workflow.md) for the complete fields and safe-path rules.
722-
723-The engine returns only verified bytes and facts. Decoding, texture upload, downloading, retries, cache capacity, and CDN/OPFS policy remain in the host. The packaged native player resolves verified `sprite.asset` bytes and renders PNG, JPEG, WebP, and bounded static SVG textures; it also provides the built-in `mesh://primitive/box` and `mesh://primitive/sphere` meshes without requiring manifest entries. `asset read` remains a data-integrity result, not a visual acceptance result: use the native report or a captured frame to prove that a specific host actually drew the asset.
724-
725-## 5. Native preview
726-
727-```powershell
728-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d preview --watch
729-```
730-
731:`--watch` waits for file metadata changes, then attempts to load the entry Luau script on the next waiting frame. On success it preserves Rust-owned world state and switches the script generation; on failure it prints a semantic diagnostic and continues using the last working script until the file changes again. Script generation counts reloads in that runtime; it is not the bundle active generation or another host's generation, so do not compare the numbers to decide whether content is synchronized. Arrow keys or A/D update Luau input. Escape or closing the window exits. This preview is a runtime smoke client, not an Editor. The packaged native player is the visual acceptance path for textured meshes, sprites, particles, Bloom and native audio; Spine/Effekseer still require their dedicated host runtimes.
732-
733-Without `--watch`, you can also start a one-shot native preview; use `--watch` when AI needs rapid edit-and-observe iteration.
734-
735-Use the single semantic Camera for both 2D and 3D projects. Choose
736-`orthographic` for a 2D-compatible view and `perspective` for a 3D view; the
737-old `camera3d.*` calls are compatibility aliases only. Inspect the semantics
--
743-cargo run -p unone-cli -- --json api describe camera.getTransform
744-cargo run -p unone-cli -- --json api describe camera.setProjection
745-cargo run -p unone-cli -- --json api describe camera.setTransform
746-cargo run -p unone-cli -- --project D:/Projects/Unone_Games/3d-racing --json test
747-```
748-
749:To validate the Web source host for an actual game project, start `python scripts/serve-player.py --directory .. --port 8001 --no-cache` from the engine repo root (`D:/Projects/Unone` in this example), then open `http://127.0.0.1:8001/Unone/web/runner/?project=/Unone_Games/3d-racing/`. The server root is `D:/Projects`, containing both engine and game directories. For a project with a bundle manifest, the same runner installs the content-addressed generation, reads the verified project/script/scene, consumes 2D/3D snapshots and UI, and can reinstall the current generation and run Luau hot reload with `Install / reload active bundle`. When the game publishes a save payload, the host persists it in a project-isolated IndexedDB store and outputs `save_store.loaded` so AI can confirm that it was actually loaded; use `?bundle=0` only to diagnose source fallback. This is generic host smoke. It does not require mobile validation for the Web slice. Without asset CDN, OPFS/production quota policy, or content-change hot-update evidence, do not mark the Web final gate passed; actual mobile-host evidence is a separate deferred track.
750-
751-## Output rules
752-
753-- Use `--json` when a machine action is needed.
754-- `facts` are facts observed by the engine; `likely_causes` are inferences; `suggested_actions` must map to the next CLI/protocol action.
755-- By default, the trace records semantic events rather than every frame, so AI context is not overwhelmed by noise.
{
  "ok": true,
  "value": {
    "name": "observation.set",
    "category": "observation",
    "purpose": "Publish the game's current serializable semantic state for observation by AI, tests, and the host.",
    "when_to_use": "When dialogue ViewModels, combat results, random results, or other game state must be readable by headless, Web, or mobile hosts.",
    "when_not_to_use": "Do not treat it as a second copy of gameplay state, and do not publish large unchanged assets or telemetry every frame.",
    "parameters": [
      {
        "name": "key",
        "type_name": "string",
        "meaning": "A non-empty stable observation name, such as view_model."
      },
      {
        "name": "value",
        "type_name": "ObservationValue",
        "meaning": "A serializable string, number, boolean, null, object, or array."
      }
    ],
    "returns": "(): no additional data on success.",
    "side_effects": [
      "Replace the latest game observation for the specified key"
    ],
    "frame_semantics": "The value updates immediately within the same update; the next observe, run report, and test assertion see the latest value. Only the last publication for each key is retained.",
    "common_errors": [
      "An empty key returns LUAU_RUNTIME_ERROR",
      "A value containing a function, userdata, cyclic table, non-finite number, or non-contiguous array key returns LUAU_RUNTIME_ERROR"
    ],
    "example": "api.observation.set(\"view_model\", { screen = \"dialogue\", node = \"intro\" })",
    "related_apis": [
      "log",
      "input.isDown"
    ]
  },
  "diagnostics": [],
  "effects": []
}
{
  "ok": true,
  "value": {
    "name": "spatial.take",
    "category": "spatial",
    "purpose": "Consume a completed batch at a fixed later simulation tick.",
    "when_to_use": "Reusable batch geometry on CPU or host-owned GPU compute; gameplay policy remains in Luau.",
    "when_not_to_use": "No AI, movement integration, damage, scene mutation or renderer replacement. V1 uses bounded complete scans, not an accelerated grid.",
    "parameters": [
      {
        "name": "ticket",
        "type_name": "number",
        "meaning": "Unconsumed ticket from an earlier successful update"
      }
    ],
    "returns": "SpatialBatchResult",
    "side_effects": [
      "Updates bounded spatial handles and frozen batch snapshots"
    ],
    "frame_semantics": "Submit/take/cancel only in update; results become visible starting the next tick. Equal-distance/time ties use ascending numeric ID. Overlap returns at most 64 contacts and explicitly errors on overflow. GPU f32 results have a documented tolerance; no bitwise cross-device promise.",
    "common_errors": [
      "Invalid/non-finite records, duplicate IDs, stale handles, early take, pending host completion, capacity and contact overflow fail explicitly."
    ],
    "example": "local result = api.spatial.take(ticket)",
    "related_apis": [
      "spatial.create",
      "spatial.pack",
      "spatial.submit",
      "spatial.take",
      "spatial.info"
    ]
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 5: Official schema and canonical typing generation

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "powershell",
  "args": [
    "-NoProfile",
    "-Command",
    "Get-Content -LiteralPath 'D:\\Projects\\Unone\\docs\\project.schema.json'; Get-Content -LiteralPath 'D:\\Projects\\Unone\\docs\\scene.schema.json' -TotalCount 100; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' --json api typings --output 'D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\engine-api.luau'; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' observe --help"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "$comment": "Generated from Rust deserialization types by game schema. Do not edit. Runtime semantic validators additionally check ranges, references, formats and capabilities.",
  "$defs": {
    "AudioCategory": {
      "additionalProperties": false,
      "description": "How a game groups its sounds, and what the engine does about the grouping.\n\nThe engine does not name `bgm` or `sfx`: the taxonomy is the game's. It owns\nonly the rules, because they decide which source survives a switch, and that\nis world state a test asserts.\n\nThe reserved fields exist so the declaration shape does not have to change\nwhen they are implemented. Declaring one is an **error**, never a silent\nno-op: a game believing it configured something it did not is the hardest\nkind of audio bug to find.",
      "properties": {
        "ducking": true,
        "exclusive": {
          "default": false,
          "description": "Only one loop in this category plays at a time; starting another begins\nstopping the previous one.",
          "type": "boolean"
        },
        "exclusive_group": true,
        "fade_in_frames": {
          "default": 0,
          "format": "uint32",
          "minimum": 0,
          "type": "integer"
        },
        "fade_out_frames": {
          "default": 0,
          "format": "uint32",
          "minimum": 0,
          "type": "integer"
        },
        "max_concurrent": true,
        "on_limit": true,
        "priority": true,
        "volume": {
          "default": 1.0,
          "description": "The bus level this category starts at, the way a mixer group has a\nvolume before anything plays. A settings screen changes it at runtime.",
          "format": "double",
          "type": "number"
        }
      },
      "type": "object"
    },
    "AudioConfig": {
      "additionalProperties": false,
      "properties": {
        "categories": {
          "additionalProperties": {
            "$ref": "#/$defs/AudioCategory"
          },
          "default": {},
          "type": "object"
        }
      },
      "type": "object"
    },
    "UiPreviewSpec": {
      "additionalProperties": false,
      "description": "One reachable screen the layout gate should inspect.",
      "properties": {
        "frames": {
          "default": 1,
          "format": "uint64",
          "minimum": 0,
          "type": "integer"
        },
        "input_sequence": {
          "default": null,
          "description": "Project-relative per-frame input replay that reaches this screen.",
          "type": [
            "string",
            "null"
          ]
        },
        "name": {
          "type": "string"
        },
        "overlap_policy": {
          "default": null,
          "description": "Project-relative exact image-behind-control overlap policy for this preview.",
          "type": [
            "string",
            "null"
          ]
        },
        "seed": {
          "default": 42,
          "format": "uint64",
          "minimum": 0,
          "type": "integer"
        }
      },
      "required": [
        "name"
      ],
      "type": "object"
    },
    "VerifyConfig": {
      "additionalProperties": false,
      "description": "The gates this project wants `verify` to run.\n\nThe default order is the engine's opinion, not a law. A project that draws\nno screen, or that is mid-way through acquiring assets, should be able to\nsay so once in its config rather than teaching its author to read past a\nred line ??a gate people learn to ignore is worse than a gate that says it\nis advisory.",
      "properties": {
        "steps": {
          "default": [],
          "items": {
            "$ref": "#/$defs/VerifyStepSpec"
          },
          "type": "array"
        }
      },
      "type": "object"
    },
    "VerifyStepDetail": {
      "additionalProperties": false,
      "properties": {
        "command": {
          "default": null,
          "description": "Reserved: a project-owned command as a gate. Declaring it is an error in\nthis build rather than a step that silently never runs."
        },
        "required": {
          "default": true,
          "description": "A failing advisory gate is reported and does not fail the run.",
          "type": "boolean"
        },
        "step": {
          "type": "string"
        }
      },
      "required": [
        "step"
      ],
      "type": "object"
    },
    "VerifyStepSpec": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "$ref": "#/$defs/VerifyStepDetail"
        }
      ],
      "description": "One declared gate: either the bare id, or the id with its settings."
    }
  },
  "$id": "https://unone.dev/schema/project.schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "asset_manifest": {
      "default": null,
      "type": [
        "string",
        "null"
      ]
    },
    "audio": {
      "anyOf": [
        {
          "$ref": "#/$defs/AudioConfig"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Sound categories and the rules between them.\n\nUndeclared means no rules, not no sound: a game can still play and loop\nwithout ever naming a category. Categories exist to say what happens\n*between* sounds, which is the part the engine owns."
    },
    "bundle_manifest": {
      "default": null,
      "type": [
        "string",
        "null"
      ]
    },
    "entry_script": {
      "default": "scripts/main.luau",
      "type": "string"
    },
    "job_scripts": {
      "additionalProperties": {
        "type": "string"
      },
      "description": "Isolated Luau job modules, keyed by operation name.",
      "type": "object"
    },
    "main_scene": {
      "default": null,
      "type": [
        "string",
        "null"
      ]
    },
    "name": {
      "type": "string"
    },
    "runtime_packages": {
      "additionalProperties": {
        "type": "string"
      },
      "description": "Exact versions of SDK-bundled Luau runtime packages used by this project.\nDeclare @unone/ui before using api.ui.components constructors. This is\ncompatibility data, not a network resolver or filesystem module loader.",
      "type": "object"
    },
    "systems": {
      "additionalProperties": {
        "type": "boolean"
      },
      "default": {},
      "description": "Engine systems this game explicitly turns on or off.\n\nAnything not declared keeps the engine default; the engine rejects\nunknown ids instead of treating a typo as a disabled system.",
      "type": "object"
    },
    "test_files": {
      "default": [],
      "items": {
        "type": "string"
      },
      "type": "array"
    },
    "ui_previews": {
      "default": [],
      "description": "Screens `verify` must check the layout of.\n\nWithout this only the opening screen is ever drawn, so a broken win or\nlose screen passes every gate. Each entry says how to reach a screen,\nthe same way `test_files` says how to reach a state worth asserting.",
      "items": {
        "$ref": "#/$defs/UiPreviewSpec"
      },
      "type": "array"
    },
    "verify": {
      "anyOf": [
        {
          "$ref": "#/$defs/VerifyConfig"
        },
        {
          "type": "null"
        }
      ],
      "default": null,
      "description": "Which gates `verify` runs, in what order, and which of them are\nadvisory.\n\nUndeclared means the engine's default order with every gate required."
    }
  },
  "required": [
    "name"
  ],
  "title": "ProjectConfig",
  "type": "object"
}
{
  "$comment": "Generated from Rust deserialization types by game schema. Do not edit. Runtime semantic validators additionally check ranges, references, formats and capabilities.",
  "$defs": {
    "AnimationData": {
      "additionalProperties": false,
      "description": "Skeletal animation state an entity publishes for a host to play.\n\nThe engine stores which clip is selected and since which frame; it does not\nevaluate bones, meshes or blending. The only declared asset kind for this\ntoday is Spine, and the host owns that runtime.",
      "properties": {
        "animation": {
          "type": "string"
        },
        "asset": {
          "type": "string"
        },
        "loop": {
          "default": true,
          "type": "boolean"
        },
        "speed": {
          "default": 1.0,
          "format": "double",
          "type": "number"
        }
      },
      "required": [
        "asset",
        "animation"
      ],
      "type": "object"
    },
    "Body3D": {
      "additionalProperties": false,
      "properties": {
        "angular_damping": {
          "default": 0.0,
          "format": "double",
          "type": "number"
        },
        "angular_velocity": {
          "$ref": "#/$defs/Vec3",
          "default": {
            "x": 0.0,
            "y": 0.0,
            "z": 0.0
          }
        },
        "body_type": {
          "$ref": "#/$defs/BodyKind"
        },
        "can_sleep": {
          "default": true,
          "type": "boolean"
        },
        "ccd": {
          "default": false,
          "type": "boolean"
        },
        "filter": {
          "default": -1,
          "format": "int32",
          "type": "integer"
        },
        "friction": {
          "default": 0.5,
          "format": "double",
          "type": "number"
        },
        "gravity_scale": {
          "default": 1.0,
          "format": "double",
          "type": "number"
        },
        "linear_damping": {
          "default": 0.0,
          "format": "double",
          "type": "number"
        },
        "lock_rotation": {
          "default": false,
          "type": "boolean"
        },
        "mass": {
          "default": 1.0,
          "format": "double",
          "type": "number"
        },
        "membership": {
          "default": -1,
          "format": "int32",
          "type": "integer"
        },
        "restitution": {
          "default": 0.0,
          "format": "double",
          "type": "number"
        },
        "sensor": {
          "default": false,
          "type": "boolean"
        },
        "shape": {
{
  "ok": true,
  "value": {
    "bytes": 26386,
    "output": "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\engine-api.luau"
  },
  "diagnostics": [],
  "effects": [
    "engine type contract written to D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\engine-api.luau"
  ]
}
Usage: game.exe observe [OPTIONS]

Options:
      --sdk <SDK>          Portable SDK root (otherwise environment or executable-relative discovery)
      --project <PROJECT>  [default: .]
      --json               
  -h, --help               Print help

~~~~

stderr:

~~~~text

~~~~

## Operation 6: Inspect generated spatial types and focused Lua entry contract

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "powershell",
  "args": [
    "-NoProfile",
    "-Command",
    "rg -n -C 5 'Spatial|start:|update:|EngineApi|type Game' 'D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\engine-api.luau'; Get-Content -LiteralPath 'D:\\Projects\\Unone\\docs\\ai-workflow.md' | Select-Object -Skip 218 -First 75; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' check --help"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
49-export type HeightfieldPatch = {x: number, z: number, width: number, depth: number, heights: {number}}
50-export type HeightfieldApi = {
51-    -- Native presentation geometry; no collision or game-owned editing rules.
52-    -- Row-major X-fast samples; update rectangles use zero-based sample indices.
53-    set: (id: string, definition: HeightfieldDefinition) -> (),
54:    update: (id: string, patch: HeightfieldPatch) -> (),
55-    remove: (id: string) -> (),
56-}
57-
58-export type Instances3DApi = {
59-    -- Packed little-endian f32 records: position.xyz, quaternion.xyzw, scale.xyz (40 bytes).
--
238-    value: number, changed: boolean, dragging: boolean,
239-    started: boolean, released: boolean, cancelled: boolean,
240-}
241-export type UiSliderControl = {
242-    view: (props: UiSliderViewProps) -> UiSliderNode,
243:    update: (input: InputApi) -> UiSliderUpdate,
244-    getValue: () -> number,
245-    setValue: (value: number) -> (),
246-    cancel: () -> (),
247-}
248-export type UiComboBoxNode = UiPlacement & {
--
505-    clearMaterial: (entityId: string) -> (),
506-    setUniform: (materialId: string, name: string, value: ShaderUniform) -> (),
507-}
508-
509--- Generic geometry only. Coordinates are packed f32 xyz triples, independent of entities.
510:export type SpatialBody = {
511-    id: number, position: {number}, radius: number,
512-    category: number?, previous_position: {number}?,
513-}
514:export type SpatialNearestQuery = {
515-    kind: "nearest", point: {number}, max_distance: number,
516-    mask: number?, exclude_id: number?,
517-}
518:export type SpatialOverlapQuery = {
519-    kind: "overlap_sphere", center: {number}, radius: number,
520-    mask: number?, exclude_id: number?,
521-}
522:export type SpatialSweepQuery = {
523-    kind: "sweep_sphere", from: {number}, to: {number}, radius: number,
524-    mask: number?, exclude_id: number?,
525-}
526:export type SpatialQuery = SpatialNearestQuery | SpatialOverlapQuery | SpatialSweepQuery
527:export type SpatialHit = {
528-    id: number, distance: number, fraction: number,
529-    point: {number}, normal: {number},
530-}
531:export type SpatialBatchResult = {version: number, results: {{hits: {SpatialHit}}}}
532:export type SpatialApi = {
533:    pack: (bodies: {SpatialBody}) -> buffer,
534:    create: (bodies: {SpatialBody} | buffer) -> number,
535:    update: (index: number, bodies: {SpatialBody} | buffer) -> number,
536-    destroy: (index: number) -> (),
537-    -- Submit/take/cancel during update; take is legal starting the next tick.
538:    submit: (index: number, queries: {SpatialQuery}) -> number,
539:    take: (ticket: number) -> SpatialBatchResult,
540-    cancel: (ticket: number) -> (),
541-    info: () -> {[string]: ObservationValue},
542-}
543-
544:export type EngineApi = {
545:    spatial: SpatialApi,
546-    shader: ShaderApi,
547-    jobs: JobsApi,
548-    instances3d: Instances3DApi,
549-    heightfield: HeightfieldApi,
550-    debug: DebugApi,
--
564-    effect: EffectApi,
565-    audio: AudioApi,
566-    log: (message: string) -> (),
567-}
568-
569:export type Game = {
570:    start: (api: EngineApi) -> (),
571:    update: (api: EngineApi, dt: number) -> (),
572-}
Run the aggregated gate once:

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/slot-machine --json verify
```

`verify` runs `check --types`, the strict `asset inspect --strict` step, the UI `layout` gate, and `test`, then returns one verdict plus each step's result. For a project with UI, the `layout` gate uses `ui preview --strict`; without published UI it is `not_applicable`. UI and save are applicable only when required by `GAME_PLAN`; do not create them just for a gate. A failed step does not stop the remaining steps, and each step includes a standalone `command`. The sections below describe individual gates when a focused query is useful; do not add a duplicate strict asset gate when `verify` is the selected entry point.

### The gate order is a default, not a law

The order above is what runs when the project says nothing. A project can
declare its own in `project.unone.json`:

```json
"verify": {
  "steps": [
    "types",
    { "step": "assets", "required": false },
    "tests"
  ]
}
```

- Order is the declared order, and only the declared gates run.
- `required: false` makes a gate **advisory**: it still runs, its diagnostics
  are still reported in full, its status is `advisory` instead of `failed`, and
  the run's effect line names it ??but it does not fail the run. Use it for a
  gate that is genuinely not ready yet (assets still being acquired), not to get
  a green line. A gate people learn to read past is worse than one that says
  out loud that it was let through.
- A gate cannot go missing quietly: an empty `steps`, an unknown id and a
  duplicate are each an error (`VERIFY_STEPS_EMPTY`, `VERIFY_STEP_UNKNOWN`,
  `VERIFY_STEP_DUPLICATED`).
- The report says where the order came from in `step_source`: `default` or
  `project`.

`{ "step": ..., "command": ... }` is the reserved shape for a project-owned
command as a gate. It is **not implemented in this build**, and declaring it
fails with `VERIFY_STEP_NOT_IMPLEMENTED` rather than silently never running.

```powershell
cargo run -p unone-cli -- --project D:/Projects/Unone_Games/minimal-2d --json check --types
```

The entry script produced by `project init` **inlines the engine's Luau type contract**, so `check --types` really rejects an API that does not exist (the engine runtime has no module require, so a single-file game must carry its own types). Use the canonical `EngineApi`, `UiApi` and `UiComponentKit` rather than handwritten `ui:any` shims. After an engine upgrade, run `game --project <game-root> api typings --update-script gameplay.luau` to replace only the explicitly marked canonical block; surrounding game code is preserved. New entries include own-line `-- BEGIN UNONE API TYPES` / `-- END UNONE API TYPES` markers. Missing, duplicate or malformed markers fail without writing. For older unmarked entries, print the contract with `game api typings` and review its initial integration; do not guess a replacement region. `--output <path>` writes a complete contract to a dedicated file, never an existing game entry script, and conflicts with `--update-script`. Tests protect the type contract and API index from drifting apart.

`check` guarantees Luau syntax and the Engine entrypoint contract: it confirms that the entry script returns a `Game` table with `start` and `update` functions. `--!strict` is reported as contract metadata. Only `--types` invokes the official `luau-analyze`; `bin/game.exe` in an engine package automatically looks for `bin/luau-analyze.exe` beside it. During engine development or when replacing the tool, set `UNONE_LUAU_ANALYZER` to the analyzer executable path. If the tool is missing, the command returns `LUAU_ANALYZER_NOT_FOUND` instead of hiding the lack of type checking.

The complete fields and assertion structure of `.test.json` are defined by the package's `test.schema.json`. `game test` treats each test file as an independent deterministic case and returns an observation digest, save payload, and assertion failures; save/restore fields are for `GAME_PLAN` requirements only. Do not use a UI screenshot as a test assertion.

For example, `project.unone.json` can set `"test_files": ["tests/opening.test.json"]`, and a test file consists of `name`, optional `frames` / `seed` / `input` / `input_sequence` / `load_save`, and `assertions`. `load_save` is only for a `GAME_PLAN` restore check. An assertion chooses exactly one of: `observation` for full JSON-value equality, `ui` for full typed UI-tree equality (including nested reusable components), or `entity` + `field` (currently `transform.x` / `transform.y`) for numeric comparison.

If only the runtime contract is needed, omit `--types`. A local Windows binary from an official Luau release can be used, or set:

```powershell
$env:UNONE_LUAU_ANALYZER = 'D:/tools/luau-analyze.exe'
```

## 1.5 Mobile host contract (separate track; not a Web prerequisite)

Android/iOS hosts should first validate lifecycle through the narrow `unone-mobile-ffi` ABI. Do not put JNI, UIKit, View, screen-pixel, or safe-area handling in game scripts:

```powershell
cargo test -p unone-mobile-ffi
.\scripts\check-android-engine.ps1
```

The native host sequence is `init ??resize ??load_project ??set_pointer/set_action ??tick ??observe ??pause ??surface_lost/resize ??resume ??tick ??shutdown`. Do not send ticks while `pause` is active; `resume` must not inject stale wall-clock time into the simulation. The ABI's JSON observation, C header, and ownership rules are documented in `docs/mobile-host-abi.md`. These commands validate only the adapter contract and Android cross-compilation. Without APK, emulator/device, or iOS hardware evidence, do not mark mobile complete.

This is a separate mobile track, not a prerequisite for the Web slice. Web-first delivery can be evaluated with the Web host; Android/iOS and mobile-lifecycle evidence remains deferred until those hosts are explicitly exercised.

On Windows, if the Android SDK build-tools and JDK are available, you can additionally validate the minimal APK host:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:/Projects/Unone/scripts/build-android-apk.ps1
Usage: game.exe check [OPTIONS]

Options:
      --sdk <SDK>          Portable SDK root (otherwise environment or executable-relative discovery)
      --types              Also run the official luau-analyze tool
      --project <PROJECT>  [default: .]
      --json               
  -h, --help               Print help

~~~~

stderr:

~~~~text

~~~~

## Operation 7: Create new isolated generic geometry example and predeclare expected results

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "node",
  "args": [
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\create-example.mjs"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\example\\project.unone.json","bytes":67,"sha256":"184cfa3c0e324c62fafbd65c939dadd22746bc67b52ea9d62bd8de938363ee54"}
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\example\\main.luau","bytes":29691,"sha256":"1a16b970727a25b8b65cd3e2c6fff646b26aac2eae3717f6aa96af4f466c920a"}
{"expectations":{"firstSubmissionTick":1,"firstDeliveryTick":2,"invalidReplacementAccepted":false,"sameTickAccepted":false,"repairVersion":2,"frozenVersion":1,"frozenNearestId":10,"frozenNearestDistance":2,"frozenOverlapIds":[10,40],"movingSweepId":30,"movingSweepFraction":0.40715233091147407,"movingSweepDistance":4.071523309114741,"consumedTicketAccepted":false,"repairedDeliveryTick":3,"repairedVersion":2,"repairedNearestId":40,"repairedNearestDistance":2.5,"repairedOverlapIds":[40]}}

~~~~

stderr:

~~~~text

~~~~

## Operation 8: Official type check of isolated example

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\example",
    "--json",
    "check",
    "--types"
  ],
  "stdin": null,
  "status": 1
}
~~~~

stdout:

~~~~text
{
  "ok": false,
  "value": {
    "project": "GenericSpatialScout",
    "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\example\\main.luau",
    "strict_mode": true,
    "entrypoints": [
      "start",
      "update"
    ],
    "type_check": null
  },
  "diagnostics": [
    {
      "code": "LUAU_TYPECHECK_FAILED",
      "severity": "ERROR",
      "summary": "Luau static analyzer found type or lint issues",
      "explanation": "The entry script passes the runtime contract but not official luau-analyze; fix the typecheck output before hot reload or running tests.",
      "facts": {
        "exit_code": 1,
        "files": [
          "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\example\\main.luau"
        ],
        "output": "D:/Projects/Unone/docs/audits/spatial-scout-2026-10-23/blind/example/main.luau:624.53-624.58: TypeError: Expected this to be\r\n\t't1 where t1 = (boolean | number | string | { [string]: t1 } | {t1})?'\r\nbut got\r\n\t'SpatialBatchResult'\r\nD:/Projects/Unone/docs/audits/spatial-scout-2026-10-23/blind/example/main.luau:632.55-632.60: TypeError: Expected this to be\r\n\t't1 where t1 = (boolean | number | string | { [string]: t1 } | {t1})?'\r\nbut got\r\n\t'SpatialBatchResult'",
        "tool": "D:\\Projects\\Unone\\.toolcache/luau-0.734\\luau-analyze.exe"
      },
      "likely_causes": [],
      "suggested_actions": [
        {
          "action": "fix_typecheck",
          "description": "Fix Luau type or lint issues using the files, line numbers, and messages in the output.",
          "command": "game check --types --json"
        }
      ],
      "source": null
    }
  ],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 9: Preserve natural type failure and create explicit observation adapter variant

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "node",
  "args": [
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\create-typed-example.mjs"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\project.unone.json","bytes":72,"sha256":"96ff360f66de1208f65c74c3a9e83cb9c7a21afb57f1199fa293ea00b98ca368"}
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau","bytes":30519,"sha256":"ed7d3a7a8f82e79d936e25767ea22e47205b765f9315b54f61e12d52aef6c10d"}

~~~~

stderr:

~~~~text

~~~~

## Operation 10: Type check repaired publication variant

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example",
    "--json",
    "check",
    "--types"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutTyped",
    "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau",
    "strict_mode": true,
    "entrypoints": [
      "start",
      "update"
    ],
    "type_check": {
      "tool": "D:\\Projects\\Unone\\.toolcache/luau-0.734\\luau-analyze.exe",
      "files": [
        "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau"
      ],
      "passed": true,
      "output": ""
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 11: One tick: invalid data, early delivery and valid repair

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example",
    "--json",
    "run",
    "--frames",
    "1",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 1
}
~~~~

stdout:

~~~~text
{
  "ok": false,
  "value": null,
  "diagnostics": [
    {
      "code": "LUAU_RUNTIME_ERROR",
      "severity": "ERROR",
      "summary": "Luau script could not be loaded or executed",
      "explanation": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau\"]:623: in function 'start'\n",
      "facts": {
        "message": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau\"]:623: in function 'start'\n",
        "runtime": "Luau",
        "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau"
      },
      "likely_causes": [
        "The entry script syntax or Engine API calls do not satisfy the current contract",
        "The script uses a missing Entity or field at runtime"
      ],
      "suggested_actions": [
        {
          "action": "check_script",
          "description": "Check the entry script contract first.",
          "command": "game check --json"
        },
        {
          "action": "inspect_project",
          "description": "Confirm the scene and Entity ids.",
          "command": "game project inspect --json"
        }
      ],
      "source": {
        "file": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau",
        "line": 623,
        "column": null
      }
    }
  ],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 12: Two ticks: first successful geometry computation and consumed-ticket rejection

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example",
    "--json",
    "run",
    "--frames",
    "2",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 1
}
~~~~

stdout:

~~~~text
{
  "ok": false,
  "value": null,
  "diagnostics": [
    {
      "code": "LUAU_RUNTIME_ERROR",
      "severity": "ERROR",
      "summary": "Luau script could not be loaded or executed",
      "explanation": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau\"]:623: in function 'start'\n",
      "facts": {
        "message": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau\"]:623: in function 'start'\n",
        "runtime": "Luau",
        "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau"
      },
      "likely_causes": [
        "The entry script syntax or Engine API calls do not satisfy the current contract",
        "The script uses a missing Entity or field at runtime"
      ],
      "suggested_actions": [
        {
          "action": "check_script",
          "description": "Check the entry script contract first.",
          "command": "game check --json"
        },
        {
          "action": "inspect_project",
          "description": "Confirm the scene and Entity ids.",
          "command": "game project inspect --json"
        }
      ],
      "source": {
        "file": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau",
        "line": 623,
        "column": null
      }
    }
  ],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 13: Three ticks: actual repaired version and state

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example",
    "--json",
    "run",
    "--frames",
    "3",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 1
}
~~~~

stdout:

~~~~text
{
  "ok": false,
  "value": null,
  "diagnostics": [
    {
      "code": "LUAU_RUNTIME_ERROR",
      "severity": "ERROR",
      "summary": "Luau script could not be loaded or executed",
      "explanation": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau\"]:623: in function 'start'\n",
      "facts": {
        "message": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau\"]:623: in function 'start'\n",
        "runtime": "Luau",
        "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau"
      },
      "likely_causes": [
        "The entry script syntax or Engine API calls do not satisfy the current contract",
        "The script uses a missing Entity or field at runtime"
      ],
      "suggested_actions": [
        {
          "action": "check_script",
          "description": "Check the entry script contract first.",
          "command": "game check --json"
        },
        {
          "action": "inspect_project",
          "description": "Confirm the scene and Entity ids.",
          "command": "game project inspect --json"
        }
      ],
      "source": {
        "file": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\typed-example\\main.luau",
        "line": 623,
        "column": null
      }
    }
  ],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 14: Preserve info publication failure and create portable string info variant

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "node",
  "args": [
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\create-portable-example.mjs"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\project.unone.json","bytes":75,"sha256":"c51377e3f0030937579c459cdaebfb06ff988e23aa28269f419f4ce4e15dc00b"}
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau","bytes":30801,"sha256":"a873718bb1961926140f20356a38dca0aeacbf1660c3c739a88dd001b8e3f655"}

~~~~

stderr:

~~~~text

~~~~

## Operation 15: Type check portable variant

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example",
    "--json",
    "check",
    "--types"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutPortable",
    "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau",
    "strict_mode": true,
    "entrypoints": [
      "start",
      "update"
    ],
    "type_check": {
      "tool": "D:\\Projects\\Unone\\.toolcache/luau-0.734\\luau-analyze.exe",
      "files": [
        "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau"
      ],
      "passed": true,
      "output": ""
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 16: One tick portable variant: pending only and invalid repair boundaries

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example",
    "--json",
    "run",
    "--frames",
    "1",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutPortable",
    "seed": 42,
    "status": "completed",
    "frames": 1,
    "observation_digest": "sha256:df7ebbbdddc25fb1d72a6488fa2856c869c846b3bce45a7728e236365812b48a",
    "world": {
      "spatial": {
        "indices": [
          {
            "bodies": [
              {
                "category": 1,
                "id": 10,
                "position": [
                  9.0,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              },
              {
                "category": 2,
                "id": 20,
                "position": [
                  0.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.10000000149011612
              },
              {
                "category": 4,
                "id": 30,
                "position": [
                  5.0,
                  -2.0,
                  0.0
                ],
                "previous_position": [
                  5.0,
                  2.0,
                  0.0
                ],
                "radius": 0.5
              },
              {
                "category": 1,
                "id": 40,
                "position": [
                  2.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              }
            ],
            "id": 1,
            "version": 2
          }
        ],
        "sequence": 2,
        "tickets": [
          {
            "batch": {
              "bodies": [
                {
                  "category": 1,
                  "id": 10,
                  "position": [
                    2.0,
                    0.0,
                    0.0
                  ],
                  "previous_position": null,
                  "radius": 0.5
                },
                {
                  "category": 2,
                  "id": 20,
                  "position": [
                    0.5,
                    0.0,
                    0.0
                  ],
                  "previous_position": null,
                  "radius": 0.10000000149011612
                },
                {
                  "category": 4,
                  "id": 30,
                  "position": [
                    5.0,
                    -2.0,
                    0.0
                  ],
                  "previous_position": [
                    5.0,
                    2.0,
                    0.0
                  ],
                  "radius": 0.5
                },
                {
                  "category": 1,
                  "id": 40,
                  "position": [
                    2.5,
                    0.0,
                    0.0
                  ],
                  "previous_position": null,
                  "radius": 0.5
                }
              ],
              "queries": [
                {
                  "exclude_id": null,
                  "kind": "nearest",
                  "mask": 1,
                  "max_distance": 100.0,
                  "point": [
                    0.0,
                    0.0,
                    0.0
                  ]
                },
                {
                  "center": [
                    2.0,
                    0.0,
                    0.0
                  ],
                  "exclude_id": null,
                  "kind": "overlap_sphere",
                  "mask": 1,
                  "radius": 0.5
                },
                {
                  "exclude_id": null,
                  "from": [
                    0.0,
                    0.0,
                    0.0
                  ],
                  "kind": "sweep_sphere",
                  "mask": 4,
                  "radius": 0.5,
                  "to": [
                    10.0,
                    0.0,
                    0.0
                  ]
                }
              ],
              "version": 1
            },
            "delivered": false,
            "id": 2,
            "submit_tick": 0
          }
        ]
      },
      "frame": 1,
      "time_seconds": 0.016666666666666666,
      "camera": {
        "position": {
          "x": 0.0,
          "y": 0.0
        },
        "zoom": 1.0,
        "view_height": 10.0
      },
      "entities": {},
      "observations": {
        "after_submit_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x000001ac246b7230",
          "operations": "table: 0x000001ac246b7200",
          "packed_format": "USB1",
          "pending": "1",
          "tickets": "1"
        },
        "initial_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x000001ac246b7590",
          "operations": "table: 0x000001ac246b74d0",
          "packed_format": "USB1",
          "pending": "0",
          "tickets": "0"
        },
        "invalid_replacement": {
          "accepted": false,
          "error": "runtime error: bodies[0].radius must be finite and in 0..=1000000\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:640: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:639>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:639: in function 'update'\n"
        },
        "phase": "submitted_v1_repaired_to_v2",
        "repair_version": 2,
        "same_tick_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_RESULT_NEXT_TICK\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645: in function 'update'\n"
        },
        "tick": 1
      }
    },
    "save_payload": null,
    "trace": [],
    "performance": {
      "frames": 1,
      "total_ms": 1.248,
      "mean_frame_ms": 1.248,
      "median_frame_ms": 1.248,
      "p95_frame_ms": 1.248,
      "slowest_frame": {
        "frame": 1,
        "total_ms": 1.248,
        "script_ms": 0.926,
        "physics_ms": 0.049,
        "observe_ms": 0.105
      },
      "sustained_fps": 801.5,
      "frame_budget_ms": 16.667,
      "frames_over_budget": 0,
      "phases": [
        {
          "name": "script",
          "total_ms": 0.926,
          "mean_ms": 0.926,
          "share": 0.857
        },
        {
          "name": "physics",
          "total_ms": 0.049,
          "mean_ms": 0.049,
          "share": 0.046
        },
        {
          "name": "observe",
          "total_ms": 0.105,
          "mean_ms": 0.105,
          "share": 0.097
        }
      ],
      "counts": {
        "entities": 0,
        "instances": 0,
        "instance_bytes": 0,
        "rigidbodies": 0,
        "ui_nodes": 0,
        "effects": 0,
        "particles": 0,
        "observations": 7
      },
      "luau_memory_bytes": 1033184,
      "luau_positive_heap_delta_bytes_per_frame": 49080,
      "profile": "debug",
      "notes": [
        "wall clock timings, excluded from the observation digest",
        "THIS IS A DEBUG BUILD. These are debug costs and are not a shipping measurement; rebuild with --release before drawing a conclusion.",
        "serialize is an optional canonical-JSON probe, not actual Web publication or decode time; measure those separately",
        "luau_positive_heap_delta_bytes_per_frame is positive net heap growth, not total allocated bytes or GC pause attribution",
        "median, p95, and frames-over-budget use the most recent bounded sample window (up to 1024 frames)"
      ]
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 17: First delivered geometric results on the second tick

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example",
    "--json",
    "run",
    "--frames",
    "2",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutPortable",
    "seed": 42,
    "status": "completed",
    "frames": 2,
    "observation_digest": "sha256:608551dd1786570b5d9620634d33a583cec340a77573cb1da883e47ac80c400a",
    "world": {
      "spatial": {
        "indices": [
          {
            "bodies": [
              {
                "category": 1,
                "id": 10,
                "position": [
                  9.0,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              },
              {
                "category": 2,
                "id": 20,
                "position": [
                  0.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.10000000149011612
              },
              {
                "category": 4,
                "id": 30,
                "position": [
                  5.0,
                  -2.0,
                  0.0
                ],
                "previous_position": [
                  5.0,
                  2.0,
                  0.0
                ],
                "radius": 0.5
              },
              {
                "category": 1,
                "id": 40,
                "position": [
                  2.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              }
            ],
            "id": 1,
            "version": 2
          }
        ],
        "sequence": 3,
        "tickets": [
          {
            "batch": {
              "bodies": [
                {
                  "category": 1,
                  "id": 10,
                  "position": [
                    9.0,
                    0.0,
                    0.0
                  ],
                  "previous_position": null,
                  "radius": 0.5
                },
                {
                  "category": 2,
                  "id": 20,
                  "position": [
                    0.5,
                    0.0,
                    0.0
                  ],
                  "previous_position": null,
                  "radius": 0.10000000149011612
                },
                {
                  "category": 4,
                  "id": 30,
                  "position": [
                    5.0,
                    -2.0,
                    0.0
                  ],
                  "previous_position": [
                    5.0,
                    2.0,
                    0.0
                  ],
                  "radius": 0.5
                },
                {
                  "category": 1,
                  "id": 40,
                  "position": [
                    2.5,
                    0.0,
                    0.0
                  ],
                  "previous_position": null,
                  "radius": 0.5
                }
              ],
              "queries": [
                {
                  "exclude_id": null,
                  "kind": "nearest",
                  "mask": 1,
                  "max_distance": 100.0,
                  "point": [
                    0.0,
                    0.0,
                    0.0
                  ]
                },
                {
                  "center": [
                    2.0,
                    0.0,
                    0.0
                  ],
                  "exclude_id": null,
                  "kind": "overlap_sphere",
                  "mask": 1,
                  "radius": 0.5
                },
                {
                  "exclude_id": null,
                  "from": [
                    0.0,
                    0.0,
                    0.0
                  ],
                  "kind": "sweep_sphere",
                  "mask": 4,
                  "radius": 0.5,
                  "to": [
                    10.0,
                    0.0,
                    0.0
                  ]
                }
              ],
              "version": 2
            },
            "delivered": false,
            "id": 3,
            "submit_tick": 1
          }
        ]
      },
      "frame": 2,
      "time_seconds": 0.03333333333333333,
      "camera": {
        "position": {
          "x": 0.0,
          "y": 0.0
        },
        "zoom": 1.0,
        "view_height": 10.0
      },
      "entities": {},
      "observations": {
        "after_submit_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x00000285f750de80",
          "operations": "table: 0x00000285f750de50",
          "packed_format": "USB1",
          "pending": "1",
          "tickets": "1"
        },
        "consumed_ticket_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_TICKET_UNKNOWN\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:656: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:656>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:656: in function 'update'\n"
        },
        "frozen_v1_result": {
          "results": [
            {
              "hits": [
                {
                  "distance": 2,
                  "fraction": 0,
                  "id": 10,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    1.5,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 0,
                  "fraction": 0,
                  "id": 10,
                  "normal": [
                    0,
                    0,
                    1
                  ],
                  "point": [
                    2,
                    0,
                    0.5
                  ]
                },
                {
                  "distance": 0.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 4.071523189544678,
                  "fraction": 0.40715232491493225,
                  "id": 30,
                  "normal": [
                    -0.9284766912460327,
                    -0.3713906705379486,
                    0
                  ],
                  "point": [
                    4.535761833190918,
                    0.1856953650712967,
                    0
                  ]
                }
              ]
            }
          ],
          "version": 1
        },
        "initial_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x00000285f750e1e0",
          "operations": "table: 0x00000285f750e120",
          "packed_format": "USB1",
          "pending": "0",
          "tickets": "0"
        },
        "invalid_replacement": {
          "accepted": false,
          "error": "runtime error: bodies[0].radius must be finite and in 0..=1000000\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:640: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:639>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:639: in function 'update'\n"
        },
        "phase": "v1_delivered_v2_submitted",
        "repair_version": 2,
        "same_tick_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_RESULT_NEXT_TICK\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645: in function 'update'\n"
        },
        "tick": 2
      }
    },
    "save_payload": null,
    "trace": [],
    "performance": {
      "frames": 2,
      "total_ms": 0.97,
      "mean_frame_ms": 0.485,
      "median_frame_ms": 0.617,
      "p95_frame_ms": 0.617,
      "slowest_frame": {
        "frame": 1,
        "total_ms": 0.617,
        "script_ms": 0.419,
        "physics_ms": 0.024,
        "observe_ms": 0.074
      },
      "sustained_fps": 2062.7,
      "frame_budget_ms": 16.667,
      "frames_over_budget": 0,
      "phases": [
        {
          "name": "script",
          "total_ms": 0.664,
          "mean_ms": 0.332,
          "share": 0.804
        },
        {
          "name": "physics",
          "total_ms": 0.029,
          "mean_ms": 0.014,
          "share": 0.035
        },
        {
          "name": "observe",
          "total_ms": 0.133,
          "mean_ms": 0.067,
          "share": 0.161
        }
      ],
      "counts": {
        "entities": 0,
        "instances": 0,
        "instance_bytes": 0,
        "rigidbodies": 0,
        "ui_nodes": 0,
        "effects": 0,
        "particles": 0,
        "observations": 9
      },
      "luau_memory_bytes": 1033184,
      "luau_positive_heap_delta_bytes_per_frame": 24540,
      "profile": "debug",
      "notes": [
        "wall clock timings, excluded from the observation digest",
        "THIS IS A DEBUG BUILD. These are debug costs and are not a shipping measurement; rebuild with --release before drawing a conclusion.",
        "serialize is an optional canonical-JSON probe, not actual Web publication or decode time; measure those separately",
        "luau_positive_heap_delta_bytes_per_frame is positive net heap growth, not total allocated bytes or GC pause attribution",
        "median, p95, and frames-over-budget use the most recent bounded sample window (up to 1024 frames)"
      ]
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 18: Third tick delivers repaired v2 and drains tickets

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example",
    "--json",
    "run",
    "--frames",
    "3",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutPortable",
    "seed": 42,
    "status": "completed",
    "frames": 3,
    "observation_digest": "sha256:ec1a399463205ae9ce16c40e892c6ebc0baebc60a45766956a9891f2635789fc",
    "world": {
      "spatial": {
        "indices": [
          {
            "bodies": [
              {
                "category": 1,
                "id": 10,
                "position": [
                  9.0,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              },
              {
                "category": 2,
                "id": 20,
                "position": [
                  0.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.10000000149011612
              },
              {
                "category": 4,
                "id": 30,
                "position": [
                  5.0,
                  -2.0,
                  0.0
                ],
                "previous_position": [
                  5.0,
                  2.0,
                  0.0
                ],
                "radius": 0.5
              },
              {
                "category": 1,
                "id": 40,
                "position": [
                  2.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              }
            ],
            "id": 1,
            "version": 2
          }
        ],
        "sequence": 3,
        "tickets": []
      },
      "frame": 3,
      "time_seconds": 0.05,
      "camera": {
        "position": {
          "x": 0.0,
          "y": 0.0
        },
        "zoom": 1.0,
        "view_height": 10.0
      },
      "entities": {},
      "observations": {
        "after_submit_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x000001b6a9508890",
          "operations": "table: 0x000001b6a9508860",
          "packed_format": "USB1",
          "pending": "1",
          "tickets": "1"
        },
        "consumed_ticket_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_TICKET_UNKNOWN\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:656: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:656>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:656: in function 'update'\n"
        },
        "final_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x000001b6a9507960",
          "operations": "table: 0x000001b6a9507930",
          "packed_format": "USB1",
          "pending": "0",
          "tickets": "0"
        },
        "frozen_v1_result": {
          "results": [
            {
              "hits": [
                {
                  "distance": 2,
                  "fraction": 0,
                  "id": 10,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    1.5,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 0,
                  "fraction": 0,
                  "id": 10,
                  "normal": [
                    0,
                    0,
                    1
                  ],
                  "point": [
                    2,
                    0,
                    0.5
                  ]
                },
                {
                  "distance": 0.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 4.071523189544678,
                  "fraction": 0.40715232491493225,
                  "id": 30,
                  "normal": [
                    -0.9284766912460327,
                    -0.3713906705379486,
                    0
                  ],
                  "point": [
                    4.535761833190918,
                    0.1856953650712967,
                    0
                  ]
                }
              ]
            }
          ],
          "version": 1
        },
        "initial_info": {
          "api_version": "1",
          "backend": "cpu",
          "bodies": "4",
          "delivery": "next_tick",
          "external": "false",
          "indices": "1",
          "limits": "table: 0x000001b6a9508bf0",
          "operations": "table: 0x000001b6a9508b30",
          "packed_format": "USB1",
          "pending": "0",
          "tickets": "0"
        },
        "invalid_replacement": {
          "accepted": false,
          "error": "runtime error: bodies[0].radius must be finite and in 0..=1000000\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:640: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:639>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:639: in function 'update'\n"
        },
        "phase": "v2_delivered",
        "repair_version": 2,
        "repaired_v2_result": {
          "results": [
            {
              "hits": [
                {
                  "distance": 2.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 0.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 4.071523189544678,
                  "fraction": 0.40715232491493225,
                  "id": 30,
                  "normal": [
                    -0.9284766912460327,
                    -0.3713906705379486,
                    0
                  ],
                  "point": [
                    4.535761833190918,
                    0.1856953650712967,
                    0
                  ]
                }
              ]
            }
          ],
          "version": 2
        },
        "same_tick_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_RESULT_NEXT_TICK\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\portable-example\\main.luau\"]:645: in function 'update'\n"
        },
        "tick": 3
      }
    },
    "save_payload": null,
    "trace": [],
    "performance": {
      "frames": 3,
      "total_ms": 1.304,
      "mean_frame_ms": 0.435,
      "median_frame_ms": 0.355,
      "p95_frame_ms": 0.656,
      "slowest_frame": {
        "frame": 1,
        "total_ms": 0.656,
        "script_ms": 0.44,
        "physics_ms": 0.025,
        "observe_ms": 0.084
      },
      "sustained_fps": 2300.3,
      "frame_budget_ms": 16.667,
      "frames_over_budget": 0,
      "phases": [
        {
          "name": "script",
          "total_ms": 0.828,
          "mean_ms": 0.276,
          "share": 0.739
        },
        {
          "name": "physics",
          "total_ms": 0.034,
          "mean_ms": 0.011,
          "share": 0.03
        },
        {
          "name": "observe",
          "total_ms": 0.259,
          "mean_ms": 0.086,
          "share": 0.231
        }
      ],
      "counts": {
        "entities": 0,
        "instances": 0,
        "instance_bytes": 0,
        "rigidbodies": 0,
        "ui_nodes": 0,
        "effects": 0,
        "particles": 0,
        "observations": 11
      },
      "luau_memory_bytes": 1049544,
      "luau_positive_heap_delta_bytes_per_frame": 21813,
      "profile": "debug",
      "notes": [
        "wall clock timings, excluded from the observation digest",
        "THIS IS A DEBUG BUILD. These are debug costs and are not a shipping measurement; rebuild with --release before drawing a conclusion.",
        "serialize is an optional canonical-JSON probe, not actual Web publication or decode time; measure those separately",
        "luau_positive_heap_delta_bytes_per_frame is positive net heap growth, not total allocated bytes or GC pause attribution",
        "median, p95, and frames-over-budget use the most recent bounded sample window (up to 1024 frames)"
      ]
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 19: Create public-only info serialization isolation

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "node",
  "args": [
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\create-info-probe.mjs"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe","purpose":"Public API isolation of the observation-incompatible info limit field; no implementation read"}

~~~~

stderr:

~~~~text

~~~~

## Operation 20: Typecheck public info isolation

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe",
    "--json",
    "check",
    "--types"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialInfoProbe",
    "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau",
    "strict_mode": true,
    "entrypoints": [
      "start",
      "update"
    ],
    "type_check": {
      "tool": "D:\\Projects\\Unone\\.toolcache/luau-0.734\\luau-analyze.exe",
      "files": [
        "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau"
      ],
      "passed": true,
      "output": ""
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 21: Inspect actual info leaf values and isolate portability failure

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe",
    "--json",
    "run",
    "--frames",
    "1",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialInfoProbe",
    "seed": 42,
    "status": "completed",
    "frames": 1,
    "observation_digest": "sha256:4b8b712d5156e31557862bae231e64d670b6f3ce0fa0ae1c685afd0452a7a072",
    "world": {
      "frame": 1,
      "time_seconds": 0.016666666666666666,
      "camera": {
        "position": {
          "x": 0.0,
          "y": 0.0
        },
        "zoom": 1.0,
        "view_height": 10.0
      },
      "entities": {},
      "observations": {
        "all_limit_strings": {
          "bodies": "131072",
          "bodies_per_index": "65536",
          "coordinate_abs": "1000000",
          "hits_per_query": "64",
          "indices": "8",
          "queries_per_batch": "1024",
          "safe_integer": "9007199254740991",
          "submissions_per_tick": "4",
          "tickets": "16"
        },
        "complete_info_publication": {
          "accepted": false,
          "error": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau\"]:589: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau\"]:589>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau\"]:589: in function 'start'\n"
        },
        "limit/bodies": 131072,
        "limit/bodies_per_index": 65536,
        "limit/coordinate_abs": 1000000,
        "limit/hits_per_query": 64,
        "limit/indices": 8,
        "limit/queries_per_batch": 1024,
        "limit/submissions_per_tick": 4,
        "limit/tickets": 16,
        "rejected/safe_integer": "runtime error: observation integer is outside the portable Luau integer range\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau\"]:585: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau\"]:585>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\info-probe\\main.luau\"]:585: in function 'start'\n"
      }
    },
    "save_payload": null,
    "trace": [],
    "performance": {
      "frames": 1,
      "total_ms": 0.109,
      "mean_frame_ms": 0.109,
      "median_frame_ms": 0.109,
      "p95_frame_ms": 0.109,
      "slowest_frame": {
        "frame": 1,
        "total_ms": 0.109,
        "script_ms": 0.007,
        "physics_ms": 0.027,
        "observe_ms": 0.004
      },
      "sustained_fps": 9216.6,
      "frame_budget_ms": 16.667,
      "frames_over_budget": 0,
      "phases": [
        {
          "name": "script",
          "total_ms": 0.007,
          "mean_ms": 0.007,
          "share": 0.186
        },
        {
          "name": "physics",
          "total_ms": 0.027,
          "mean_ms": 0.027,
          "share": 0.698
        },
        {
          "name": "observe",
          "total_ms": 0.004,
          "mean_ms": 0.004,
          "share": 0.115
        }
      ],
      "counts": {
        "entities": 0,
        "instances": 0,
        "instance_bytes": 0,
        "rigidbodies": 0,
        "ui_nodes": 0,
        "effects": 0,
        "particles": 0,
        "observations": 11
      },
      "luau_memory_bytes": 1014364,
      "luau_positive_heap_delta_bytes_per_frame": 0,
      "profile": "debug",
      "notes": [
        "wall clock timings, excluded from the observation digest",
        "THIS IS A DEBUG BUILD. These are debug costs and are not a shipping measurement; rebuild with --release before drawing a conclusion.",
        "serialize is an optional canonical-JSON probe, not actual Web publication or decode time; measure those separately",
        "luau_positive_heap_delta_bytes_per_frame is positive net heap growth, not total allocated bytes or GC pause attribution",
        "median, p95, and frames-over-budget use the most recent bounded sample window (up to 1024 frames)"
      ]
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 22: Create final generic example using scalar info and typed result adapter

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "node",
  "args": [
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\create-final-example.mjs"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\project.unone.json","bytes":72,"sha256":"579783b47f514eaa325b1793bd48a89665a8fe57036a53df6fd1ae80fc25ceaa"}
{"created":"D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau","bytes":30917,"sha256":"dc8c294d31c1e83713299d75a133cded5a77b9f2e223328529a4368df917a2e2"}
Final example publishes only known scalar info fields. Intermediate tostring(table) pointer observations are deliberately not carried forward.

~~~~

stderr:

~~~~text

~~~~

## Operation 23: Final example official typecheck

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example",
    "--json",
    "check",
    "--types"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutFinal",
    "script": "\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau",
    "strict_mode": true,
    "entrypoints": [
      "start",
      "update"
    ],
    "type_check": {
      "tool": "D:\\Projects\\Unone\\.toolcache/luau-0.734\\luau-analyze.exe",
      "files": [
        "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau"
      ],
      "passed": true,
      "output": ""
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 24: Final example actual three tick results and state

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "D:\\Projects\\Unone\\target\\debug\\game.exe",
  "args": [
    "--project",
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example",
    "--json",
    "run",
    "--frames",
    "3",
    "--seed",
    "42"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{
  "ok": true,
  "value": {
    "project": "GenericSpatialScoutFinal",
    "seed": 42,
    "status": "completed",
    "frames": 3,
    "observation_digest": "sha256:f924cdac97418882378643ba340873c71b1a964584a352235c191ea93d1e6851",
    "world": {
      "spatial": {
        "indices": [
          {
            "bodies": [
              {
                "category": 1,
                "id": 10,
                "position": [
                  9.0,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              },
              {
                "category": 2,
                "id": 20,
                "position": [
                  0.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.10000000149011612
              },
              {
                "category": 4,
                "id": 30,
                "position": [
                  5.0,
                  -2.0,
                  0.0
                ],
                "previous_position": [
                  5.0,
                  2.0,
                  0.0
                ],
                "radius": 0.5
              },
              {
                "category": 1,
                "id": 40,
                "position": [
                  2.5,
                  0.0,
                  0.0
                ],
                "previous_position": null,
                "radius": 0.5
              }
            ],
            "id": 1,
            "version": 2
          }
        ],
        "sequence": 3,
        "tickets": []
      },
      "frame": 3,
      "time_seconds": 0.05,
      "camera": {
        "position": {
          "x": 0.0,
          "y": 0.0
        },
        "zoom": 1.0,
        "view_height": 10.0
      },
      "entities": {},
      "observations": {
        "after_submit_info": {
          "api_version": 1,
          "backend": "cpu",
          "bodies": 4,
          "delivery": "next_tick",
          "external": false,
          "indices": 1,
          "packed_format": "USB1",
          "pending": 1,
          "tickets": 1
        },
        "consumed_ticket_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_TICKET_UNKNOWN\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:657: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:657>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:657: in function 'update'\n"
        },
        "final_info": {
          "api_version": 1,
          "backend": "cpu",
          "bodies": 4,
          "delivery": "next_tick",
          "external": false,
          "indices": 1,
          "packed_format": "USB1",
          "pending": 0,
          "tickets": 0
        },
        "frozen_v1_result": {
          "results": [
            {
              "hits": [
                {
                  "distance": 2,
                  "fraction": 0,
                  "id": 10,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    1.5,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 0,
                  "fraction": 0,
                  "id": 10,
                  "normal": [
                    0,
                    0,
                    1
                  ],
                  "point": [
                    2,
                    0,
                    0.5
                  ]
                },
                {
                  "distance": 0.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 4.071523189544678,
                  "fraction": 0.40715232491493225,
                  "id": 30,
                  "normal": [
                    -0.9284766912460327,
                    -0.3713906705379486,
                    0
                  ],
                  "point": [
                    4.535761833190918,
                    0.1856953650712967,
                    0
                  ]
                }
              ]
            }
          ],
          "version": 1
        },
        "initial_info": {
          "api_version": 1,
          "backend": "cpu",
          "bodies": 4,
          "delivery": "next_tick",
          "external": false,
          "indices": 1,
          "packed_format": "USB1",
          "pending": 0,
          "tickets": 0
        },
        "invalid_replacement": {
          "accepted": false,
          "error": "runtime error: bodies[0].radius must be finite and in 0..=1000000\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:641: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:640>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:640: in function 'update'\n"
        },
        "phase": "v2_delivered",
        "repair_version": 2,
        "repaired_v2_result": {
          "results": [
            {
              "hits": [
                {
                  "distance": 2.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 0.5,
                  "fraction": 0,
                  "id": 40,
                  "normal": [
                    -1,
                    0,
                    0
                  ],
                  "point": [
                    2,
                    0,
                    0
                  ]
                }
              ]
            },
            {
              "hits": [
                {
                  "distance": 4.071523189544678,
                  "fraction": 0.40715232491493225,
                  "id": 30,
                  "normal": [
                    -0.9284766912460327,
                    -0.3713906705379486,
                    0
                  ],
                  "point": [
                    4.535761833190918,
                    0.1856953650712967,
                    0
                  ]
                }
              ]
            }
          ],
          "version": 2
        },
        "same_tick_take": {
          "accepted": false,
          "error": "runtime error: SPATIAL_RESULT_NEXT_TICK\nstack traceback:\n\t[C]: in ?\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:646: in function <[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:646>\n\t[C]: in function 'pcall'\n\t[string \"\\\\?\\D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\final-example\\main.luau\"]:646: in function 'update'\n"
        },
        "tick": 3
      }
    },
    "save_payload": null,
    "trace": [],
    "performance": {
      "frames": 3,
      "total_ms": 1.414,
      "mean_frame_ms": 0.471,
      "median_frame_ms": 0.355,
      "p95_frame_ms": 0.902,
      "slowest_frame": {
        "frame": 1,
        "total_ms": 0.902,
        "script_ms": 0.64,
        "physics_ms": 0.031,
        "observe_ms": 0.089
      },
      "sustained_fps": 2121.2,
      "frame_budget_ms": 16.667,
      "frames_over_budget": 0,
      "phases": [
        {
          "name": "script",
          "total_ms": 1.006,
          "mean_ms": 0.335,
          "share": 0.818
        },
        {
          "name": "physics",
          "total_ms": 0.04,
          "mean_ms": 0.013,
          "share": 0.033
        },
        {
          "name": "observe",
          "total_ms": 0.184,
          "mean_ms": 0.061,
          "share": 0.149
        }
      ],
      "counts": {
        "entities": 0,
        "instances": 0,
        "instance_bytes": 0,
        "rigidbodies": 0,
        "ui_nodes": 0,
        "effects": 0,
        "particles": 0,
        "observations": 11
      },
      "luau_memory_bytes": 1065904,
      "luau_positive_heap_delta_bytes_per_frame": 21813,
      "profile": "debug",
      "notes": [
        "wall clock timings, excluded from the observation digest",
        "THIS IS A DEBUG BUILD. These are debug costs and are not a shipping measurement; rebuild with --release before drawing a conclusion.",
        "serialize is an optional canonical-JSON probe, not actual Web publication or decode time; measure those separately",
        "luau_positive_heap_delta_bytes_per_frame is positive net heap growth, not total allocated bytes or GC pause attribution",
        "median, p95, and frames-over-budget use the most recent bounded sample window (up to 1024 frames)"
      ]
    }
  },
  "diagnostics": [],
  "effects": []
}

~~~~

stderr:

~~~~text

~~~~

## Operation 25: Recapture bootstrap public entrypoints and executable identity for durable evidence

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "powershell",
  "args": [
    "-NoProfile",
    "-Command",
    "foreach (\\ in @('D:\\AGENTS.md','D:\\Projects\\AGENTS.md','D:\\Projects\\Unone\\AGENTS.md')) { if (Test-Path -LiteralPath \\) { Write-Output \\",
    "INSTRUCTIONS:",
    "\\\\; Get-Content -LiteralPath \\ } }; Get-Content -LiteralPath 'D:\\Projects\\Unone\\README.md'; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' --help; & 'D:\\Projects\\Unone\\target\\debug\\game.exe' --version; Get-FileHash -LiteralPath 'D:\\Projects\\Unone\\target\\debug\\game.exe' -Algorithm SHA256 | Format-List"
  ],
  "stdin": null,
  "status": 1
}
~~~~

stdout:

~~~~text

~~~~

stderr:

~~~~text
��� �u��:1 �r��:10
+ foreach (\ in @('D:\AGENTS.md','D:\Projects\AGENTS.md','D:\Projects\U ...
+          ~
foreach �᭱���ܼƦW�١C
��� �u��:1 �r��:86
+ ... S.md','D:\Projects\AGENTS.md','D:\Projects\Unone\AGENTS.md')) { if (T ...
+                                                                 ~
�B�⦡�γ��z���������w���� ')' �y�J�򤸡C
    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
    + FullyQualifiedErrorId : MissingVariableNameAfterForeach
 

~~~~

## Operation 26: Repair shell quoting in bootstrap evidence capture using owned Node helper

Command as exact argv (no shell reconstruction):

~~~~json
{
  "cwd": "D:\\Projects\\Unone",
  "command": "node",
  "args": [
    "D:\\Projects\\Unone\\docs\\audits\\spatial-scout-2026-10-23\\blind\\capture-bootstrap.mjs"
  ],
  "stdin": null,
  "status": 0
}
~~~~

stdout:

~~~~text
{"recaptured":"bootstrap-entrypoints-recapture.txt","helpStatus":0,"helpStderr":"","versionStatus":0,"versionStdout":"game 0.1.0\n","versionStderr":"","executableSha256":"a5da57e920476a7665aab1905f3e48f8c78f1693dbe6f3ac349fba1ad15c587f","note":"Bootstrap original was visible in tool result; this later public-file/help recapture supplies a durable full text. It is not represented as a timestamped original stdout capture."}

~~~~

stderr:

~~~~text

~~~~
