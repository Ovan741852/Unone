# Legion Fall recording: measured limits

Captured September 8, 2026 on Windows, Ryzen 9 9900X; the machine reports an RTX 5080 and integrated Radeon graphics. The capture does not establish which adapter the browser selected. Codex in-app Chromium, 1280 × 720 drawing buffer, release-built development player, bloom off, both physics systems off. Other desktop workloads were not isolated.

The 54-second MP4 is a transcode of real-time canvas MediaRecorder output. No playback acceleration or offline simulation frames were used. Recording and its compositing HUD add overhead; this is an end-to-end demonstration, not an isolated renderer benchmark.

| Recorded observation | Result |
| --- | --- |
| Initial units | 10,000, equally split |
| Samples with at least 9,500 alive and a valid FPS reading | 16 one-second samples |
| RAF FPS in those samples | median 9; range 9–10 |
| Initial crowd geometry | about 3.39 million triangles, 15 draw calls |
| Final wall / simulation time | 54.0 s / 37.7 s |
| Final survivors | 2,711 red + 1,873 blue |

RAF FPS measures browser presentation cadence, not combat tick throughput. Simulation falls behind wall time under load; the recording makes this visible. Later FPS reflects fewer living units and is not a 10,000-unit result.

[Recorded telemetry](media/legion-fall-telemetry.json) retains the sampled counters and end runtime profile. The recorder's 30 FPS request is only a target; the encoded stream contains fewer frames under load. Video frame rate and the HUD's rolling RAF rate are distinct measures.

The end-of-capture engine profile reports a script-phase mean of 17.653 ms per engine tick and 99.3% of measured engine time; physics time is negligible. These counters include frames before recording reset and the script phase includes engine API calls made by Luau. They do **not** identify a single Luau function or constitute a clean capture-only average. Renderer GPU rolling timings were low (about 0.62 ms median near the start), but these windows also include prior frames and omit CPU simulation, bridge and recording work.

## What to optimize next

The strongest current evidence points to CPU-side script/update work, rather than draw-call count or physics. Split measurements around grid rebuilding, target acquisition, combat/projectiles, pose packing and `instances3d.set` before attributing cost more precisely.

The game already uses a uniform grid, bounded target candidates and staggered reacquisition. Adding another broadphase alone would not explain or fix this result. Candidate changes include reusing grid buckets, reducing temporary allocations, avoiding unnecessary pose/quaternion recomputation, and lowering distant-unit decision frequency. Gameplay choices belong in Luau.

The engine should separately measure and, if necessary, improve packed-buffer validation, copying, observation serialization and host upload. Those are reusable engine mechanisms. All unit poses are repacked at the 20 Hz game update; the host observation path also carries packed instance data. A binary/dirty-buffer transport is a candidate, not a measured speedup yet.

The current `bridge_ms` field includes input transfer, the whole WASM tick and JSON readback; it is not a pure transfer measurement. See the [AI profiling tool review](reviews/2026-09-08-ai-profiling-tools.md) for attribution, collection-overhead and measurement-window gaps.

The 600-frame game test passes loss/conservation assertions. CLI and the actual exported Web host payload produce matching final observation digests for that replay. This establishes one reproducible behavior check, not general visual, performance or cross-platform parity.
