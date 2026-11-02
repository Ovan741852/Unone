# Prepared sprite resources and atomic appearance

`api.sprite` separates resource preparation from publishing an entity's appearance.
The project owns animation, pooling, prefetch choices and cache policy. The engine
owns decoded images, textures, shader preparation, reference lifetimes and host
feedback. No GPU object or writable image buffer is exposed to Luau.

Use the generated `SpriteApi`, `SpriteResource` and `SpriteAppearance` types in
[engine.d.luau](engine.d.luau). A resource is an opaque runtime userdata; a table
containing its diagnostic `id` is not a resource. Resources cannot be saved.

```luau
local resource = api.sprite.prepare("texture://hero", "hero-tint")
-- Retain the resource; preparation is asynchronous.
if api.sprite.status(resource).state == "ready" then
    local revision = api.sprite.commit(entity, resource, {
        transform = {position = {x = 0, y = 0}, rotation = 0, scale = {x = 1, y = 1}},
        size = {x = 2, y = 2},
        sheet = {columns = 4, rows = 2},
        frame = 3,
        uniforms = {tint = {1, 0.5, 0.25, 1}},
    })
end
```

`prepare(assetId, materialId?)` captures the declared image and optional shader
material definition. `status` returns `state`, `epoch`, `bytes` and optional
`error`. States are `loading`, `ready`, `error` and `released`. Readiness means
the selected host prepared its image/texture and shader program for its current
epoch. Native currently rejects custom sprite shaders with
`SHADER_BACKEND_UNSUPPORTED`; it must not report a fallback as ready.

`commit` returns nil while the resource is not ready. A successful call validates
the entire appearance before changing the World, publishes texture, UV/frame,
instance uniforms and initial placement together, and returns a revision. An
unchanged appearance keeps its revision. Missing `materialId` selects the ordinary
sprite material. Per-instance uniforms do not change the declared material's
defaults or another instance's mutable uniform storage.

An accepted revision is not a pixel receipt. `getCommit(entity)` returns
`requestedRevision`, optional `submittedRevision`, `state`, `epoch` and optional
`error`. States are `none`, `pending`, `submitted` and `error`. The official
renderer reports submission after a completed frame; this does not certify OS
scanout. A context loss changes the resource epoch and invalidates old readiness
and submission. Wait for readiness and the first submitted revision after a new
resource or recovery. Ordinary ready-page animation need not wait one extra host
round trip for every frame.

The renderer retains the preceding complete appearance while a replacement is
pending. It never mixes a new texture with old UVs or old instance uniforms.
Live transform/physics movement after a commit retains the resource and revision.
Legacy sprite/frame/material replacement, despawn and `setSpriteVisible(false)`
invalidate the managed appearance, so a late preparation cannot resurrect it.
An explicit hidden appearance can acknowledge absence after a successful frame;
a globally suppressed visible sprite cannot claim submission.

`release(resource)` is idempotent and relinquishes that handle's caller lease.
Entities that committed it retain their own ownership until hidden or replaced.
Several entities may share one handle. Several Luau aliases of that same handle
share one caller lease; call `prepare` separately for independent caller release.
The Web host shares physical image/texture storage across material preparations
for the same catalog asset and sampling settings. Program readiness remains
specific to its shader and render-target variants.

Host resource plans and scalar receipts travel outside the canonical World.
`presentation_resources` is recorded input, containing resource and appearance
receipts. Manual/replay input stays authoritative. Failed ticks retain admitted
feedback and roll back the appearance transaction. GPU/image objects never cross
the worker boundary. Reload/session/context epochs fence late completions.

Generic safety limits are 4096 live resource handles/owners, at most 256 resource
and 256 appearance receipts per input batch, exact positive safe-integer epochs
and revisions, and at most 1 GiB reported bytes per resource. Actual Web texture
admission uses the authored image budget (default 64 MiB / 128 unique textures),
including both outgoing and incoming owners. A larger hard limit is not a memory
budget. Other renderer allocations, render targets, browser copies and broker
unused-image caches have separately reported scopes.

See [immutable byte views](decisions/0049-bounded-immutable-byte-views.md) for
binary buffer ownership. Sprite resources do not expose a writable buffer alias.

