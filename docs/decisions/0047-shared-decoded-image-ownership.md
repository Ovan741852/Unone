# Decision 0047: Shared decoded images and declared scene preparation

- Date: 2026-10-30
- Status: implemented; source tests passed, packaged-player acceptance pending
- Scope: official Web presentation; existing Core/WASM ABI unchanged

The long-running official-player test found two skipped draws when a previously
hidden scene sprite first appeared in UI. Its image was already an authored
scene dependency, but the independent UI loader began decoding only on first
visible use. A successful simulation tick did not imply a completed draw.

This is reusable presentation resource ownership. Game code continues to own
content, visibility, NPC behavior and decisions about which scene to load. The
engine does not encode an asset ID or alter simulation, input, frame clocks,
completion metrics or acceptance thresholds.

Use one decoded-image broker for each immutable asset catalog. World textures,
Canvas UI and cursor images acquire independent leases over shared decoded
pixels. Ready acquisition is synchronous. Consumers retain their own GPU
textures, samplers and painter behavior; GPU context restoration can reuse the
leased CPU image. Only the broker releases pixels after the last owner retires.

Prepare unique declared scene sprite dependencies, including hidden sprites,
before the startup READY barrier. Scene leases persist until scene replacement.
Bound preparation by decoded-byte estimates and entries, and bound unowned
ready images with a separate LRU. Current owners remain pinned with explicit
pressure reporting. Unknown dimensions or excess dependencies produce partial
preparation and preserve honest lazy-loading outcomes.

Do not preload every manifest image or identify future assets by filenames.
The observed scene declares 38 images, about 48.54 MiB of RGBA payload, while its
manifest contains about 398 MiB of PNG payload. A declared plan gives ownership
and a useful bound without guessing gameplay. The existing HTML image/decode
path preserves color and alpha behavior; introducing ImageBitmap would require
separate pixel and lifecycle evidence.

See the [image ownership contract](../web-image-assets.md) for budgets,
cancellation, unsupported prewarm metadata, metrics and validation limits.
Host packaging may reuse the verified SDK10 production WASM. This does not
establish delivery of the separately implemented, locally build-blocked fused
Luau-copy runtime.
