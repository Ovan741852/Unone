// Accepted decoder routes, not a guarantee that bytes decode on this device.
export const DECODER_ROUTES = Object.freeze({
  mesh: { "unone-mesh-json": "application/json" },
  image: { svg: "image/svg+xml", png: "image/png", jpeg: "image/jpeg", webp: "image/webp" },
  audio: { wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg" },
  spine: { "spine-json": "application/json" },
  effekseer: { efkefc: "application/octet-stream", efk: "application/octet-stream" },
});

export function requireAssetEncoding(asset, decoder) {
  const encoding = asset.encoding;
  if (encoding == null) return; // Legacy manifests explicitly have unspecified encoding.
  const mime = DECODER_ROUTES[decoder]?.[encoding.format];
  if (encoding.decoder !== decoder || !mime || encoding.mime !== mime || encoding.format_version != null) {
    const error = new Error(`HOST_ASSET_ENCODING_UNSUPPORTED: ${asset.id} requests ${JSON.stringify(encoding)}`);
    error.code = "HOST_ASSET_ENCODING_UNSUPPORTED";
    throw error;
  }
}
// Presentation-owned asset catalog: an immutable, derived id index over ONE manifest generation.
// It is never a game/World authority. The index is built once (String(id) keys, last duplicate wins,
// exactly like the legacy per-draw Map); replacing the manifest requires a new catalog/generation.
// adopt:true freezes the caller's manifest in place (the official player owns its fetched JSON), so
// in-place edits throw instead of silently desynchronizing; the default copies before freezing.
const assetCatalogs = new WeakSet();
let assetCatalogGeneration = 0;
function invalidCatalog(message) {
  const error = new Error(`ASSET_CATALOG_INVALID: ${message}`);
  error.code = "ASSET_CATALOG_INVALID";
  return error;
}
// Iterative walks; arrays use index loops (no per-element key strings) and primitives are not stacked.
// Only JSON-like data is accepted: null, boolean, number, string, arrays and plain objects.
function childrenOf(value, visit) {
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) visit(value[i]); }
  else { const keys = Object.keys(value); for (let i = 0; i < keys.length; i++) visit(value[keys[i]]); }
}
function assertPlainData(root) {
  const stack = [root];
  const visit = (child) => {
    if (child === null) return;
    const type = typeof child;
    if (type === "object") { stack.push(child); return; }
    if (type !== "boolean" && type !== "number" && type !== "string") throw invalidCatalog("manifest must be plain JSON data");
  };
  while (stack.length) {
    const value = stack.pop();
    if (!Array.isArray(value)) {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw invalidCatalog("manifest must be plain JSON data");
    }
    childrenOf(value, visit);
  }
}
function deepFreeze(root) {
  const stack = [root];
  const visit = (child) => { if (child !== null && typeof child === "object" && !Object.isFrozen(child)) stack.push(child); };
  while (stack.length) { const value = stack.pop(); Object.freeze(value); childrenOf(value, visit); }
  return root;
}
function readOnlyIndex(index) {
  const view = Object.freeze({
    get: (id) => index.get(id), has: (id) => index.has(id), get size() { return index.size; },
    keys: () => index.keys(), values: () => index.values(), entries: () => index.entries(),
    forEach: (fn, self) => index.forEach((value, key) => fn.call(self, value, key, view)),
    [Symbol.iterator]: () => index.entries(),
  });
  return view;
}
export function createAssetCatalog(manifest, { adopt = false } = {}) {
  if (manifest != null && (typeof manifest !== "object" || Array.isArray(manifest))) throw invalidCatalog("manifest must be an object");
  const assets = manifest?.assets ?? [];
  if (!Array.isArray(assets)) throw invalidCatalog("assets must be an array");
  assets.forEach((asset, i) => {
    if (asset === null || typeof asset !== "object" || Array.isArray(asset)) throw invalidCatalog(`assets[${i}] must be an object`);
  });
  if (manifest != null) assertPlainData(manifest);
  // Everything is validated before freezing, so a rejected manifest is left untouched.
  const owned = deepFreeze(manifest == null ? { assets: [] } : adopt ? manifest : structuredClone(manifest));
  const index = new Map();
  for (const asset of owned.assets ?? []) index.set(String(asset.id), asset);
  const catalog = Object.freeze({ kind: "unone.asset-catalog", generation: ++assetCatalogGeneration, manifest: owned, size: index.size, specs: readOnlyIndex(index) });
  assetCatalogs.add(catalog);
  return catalog;
}
export function isAssetCatalog(value) { return assetCatalogs.has(value); }
export function assetCatalogSpecs(catalog) {
  if (!assetCatalogs.has(catalog)) throw new Error("ASSET_CATALOG_REQUIRED: getAssetCatalog must return a catalog from createAssetCatalog");
  return catalog.specs;
}

