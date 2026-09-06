# Decision 0016: Bundle Generation and Browser Storage Are Managed by the Host

- Date: 2026-09-05
- Status: accepted

## Context

The same game content must work on native, Web, iOS, and Android, but fetching, retries, permissions, storage quotas, background downloads, and file APIs differ by platform. Putting these policies into `unone-engine` would turn the engine into a downloader and contaminate headless replay with platform state.

## Decision

Split the responsibility into two layers:

- The engine provides `BundleVerifier`, which standardizes size/SHA-256 rules through `begin → update(chunk)* → finish`; the native `BundleManager` remains responsible for dependency resolution, `.part` staging, cache commit, and atomic generation rename.
- The Web host's `bundle-store.js` handles fetching, dependency order, the IndexedDB content-addressed cache, cache-hit re-verification, and the generation transaction. Only after all content is verified does it write bundle records, the generation record, and the `activeGeneration` pointer together; any fetch, verification, or transaction failure leaves the previous active pointer unchanged.

The content hot-update order is fixed:

```text
fetch / cache lookup
        ↓
bounded Rust verification
        ↓
host staging + dependency resolution
        ↓
one storage transaction activates generation
        ↓
engine safe-point source/content apply
```

`reload_source` is script hot reload and preserves Rust-owned world state; generation activation is a content-version switch. They must not be conflated into “replace any file immediately.” The sample validates this distinction with v1/v2 script bundles: v2 downloads only the changed script, then calls source reload on the same runtime after activation.

## Consequences

- Browser storage does not enter the engine core; mobile can connect its own filesystem/key-value adapter using the same manifest/hash/generation semantics.
- The cache key is the content hash, not a URL or version string; changing the URL without changing the bytes does not download the content again.
- The active pointer is the rollback boundary; do not delete the old generation immediately, and reclaim it only after ref-count/reference tracking and quota policy are mature.
- The smoke host currently collects a verified response in a `Blob` and then writes it to IndexedDB. This is a testable minimal implementation, not final streaming storage for large assets. Production needs OPFS, a chunk store, or a platform-native streaming writer to avoid a single bundle simultaneously consuming peak memory for the response, verification, and storage.
- Do not build P2P, delta patches, remote script execution, native plugin hot-plugging, CDN routing, or download scheduling; these belong to the host/operations layer and need a separate decision only if multiple validation games prove them necessary.
