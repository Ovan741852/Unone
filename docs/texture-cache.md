# Official Web sprite texture cache

This reusable renderer policy controls idle GPU textures used by ordinary 2D
sprites. It contains no map, chunk, character or game-specific behavior. UI
Canvas images already close/delete resources no longer referenced by their UI
tree; they are a separate cache.

Declare an optional policy in `player.presentation.json`:

```json
"texture_cache": {
  "max_bytes": 67108864,
  "max_entries": 128,
  "idle_frames": 1800
}
```

All three fields are required positive integers. `max_bytes` is at most 1 GiB,
`max_entries` at most 65,536, and `idle_frames` at most 36,000 rendered frames.
Unknown fields, null, fractions and invalid ranges fail explicitly. Omission
preserves the previous keep-warm behavior. The policy is official Web only;
custom renderers and native wgpu reject it instead of silently ignoring it.

Each draw protects current sprite references. Idle records are evicted oldest
first under byte/count pressure, or after the idle grace period even without
pressure. A texture also requested by mesh, heightfield or projected geometry
is conservatively protected until the owning renderer clears its shared caches.
This initial policy does not claim to evict those 3D dependencies.

Disposal releases the Three texture allocation and removes its cache record.
Pending loads carry record identity checks: a completed load for an evicted or
cleared record disposes its result rather than resurrecting an old resource.
Visible textures are never evicted to satisfy a budget. If the active set alone
exceeds the limits, metrics report pressure; the renderer does not introduce
missing sprites or claim the limits are a hard memory cap.

`renderer.metrics().texture_cache` reports entries, loading, releases, estimated
decoded bytes, protected bytes, and unresolved budget pressure. Estimates count
RGBA pixels and mipmaps, excluding driver overhead, encoded files, browser
decode copies, render targets and non-texture resources. These are not a process
RSS or total GPU memory measurement.

Games should still share atlases and retire unused entities. This policy is a
resource lifetime primitive, not a world streaming or navigation service.
