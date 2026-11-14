# Proposal: rollback netcode v1

- Date: 2026-11-14
- Status: proposed, not implemented. Nothing here is a callable API yet.
- Scope: Engine runtime (state checkpoints), `api.netcode`, official Web
  player transport, replay and test hosts

## Problem

`api.network` relays ordered text between sessions; each game builds its own
protocol on it. Populous built lockstep this way, which waits for every
player's input before each turn, so latency becomes input lag. Action games
need **prediction**: run ahead on guessed remote input, then correct when the
real input arrives. Engines compared with Unone offer this (for example
server-authoritative snapshots with prediction and reconciliation).

## Why rollback suits Unone

Unone's simulation is deterministic: the same inputs from the same state give
the same observation digest on every host. That makes GGPO-style rollback
the natural model. Every peer simulates everything, only inputs travel, and
no server runs game code. A mismatch is a bug that the digest can detect,
not drift to smooth over. Server authority stays possible on top of
`api.network` for games that need hidden information.

## Proposed contract

1. **Declaration** in `project.unone.json`:
   `"netcode": {"mode": "rollback", "players": 2, "input_delay": 2, "max_rollback": 8, "checksum_every": 30}`.
2. **Per-player input.** Each tick has one input frame per player, the same
   `InputFrame` hosts already send (actions, gamepads, pointer). Game code reads
   `api.netcode.input(player)`, returning `isDown` / `wasPressed` /
   `getGamepad` views for that player; `api.input` stays local-only for menus.
3. **State checkpoints.** The engine checkpoints World state (entities,
   physics, particles, random generator, audio requests, render and lighting
   state) every tick in a ring of `max_rollback + 1`. Game Luau state is not
   copied implicitly: the game provides `Game.saveState()` returning plain
   data and `Game.loadState(state)`. Games written for `api.save` already
   have most of this. A checkpoint is World + that data.
4. **Prediction and rollback.** A missing remote input is predicted as that
   player's last input. When the real input differs, the engine restores the
   checkpoint of that tick, replaces the input and re-simulates to the present
   in one host frame. Presentation always shows the newest predicted tick.
   Audio and effect events from re-simulated ticks are deduplicated by
   (tick, kind, id).
5. **Transport.** Peers exchange `(tick, player, input frame)` and periodic
   `(tick, digest)` through the existing relay, as ordered physical rows, so
   replays record exactly what arrived.
6. **Desync detection.** Every `checksum_every` ticks peers compare
   confirmed-tick observation digests. A mismatch stops with `NETCODE_DESYNC`,
   naming the first differing tick and both digests, plus a replay of each side
   that `game replay diff` can compare.

## Plan

1. **Checkpoint and restore in one process.** World snapshot/restore,
   `Game.saveState`/`loadState`, and a test hook proving that "simulate N, roll
   back K, re-simulate" gives the same digest as straight simulation for
   physics, particles and random numbers. This is the hard part, and every
   later phase depends on it.
2. **Two simulated peers in `game test`.** An in-memory transport with
   configurable latency and loss, so rollback correctness and cost (ticks
   re-simulated per frame) are measured headlessly.
3. **Web transport.** The relay carries input and digest rows; the official
   Web player predicts, rolls back and reports rollbacks per second.
4. **Native transport** once native gains a network adapter (it carries none
   today), then spectators and late join by full checkpoint transfer.

## Alternatives

- **Lockstep only** (today): simplest and already possible; adds latency as
  input lag.
- **Server-authoritative snapshots with client prediction**: hides state from
  clients and tolerates nondeterminism, but needs a server running game code
  and per-entity interpolation; it duplicates work determinism already gives.
- **Implicit Luau VM snapshots**: no game hooks, but copying a Luau heap every
  tick is costly and does not survive engine version changes; explicit game
  state is smaller, testable and doubles as the save format.

## Open questions

- How large a World checkpoint is for the validation games, and whether
  copy-on-write per system is needed to keep ~8 checkpoints per tick cheap.
- Which presentation-only state (camera smoothing, UI animation) must be
  excluded from rollback so the screen does not jump.
