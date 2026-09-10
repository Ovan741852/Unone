# Versioned headless replay and memory investigation

Implemented slice: `game replay scenario`, `game replay fingerprint`, and MCP
`unone_replay_scenario` / `unone_replay_fingerprint`. These are SDK tools, not
Viewer dependencies. Existing `replay record/diff` remains unchanged.
`game --json replay describe` / `unone_replay_describe` embeds this guide, schemas
and the adapter example in the SDK binary; AI does not need this source checkout.

Replay uses a private project snapshot and a fresh worker process. A deadline
covers staging, schema validation, Lua module evaluation, start, adapter restore,
update and inspection. Production saves are not read or written. This is not an
OS sandbox for hostile native plugins. stdout from gameplay cannot corrupt reports.
On Windows the worker is attached to a kill-on-close Job owned by the parent.
It also has its own watchdog on all platforms, so losing the parent cannot leave
an infinite Lua loop running indefinitely. Abrupt parent termination can leave
temporary snapshot files for OS/user cleanup; normal completion and timeout clean
the parent-owned temporary directory. On non-Windows, parent death is bounded by
the worker watchdog rather than immediate Job teardown.

## Run the real example

```powershell
cargo build -p unone-cli
node docs/fixtures/diagnostics/create-request.mjs target/debug/game.exe replay-request.json
target/debug/game.exe --project docs/fixtures/diagnostics/project --json replay scenario --request replay-request.json
```

Expected: `status: reproduced`, `regressionStatus: passed`, four explicit full-GC
samples, with the warmup sample excluded from retention trend comparison.
This is a test workload, not evidence about YesSir's memory behavior.

## Request and identity

`reproduction` follows [the schema](reproduction.schema.json). The request also
requires `target` (the exact object returned by `replay fingerprint`), `mode`,
`scenarioSchema` (the **original schema text string**, hash its exact UTF-8 bytes),
`maxTicks` (1..100000), and `timeoutMs` (1..60000). JSON requests are limited to
8 MiB. Schemas are bundled, local `$defs` work, network/file resolution is disabled.
The schema's `$id` and `x-unone-version` must agree with capture metadata.
The request's `mode` is authoritative. `reproduction.mode` records the original
capture intent and remains archival: compatible retests deliberately do not edit
an originally exact-version capture.

Fingerprints hash all project `.luau`/`.lua` files (excluding `.git`, `.unone`,
node_modules, target, dist and build), project configuration, main scene, declared
asset sources/companions, and bundle files. Imports must be inside the project.
When a bundle lists scripts, their bytes contribute only to `scriptHash`;
bundle metadata contributes to the overall game content revision, not the asset
hash. Thus a source-only edit (including its bundle metadata update) keeps the
asset fingerprint unchanged.
Snapshot limit: 2 GiB / 50000 scanned directory entries. Symlinks are rejected.
Scripts and assets are staged before hashing; this is a **headless** identity,
not a fingerprint of external renderer plugins or browser code.
`game.revision` is a content revision, not Git HEAD; `engine.coreRevision` hashes
the actual executable, so rebuilding the CLI requires a new target/capture or an
explicit compatible-version request. Local active generation is not compared.

Only `captureOrigin: start` is implemented. A start capture requires an explicit
decimal u64 seed and input frames from tick 0. Index `i` is input for tick `i`;
it is applied to the Core's next update (resulting Core frame `i+1`). An explicit
`{}` means no input. Missing inputs are **never** synthesized. Incomplete/truncated
captures and checkpoint requests return `incomplete`, not a successful verdict.

## Project adapter (Luau)

The game return table exposes `Game.replay` with `id`, `version` and callbacks:

- `restore(capture, api) -> boolean`: called after `Game.start` on a fresh runtime.
  Apply and validate scenario/initial state completely, or return false. A `save`
  is injected before `start`. Do not assume Rust knows game-specific state.
- `inspect({tick}, api) -> {invariants, diagnostics}`: read-only inspection after
  each update. Invariants are keyed by semantic ID; diagnostics is an array of
  `{code, flag}` entries for that tick. Evidence has a 64 KiB/tick limit and is not
  persisted in a global registry. Do not mutate state or consume RNG here.
