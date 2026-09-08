# Optional Luau batch jobs

Status: callable runtime API. Enable `"systems": {"jobs": true}` in
`project.unone.json`; selected player builds include the optional Cargo `jobs`
feature. It is disabled by default. Algorithms, choosing batches and applying
results belong to game Luau. Rust owns isolation, scheduling and diagnostics.

| Host | Executor | Parallel |
| --- | --- | --- |
| Native / CLI | Lazy pool, up to two threads, leaving one available core free | Device dependent |
| Exported Web player | Inline or lazy 0–4 Worker pool (auto default cap 2) | Device dependent |
| Older raw WASM hosts | Inline unless they implement the host job ABI | No automatic pool |

Every backend isolates the compute function in a fresh Luau VM. Results become
visible **no earlier than the next simulation tick**, including inline execution.
The authoritative next-tick barrier waits for unfinished jobs; timing cannot skip
results or change application order. This is not an arbitrary WASM module loader.

## Recommended authoring: files and closures

Declare `"job_scripts": {"search": "jobs/search.luau"}` in project config. The
file returns `function(input: buffer): buffer`. File paths must be relative `.luau`
paths within the project. Native resolves files; export and the shared Web loader
supply `job_sources` keyed by operation ID. Missing or extra sources are errors.
The runtime registers these before Game.start. Source paths survive error traces;
source hashes participate in canonical job observations. Legacy `jobs.register`
uses a virtual `jobs/<id>.luau` stack label; that label is not necessarily a file.
Only entries declared in `job_scripts` identify project source files. Changes to module files
require restarting/re-exporting the project; entry-script hot reload alone does
not reload those files.

```lua
-- Game.start; prepare/apply are ordinary closures in the gameplay VM.
local schedule = api.jobs.schedule("search", {every_ticks = 6, times = 10},
    function(api, occurrence)
        return buildFreshInput(api) -- explicit copied buffer
    end,
    function(api, output, occurrence)
        applyTargets(api, output)
    end)
-- api.jobs.cancel(schedule) cancels the schedule and its pending job.
```

`every_ticks` is a positive integer; omit `times` to continue until cancellation.
The first dispatch occurs at the next scheduler pump (before Game.update); later
ones use simulation ticks, not wall time. Preparing a task does not run its result
callback in that tick. Results are applied before Game.update on a later tick.
Callbacks run in schedule creation order, without overlapping a schedule's work.
Pause does not advance the schedule. Maximum 16 schedules; schedules and direct
submissions share the four-submissions-per-tick and payload limits below. Exceeding
a limit is an error, not an invisible backlog. Callbacks may cancel/reset schedules.
A callback failure faults jobs; already performed gameplay changes are not undone.

Compute functions cannot capture the gameplay VM's tables/entities/API. Keeping
prepare/apply closures local provides convenient authoring without giving a worker
unsafe shared state. `jobs.register(id, source)` remains available for generated
kernels and compatibility; files are the recommended everyday workflow.
See [`jobs-scheduler-lab`](../_Games/jobs-scheduler-lab) for a complete example.

## Web dispatch and AI inspection

`player.presentation.json` accepts:

```json
{"runtime_backend":"main","job_policy":{"mode":"auto","max_workers":2,"memory_budget_mb":128}}
```

Modes: `auto`, `inline`, `workers`. The cap is 0–4. Auto reserves two logical cores
for other work, estimates per-worker memory conservatively from WASM capacity
(minimum 32 MiB), and limits its budget using device memory when reported. Missing
capability information chooses conservative limits; no Worker support uses inline
in auto mode and explicitly errors in forced-workers mode. Workers start lazily.
This is a resource estimate, not a hard browser process-memory limit. The initial
worker count stays fixed during a loaded session. After four measured executions,
kernels averaging below 0.25 ms can run inline in the isolated executor; this
heuristic changes placement only, never the next-tick visibility contract.

