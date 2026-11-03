# Translation-only text raster reuse — source review proposal

Read-only design, 2026-11-03. No implementation or execution is authorized by this note. The observed +1152 rasters/uploads does not identify translation as its cause; the largest four UI spans remain internally unsplit.

Current `canvas-ui.mjs` builds full-node JSON keys for composition change detection. `ui-gpu.js` includes that absolute placement key in raster content even though the painter is translated by `-x0,-y0`. Keep composition/routing keys unchanged. Decouple only the per-slot raster-content equality.

Minimal conservative paint key:

`[identity, kind, text, placeholder, text_edit, style, align, fontSize, lineHeight, x-x0, y-y0, width, height, croppedWidth, croppedHeight, viewportHeight, scale]`

`identity` retains font-family/fallback-color identity. Keep all style fields initially, including padding, wrap/ellipsis, font family/weight/size, line height, letter spacing, color, and text shadow/rounded clip. Future painter fields must update this shared paint-input contract. Existing explicit font invalidation remains necessary if a host changes font resources under the same family.

The painters use supplied bounds, never authored `node.rect` or `node.clip`. An exact integer translation can reuse pixels only if local offsets and cropped dimensions remain identical. The quad origin and GPU clip still move. Fractional phase or changed crop must invalidate. Do not round offsets or suppress layout changes to force a hit. No cross-node/global raster cache, new retention budget, or new slot lifetime is required.

Required true RED and safety cases:

1. Actual presenter, same id/text/style, exact one-device-pixel translation with co-moving crop: old source increments raster/upload; proposed key preserves counts while mesh placement changes. Cover atlas and dedicated fallback.
2. Fractional translation, independently moving clip/crop edge, changed width/height and word-wrap/ellipsis must reraster.
3. Padding, font family/weight/size, line height, spacing, color, shadow offset/color and rounded shadow clip changes must invalidate.
4. Text-input text/placeholder/focus/selection/caret/composing changes must invalidate; unchanged editing state may translate.
5. Viewport-height, DPR/scale and fallback family/color changes invalidate even when another dimension happens to match.
6. Duplicate node-id suffix/order behavior remains correct; different content must never share a stale per-id slot.
7. Clear/context loss forces fresh upload, and disappearing/reappearing nodes preserve the existing slot/compaction policy.
8. Official pixel comparison later covers translated glyphs, shadow and clipping. Fake Canvas calls/counters only establish invalidation logic, not browser raster or visual parity.

Source anchors at review: `canvas-ui.mjs:236–259,308`; `ui-gpu.js:101–117,191–198`; `ui-style.mjs:101–139`; `ui-presentation.mjs:12–16`.
