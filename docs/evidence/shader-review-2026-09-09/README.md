# YesSir shader review — 2026-09-09

Source changes are confined to reusable presentation code in `web/renderer/bloom.js`.
Existing uncommitted game, vendor, panel and engine changes were retained. No commit,
push, reset, game export or gameplay changes were performed.

## Inventory and tools

- `web/renderer/bloom.js`: fullscreen vertex, bright extraction, separable blur,
  combine and embedded depth SSAO GLSL. Three.js supplies the GLSL3 prefixes and
  `colorspace_fragment`. Tested through the actual bundled Three.js renderer.
- `web/shared/webgpu-snapshot.js`: color and textured sprite WGSL. Both inspected
  with the installed `unone-shader` protocol and checked by real WebGPU compilation.
- Other `web/renderer` modules use built-in Three.js materials or the Effekseer
  adapter. No additional owned standalone `.wgsl/.glsl/.vert/.frag` assets were
  found in `web` or game sources outside vendor/export directories. Third-party
  generated shader internals and archived game bundles were not rewritten.
- `unone-shader` currently accepts WGSL only. The GLSL request is explicitly
  rejected; it is not renamed WGSL to obtain a false pass. Its external preview
  response remains `compilation: not_checked`; the browser supplies compilation
  and visual evidence. `shader.profile` receives real asynchronous timer samples.

## Findings and fixes

1. **Confirmed wasted passes:** Bloom off / AO on still ran bright extraction
   and both blur passes. It now renders the scene and combine only (5 → 2 passes).
   The combine shader also avoids fetching an unused/uninitialized Bloom texture.
2. **Confirmed unnecessary AO work:** position reconstruction and derivatives ran
   even with AO disabled. Depth and normal work now runs only when AO is enabled
   and the pixel contains geometry.
3. **Depth/normal boundary hardening:** the previous fixed `.001` UV clamp was
   resolution-dependent, and inverse-W division and `normalize(cross(...))` had
   no degenerate-value protection. UVs now clamp to half a depth texel; division
   and normalization are guarded. Background samples do not occlude surfaces.
   Normals use the closer depth neighbour along each axis to reduce silhouette
   discontinuities. Degenerate inputs are protected without claiming that the
   old path failed every device's pixel test.
4. **Measurement state consistency:** Bloom/AO switches are captured at draw
   entry, so synchronous overlay callbacks cannot relabel the current query or
   partially change the current frame. Four buckets and existing aliases remain.

No compilation failure or duplicate color-space conversion was observed in the
tested baseline. Bright/blur remain linear intermediates; combine performs the
final output conversion. Their existing thresholds, weights and art settings were
preserved. Depth texture sampling is explicitly nearest; tiny targets are bounded
to at least one pixel.

## Validation

- `node --test web/renderer/*.test.mjs web/shared/webgpu-snapshot.test.mjs web/developer/api.test.mjs`: **15 passed**.
- Actual Unone CLI `plugin.test`: **4/4**.
- Real Edge / ANGLE D3D11 / NVIDIA RTX 5080: **9 WebGL programs linked**, GL error 0,
  no browser console/page errors in the final run.
- Both WGSL modules returned empty compilation messages. The original raw WebGPU
  renderer also created its pipelines and submitted an empty-scene frame.
- Perspective scene preview, orthographic flat plane, 1×1 / 17×9 / 641×359 targets,
  and forced RGBA8 fallback with first-frame AO-only rendering were exercised.
- All four flat-plane probes and the RGBA8 first-AO probe produced
  `[80,80,80,255]`, with a one-channel-unit tolerance enforced by the test.
- Unit tests verify 1/5/2/5 pass counts, delayed query bucket assignment, aliases,
  reset and in-flight mode consistency.
- `after/preview.png` is a real rendered fixture, not ImageGen. `after/browser.json`
  stores device, compiler, pixel and timing evidence. `unone-shader.json` stores
  the actual tool responses. Baseline captured a favicon 404 (not a shader error);
  the fixture server handles it in the final run.

## Timing interpretation

640×360 small static scene, 48 submitted frames per state, asynchronous query
completion (47–48 collected samples per bucket). Tool-reported p95 milliseconds:

| State | Before | After |
|---|---:|---:|
| Bloom off / AO off | 0.008736 | 0.009568 |
| Bloom on / AO off | 0.120896 | 0.199520 |
| Bloom off / AO on | 0.147808 | 0.021888 |
| Bloom on / AO on | 0.170272 | 0.101568 |

These are short, sequential measurements including warm-up variability, not a
controlled performance benchmark. Bloom-only p95 rose in this run; no universal
speedup or game-FPS claim is justified. The deterministic improvement is removing
three unnecessary AO-only passes. Each bucket measures the entire draw, not an
isolated AO or Bloom kernel. All samples were below the tool's hotspot threshold
for the supplied 16.67 ms budget in this fixture only.

## Reproduction and limits

Set `PLAYWRIGHT_MODULE` to an installed Playwright module path if necessary:

```powershell
node scripts/verify-shaders-browser.mjs docs/evidence/shader-review-2026-09-09/after
node scripts/verify-shaders-tooling.mjs D:/Projects/Unone-shader/plugin.mjs docs/evidence/shader-review-2026-09-09
```

Browser verification requires installed Edge, GPU support and Playwright. The
tooling script compares the retained baseline and the requested after capture.
Do not treat unavailable GPU timing as zero time.

Remaining risks: only one Windows GPU/backend was exercised; mobile, Safari,
other vendors and driver versions are unverified. SSAO remains a screen-space,
pixel-radius approximation without temporal filtering; transparent surfaces do
not provide complete depth and silhouettes can still exhibit artifacts. The
guarded projection assumes conventional WebGL depth (not reversed/logarithmic
depth). This fixture does not validate every Three.js material permutation or
Effekseer shader. Source fixes have not been copied into existing game exports.
