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

Tests or a different presentation host may supply `loadImage(url,{signal,asset})` and `inspectImage(url,{signal,asset})`. The loader transfers decoded-image ownership to the broker and should honor cancellation. The inspector returns `{format:'png',width,height}` or `null` when bounded preparation is unavailable. The broker keeps at most `maxConcurrentTasks` preflight/decode tasks running (default 6, accepted range 1..16; each is mostly a network wait, and two made start-up pay one round trip after another for scenes of many small images). Decoded bytes stay bounded by the scene and unused budgets, which reserve before a decode starts. A noncooperative injected operation may finish late; its pixels are fenced and released instead of being published into a newer generation.

## Declared scene preparation

`prepareScene(scene)` collects unique `sprite.asset` dependencies from the scene's entity array or entity record, including hidden sprites. It does not scan or decode every image in the asset manifest. These are authored future dependencies, rather than an asset-name, folder or image-size heuristic.

An image's size comes from the preload plan's authored `dimensions` when it has one (no request at all), otherwise from a bounded header read. The default inspector picks the read by the declared encoding, or by the file extension in a legacy manifest without one: a PNG's signature and IHDR from the first 24 bytes, a WebP's first chunk from the first 64 bytes, a JPEG's SOF within 64 KiB. PNG, JPEG and WebP sprites whose size is known are all admitted and decoded before READY; the decoder must still produce exactly that size. If the server ignores Range and sends a full successful response, inspection drains that stream to EOF while retaining only the 24-byte header, then releases the reader lock. It does not accumulate the encoded body or decode an unadmitted image. Only an actual abort or failed read cancels the reader; errors remain observable. Unknown bounded dimensions (an SVG, a header the prefix does not reach), excess entries and excess bytes produce explicit partial preparation and preserve normal lazy acquisition. They do not invalidate a valid Core scene. The scene-entry limit also bounds the number of inspected candidates; later dependencies are reported as skipped. Admission follows declaration order, independent of request completion order.

The default loader retains the HTML image path already used by Canvas and Three. It waits for `Image.decode()` when available, clears event handlers after settlement, and cancels/clears the source only when an abort arrives before `onload`. After `onload`, cancellation fences pending decode work without resetting the completed source. This avoids changing ImageBitmap color conversion or alpha premultiplication. Decoded dimensions must match a prepared reservation. Failed speculative loads are reported, released and removed; later required use can retry normally instead of inheriting a permanently rejected speculative entry.

The returned immutable result contains `declared_entries`, `admitted_entries`, `ready_entries`, `reserved_bytes`, `partial`, `unsupported`, `budget_skipped`, `errors` and `cancelled`. A partial result is not evidence that every future image is ready. A new preparation replaces the previous scene plan; overlapping dependencies keep their existing leases. A superseded preparation cannot publish or release its successor's ownership.

## Ownership and budgets

Scene admission defaults to 64 MiB and 128 images. Admitted scene leases remain until the next scene preparation or broker disposal, including while their sprites are hidden. A draw-count idle timeout must not discard these declared future dependencies.

Current consumers hold separate active leases. World texture records keep their image lease until texture eviction or final disposal, because a restored GPU context still needs those CPU pixels. Canvas and cursor consumers release their leases when retired. The official GPU UI prefix also acquires an independent broker lease for each decoded image used by its textures, requiring an already ready lease with the identical image. Texture disposal precedes release of that GPU owner's lease. Failed preparation rolls back newly staged textures and image leases while retaining previously committed texture owners. Removing one Canvas image consumer therefore lets the prefix sweep only unused geometry and textures while preserving the other meshes, buffers, textures and shared material. GPU context loss retires GPU bindings and their leases while Canvas, world and scene owners preserve any still-required decoded pixels.

