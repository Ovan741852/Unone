# Optional Luau batch jobs

Status: callable runtime API. Enable `"systems": {"jobs": true}` in
`project.unone.json`; selected player builds include the optional Cargo `jobs`
feature. It is disabled by default. Algorithms, choosing batches and applying
results belong to game Luau. Rust owns isolation, scheduling and diagnostics.

| Host | Executor | Parallel |
| --- | --- | --- |
| Native / CLI | Two lazy background threads | Yes |
| Web / WASM | Inline execution after update | No |

This is not a Web Worker implementation or an arbitrary gameplay WASM loader.
Web supports the same game API and next-tick contract, but cannot use it to
remove computation from the browser main thread yet. Native joins pending work
before the next update: an expensive job can still delay a tick. No FPS guarantee.

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
