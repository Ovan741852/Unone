# Compute job contract model — experimental v0

Run `node --test experiments/compute-contract/job-model.test.mjs` from the repo.
This is a Node-only executable state machine, not a Worker, WASM loader, optional
engine system or callable Luau API. No production files import it. It exists to
test protocol choices before changing the synchronous engine tick contract.

## Decisions exercised here

| State/action | Meaning |
|---|---|
| `requestTick(input)` | Freeze one normalized input byte sequence; no world tick completed. A second request is an error. |
| `waiting / pending` | At least one previous-tick job remains queued. Completion messages may arrive; world/input/frame do not advance. |
| `waiting / ready` | All barrier obligations resolved. The host may enter the update, subject to pause. |
| `enterTick()` | Deliver ready results in submission order, enter one update, return frozen input. |
| `submit()` | During update only; copy input, reserve output capacity, stage work. No submission from `Game.start` in v0. |
| `finishTick()` | A successful update commits the tick and makes staged jobs dispatchable. Their delivery tick is the following tick. |
| `dispatchInput()` | Obtain an executor-owned copy of queued input, only after commit. The executor/transport must separately bound its copies. |
| `take()` | During update only; transfer one delivered result, release reservation. |
| `cancel()` | Explicit replayable control action; remove a not-yet-taken job and its barrier obligation, regardless of whether completion already arrived. |
| `reset()` | Between updates only; increment gameplay revision, discard all jobs and frozen input, preserve completed frame number. |
| `reload(false)` | Preserve old program's jobs, revision and frozen input. |
| `reload(true)` | Between updates only; new generation, discard outstanding state. |
| `fault()` | Terminal operational failure, release owned payloads, no further tick. Host must dispose the executor and handle any partial Lua mutations separately. |
| `close()` | Terminal session; a new model has a different host session identity. |

Handles include host session, runtime generation, gameplay revision and ordinal.
Session identity is operational, not gameplay state; a future replay format must
map logical job IDs rather than hash the host-local session counter. Old replies
are rejected without faulting a new generation. Taken/cancelled handles return
`JOB_EXPIRED`; no forever-growing tombstone log promises to distinguish these
two cases. Identical duplicate completions before take are ignored; conflicting
ones fault the session. No result is partly delivered through a failed barrier.

Pause can occur while waiting: completions are retained, automatic tick entry
stops, frozen input stays unchanged. An explicit paused `step` request waits for
the same barrier and authorizes exactly one update. Actual RAF, visibility,
catch-up accounting, input collection and asynchronous Step responses are not
implemented here. The future host must count only `finishTick` as completion,
continue rendering its last committed snapshot while pending, and avoid turning
barrier wait into catch-up ticks. Current production scheduler cannot do this.

## Bounds and error scope

Model defaults: 64 active jobs, 16 submissions/update, 64 KiB input/output per
job, 1 MiB total reserved payload, 4 KiB frozen tick input. These are deliberately
small test-model limits, **not approved production defaults**. Total accounting
includes retained input, reserved maximum output and frozen tick input; untaken
results keep their reservation, so they eventually reject new work instead of
growing indefinitely. Finished/taken and cancelled jobs are removed.

This is not an allocator/RSS bound. Caller buffers, message transport copies,
module binaries/memory, executors, compiled code and host object overhead need
separate capped ownership in a real implementation. It has no module operations
or ABI validation. A fault labelled `FREE_TRAP` or `START_TIMEOUT` is an injected
signal; these tests **do not prove** native interruption, browser watchdogs,
pointer checks, float validation or termination of an infinite WASM loop.

The test compares applied bytes across all 24 completion permutations of four
jobs, checks duplicate/cancel races, immutable waiting input, pause/step,
reset/reload/session replacement, malformed requests, aggregate saturation,
untaken output, and atomic barrier failure. It does not prove arbitrary gameplay
determinism, world rollback, cross-host parity or a speedup.

Independent re-review found that Node `Buffer.slice()` aliases memory despite
being accepted as a `Uint8Array`. The model now copies via `new Uint8Array(value)`
and hashes the owned copy. Regression checks mutate caller Buffer input/output
and executor dispatch copies, then verify the actual delivered bytes.

## Next gate

Select a measured, equivalent game-owned batch kernel and retain a Luau reference
and input/output corpus. The Legion Fall targeting routine is not generic 3D
nearest-neighbor search and observes in-place updated positions; replacing it
with a frozen batch changes semantics. No current evidence justifies ECS.

Before promoting this model into the engine: define a machine-readable module
layout; implement bounded/interruptible Web and native executors; adapt every
host's input/Step/replay/visibility path; test fixed-byte cross-host results and
measure end-to-end cost including transfer, validation and barrier wait.
