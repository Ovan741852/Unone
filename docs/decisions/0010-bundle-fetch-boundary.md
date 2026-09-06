# Decision 0010: The Host Provides Bundle Sources; Validation and Activation Stay in the Engine

- Date: 2026-09-05
- Status: accepted

## Context

Bundles must support native, Web, iOS, and Android at the same time. If the engine directly depends on HTTP, a CDN, browser cache, or mobile storage, platform policy and operational services would leak into the engine core, and headless tests would become difficult to replay.

## Decision

`BundleManager::install_with_fetcher` accepts a host-provided `BundleFetcher`. The host decides how to obtain the `Read` source; the engine is responsible only for:

- dependency resolution and cycle diagnostics
- 64 KiB streaming size/SHA-256 verification
- `.part` staging, flush/sync, and cache commit
- generation activation and retaining the previous active generation on failure
- reporting source, cache, and available status through `inspect`

The native CLI's local-file fetcher is an adapter; Web/mobile may fetch, decrypt, or persist content outside the engine and then provide a reader. The first version does not build an HTTP client, CDN, P2P, delta updates, or download scheduling into the engine.

## Consequences

The same integrity and rollback rules can be reused across hosts, including tests for “the remote source is missing but the cache is usable” and “corrupt new content does not switch generations.” Hosts still handle network retries, permissions, background downloads, and storage quotas themselves. If a non-file cache is needed later, replace the host/storage adapter without changing the game-side Luau API.