- `compatible(versions, api) -> boolean`: required only for compatible-version
  retests. Receives source/target fingerprints, source/target adapter identities and
  source schema metadata. Only explicitly accepted compatibility can proceed.
  Schema migrations are not implemented: the original schema must still validate.

The complete counter/allocate/release adapter is in
[the fixture](fixtures/diagnostics/project/main.luau). It is project behavior,
not a Core policy for retaining or collecting memory.

`expectedOverride` changes the selected matcher without modifying the original
capture. `originalMatcher` and `overrideMatcher` are reported separately.
`regressionChecks` is an optional array of `{id, expectedValue, endCondition}`.
A missing invariant is unevaluated, not a null-valued pass. An empty regression
set is `not_evaluated`. Matches wait until their declared end condition; a timeout,
insufficient inputs or tick budget cannot become `not_reproduced`.
Missing/malformed evidence channels are `incomplete`, never proof that a diagnostic
was absent. Empty Luau diagnostic tables are accepted as empty arrays.

Statuses: `reproduced`, `not_reproduced`, `incompatible`, `incomplete`,
`execution_failed`. An unexpected Lua failure is not proof of the expected issue.
Read both the selected matcher and independent regression verdicts.
Outer `ok`/CLI exit success/MCP success is true only when the selected matcher
was evaluated (`reproduced` or `not_reproduced`) and regressions passed or were not
requested. Incomplete, incompatible, crashed or failed regression runs return
`ok:false` while preserving `value` for diagnosis. Invalid request files may have
no value and include a structured diagnostic.
All replay reports include status/reason and the keys in
[the result schema](replay-result.schema.json). Early exits have null unavailable
metadata/metrics/matchers and `ticksExecuted:null`, not a fabricated zero.

## Existing profiling and new retention tools

Existing `profile.start` / `profile` / `profile.stop` provide bounded Luau function
sampling, allocation growth, incremental GC steps/time, Core phase timings and
host-specific renderer data. Allocation growth is not live retained memory.

New developer requests, usable between ticks in native and rebuilt development
Web runtimes (Core ABI uses underscores instead of dots):

```json
{"method":"memory.sample","label":"idle_after_round","collect":true,"warmup":false}
{"method":"memory.report"}
{"method":"memory.reset"}
```

Collection defaults to **false**; `collect:true` is an explicit full-GC operation.
Reports include before/after Lua bytes, reclaimed bytes, full-GC wall time,
measurement overhead, tick, phase label, bounded 128-sample history and dropped
count. Sampled peak is not a continuous peak. Hot reload replaces VM-local history.
Only same-label, post-GC, non-warmup samples contribute to trends. Three strictly
rising retained samples produce `growing_retained_heap_investigate`, never
`leak_proven:true`. Compare identical workloads and return-to-idle phases.

Replay can sample with `memory:{sampleEveryTicks,warmupTicks,collect,label}` and
attaches the actual fingerprints and profiling report. Collection changes weak
references/GC scheduling, so measure it separately from ordinary gameplay timing.
Do not assign one label across incomparable battle/loading/idle phases.
Replay adapter callbacks are excluded from gameplay function samples;
`adapterInspectWallMs` reports their wall-clock cost separately.

Retaining paths, allocation callsites, JS GC, native/Rust allocator usage and GPU
bytes remain unavailable (`null`). Existing Web `memory` can report WASM capacity,
optional browser heap and renderer counters; capacity is not allocator-in-use.
This tool supplies evidence for investigation, not an automatic cross-layer leak
or bottleneck verdict.

## Explicitly not implemented

Checkpoint/world/RNG restoration, automatic scene capture, flag registry + source
mapping, bounded trace store/query, shareable capture bundle import/export, schema
migrations, renderer replay and automated recovery remain separate roadmap work.
The broader [design contract](ai-diagnostics-schema-v1.md) is not a claim that those
features already exist.
