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

The default inspector checks the PNG signature and IHDR dimensions before reserving decoded RGBA bytes. It requests the first 24 bytes. If the server ignores Range and sends a full successful response, inspection drains that stream to EOF while retaining only the 24-byte header, then releases the reader lock. It does not accumulate the encoded body or decode an unadmitted image. Only an actual abort or failed read cancels the reader; errors remain observable. Unknown/non-PNG bounded dimensions, excess entries and excess bytes produce explicit partial preparation and preserve normal lazy acquisition. They do not invalidate a valid Core scene. The scene-entry limit also bounds the number of inspected candidates; later dependencies are reported as skipped. Admission follows declaration order, independent of request completion order.

The default loader retains the HTML image path already used by Canvas and Three. It waits for `Image.decode()` when available, clears event handlers after completion, and cancels/clears the source on abort. This avoids changing ImageBitmap color conversion or alpha premultiplication. Decoded dimensions must match a prepared reservation. Failed speculative loads are reported, released and removed; later required use can retry normally instead of inheriting a permanently rejected speculative entry.

The returned immutable result contains `declared_entries`, `admitted_entries`, `ready_entries`, `reserved_bytes`, `partial`, `unsupported`, `budget_skipped`, `errors` and `cancelled`. A partial result is not evidence that every future image is ready. A new preparation replaces the previous scene plan; overlapping dependencies keep their existing leases. A superseded preparation cannot publish or release its successor's ownership.

## Ownership and budgets

Scene admission defaults to 64 MiB and 128 images. Admitted scene leases remain until the next scene preparation or broker disposal, including while their sprites are hidden. A draw-count idle timeout must not discard these declared future dependencies.

Current consumers hold separate active leases. World texture records keep their image lease until texture eviction or final disposal, because a restored GPU context still needs those CPU pixels. Canvas and cursor consumers release their leases when retired. GPU UI textures must retire before releasing their last relevant decoded-image lease. GPU context loss retires GPU bindings while preserving the decoded pixels and active scene plan.

When a Canvas composition changes, it acquires every incoming image lease before retiring GPU resources and releasing any outgoing image lease. Cleanup runs even if a diagnostic or render-request callback throws. If a callback replaces the composition synchronously, acquisition stops for the obsolete composition and cleanup preserves the latest required set; disposal also stops the draw. An image-cursor change follows the same rule: acquire the incoming image under the validated new cursor specification, then retire outgoing ownership, including when an acquisition-error handler throws. Disposed cursor hosts reject further updates with the existing skipped-diagnostics outcome before validation or acquisition. This protects ready incoming images from an idle-cache sweep triggered by the outgoing releases. Ready hits remain usable synchronously in the same draw. The unused budget is unchanged: a genuinely larger inactive working set can still require later loads, so this handoff rule does not promise zero reloads for every screen transition.

Unowned ready images use a separate aggregate LRU, defaulting to 16 MiB and 128 entries. Unowned pending/error entries are cancelled/removed. Active consumers are pinned and may exceed the nominal limits; their images are never silently closed to satisfy the cache. Only the broker releases pixels after all consumers and the scene plan have released them. Disposal aborts pending work and prevents new acquisition; already leased ready images remain valid until their final release. Late results are not inserted back into a disposed broker.

`report()` distinguishes resident, active, scene and unused decoded estimates, loading work, reuse, retirement and partial preparation. Active and scene sets can overlap and must not be added together. `pressure_bytes` compares total resident pixels with the combined scene-plus-unused nominal capacity; it is informative pressure, not permission to evict an active consumer. It also reports an entry-count pressure threshold.

These budgets and counters estimate `width * height * 4` decoded image payload. They are separate from renderer GPU texture/cache policy, mipmaps, encoded files, browser decode copies and render targets. They do not establish browser live-heap limits, VRAM allocation, absence of leaks, GC cadence or frame-rate acceptance.

## Verification scope

Broker unit tests cover synchronous sharing, hidden-scene dependency collection, two-task concurrency, entry/byte bounds, active ownership, scene replacement, decode/header mismatch, cancellation and late completion, transient speculative failure followed by required retry, shared-image retirement, successful PNG stream draining with bounded header retention, failed-read cleanup and HTML image decode readiness. Consumer integration and the exported official player require their own validation. A passing resource test does not prove a rendered frame or stable FPS.