const imageError = (code, detail = '') => new Error(`${code}${detail ? ': ' + detail : ''}`);
function abortImageError() { const error = imageError('IMAGE_ASSET_CANCELLED'); error.name = 'AbortError'; return error; }
function closeDecodedImage(image) {
  if (!image) return;
  if (typeof image.close === 'function') image.close();
  else image.removeAttribute?.('src');
}
function imageDimensions(image) {
  const width = image?.naturalWidth ?? image?.width, height = image?.naturalHeight ?? image?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw imageError('IMAGE_ASSET_DIMENSIONS');
  return { width, height, bytes: width * height * 4 };
}
function loadDecodedImage(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortImageError()); return; }
    const image = new Image(); let settled = false;
    const cleanup = () => { image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
    const fail = error => { if (settled) return; settled = true; cleanup(); closeDecodedImage(image); reject(error); };
    const abort = () => fail(abortImageError());
    image.onload = () => {
      let decoded; try { imageDimensions(image); decoded = image.decode?.(); } catch (error) { fail(error); return; }
      Promise.resolve(decoded).then(() => { if (settled) return; settled = true; cleanup(); resolve(image); }, fail);
    };
    image.onerror = () => fail(imageError('IMAGE_ASSET_LOAD_FAILED', String(url)));
    signal?.addEventListener('abort', abort, { once: true }); image.src = String(url);
  });
}
async function inspectPngImage(url, { signal } = {}) {
  // Retain only the PNG header. A server may ignore Range; drain a successful
  // response to EOF rather than turning speculative inspection into an aborted
  // network request. The encoded body is never accumulated or decoded here.
  const response = await fetch(url, { signal, headers: { Range: 'bytes=0-23' } });
  if (!response.ok) throw imageError('IMAGE_ASSET_HEADER_FAILED', String(response.status));
  if (!response.body?.getReader) return null;
  const reader = response.body.getReader(), header = new Uint8Array(24); let length = 0, complete = false;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) { complete = true; break; }
      if (length < header.length) { const take = Math.min(next.value.byteLength, header.length - length); header.set(next.value.subarray(0, take), length); length += take; }
    }
  } finally { if (!complete) { try { await reader.cancel(); } catch {} } reader.releaseLock(); }
  if (length < 24 || [137,80,78,71,13,10,26,10].some((value, i) => header[i] !== value)) return null;
  const view = new DataView(header.buffer); if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw imageError('IMAGE_ASSET_PNG_HEADER');
  return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
}