When a Canvas composition changes, it acquires every incoming image lease before releasing any outgoing image lease. With the official prefix's `ownsImageLeases` capability and a broker acquisition function, it releases only its own CPU consumer; the next prefix draw incrementally retires unused GPU owners. A presenter that borrows Canvas pixels instead must clear its GPU resources before the outgoing Canvas lease is released. Cleanup runs even if a diagnostic or render-request callback throws. If a callback replaces the composition synchronously, acquisition stops for the obsolete composition and cleanup preserves the latest required set; disposal also stops the draw. An image-cursor change follows the same rule: acquire the incoming image under the validated new cursor specification, then retire outgoing ownership, including when an acquisition-error handler throws. Disposed cursor hosts reject further updates with the existing skipped-diagnostics outcome before validation or acquisition. This protects ready incoming images from an idle-cache sweep triggered by the outgoing releases. Ready hits remain usable synchronously in the same draw. The unused budget is unchanged: a genuinely larger inactive working set can still require later loads, so this handoff rule does not promise zero reloads for every screen transition. Explicit Canvas invalidation and disposal still clear the prefix before releasing its consumer leases. `ui_image_batches.image_leases` reports prefix-owned decoded-image leases separately from GPU texture counters; it is not an additional cache budget or a live browser-memory measurement.

Unowned ready images use a separate aggregate LRU, defaulting to 16 MiB and 128 entries. Unowned pending/error entries are cancelled/removed. Active consumers are pinned and may exceed the nominal limits; their images are never silently closed to satisfy the cache. Only the broker releases pixels after all consumers and the scene plan have released them. Disposal aborts pending work and prevents new acquisition; already leased ready images remain valid until their final release. Late results are not inserted back into a disposed broker.

Retiring a completed `HTMLImageElement` drops broker and consumer ownership without changing its `src`; the browser decides when to collect its element and decoded storage. Resetting a completed image's source can itself create broken-image fallback state. Images with an explicit `close()` operation, such as owned custom decoded images or `ImageBitmap`, still receive that operation exactly once after the last image owner retires. The default HTML loader cancels the source only for a real abort before `onload`; aborting after `onload` while `decode()` is pending clears callbacks and rejects readiness without resetting the completed source. Captured late load callbacks cannot restart decoding or republish a cancelled generation.

`report()` distinguishes resident, active, scene and unused decoded estimates, loading work, reuse, retirement and partial preparation. `closed_images` counts logical final broker image-ownership retirements, including completed HTML images for which no native close operation exists. `released_bytes_estimate` is the decoded payload estimate removed from those entries, not measured native memory returned to the browser or OS. Active and scene sets can overlap and must not be added together. `pressure_bytes` compares total resident pixels with the combined scene-plus-unused nominal capacity; it is informative pressure, not permission to evict an active consumer. It also reports an entry-count pressure threshold.

These budgets and counters estimate `width * height * 4` decoded image payload. They are separate from renderer GPU texture/cache policy, mipmaps, encoded files, browser decode copies and render targets. They do not establish browser live-heap limits, VRAM allocation, absence of leaks, GC cadence or frame-rate acceptance.

## Verification scope

Broker unit tests cover synchronous sharing, hidden-scene dependency collection, two-task concurrency, entry/byte bounds, active ownership, scene replacement, decode/header mismatch, cancellation and late completion, transient speculative failure followed by required retry, shared-image retirement, successful PNG stream draining with bounded header retention, failed-read cleanup and HTML image decode readiness. Consumer integration and the exported official player require their own validation. A passing resource test does not prove a rendered frame or stable FPS.

## Formal image preload plans

