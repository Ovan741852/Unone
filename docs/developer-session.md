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
