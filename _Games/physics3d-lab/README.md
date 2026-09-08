# 3D physics lab

An engine probe with 36 dynamic boxes, a fast CCD sphere, a thin wall, a moving
kinematic platform, a capsule, a sensor and a spherical-joint pendulum. Gameplay
and development controls are in `main.luau`; reusable simulation is in the engine.

Development controls: fire the CCD sphere, rebuild the stack, toggle the platform.
Use the shared panel to pause/step and inspect Profile. The capsule currently uses
a box-shaped visual proxy; collider shape and dimensions come from `scene.json`.
The trigger is shown as a thin slab but produces events without blocking bodies.

```powershell
./target/debug/game.exe --project _Games/physics3d-lab test --json
./target/debug/game.exe --project _Games/physics3d-lab preview --tools-port 8191
./target/debug/game.exe --project _Games/physics3d-lab export web --development --output <new-directory>
```

Replay checkpoints are consumed by the actual exported-player parity gate.
See [physics contract](../../docs/physics3d.md) for scope, ownership and limits.
