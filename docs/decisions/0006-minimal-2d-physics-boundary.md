# Decision 0006: Start with a Verifiable Minimal 2D Physics Mechanism

## Decision

The first physics slice provides only engine mechanisms:

- dynamic/static circular RigidBody2D
- gravity, a fixed timestep, and velocity/position integration
- an optional ground plane
- deterministic circle-collision resolution
- Luau's `getVelocity`, `setVelocity`, and `physics.applyImpulse`

Birds, slingshots, trajectories, pigs, wooden boxes, level rules, and win/loss conditions all stay in `Unone_Games`.

## Why This Is Needed Now

2D physics is the first cross-game mechanism needed for Angry Birds validation, and it can also be reused for platform games, pinball, collision-based UI, or other physics-based gameplay. Without it, the existing transform demo cannot prove that the engine can support a real game.

## Explicitly Not Doing

This slice does not preemptively build friction, joints, polygon meshes, continuous collision detection, a spatial index, network rollback, or a complete physical-material system. If a real validation game is blocked by the same performance or correctness problem, expand the system using test evidence; do not patch each game independently.

## Changeability

The Scene's physics settings and RigidBody2D data are source JSON; Luau calls only semantic APIs. If the solver is replaced later, preserve the scene/script semantic fields and observation contract, without exposing solver details to the game side. If two games prove this boundary wrong, it may be dismantled and rebuilt directly; there is no promise of old API compatibility.
