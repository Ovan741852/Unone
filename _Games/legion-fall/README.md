# LEGION FALL — 10,000-unit battle probe

A Web battle prototype used to expose engine limits. Two armies start with 5,000 units each and fight automatically: infantry, archers, cavalry, ballistae, catapults, flyers and mages. The game includes melee, ranged trajectories, area damage, flying movement, deaths and selectable cameras.

| 優化前（基準版本） | 第一輪優化後 |
|---|---|
| ![Before optimization](../../docs/media/legion-fall-preview.gif) | ![After round one](../../docs/media/legion-fall-optimized.gif) |

第二輪優化完成後再追加比較。These are different recording windows, not a controlled FPS A/B test.

Optimized build, 12 seconds at original playback speed, GIF encoded at 10 fps. [Capture details](../../docs/media/legion-fall-optimized.md) · [Optimization report](../../docs/legion-fall-optimization.md).

The [original 54-second baseline recording](../../docs/media/legion-fall-demo.mp4) predates optimization. Neither recording proves stable 60 FPS with 10,000 units.

## Run

From the repository root, after installing the documented Web toolchain:

```powershell
cargo build -p unone-cli
powershell -File scripts/build-web-live.ps1 -Player -Development -Project _Games/legion-fall
node _Games/legion-fall/export.mjs
python scripts/serve-player.py _Games/legion-fall/dist/web --port 8190
```

Open `http://127.0.0.1:8190/`. Choose 1,000 / 5,000 / 10,000 units, reset, pause, or change the camera. The developer panel exposes the same registered Luau controls to humans and AI. The optional stress control prevents deaths; it is disabled in the recording.

For recording, use `python _Games/legion-fall/serve_capture.py _Games/legion-fall/dist/web --output artifacts/legion-capture --port 8195`, open `http://127.0.0.1:8195/?capture=1`, then click the recording button. Keep that tab visible throughout capture. The loopback server accepts only the three fixed recording filenames.

## Boundaries and validation

- Combat rules, target selection, movement, projectiles, damage resolution and cameras live in `main.luau`. Combat updates at 20 Hz; the engine ticks at 60 Hz.
- Units are Luau records rendered through packed GPU instances, not 10,000 entity objects or rigid bodies. This project disables both physics systems. It does not benchmark 10,000-body physics.
- Meshes use static poses. There is no skeletal crowd animation, obstacle navigation or production-quality battle balance. Bounded target queries and per-team projectile limits trade fidelity for cost.
- Web instancing is the demonstrated renderer. Native visual parity for this crowd is not implemented; this recording does not validate Android performance.
- `battle.test.json` runs 600 frames and checks that combat produces losses while conserving initial unit count. The actual exported host payload also passes CLI/WASM final observation-digest comparison for that replay. Neither check proves visual parity or general cross-platform determinism.

Performance findings and capture conditions are in [the measurement record](../../docs/legion-fall-demo.md). Asset authors, licenses and conversion details are in [ASSETS.md](ASSETS.md).

The original baseline recording predates the optimization. See [the optimization report](../../docs/legion-fall-optimization.md) for controlled CPU measurements; these are not a replacement browser FPS recording.
