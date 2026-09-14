# Minimal shader fallback regression

This change adds tests only. It does not change game rules, renderer behavior,
or the external unone-shader repository. WebGPU initialization failure → WebGL
switching is intentionally outside this test scope.

## Results

- Node: **7 passed, 0 failed, 0 skipped** (4 new fallback cases, 3 existing Bloom tests).
- No `navigator.gpu`: execute the installed plugin's actual preview module in a
  VM with no GPU API. It reports WebGPU unavailable/no pixels claimed, never
  requests a render loop/context, and does not report compiled/rendered. Real
  plugin stdin/stdout inspection still succeeds; its preview contract explicitly
  keeps `compilation: not_checked`.
- LDR: mask `EXT_color_buffer_float` at effect creation and use real WebGL to draw
  all four Bloom/AO states. `hdr:false` verifies the RGBA8 fallback was selected.
  First-frame AO-only is also exercised before initializing Bloom textures.
- No timer: mask `EXT_disjoint_timer_query_webgl2`; all four states still draw.
  `gpu_timer_available:false`; every GPU alias and bucket is `null`, never zero.
  The Node fixture additionally asserts no timer query is created.
- Disjoint: Node fixture marks pending queries disjoint and ready. They are
  deleted without entering the measurement buckets; drawing continues. Existing
  valid historical samples are not tested for invalidation or relabelled as new.
- Real plugin profile: CPU-only timing remains in `cpu_ms`, `gpu_ms:null`;
  requests containing no measured time are rejected.

Browser evidence is `browser.json` and `preview.png`: Edge, ANGLE D3D11,
NVIDIA RTX 5080; five programs linked; no GL/console/page errors. Eight forced
fallback probes and the first-frame LDR probe match the flat reference pixel
`[80,80,80,255]` within the enforced tolerance of one channel unit.
The fallback-only run deliberately collects **no performance samples**;
`samples:[]` is not a zero-millisecond performance claim.

## Reproduce

```powershell
$env:UNONE_SHADER_ROOT='D:/Projects/Unone-shader'
node --test scripts/unone-shader-fallback.test.mjs web/renderer/bloom.test.mjs
$env:PLAYWRIGHT_MODULE='C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
node scripts/verify-shaders-browser.mjs docs/evidence/shader-fallback-2026-09-09 --fallback-only
```

Use your installed plugin and Playwright paths. Without `UNONE_SHADER_ROOT`, the
two external-plugin tests explicitly skip; skipped results are not a pass for
the no-WebGPU requirement. No plugin source is copied or mocked to simulate a
successful inspection.

## Limits

Missing extensions are injected on an otherwise capable GPU; this is not a test
on physically unsupported hardware. Disjoint/no-WebGPU branches use controlled
VM/mock environments. Pixel assertions cover a flat low-radiance fixture, not
HDR appearance equivalence, every scene or all drivers. No WebGPU→WebGL failure
conversion, GPU device loss, platform matrix or benchmark was added this round.
