# 0052: One bounded world-texture cache authority

Status: implemented; source, Node and bounded official WebGL main/worker GPU
ownership acceptance passed. Game FPS acceptance remains separate.

Ordinary sprites began using the prepared sprite pool, while `texture_cache`
still controlled only the older texture-record map. Hiding an ordinary sprite
therefore destroyed its GPU texture/program despite the configured idle grace.
A decoded-image hit still entered asynchronous GPU preparation on reappearance,
manufacturing a pending draw and repeated uploads.

Extend the existing controller with private physical-owner adapters. Legacy
records and pool textures share its byte/count policy and intrusive idle LRU.
One texture shared by several material entries is counted once. Active,
prepared and persistent owners remain pinned. Omitted policy now selects bounded
defaults: 64 MiB, 128 physical owners, 1800 renderer frames.

The pool may retain an explicit cache-owner token only for a ready resource
previously used by ordinary sprites. Its last ordinary use governs expiration;
managed use neither creates nor refreshes that permission. Idle material entries
have a separate count bound of `min(policy.max_entries,4096)`. Managed-only last
release still retires immediately. Pending/error resources are not cached.

The pool's existing hard preparation/live-resource admission remains separate
from this idle policy and decoded-image ownership. It reclaims eligible idle
owners through the same controller before rejecting an incoming request. This
does not create another idle texture budget or a process/GPU-memory guarantee.

Retirement fences new acquisition during disposal callbacks; cancellation,
context loss, reset and teardown retire the matching generation exactly once.
Normal pressure/expiry sweeping is linear, with exact recounts when callbacks
change registry membership or touch accounting. Public Core APIs still expose
metadata/opaque handles; this change exposes no GPU object or writable buffer.

Returning ordinary sprites to the older renderer path was rejected because it
would lose the prepared shader and prior-complete appearance guarantees.
Independent idle caches were rejected because each could consume the full
declared budget. Unlimited retention and ignoring genuine pending draws were
also rejected. This is renderer resource ownership, not game streaming rules.

The reproduction, source reviews, actual official WebGL 100-cycle results and
execution limits are recorded in
[the review](../reviews/2026-11-03-unified-sprite-cache.md). This bounded resource
acceptance is separate from the Game's FPS, GC and process-memory acceptance.