Game code requests groups through `api.assets.imageGroups`; see
[game requests](#game-requests). Page code and diagnostics use the official Web
host's facade, with the same broker and the same validated plan. See
[runtime image groups](#runtime-image-groups).

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

The optional `dimensions` record avoids runtime HTTP header inspection:

```json
"dimensions": {
  "image://terrain": {"format":"png", "width":2048, "height":2048}
}
```

Only group-member IDs are accepted, with positive integer dimensions up to
65536 per axis, and `png`/`jpeg`/`webp` formats matching the declared encoding.
The trusted publisher checks these values against bounded prefixes of the
sealed image files. The browser still validates the actual decoded dimensions;
metadata is an admission estimate, never permission to accept different pixels.
This avoids fetching the full file twice when a CDN ignores the old Range
header request. Omit metadata to retain the existing inspection route.

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
project config/script/assets, and the host's image-plan capability. A production
export ships bytecode instead of the entry script and modules, so the helper
compares the project's files with the SHA-256 of each compiled source that the
CLI records in `export.json` as `script_sources`; export again with a current
CLI when an older production export has none. The host's
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

Required unique entries receive an early bounded budget check. A required
startup image needs a known size: authored `dimensions` (PNG, JPEG or WebP,
already checked against the file's own header) or a 24-byte PNG IHDR. A required
image with neither is rejected (`IMAGE_PRELOAD_STARTUP_DIMENSIONS_UNSUPPORTED`).
For WebP or JPEG startup images, author their dimensions. This header check is not a decoder or an image-validity
guarantee; the browser still validates decoding, admission and completion.

Preflight failures create no output. A copy/write failure preserves its
incomplete output for diagnosis; `export.json` is written last and marks a
completed publication. Select another fresh output after a failure. The tool
does not delete or overwrite an existing export.

## Runtime image groups

`window.unonePlayerAssets` is installed in production and development official
Web players. This is a reusable presentation resource primitive: the game
chooses its groups, navigation and next-screen policy, and asks for them from
Luau through [api.assets.imageGroups](#game-requests). It does not change World
state, instantiate entities, load audio, or replace the official renderer.

```js
await window.unonePlayerAssets.preload('next-screen');
await window.unonePlayerAssets.load('current-screen');
window.unonePlayerAssets.unload('previous-screen');
const one = window.unonePlayerAssets.status('current-screen');
const summary = window.unonePlayerAssets.snapshot();
const diagnostic = window.unonePlayerAssets.snapshot({includeTimings:true});
```

Both preload and load prepare/decode and hold the group's shared image leases
until unload. Preload marks an authored background warm set; load promotes that
same set to the current retained working set. They share the bounded two-task
broker queue, not separate decoders or caches. Load is asynchronous and does not
block or pause simulation. Repeated pending requests for one group share one
promise; load promotes an existing preload without reserving or decoding twice.

Only names from the validated image plan are allowed. Missing groups and calls
before broker readiness reject explicitly. The aggregate unique group-held
decoded estimate is limited by the plan's max_bytes/max_entries, with atomic
admission after bounded metadata checks. Overlapping groups reserve a shared
asset once. Choose small explicit warm sets; preloading the entire catalog is
not a default strategy. Scene/startup and renderer owners are separate and can
overlap these estimates; this is not an overall browser or GPU memory limit.

Unload cancels that group's pending work and releases its ownership. It evicts
only images with no remaining scene, group or active renderer/UI/GPU owner.
It cannot break a still-visible image. An unload followed immediately by load
has a new request epoch; stale completion cannot publish into or release the
replacement. Failures roll back all of that group's reservations and leases.
An actual HTML image retirement drops ownership; browser/OS memory reclamation
and GPU collection remain independently managed.

Status rows include name, catalog_generation, state (idle/loading/ready/error/
unloaded), mode, total, ready, held, reserved_bytes_estimate, cache_hits,
cancelled, elapsed_ms and error. Snapshot adds the group budget and aggregate
held counts, bounded loading totals and broker residency/reuse/eviction counts.
Status and snapshot are detached frozen views. Querying never acquires images
or advances the game. The production facade has no arbitrary URL or code route.

## Game requests

Game code chooses its groups from Luau. `api.assets.imageGroups` drives the
same group manager, validated plan, budget, rollback and epoch rules as
`window.unonePlayerAssets`; it adds no second decoder or cache.

Give independently closing screens and overlays stable owner names. Use
`setOwner` when a screen's required set changes. Omitting a name from its next
set releases that owner's interest, including across a direct switch between
two characters. `load` takes precedence over `preload` across all game owners.

```luau
local groups = api.assets.imageGroups
groups.setOwner("conversation", {["dialogue-base"]="load", ["merchant"]="preload"})
groups.setOwner("story", {["dialogue-base"]="preload"})
groups.releaseOwner("conversation")
local remaining = groups.owners("dialogue-base") -- {story = "preload"}
if groups.status("dialogue-base").state == "error" then
    groups.retry("dialogue-base") -- on a user's retry action
end
groups.releaseOwner("story")
```

Each replacement validates the entire table before changing any holds. An empty
set releases the owner. The registry supports 128 active named owners, each
with a name of 1–128 UTF-8 bytes. Repeated declarations of the same effective
working set leave the host plan unchanged. `owners(group)` returns a detached
table of named Luau consumers. Direct game requests have an independent hold.
Use `status(group)` for the last host receipt and the official player's asset
snapshot for decoded estimates and renderer activity.

```luau
local groups = api.assets.imageGroups
if nearTown then groups.preload("town-3") end   -- approaching: decode in the background
if inTown then groups.load("town-3") end        -- entered: hold as the current working set
if farFromTown then groups.unload("town-3") end -- far away: release what nothing else uses
local s = groups.status("town-3")
local artReady = s.state == "ready" or s.state == "unsupported"
```

The types in [engine.d.luau](engine.d.luau):

```luau
export type ImageGroupState = "idle" | "loading" | "ready" | "error" | "unloaded" | "unsupported"
export type ImageGroupRequest = "preload" | "load" | "unload"
export type ImageGroupStatus = {
    name: string, state: ImageGroupState, requested: ImageGroupRequest?,
    total: number, ready: number, bytes: number, error: string?,
}
export type ImageGroupsApi = {
    setOwner: (owner: string, desired: {[string]: "preload" | "load"}) -> (),
    releaseOwner: (owner: string) -> (),
    owners: (group: string) -> {[string]: "preload" | "load"},
    retry: (name: string) -> (),
    preload: (name: string) -> (),
    load: (name: string) -> (),
    unload: (name: string) -> (),
    status: (name: string) -> ImageGroupStatus,
}
```

### Requests

`preload`, `load` and `unload` record the game's latest request for a group and
return at once. They never wait for decoding or pause the simulation. Repeating
a request changes nothing, so a game may call them every update.

The host holds every group with an effective preload or load. A load after
a preload promotes the same images without decoding again; a preload after a
load does not demote the group. Requests within one tick collapse to the last,
so an unload followed by a load in the same tick never reaches the host.
After an error, `retry(name)` requests a new attempt while preserving all
owners and their other ready images. Call it once per explicit retry and
read the next host receipt. A group with no demand or no reported failure
has nothing to retry. The requests are refused inside `renderItem`
(`UI_PURE_VIEW`).

### Names

`game check`, `run`, `test` and previews read the group names from
`player.image-assets.json`. Web and native exports copy them into
`content/project.json` as `image_groups`. Every runtime accepts only those names:

- A name that is not in the plan raises `IMAGE_GROUP_UNKNOWN` and lists up to
  eight declared groups. This holds in tools, previews, the native player and
  the Web players alike, so a typo fails `game test` before release.
- In a project without a plan, every name raises `IMAGE_GROUP_UNKNOWN`.
- An empty name, or one over 128 bytes, raises `IMAGE_GROUP_NAME_INVALID`.

The publisher refuses a plan that lacks a group the export recorded
(`IMAGE_PRELOAD_GROUPS_STALE`).

### Status

`status(name)` returns the state the host last reported for the group:

| state | Meaning |
|---|---|
| `idle` | This host holds groups, but has not loaded this one or has not reported yet. |
| `loading` | Admitted under the budget; the images are being decoded. |
| `ready` | Every image in the group is decoded and held. |
| `error` | The request failed; `error` says why (`IMAGE_ASSET_GROUP_BUDGET`, `IMAGE_ASSET_GROUP_MISSING`, a decode failure). |
| `unloaded` | Released, or cancelled before it finished. |
| `unsupported` | No host holds groups in this run, and no report arrived. Images still load on demand when drawn. |

`requested` is the game's latest call for the group, or nil before any. `total`
is the number of distinct images. `ready` is how many of them are decoded and
held.

`bytes` is the decoded estimate the group reserves under the plan budget:
width × height × 4 per distinct image, taken from the authored `dimensions` or
the PNG header at admission. A 3840×1920 ground counts 29,491,200 bytes. An image
shared with another held group is reserved once against `budget.max_bytes`, but
counts in each group's `bytes`. These are estimates of decoded pixels, not
measured browser, driver or GPU memory.

The host reports through recorded presentation input: `presentation_resources.image_groups`
in the tick's input frame (see `game schema input`). A report admitted with a
tick is visible from that tick's `Game.update` on. A request made in tick N
reaches the host after tick N, and its first report arrives with tick N+1 at
the earliest, so `state` lags a new request by at least one tick. A replay
reproduces `status` from the recorded reports.

### World and determinism

Requests and reports live in the game VM beside World, never in it. They do not
change entities, observations, the World snapshot or its digest. The host
receives the groups to hold beside each snapshot (`image_group_plan`), not inside
it. A failed tick rolls back the reports and requests it admitted. Status is
presentation feedback: do not make game rules depend on it.

### Where groups are held

| Run | Requests | `status` |
|---|---|---|
| Official Web player (production or development) with a published plan (`content/image-assets.json`) | Applied to the broker | Host reports |
| Official Web player without a published plan | Validated, then ignored | `unsupported` |
| `game check`, `run`, `test`, previews and native players (desktop, Android) | Validated, then ignored | `unsupported`; recorded reports in replayed input still apply |

The Web player tells Core it holds groups (`image_group_host: true` in the load
payload) only when its plan is published. Holds that page code makes through
`window.unonePlayerAssets` stay independent: the game's unload never drops one,
and a restart releases only what the game asked for.

## Loading diagnostics

The broker retains at most 128 scalar load records. Ordinary snapshot queries
return broker-generation cumulative totals only; includeTimings opts into the
detached record array. total_elapsed_ms sums per-image readiness durations;
parallel waits overlap, so it is not total startup time. Rows
contain queued/start/completion times, elapsed_ms, queue_ms, load_event_ms,
decode_ms, nullable Resource Timing network_ms/transfer_bytes/encoded_body_bytes,
and outcome/error. load_event_ms includes browser fetch and event delivery, not
just network service. decode_ms is measured around the default Image.decode
wait; injected decoders without timing return null. Missing or zero restricted
transfer sizes are null, not evidence of a free cache hit. Times use the main
host performance clock; none are GPU, physical presentation or OS-memory values.

`loading_metrics.visible_queue_supported` identifies a broker that measures
`visible_queue_ms`. The public player exposes this flag in
`unonePlayerAssets.snapshot().loading`. Each completed, failed or cancelled
image load records the longest uninterrupted interval with a renderer lease
while it was still queued for a load slot. Acquiring a second renderer lease
continues the same interval. Releasing the last one or admitting the task ends
it. Reacquiring a queued image starts another interval. A background load or
an immediately admitted image records `null`. Browser fetch and decode occur
after slot admission and have their own timing fields.

The existing `window.unonePlayerPerformance.snapshot()` includes image_assets
with the current group/broker/loading summary. For startup, retain the existing
playerMetrics runtime_ready_ms and first_presented_ms plus Resource Timing.
For navigation, compare the group elapsed_ms and loading/cache counters around
the same user actions, and keep successful-submission, dropped-step and frame
interval measurements separate. See [profiling](profiling.md).