// Presentation-owned decoded pixels. GPU textures/samplers remain owned by
// their renderer. Only exact immutable catalog membership authorizes id reuse.
export function createImageAssetBroker(catalog, { resolveAssetUrl, loadImage = loadDecodedImage, inspectImage = inspectPngImage,
  sceneMaxBytes = 64 * 1024 * 1024, sceneMaxEntries = 128, unusedMaxBytes = 16 * 1024 * 1024, unusedMaxEntries = 128 } = {}) {
  const specs = assetCatalogSpecs(catalog);
  if (typeof resolveAssetUrl !== 'function' || typeof loadImage !== 'function' || typeof inspectImage !== 'function') throw imageError('IMAGE_ASSET_BROKER_OPTIONS');
  for (const [key, value] of Object.entries({ sceneMaxBytes, sceneMaxEntries, unusedMaxBytes, unusedMaxEntries })) if (!Number.isSafeInteger(value) || value < 0) throw imageError('IMAGE_ASSET_BUDGET', key);
  const entries = new Map(), imageOwners = new Map(), queue = []; let running = 0, stamp = 0, disposed = false, planEpoch = 0, planController = null, sceneLeases = new Map(), preparation = null;
  let loads = 0, reuses = 0, evictions = 0, closedImages = 0, releasedBytes = 0;
  const limits = Object.freeze({ sceneMaxBytes, sceneMaxEntries, unusedMaxBytes, unusedMaxEntries });
  const ownImage = image => imageOwners.set(image, (imageOwners.get(image) ?? 0) + 1);
  const dropImage = image => { const remaining = (imageOwners.get(image) ?? 1) - 1; if (remaining) imageOwners.set(image, remaining); else { imageOwners.delete(image); closeDecodedImage(image); closedImages++; } };
  function pump() {
    while (running < 2 && queue.length) {
      const task = queue.shift(); if (task.signal.aborted) { task.cleanup(); continue; } running++;
      Promise.resolve().then(task.work).then(task.resolve, task.reject).finally(() => { running--; task.cleanup(); pump(); });
    }
  }
  function schedule(work, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { const queued = queue.indexOf(task); if (queued >= 0) { queue.splice(queued, 1); task.cleanup(); } reject(abortImageError()); pump(); };
      const task = { work: () => { if (signal.aborted) throw abortImageError(); return work(); }, signal, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) };
      if (signal.aborted) { reject(abortImageError()); return; } signal.addEventListener('abort', abort, { once: true }); queue.push(task); pump();
    });
  }
  function specFor(id) {
    if (disposed) throw imageError('IMAGE_ASSET_BROKER_DISPOSED');
    if (typeof id !== 'string' || !specs.has(id)) throw imageError('IMAGE_ASSET_MISSING', String(id));
    const asset = specs.get(id); if (asset.kind !== 'texture2d') throw imageError('IMAGE_ASSET_KIND', id); requireAssetEncoding(asset, 'image'); return asset;
  }
  function forget(entry) {
    if (entry.external || entry.scene) return;
    if (entries.get(entry.id) === entry) entries.delete(entry.id); entry.retired = true; entry.controller.abort();
    if (entry.image) { releasedBytes += entry.bytes; dropImage(entry.image); entry.image = null; }
    evictions++;
  }
  function sweep() {
    const unused = [...entries.values()].filter(entry => !entry.external && !entry.scene);
    let bytes = unused.reduce((sum, entry) => sum + entry.bytes, 0), count = unused.length;
    unused.sort((a, b) => a.stamp - b.stamp);
    for (const entry of unused) { if (!disposed && entry.state === 'ready' && bytes <= unusedMaxBytes && count <= unusedMaxEntries) continue; bytes -= entry.bytes; count--; forget(entry); }
  }
  function entryFor(id, reservation = null) {
    const asset = specFor(id); let entry = entries.get(id);
    if (entry) {
      if (reservation) {
        if ((entry.reservation && (entry.reservation.width !== reservation.width || entry.reservation.height !== reservation.height)) || (entry.state === 'ready' && (imageDimensions(entry.image).width !== reservation.width || imageDimensions(entry.image).height !== reservation.height))) throw imageError('IMAGE_ASSET_DIMENSIONS_CHANGED', id);
        entry.reservation = reservation;
      }
      reuses++; return entry;
    }
    entry = { id, asset, state: 'loading', image: null, error: null, bytes: 0, external: 0, scene: 0, stamp: ++stamp, retired: false, controller: new AbortController(), reservation };
    entries.set(id, entry); loads++;
    entry.promise = schedule(async () => {
      const url = await resolveAssetUrl(asset); if (entry.controller.signal.aborted) throw abortImageError();
      const image = await loadImage(url, { signal: entry.controller.signal, asset });
      if (!image || typeof image !== 'object') throw imageError('IMAGE_ASSET_INVALID', id);
      ownImage(image);
      if (disposed || entry.retired || entry.controller.signal.aborted || entries.get(id) !== entry) { dropImage(image); throw abortImageError(); }
      let dimensions; try { dimensions = imageDimensions(image); } catch (error) { dropImage(image); throw error; }
      if (entry.reservation && (dimensions.width !== entry.reservation.width || dimensions.height !== entry.reservation.height)) { dropImage(image); throw imageError('IMAGE_ASSET_DIMENSIONS_CHANGED', id); }
      entry.image = image; entry.bytes = dimensions.bytes; entry.state = 'ready'; entry.stamp = ++stamp; sweep(); return image;
    }, entry.controller.signal).catch(error => { if (!entry.image) { entry.state = 'error'; entry.error = error; } throw error; });
    // Consumers own rejection handling; unused/released async work must never
    // manufacture an unhandled rejection during teardown.
    entry.promise.catch(() => {}); return entry;
  }
  function leaseFor(id, role = 'external', reservation = null) {
    const entry = entryFor(id, reservation); entry[role]++; entry.stamp = ++stamp; let released = false;
    const releasedError = imageError('IMAGE_ASSET_LEASE_RELEASED', id);
    return Object.freeze({
      get state() { return released ? 'error' : entry.state; }, get image() { return !released && entry.state === 'ready' ? entry.image : null; },
      get error() { return released ? releasedError : entry.error; }, promise: entry.promise,
      release() { if (released) return; released = true; entry[role]--; entry.stamp = ++stamp; sweep(); },
    });
  }
  function freezePreparation(value) { for (const key of ['unsupported','budget_skipped','errors']) { value[key].forEach(Object.freeze); Object.freeze(value[key]); } return Object.freeze(value); }
  async function prepareScene(scene) {
    if (disposed) throw imageError('IMAGE_ASSET_BROKER_DISPOSED');
    planController?.abort(); const controller = new AbortController(); planController = controller; const epoch = ++planEpoch;
    const entities = scene?.entities ?? [], ids = [...new Set((Array.isArray(entities) ? entities : Object.values(entities)).flatMap(entity => typeof entity?.sprite?.asset === 'string' ? [entity.sprite.asset] : []))];
    const previous = sceneLeases, next = new Map(); sceneLeases = next;
    for (const [id, lease] of previous) { if (ids.includes(id)) next.set(id, lease); else lease.release(); }
    const result = { declared_entries: ids.length, admitted_entries: 0, ready_entries: 0, reserved_bytes: 0, partial: false, unsupported: [], budget_skipped: [], errors: [], cancelled: false };
    const candidates = ids.slice(0, sceneMaxEntries), inspected = new Array(candidates.length); let position = 0;
    for (const id of ids.slice(sceneMaxEntries)) result.budget_skipped.push({ id, reason: 'scene_entry_budget' });
    const worker = async work => { while (!controller.signal.aborted && position < candidates.length) { const index = position++; await work(candidates[index], index); } };
    const inspect = async (id, index) => {
      try { const asset = specFor(id), known = entries.get(id); const metadata = known?.reservation ?? await schedule(async () => inspectImage(await resolveAssetUrl(asset), { signal: controller.signal, asset }), controller.signal);
        if (!metadata || metadata.format !== 'png') { inspected[index] = { id, unsupported: true }; return; }
        const dimensions = imageDimensions(metadata); inspected[index] = { id, ...dimensions, format: 'png' };
      } catch (error) { inspected[index] = { id, error }; }
    };
    await Promise.all([worker(inspect), worker(inspect)]);
    if (controller.signal.aborted || epoch !== planEpoch || disposed) { result.cancelled = result.partial = true; return freezePreparation(result); }
    const selected = [];
    for (const item of inspected) {
      if (item.error) { result.errors.push({ id: item.id, message: String(item.error.message ?? item.error) }); continue; }
      if (item.unsupported) { result.unsupported.push({ id: item.id, reason: 'unknown_bounded_dimensions_or_non_png' }); continue; }
      if (result.reserved_bytes + item.bytes > sceneMaxBytes) { result.budget_skipped.push({ id: item.id, reason: 'scene_byte_budget' }); continue; }
      selected.push(item); result.reserved_bytes += item.bytes;
    }
    const selectedIds = new Set(selected.map(item => item.id)); for (const [id, lease] of next) if (!selectedIds.has(id)) { next.delete(id); lease.release(); }
    result.admitted_entries = selected.length; position = 0;
    const decode = async () => { while (!controller.signal.aborted && position < selected.length) { const item = selected[position++]; let lease;
      try { lease = next.get(item.id); if (!lease) { lease = leaseFor(item.id, 'scene', item); next.set(item.id, lease); } await lease.promise; if (lease.state === 'ready') result.ready_entries++; else throw lease.error;
      } catch (error) {
        result.errors.push({ id: item.id, message: String(error?.message ?? error) });
        // A speculative failure must not poison the later required load. A
        // superseded plan must also never release a lease transferred to its successor.
        if (lease && epoch === planEpoch && sceneLeases === next && next.get(item.id) === lease) { next.delete(item.id); lease.release(); }
      }
    } };
    await Promise.all([decode(), decode()]);
    result.cancelled = controller.signal.aborted || epoch !== planEpoch || disposed;
    if (!result.cancelled) { result.admitted_entries = next.size; result.reserved_bytes = selected.reduce((bytes, item) => bytes + (next.has(item.id) ? item.bytes : 0), 0); }
    result.partial = result.cancelled || result.ready_entries !== result.declared_entries;
    if (!result.cancelled) preparation = freezePreparation(result); else freezePreparation(result);
    return result;
  }
  return Object.freeze({
    acquire: id => leaseFor(id), prepareScene,
    report() {
      let residentBytes = 0, activeBytes = 0, sceneBytes = 0, unusedBytes = 0, activeEntries = 0, sceneEntries = 0, unusedEntries = 0, loading = 0;
      for (const entry of entries.values()) { residentBytes += entry.bytes; if (entry.state === 'loading') loading++; if (entry.external) { activeEntries++; activeBytes += entry.bytes; } if (entry.scene) { sceneEntries++; sceneBytes += entry.bytes; } if (!entry.external && !entry.scene) { unusedEntries++; unusedBytes += entry.bytes; } }
      return { catalog_generation: catalog.generation, disposed, limits, resident_entries: entries.size, resident_bytes_estimate: residentBytes, active_entries: activeEntries, active_bytes_estimate: activeBytes, scene_entries: sceneEntries, scene_bytes_estimate: sceneBytes, unused_entries: unusedEntries, unused_bytes_estimate: unusedBytes, loading, active_tasks: running, queued_tasks: queue.length, loads, reuses, evictions, closed_images: closedImages, released_bytes_estimate: releasedBytes, pressure_bytes: Math.max(0, residentBytes - sceneMaxBytes - unusedMaxBytes), pressure_entries: Math.max(0, entries.size - sceneMaxEntries - unusedMaxEntries), preparation, scope: 'Decoded image RGBA estimate; scene and active sets may overlap. GPU textures, encoded bytes, browser copies and render targets are separate. Active leases are never evicted.' };
    },
    dispose() { if (disposed) return; disposed = true; planEpoch++; planController?.abort(); for (const lease of sceneLeases.values()) lease.release(); sceneLeases.clear(); for (const entry of entries.values()) if (entry.state === 'loading') entry.controller.abort(); sweep(); },
  });
}