## Formal image preload plans

The official player owns image decoding, shared decoded-image leases and GPU
texture lifetime. A project may declare image groups for a required startup
working set. This does not create entities, allocate a second renderer or move
game rules into the host.

Create `player.image-assets.json` in the project root:

```json
{
  "version": 1,
  "groups": {
    "map": ["image://terrain"],
    "ui": ["image://inventory"]
  },
  "startup": ["map", "ui"],
  "budget": {"max_bytes": 67108864, "max_entries": 128}
}
```

`version`, `groups` and `startup` are required. `budget` is optional; its fields
default to 64 MiB and 128 entries. Groups are authored presentation choices;
the engine does not infer groups from IDs or add invisible scene objects.
Every referenced ID must be a declared `texture2d` with an accepted image
encoding. Startup groups must exist and be unique. Repeated asset references
share one decoded image. Group names may contain 1–128 UTF-8 bytes; IDs may
contain 1–2048. The plan allows at most 128 groups, 4096 references per group
and 16384 references in total. Raw and canonical JSON are each limited to
1 MiB. Unknown fields fail explicitly.

The selected startup groups are required before the official player's READY
boundary. Unsupported decoding, required budget admission failure or cancellation
fails startup. Automatic scene-sprite preparation remains a separate, potentially
partial convenience. Budgets estimate decoded RGBA image storage; they do not
raise the renderer's GPU texture-cache budget or represent total driver memory.

### Publish after host integration

CLI 10 does not automatically apply this sidecar. Use Node.js 18 or newer and
the additional SDK-indexed publisher after the normal official-player export
and any project host integration/finalization:

```text
node <sdk>/scripts/prepare-web-image-assets.mjs --project <project> --input-export <export> --output <new-export>
```

`--plan <file>` selects another plan. The default is
`<project>/player.image-assets.json`. The output directory must not exist and
must have an existing parent. Do not finalize or mutate the published files
after this step; publish the complete new generation before exposing its root
`index.html`. Validate the resulting official player on the requested target.

The helper verifies the complete input file inventory and all SHA-256 hashes,
the selected generation's alias pairs, official renderer selection, matching
project config/script/assets, and the host's image-plan capability. The host's
asset module must match the publisher's trusted SDK template, and the entry
must implement the versioned plan loader. The helper never imports code from
the input export. Installed SDK use verifies the tool and validator against
`sdk.json`; repository development uses the sibling engine template.

The canonical plan is added as `content/image-assets.json` with exactly one
`unone-image-assets` HTML meta reference. The helper preserves the CLI's flat
root `index.html` layout and inserts its new release base. It does not invent
an inner release index. All other logical file bytes, including project wheel
adapters, config, scene, runtime and assets, are preserved. The new release
identity uses the engine's exact `seal_web_generation` algorithm: SHA-256 of
the JSON tuple containing the HTML without its base and the UTF-8-byte-sorted
logical `[path, sha256]` inventory. Aliases and selected release copies are
both emitted and indexed. Old generation copies are not carried forward.

Some existing host finalizers refresh indexed file hashes without resealing
the release name. Such an input is accepted only when every indexed byte and
alias pair verifies. `image_assets.input_generation_matches_content` records
that mismatch; the new output is always resealed from its actual contents.
Paths must be portable relative paths and source/output ancestry must contain
no symlinks, junctions or Windows reparse points. No input is modified.

Required unique entries and 24-byte PNG IHDR dimensions receive an early
bounded budget check. Required startup images with unknown/non-PNG dimensions
are rejected because the current official bounded preloader supports PNG.
Non-startup groups may still declare other supported image encodings for
ordinary on-demand use. This header check is not a decoder or an image-validity
guarantee; the browser still validates decoding, admission and completion.

Preflight failures create no output. A copy/write failure preserves its
incomplete output for diagnosis; `export.json` is written last and marks a
completed publication. Select another fresh output after a failure. The tool
does not delete or overwrite an existing export.