Development WebMCP: `{"method":"jobs"}` returns runtime state plus host policy,
worker count, reason, queue/run/roundtrip totals and the most recent 64 dispatches.
Join `job` IDs with runtime `recent` entries for submit/deliver ticks, source path,
input/output size and execution cost. `profile.start`/`profile.stop` bounds runtime
measurement; host pool totals currently cover the loaded session (take differences
between reports). Native DeveloperSession exposes jobs in profile reports and CLI
run/perf JSON. Unsupported hosts report no pool; no invented zero timings.

The Web Job data path uses **UJB1 binary payloads** and transfers ownership of
standalone `ArrayBuffer`s between Workers. Only bounded metadata is JSON;
input/output bytes never become JSON numeric arrays. Legacy JSON job ABI remains
for older clients and A/B measurement, but the exported player uses binary.
New hosts fail explicitly if their WASM binary lacks the binary ABI.

This is not end-to-end zero-copy: Lua isolation, packet construction, and crossing
WASM memory boundaries still copy. WASM heaps are never detached or shared with
other workers. The JS-to-Worker handoff uses transfer lists, so the sending owner
can no longer read that buffer. See [UJB1 wire contract](job-binary.md).
`jobs.host.binary_transport` reports manager/inline wire bytes and codec costs;
`jobs.host.pool.worker_transport` contains each worker's counters. Root transport
totals cover backend lifetime (including project restarts); worker counters cover
that worker's lifetime. Take differences for a measurement window. `abi_ms`
includes Rust work; do not add it to kernel `run_ms` as disjoint CPU time.

Worker crashes/timeouts are explicit errors;
there is no silent retry that might hide an invalid task. Each worker owns a WASM
instance and job VM allocation/compilation remains a real per-job cost.

## Minimal game

```lua
local pending=nil
return {
 start=function(api)
  api.jobs.register('twice', [[return function(input)
   local output=buffer.create(4)
   buffer.writeu32(output,0,buffer.readu32(input,0)*2)
   return output
  end]])
 end,
 update=function(api)
  if pending then
   local output=api.jobs.take(pending)
   api.observation.set('answer',buffer.readu32(output,0))
  end
  local input=buffer.create(4)
  buffer.writeu32(input,0,21)
  pending=api.jobs.submit('twice',input)
 end,
}
```

Register source during initial loading/start. Source must return a function
accepting and returning a Luau buffer; syntax/type failures surface when executed.
Submit and take are permitted only inside update. Submit copies input; subsequent
mutations cannot affect the task. Output ownership transfers through another copy
into the gameplay VM. There is no shared writable world or zero-copy promise.

Submissions are staged until update and physics succeed. At the beginning of the
next tick all outstanding results are joined and validated, then exposed in
submission order. `take` is one-shot; taking during the submission tick is an
explicit error. A result may remain until a later update, subject to capacity.
There is no timing-dependent `isReady` branch. Any executor error terminally faults
the job manager before that next gameplay update; it never supplies default data.
Already performed gameplay mutations are not rolled back on script errors.

`cancel(handle)` invalidates that task; `reset()` invalidates all handles and starts
a new epoch, retaining registrations. Late replies are ignored. Cancellation is
cooperative and does not imply immediate resource reclamation. Successful hot
reload invalidates old tasks and copies registrations; use `onReload` to replace
operation source. Failed reload preserves the existing manager. Handles are
runtime-local, ephemeral and must not be persisted as save-game state. Observation
job metadata supports replay comparison, not restoration of queued VM execution.

## Isolation and limits

Each execution creates a fresh sandboxed VM: no engine/world APIs, clocks, engine
RNG, print, files or network. Supply seeds explicitly in input. Normal
[Luau determinism boundaries](luau-determinism.md) still apply; isolated execution
does not make arbitrary floating-point algorithms universally portable.

- 8 registered operations; ASCII IDs up to 64 bytes; source up to 16 KiB each.
- 4 submissions per tick, including subsequently cancelled/reset submissions.
- 16 live handles maximum; 256 KiB maximum for each input and output.
- 4 MiB logical payload reservation, accounting input plus maximum output per
  handle until take/cancel. Nonempty inputs can hit this before 16 handles.
