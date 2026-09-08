# Optimized Legion Fall capture

Recorded 2026-09-08 from the exported development player corresponding to commit `4ce04d4`. Uses the implemented WASM memory instance transport. Source capture: 1,280 × 720, 54 seconds, real-time canvas MediaRecorder with live Luau battle and camera changes. No offline simulation or playback speedup.

The GIF shows source seconds 8–20 at 640 × 360, 10 encoded frames/s and 96 palette colors. Living units decrease from approximately 9,768 to 8,000 during the excerpt. The visible player FPS counter was approximately 15–16 during this recording and includes recording overhead; GIF frame rate is independent. This capture is a visual demonstration, not a controlled before/after performance benchmark. See the [CPU optimization report](../legion-fall-optimization.md) for repeated comparisons and limits.

The original baseline GIF/video remain in this directory. The root and game READMEs now display the optimized GIF.
