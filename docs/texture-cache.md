# Official Web sprite texture cache

This reusable renderer policy controls registered world asset-texture GPU
owners, including legacy texture records, the sprite resource pool and the
official catalog-image UI presenter. They share one controller and one
byte/count policy. It contains no map, chunk, character or game-specific
behavior. The decoded-image broker, data textures and render targets have
separate ownership scopes; UI and sprite sampling of the same source image
can use distinct GPU owners.

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
uses the bounded defaults shown above: 64 MiB, 128 entries and 1800 renderer
frames. The policy is official Web only;
custom renderers and native wgpu reject it instead of silently ignoring it.

For selected asset IDs, optionally override *only* the idle GPU grace period:

```json
"texture_cache": {
  "max_bytes": 67108864, "max_entries": 128, "idle_frames": 1800,
  "idle_overrides": [
    {"asset_ids": ["texture://demo/tile-1", "texture://demo/tile-2"], "idle_frames": 300},
    {"asset_prefix": "texture://demo/transient/", "idle_frames": 600}
  ]
}
```

Each rule has `idle_frames` in 1..36000 and exactly one selector. `asset_ids`
is a nonempty list of exact catalog IDs; up to 1024 IDs total are allowed,
with no duplicates even across rules. `asset_prefix` is a literal namespace
prefix ending in `/` (not a glob or regex); duplicate prefixes are rejected.
IDs and prefixes are at most 2048 UTF-8 bytes, contain `://`, and may not
contain control characters. At most 64 rules are allowed. An exact ID wins
over prefixes; among matching prefixes the longest wins, independent of order.
An owner without a matching asset ID uses the global TTL. Omission and an empty
array preserve global behavior. The rules are fixed for the renderer lifetime.

This selects GPU owners by their actual asset identity, not image-group names,
URLs, scene names or object keys. A group's unload only releases its own broker
lease; it does not force a GPU eviction. A matching idle UI owner may retire
while an independent active sprite owner of the same image stays pinned.
Active, prepared and persistent owners remain protected; byte/count pressure
still chooses global LRU victims. The shorter TTL may increase GPU uploads or
network work after a revisit, so measure both. Renderer/catalog IDs may be
dynamic: the configuration is syntactically validated but a nonexistent ID
does not fail startup; `override_owner_entries` and `override_idle_expired`
show whether matching GPU owners actually appeared and expired. A zero count
before those images are displayed is expected.

Each draw protects current sprite references. Active entity leases and explicit
prepared-resource leases pin their textures. Several material/program variants
of the same catalog asset and sampling configuration share one physical texture
owner in the current epoch; that owner is counted once, rather than once per
material. A texture requested by mesh, heightfield or projected geometry remains
conservatively protected until the owning renderer clears its shared caches.

An ordinary sprite's ready resource may retain an explicit idle cache owner
after it becomes hidden or leaves the current set. Its last ordinary-sprite use
starts the idle grace period. Managed preparation or managed entity activity
does not create or refresh that permission. A resource used only by managed
leases retires immediately when its final owner releases it. Pending or failed
preparations are not promoted into ready idle entries.

Idle GPU owners are reclaimed oldest first under the shared byte/count pressure,
or when their idle TTL expires even without pressure. Idle material/program
entries also have a separate count bound of `min(max_entries, 4096)` and an idle
TTL; sharing one atlas does not permit unbounded cached shader variants. This is
a metadata/program bound, not a second texture allocation budget.

Retirement disposes the GPU allocation and releases its decoded-image lease.
The broker may still retain that decoded image under its own policy. Pending
loads carry generation and record identity checks: a completed load for an
evicted, reset or disposed record cannot resurrect its old GPU owner. A real
cold preparation remains pending; the cache does not manufacture readiness or
replace the previous complete appearance with a partial texture/UV/uniform tuple.
Visible textures are never evicted to satisfy a budget. If the active set alone
exceeds the limits, metrics report pressure; the renderer does not introduce
missing sprites or claim the limits are a hard memory cap.

The sprite pool also retains its existing hard admission check for active,
incoming and reserved unique textures. The official player currently takes
those byte/count limits from the image preload plan's budget, independently of
the idle `texture_cache` policy. Before rejecting admission, the pool can reclaim
its eligible idle owners through the same controller. It cannot evict live
owners, bypass admission, or raise the authored limits. This is not another idle
texture cache; the CPU decoded-image broker's residency accounting is separate.

Context loss retires idle cache owners and invalidates GPU readiness. Active
owners retain the CPU image leases needed for restoration into the new epoch.
Reset and disposal retire all registered owners once and fence late completions.

`renderer.metrics().texture_cache` reports entries, loading, releases, estimated
decoded texture byte estimates, protected bytes, the effective default/authored
policy, and unresolved budget pressure. Estimates count RGBA pixels and mipmaps
for the registered GPU owners, excluding driver overhead, encoded files, browser
decode copies, data textures, render targets and non-texture resources. A
field named `decoded_texture_bytes_estimate` here describes this texture
estimate; the image broker's decoded-image residency is a separate report.
Neither is a process RSS or total GPU memory measurement.

`override_owner_entries` / `override_owner_bytes_estimate` describe currently
tracked owners matched by an override; `override_owner_evicted` and
`override_owner_released_bytes_estimate` count matching owners evicted for any
cache reason, including pressure, while `override_idle_expired` counts only
matching owners retired by an idle deadline. These are renderer estimates, not
proof of immediate browser decoded-image or OS memory reclamation.

Games should still share atlases and retire unused entities. This policy is a
resource lifetime primitive, not a world streaming or navigation service.