- 16 MiB Luau VM allocation limit per execution; two native workers.
- 2,000,000 VM safe points per job, covering source evaluation and invocation.

Payload reservations are not process RSS: VM memory, transient copies, queued
cancelled tasks and transport allocations are separate. The native work queue
holds at most 16 tasks plus two executing tasks. Budgets/cancellation are
cooperative, not a hard wall-time deadline or hostile-code containment guarantee;
compilation and native builtins are not preempted by a VM safe-point check.

## AI discovery and measurement

`game api search jobs --json` discovers the callable API. CLI run/perf JSON includes
`jobs`. Native/Web developer `profile`, `profile.start`, `profile.stop` expose:

- `backend`, `parallel`, `workers`, explicit limits and terminal `fault`;
- live `active_jobs` and logical `reserved_payload_bytes`;
- window totals: completed jobs, input/output bytes, summed executor time and
  main-thread barrier waiting time;
- the last 64 delivered jobs with operation, handle, submit/deliver ticks and cost.

Timings include VM creation, source compilation and copies. Summed concurrent
executor time is not frame wall time. Window totals count results delivered inside
the window; executor work may have started earlier. Stop freezes totals/recent
records, while live queue counts continue changing. With no explicit window,
metrics cover lifetime. Timings never enter the observation digest; operation and
input/output hashes do. Output hashes become visible only at the logical barrier.

Try [Jobs Lab](../_Games/jobs-lab/README.md). Measure against direct gameplay Luau
as well as the inline isolated executor: small tasks may lose more to isolation
than they gain from parallel execution. Good candidates are independently batched
procedural fields, path queries or geometry generation, after profiling identifies
enough work. No gameplay algorithm is built into the engine job layer.

## Reproduce artifact acceptance

Use Node 20 or newer for the JavaScript tools.

Build the CLI, then `scripts/build-web-live.ps1 -Player -Development -Project
_Games/jobs-lab`. Export to a new directory, and run
`node scripts/install-job-worker-acceptance.mjs EXPORT _Games/jobs-lab`. Serve that
export with JavaScript MIME types and open `job-acceptance.html`. It compares 30
ticks across inline and two actual compute Workers in both simulation placements,
then checks the final digest against CLI. Use `_Games/jobs-scheduler-lab` and
minimum-worker argument `1` for file-backed periodic callbacks. The pool remains
lazy: a single periodic task does not need two active workers. Repeat against a
production runtime to check Job execution without developer API exports.

## Executor bytecode cache

Native threads and Web WASM executors each retain an LRU of internally compiled
Luau bytecode: at most 32 programs and 1 MiB of source plus bytecode. Exact source
content is the key; edited source misses immediately. Paths are applied on each
load so identical source in different files keeps the current error location.
Compiler options are fixed to mlua defaults. This cache is process-local and
accepts no user-supplied bytecode. It never retains a VM, globals or closures;
each execution still creates an isolated VM and copies its input/output.

AI `jobs` recent entries include `executor_profile`: `vm_ms`, `compile_ms`
(lookup plus compilation on misses), `load_ms` (including module initialization),
`call_copy_ms` (kernel plus buffer copies), `cache_hit`, `cache_bytes` (resident
source plus bytecode, excluding allocator overhead). Worker histories expose the
same object. These are host-local diagnostics, excluded from replay state.
Phases are completed-phase measurements, not separate pure-copy attribution;
failed phases can remain zero. Total execution time also includes teardown.
Cache residency lasts for the executor thread/WASM instance, across profile
windows; a window reset does not flush it.

`node scripts/benchmark-job-cache.mjs BEFORE_RUNTIME AFTER_RUNTIME report.json`
compares matching release feature sets using alternating runs and exact output
checks. See [measurements](reviews/2026-09-08-job-cache.md).
