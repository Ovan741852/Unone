# Shared decoded images in the official Web player

The official player owns decoded image pixels. Ordinary world sprites, Canvas UI, GPU UI batches and an image cursor can borrow the same ready image while retaining their own GPU textures, sampler state, crop, opacity and painter order. This is a presentation resource primitive; it does not select game content or change simulation, scene visibility or input rules.

`createImageAssetBroker` lives in the existing `web/shared/asset-encoding.js` template. It requires a catalog returned by `createAssetCatalog`. A caller-supplied ID, object identity or revision is not an immutable-resource grant. The broker belongs to one catalog generation; changing a manifest creates a new catalog and broker.

## Interface

```js
const images = createImageAssetBroker(catalog, {
  resolveAssetUrl: asset => new URL(asset.source, contentBase),
  sceneMaxBytes: 64 * 1024 * 1024,
  sceneMaxEntries: 128,
  unusedMaxBytes: 16 * 1024 * 1024,
  unusedMaxEntries: 128,
});

const preparation = await images.prepareScene(project.scene);
const lease = images.acquire(assetId);
if (lease.state === 'ready') useImage(lease.image); // synchronous, including first use after prewarm
else await lease.promise;
// The consumer must still check its generation and lease.state after an await.
lease.release(); // idempotent; the consumer must never close the borrowed image
```

`acquire(id)` accepts a declared `texture2d` asset with a supported image encoding. Missing assets, invalid kinds/encodings and acquisition after broker disposal throw. A lease has synchronous `state` (`loading`, `ready` or `error`), `image` and `error` getters, a `promise` resolving to the shared image, and `release()`. A ready acquisition does not enter a loading state merely to resolve another Promise. The shared promise may settle after an individual lease has been released; consumers must check their own generation and lease state before adopting its result. A released lease exposes no image and reports `IMAGE_ASSET_LEASE_RELEASED`.

Tests or a different presentation host may supply `loadImage(url,{signal,asset})` and `inspectImage(url,{signal,asset})`. The loader transfers decoded-image ownership to the broker and should honor cancellation. The inspector returns `{format:'png',width,height}` or `null` when bounded preparation is unavailable. The broker keeps at most two preflight/decode tasks running. A noncooperative injected operation may finish late; its pixels are fenced and released instead of being published into a newer generation.

## Declared scene preparation

`prepareScene(scene)` collects unique `sprite.asset` dependencies from the scene's entity array or entity record, including hidden sprites. It does not scan or decode every image in the asset manifest. These are authored future dependencies, rather than an asset-name, folder or image-size heuristic.

The default inspector checks the PNG signature and IHDR dimensions before reserving decoded RGBA bytes. It requests the first 24 bytes and cancels the response body after that header even if the server ignores the Range request. It does not retain or decode an unadmitted image. Unknown/non-PNG bounded dimensions, excess entries and excess bytes produce explicit partial preparation and preserve normal lazy acquisition. They do not invalidate a valid Core scene. The scene-entry limit also bounds the number of inspected candidates; later dependencies are reported as skipped. Admission follows declaration order, independent of request completion order.

The default loader retains the HTML image path already used by Canvas and Three. It waits for `Image.decode()` when available, clears event handlers after completion, and cancels/clears the source on abort. This avoids changing ImageBitmap color conversion or alpha premultiplication. Decoded dimensions must match a prepared reservation. Failed speculative loads are reported, released and removed; later required use can retry normally instead of inheriting a permanently rejected speculative entry.

The returned immutable result contains `declared_entries`, `admitted_entries`, `ready_entries`, `reserved_bytes`, `partial`, `unsupported`, `budget_skipped`, `errors` and `cancelled`. A partial result is not evidence that every future image is ready. A new preparation replaces the previous scene plan; overlapping dependencies keep their existing leases. A superseded preparation cannot publish or release its successor's ownership.

## Ownership and budgets

Scene admission defaults to 64 MiB and 128 images. Admitted scene leases remain until the next scene preparation or broker disposal, including while their sprites are hidden. A draw-count idle timeout must not discard these declared future dependencies.

Current consumers hold separate active leases. World texture records keep their image lease until texture eviction or final disposal, because a restored GPU context still needs those CPU pixels. Canvas and cursor consumers release their leases when retired. GPU UI textures must retire before releasing their last relevant decoded-image lease. GPU context loss retires GPU bindings while preserving the decoded pixels and active scene plan.

Unowned ready images use a separate aggregate LRU, defaulting to 16 MiB and 128 entries. Unowned pending/error entries are cancelled/removed. Active consumers are pinned and may exceed the nominal limits; their images are never silently closed to satisfy the cache. Only the broker releases pixels after all consumers and the scene plan have released them. Disposal aborts pending work and prevents new acquisition; already leased ready images remain valid until their final release. Late results are not inserted back into a disposed broker.

`report()` distinguishes resident, active, scene and unused decoded estimates, loading work, reuse, retirement and partial preparation. Active and scene sets can overlap and must not be added together. `pressure_bytes` compares total resident pixels with the combined scene-plus-unused nominal capacity; it is informative pressure, not permission to evict an active consumer. It also reports an entry-count pressure threshold.

These budgets and counters estimate `width * height * 4` decoded image payload. They are separate from renderer GPU texture/cache policy, mipmaps, encoded files, browser decode copies and render targets. They do not establish browser live-heap limits, VRAM allocation, absence of leaks, GC cadence or frame-rate acceptance.

## Verification scope

Broker unit tests cover synchronous sharing, hidden-scene dependency collection, two-task concurrency, entry/byte bounds, active ownership, scene replacement, decode/header mismatch, cancellation and late completion, transient speculative failure followed by required retry, shared-image retirement, PNG header cancellation and HTML image decode readiness. Consumer integration and the exported official player require their own validation. A passing resource test does not prove a rendered frame or stable FPS.
