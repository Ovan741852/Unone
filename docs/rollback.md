# Rollback checkpoints

A rollback host runs ahead on guessed input, goes back to an earlier tick when
the real input arrives, and runs those ticks again. That needs a copy of
everything the simulation continues from. This is phase 1 of the
[rollback netcode proposal](proposals/rollback-netcode-v1.md): checkpoints and
restores in one process, and `game test --rollback` to prove a game survives
them. Per-player input, `api.netcode` and a transport come later.

## What a checkpoint holds

The engine copies its own state whole: the World (entities, 2D and 3D physics
bodies and solver state, particles, effects, audio requests, camera, render,
lighting and material state), input edges, the random generator, observations,
the published UI, the save payload, host time and sprite resource feedback.

The game's Luau variables are not copied: a Luau heap is large and does not
survive engine changes. The game gives them through two hooks, both or
neither:

```luau
local Game = {}
local score = 0
local trail = {}

function Game.update(api)
  score += 1
  table.insert(trail, api.random.nextFloat())
end

-- Everything update reads, as plain data.
function Game.saveState(api)
  return {score = score, trail = table.clone(trail)}
end

-- The engine state is already back when this runs: set Luau variables only.
function Game.loadState(api, state)
  score = state.score
  trail = table.clone(state.trail)
end
```

- The state is plain data: tables, numbers, strings and booleans. A function,
  buffer or cycle fails the checkpoint with `GAME_STATE_INVALID`.
- One hook without the other fails the load with
  `GAME_STATE_HOOKS_INCOMPLETE`.
- Include locals of required modules, caches and counters too: whatever the
  ticks after a checkpoint change and a later update reads. Copy tables you
  keep (`table.clone`), so the saved state does not change with them.
- A game whose Luau variables do not affect the simulation needs no hooks.
- Both hooks run under the script time limit, like `update`.

Not part of a checkpoint: `api.log` lines already in the trace, performance
counters, the viewport and preview tools. They describe what the host saw, not
what the simulation continues from.

## Proving it: `game test --rollback K`

```bash
game test --rollback 8
```

Each test runs twice in step. The straight run ticks as `game test` does. The
rolled-back run, before every tick, takes a checkpoint, runs up to `K` ticks on
wrong input (nothing held, pointer up), restores, then runs the real tick.
After every tick both must have the same observation digest, and the
rolled-back run must still pass the test's assertions. `K` is 1 to 64; MCP
`unone_test` takes it as `rollback`. A case fails at the first problem:

| Failure | Meaning |
| --- | --- |
| `ROLLBACK_DIVERGED` | The tick run again differs from the straight run. The message names the tick and the first difference, for example `world.observations.count = 7, expected 6`. Usually Luau state the hooks miss, or no hooks. |
| `ROLLBACK_RESTORE_INCOMPLETE` | After the restore the world differs from the checkpoint: engine state the checkpoint does not copy. An engine bug. |
| `ROLLBACK_PREDICTED_TICK_FAILED` | The game failed on the guessed input, which a rollback host would also give it. |
| `ROLLBACK_UNSUPPORTED` | The game uses spatial batches or jobs (below). |

## Not yet

- Spatial batches (`api.spatial`) and jobs (`api.jobs`) carry work between
  ticks. A checkpoint while either is in use fails with `ROLLBACK_UNSUPPORTED`.
- Sounds and effects requested by ticks that are run again are requested
  again; a rollback host will deduplicate them by tick (proposal, phase 3).
- A checkpoint copies the whole World every time, with no sharing between
  checkpoints.

## Host API

Rust hosts call `EngineRuntime::checkpoint()` for a `Checkpoint` and
`EngineRuntime::restore(&checkpoint)` to continue from it, as many times as
they like. `Checkpoint::frame()` is the tick it continues from, and
`Checkpoint::game_state()` is what `Game.saveState` returned.
`EngineRuntime::has_state_hooks()` says whether the game has the hooks.
