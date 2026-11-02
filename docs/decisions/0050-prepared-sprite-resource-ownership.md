# 0050: Prepared sprite resources and atomic appearance

Status: accepted

Games need to prepare an image/material independently of an entity, share it
across instances, and replace texture, UVs and uniforms without a partially
prepared frame. A synchronous World setter cannot promise asynchronous GPU
readiness. Keeping GPU objects in the World would also break replay portability
and worker ownership.

Use an opaque `api.sprite.prepare` lease and an atomic `commit` appearance.
Resource readiness and actual frame submission are separate, epoch-scoped
receipts. Caller and entity ownership are independent. The private registry is
transactional and publishes scalar plans; recorded host input carries receipts.
Neither GPU objects nor writable buffers escape into Luau or worker messages.

The host separates image/texture identity from material/program identity, so a
different shader does not duplicate an identical image upload. Budgets charge
physical texture reservations once and include outgoing plus incoming resources.
Instance uniform storage remains independent even when programs are shared.

Game-specific pool sizes, prefetch windows, atlas catalogs, animation timing and
eviction choices remain Luau policy. Native capabilities fail explicitly when a
custom sprite shader cannot be prepared. Production WASM execution, host unit
tests and official player GPU checks have separate evidence and acceptance
scopes; none by itself establishes universal 60 FPS or absence of all leaks.

The full API and lifetime contract is [sprite-resources.md](../sprite-resources.md).
