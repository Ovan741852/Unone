# UI text atlas

The official WebGL UI renderer packs rasterized text blocks into GPU atlas pages.
Projects can optionally request a page size in the root of `player.presentation.json`:

```json
{
  "ui_text_atlas_size": 2048
}
```

The value must be one of `256`, `512`, `1024`, `2048`, or `4096`. Omission
retains the existing 4096 request. The effective page is capped by the GPU's
maximum texture size. This is an official Web-only setting; the export rejects
it for native and custom renderers. Explicit `null` is invalid. Re-export and
relaunch to change the setting. It does not change font size or UI scale.

Pages use RGBA without mipmaps. A 4096 page estimates 64 MiB and a 2048 page
estimates 16 MiB, but up to four pages can remain allocated. A text block that
does not fit or cannot be packed gets a dedicated texture. Multiple dedicated
textures can coexist, so smaller pages do not guarantee lower total use.
Text larger than the device's maximum texture size remains subject to the
renderer/device limit. The canvas and GPU implementation can retain additional
copies and use padding; these figures are not process or driver measurements.

The player performance report exposes `ui.gpu.atlas_page_size_requested`,
`atlas_page_size`, `atlas_pages`, `atlas_reserved_bytes_estimate`,
`dedicated_text_textures`, `dedicated_text_bytes_estimate`, and
`atlas_compactions`. The byte estimates describe RGBA allocation sizes rather
than physical GPU residency. For a comparison, record atlas plus dedicated
bytes and actual process/GPU use across representative scenes and 4K/high-DPI
screens; also inspect oversized text visually. Pages are retired on context
loss and rebuilt for the restored device. The existing CPU text scratch canvas
can retain its previous high-water dimensions, independently of GPU pages.
