# Packed instances: WASM memory presentation contract

The exported Web player opts into `wasm-memory-v1` when the runtime exports `unone_web_set_instance_transport`. Older runtimes and other hosts continue using JSON. This is a presentation transport; Lua's `api.instances3d.set` and authoritative snapshots retain their existing meaning.

## ABI and ownership

`unone_web_set_instance_transport(0)` selects JSON; `1` selects WASM memory. It republishes the current world without ticking and rejects other modes. A successful project load resets the mode to JSON, then the player opts in again. In memory mode the envelope identifies `instance_transport: "wasm-memory-v1"`, and each batch replaces `data` with:

```json
{"asset":"mesh://unit","count":1,"format":"f32le-p3-q4-s3-v1",
 "memory":{"offset":65536,"byte_length":40,"revision":"123"}}
```

The pointer above is illustrative, never a fixed address. The 40-byte record remains position 3 × f32, quaternion 4 × f32, scale 3 × f32, little-endian. The host validates count, format, bounds and length before creating a `DataView` over the current WASM memory buffer. The provider is explicit; renderer code does not reach into a global module.

Rust retains each immutable packed allocation until the next successful **world publication** replaces the presentation descriptors. Consumers must use the newest snapshot after an ABI operation publishes a world. Profile/tool-registry responses do not release those allocations. Memory growth can replace/detach the JS ArrayBuffer, so the renderer obtains the current `HEAPU8.buffer` whenever it reads data. It retains GPU matrices, not stale DataViews. This v1 ABI assumes a single-threaded, unshared engine memory; a concurrently mutated shared-memory protocol is not implied.

`revision` is an opaque decimal string outside canonical replay state. Replacing a batch creates a new revision even if an allocator reuses the same address. Unchanged revisions skip matrix regeneration and GPU upload. Removing batches releases the renderer mesh. This is whole-batch invalidation, not subrange dirty tracking.

## What is and is not eliminated

The rendering response omits Base64 instance payloads. JS no longer decodes Base64 or copies it into an intermediate byte array. Rust keeps a contiguous validated allocation and JS reads it directly. Transform-to-matrix conversion and CPU-to-GPU upload still occur when a batch changes.

Full snapshots and their canonical digests keep the original Base64 representation for compatibility. The engine still encodes that representation and currently retains both encoded and packed forms. Memory mode also constructs a lightweight presentation world from the canonical snapshot. This is not zero-copy end-to-end, nor the final binary-only engine storage design. Further work should be driven by measurements of canonical serialization, validation, packing and upload separately.

## AI verification

The development API can switch paths at a paused frame:

```json
{"method":"instances.transport","mode":"json"}
{"method":"screenshot"}
{"method":"instances.transport","mode":"memory"}
{"method":"screenshot"}
```

The frame/digest and rendered pixels should remain identical for static content. Use `scripts/profile-player.mjs --transport json|memory` to compare CPU publication/readback on the same artifact; its default `auto` chooses memory when supported. Digest parity alone does not prove that GPU rendering consumed the right bytes: native ABI lifetime tests, JS view/growth/revision tests and actual artifact byte checks complement it. Native renderers already own Rust state and do not consume these JS memory descriptors.
