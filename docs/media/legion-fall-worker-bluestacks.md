# BlueStacks Worker demonstration — 2026-09-08

[Play the 20-second MP4](legion-fall-worker-bluestacks.mp4).

Actual BlueStacks 5 Android Chrome screen recording, 1600×900, original speed,
H.264, no audio. Android `screenrecord` captured a separate 24-second run; the
first three seconds were trimmed and the next 20 seconds encoded for playback.
No generated frames or speedup. Recording overhead is excluded from benchmark
numbers. The visible RAF FPS label is not proof of distinct simulation poses or
physical display scanout; battle state commits at 20 Hz.

One Worker owns the full unchanged Luau/WASM battle simulation. This is not a
search-only offload and is not the shipping player default. The fixture maintains
10,000 living units, uses empty input and a fixed wide camera. The browser renders
at 1920×1080 internally (1280×720 CSS with DPR 1.5), with the Android viewport
showing the visible part of that canvas. Browser chrome is retained as evidence
that this is the emulator's Android browser.

See the [comparison report](../legion-fall-worker.md) for actual benchmark values.
