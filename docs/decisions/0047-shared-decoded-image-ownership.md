# Decision 0047: Shared decoded images and declared scene preparation

- Date: 2026-10-30
- Status: implemented; official main/worker functional checks passed; timing and resource-cycle followups remain open
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

Canvas and cursor transitions acquire incoming ownership before retiring
outgoing leases. Otherwise the outgoing release can trigger an LRU sweep that
evicts the very image required by the incoming view. The invariant preserves
ready synchronous hits; it does not enlarge the idle budget or promise that a
larger working set fits. GPU UI resources retire before their outgoing pixel
leases. The corresponding real-broker regressions alternate views/cursors one
hundred times and verify bounded loads and exactly one final retirement.

Metrics distinguish the current consumer's image list from broker residency.
An image newly listed as ready in `ui.assets` can be an immediate lease reuse;
it is not evidence of another decode. Use broker loads/reuses, preparation and
resident counters to establish that distinction. CPU decoding also does not
establish that a GPU texture or shader has already been initialized.

The GPU UI prefix also owns an independent broker lease for every texture it
retains. Removing a Canvas-only image must not destroy the prefix's unrelated
geometry, material or textures: an actual idle-window stall coincided with four
geometries, the shared material and nineteen textures being disposed and then
rebuilt. The prefix now sweeps only unused resources, disposing a GPU texture
before releasing its pixel lease. Canvas can omit its legacy full-clear path
only when a broker is available and the presenter explicitly declares ownership.
Borrowed-image presenters retain the conservative fallback.

New image owners are staged during draw construction. On a later allocation
failure, touched resources are detached before newly acquired texture/lease
owners are rolled back; untouched resources remain valid. This is an ownership
and retry guarantee, not a promise of atomic visible pixels after allocation
failure. Functional tests establish retained identities and exact retirement;
same-Game browser measurements remain necessary to establish timing and churn.

The ownership model draws on shared cached resources and explicit reference
lifetimes described by [Godot resources](https://docs.godotengine.org/en/stable/tutorials/scripting/resources.html)
and [Unity Addressables memory management](https://docs.unity3d.com/Packages/com.unity.addressables@2.3/manual/MemoryManagement.html).
Unity also documents rapid unload/reload churn. Unone's catalog-generation
boundary, decoded-image leases and separate GPU ownership are its application
of those principles, not claims that the engines expose identical APIs.
