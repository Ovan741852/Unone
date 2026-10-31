import {IMAGE_DIMENSIONS_MAX_PREFIX_BYTES,inspectImageDimensions} from './image-dimensions.mjs';
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

export const IMAGE_PRELOAD_PLAN_VERSION = 1;
export const IMAGE_PRELOAD_PLAN_MAX_BYTES = 1048576;
function preloadInvalid(detail) { throw new Error(`IMAGE_PRELOAD_PLAN_INVALID: ${detail}`); }
function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i); if (code < 128) bytes++; else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; } else bytes += 3;
  }
  return bytes;
}
function preloadRecord(value, label, allowed = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) preloadInvalid(`${label} must be a plain JSON object`);
  for (const key of Reflect.ownKeys(value)) { const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || allowed && !allowed.includes(key)) preloadInvalid(`${label} has an unknown or non-JSON field`);
  }
}
function preloadArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) preloadInvalid(`${label} must be a bounded JSON array`);
  for (const key of Reflect.ownKeys(value)) { if (key === 'length') continue; const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) preloadInvalid(`${label} has a non-JSON field`);
  }
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) preloadInvalid(`${label} contains a hole`);
}
function preloadString(value, label, maximum) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || utf8Length(value) > maximum) preloadInvalid(`${label} exceeds its UTF-8 string bound`);
}
function quotedUtf8Length(text) {
  let bytes = 2;
  for (let i = 0; i < text.length; i++) { const code = text.charCodeAt(i);
    if (code === 34 || code === 92) bytes += 2;
    else if (code < 32) bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
  }
  return bytes;
}
export function validateImagePreloadPlan(value, catalog) {
  const specs = assetCatalogSpecs(catalog); preloadRecord(value, 'plan', ['version','groups','startup','budget']);
  if (!Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'groups') || !Object.hasOwn(value, 'startup') || value.version !== IMAGE_PRELOAD_PLAN_VERSION) preloadInvalid('version1, groups and startup are required');
  const budget = Object.hasOwn(value, 'budget') ? value.budget : null;
  if (Object.hasOwn(value, 'budget')) preloadRecord(budget, 'budget', ['max_bytes','max_entries']);
  const maxBytes = budget && Object.hasOwn(budget, 'max_bytes') ? budget.max_bytes : 64 * 1024 * 1024, maxEntries = budget && Object.hasOwn(budget, 'max_entries') ? budget.max_entries : 128;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1073741824 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 65536) preloadInvalid('budget must contain positive bounded integers');
  const canonicalBudget = Object.freeze({ max_bytes: maxBytes, max_entries: maxEntries });
  let encodedBytes = utf8Length(JSON.stringify({ version: IMAGE_PRELOAD_PLAN_VERSION, groups: {}, startup: [], budget: canonicalBudget }));
  const reserve = bytes => { encodedBytes += bytes; if (encodedBytes > IMAGE_PRELOAD_PLAN_MAX_BYTES) preloadInvalid('canonical encoded plan exceeds1MiB'); };
  preloadRecord(value.groups, 'groups'); const names = Object.keys(value.groups); if (names.length > 128) preloadInvalid('groups exceeds128');
  const groups = {}; let references = 0, groupIndex = 0;
  for (const name of names) { preloadString(name, 'group name', 128); const authored = value.groups[name]; preloadArray(authored, 'group references', 4096); references += authored.length; if (references > 16384) preloadInvalid('total references exceeds16384');
    reserve(quotedUtf8Length(name) + 3 + (groupIndex++ ? 1 : 0)); const ids = [];
    for (const id of authored) { preloadString(id, 'asset ID', 2048); reserve(quotedUtf8Length(id) + (ids.length ? 1 : 0)); const asset = specs.get(id); if (!asset || asset.kind !== 'texture2d') preloadInvalid(`group asset must be a declared texture2d: ${id}`); requireAssetEncoding(asset, 'image'); ids.push(id); }
    Object.defineProperty(groups, name, { value: Object.freeze(ids), enumerable: true });
  }
  preloadArray(value.startup, 'startup', 128); const startup = [], seen = new Set();
  for (const name of value.startup) { preloadString(name, 'startup group', 128); if (!Object.hasOwn(groups, name) || seen.has(name)) preloadInvalid('startup groups must exist and be unique'); reserve(quotedUtf8Length(name) + (startup.length ? 1 : 0)); seen.add(name); startup.push(name); }
  const canonical = { version: IMAGE_PRELOAD_PLAN_VERSION, groups: Object.freeze(groups), startup: Object.freeze(startup), budget: canonicalBudget };
  if (utf8Length(JSON.stringify(canonical)) > IMAGE_PRELOAD_PLAN_MAX_BYTES) preloadInvalid('canonical encoded plan exceeds1MiB');
  return Object.freeze(canonical);
}

const imageError = (code, detail = '') => new Error(`${code}${detail ? ': ' + detail : ''}`);
function abortImageError() { const error = imageError('IMAGE_ASSET_CANCELLED'); error.name = 'AbortError'; return error; }
function closeDecodedImage(image) {
  if (!image) return;
  // Completed HTML images have no explicit close operation. Drop ownership
  // instead of resetting src, which can create browser broken-image state.
  if (typeof image.close === 'function') image.close();
}
function imageDimensions(image) {
  const width = image?.naturalWidth ?? image?.width, height = image?.naturalHeight ?? image?.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 4)) throw imageError('IMAGE_ASSET_DIMENSIONS');
  return { width, height, bytes: width * height * 4 };
}
function loadDecodedImage(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortImageError()); return; }
    const image = new Image(); let settled = false, loaded = false;
    const cleanup = () => { image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
    const fail = (error, cancelPending = false) => { if (settled) return; settled = true; cleanup(); if (cancelPending && !loaded) image.removeAttribute?.('src'); closeDecodedImage(image); reject(error); };
    const abort = () => fail(abortImageError(), true);
    image.onload = () => {
      if (settled) return; loaded = true;
      let decoded; try { imageDimensions(image); decoded = image.decode?.(); } catch (error) { fail(error); return; }
      Promise.resolve(decoded).then(() => { if (settled) return; settled = true; cleanup(); resolve(image); }, fail);
    };
    image.onerror = () => fail(imageError('IMAGE_ASSET_LOAD_FAILED', String(url)));
    signal?.addEventListener('abort', abort, { once: true }); image.src = String(url);
  });
}
async function readImageHeader(url,signal,limit) {
  // Retain only the bounded header prefix. A server may ignore Range; drain a successful
  // response to EOF rather than turning speculative inspection into an aborted
  // network request. The encoded body is never accumulated or decoded here.
  const response = await fetch(url, { signal, headers: { Range: `bytes=0-${limit-1}` } });
  if (!response.ok) throw imageError('IMAGE_ASSET_HEADER_FAILED', String(response.status));
  if (!response.body?.getReader) return null;
  const reader = response.body.getReader(), header = new Uint8Array(limit); let length = 0, complete = false;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) { complete = true; break; }
      if (length < header.length) { const take = Math.min(next.value.byteLength, header.length - length); header.set(next.value.subarray(0, take), length); length += take; }
    }
  } finally { if (!complete) { try { await reader.cancel(); } catch {} } reader.releaseLock(); }
  return header.subarray(0,length);
}
async function inspectPngImage(url, { signal } = {}) {
  const header=await readImageHeader(url,signal,24);
  if (!header || header.length < 24 || [137,80,78,71,13,10,26,10].some((value, i) => header[i] !== value)) return null;
  const view = new DataView(header.buffer); if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw imageError('IMAGE_ASSET_PNG_HEADER');
  return { format: 'png', width: view.getUint32(16), height: view.getUint32(20) };
}
async function inspectRasterImage(url,options={}) {
  if(options.asset?.encoding?.format==='png')return inspectPngImage(url,options);
  if(options.asset?.encoding?.format==='svg')return null;
  const prefix=await readImageHeader(url,options.signal,IMAGE_DIMENSIONS_MAX_PREFIX_BYTES);
  return prefix?inspectImageDimensions(prefix):null;
}

// Presentation-owned decoded pixels. GPU textures/samplers remain owned by
// their renderer. Only exact immutable catalog membership authorizes id reuse.
export function createImageAssetBroker(catalog, { resolveAssetUrl, loadImage = loadDecodedImage, inspectImage = inspectPngImage,
  sceneMaxBytes = 64 * 1024 * 1024, sceneMaxEntries = 128, unusedMaxBytes = 16 * 1024 * 1024, unusedMaxEntries = 128, preloadPlan = null } = {}) {
  const specs = assetCatalogSpecs(catalog);
  if (typeof resolveAssetUrl !== 'function' || typeof loadImage !== 'function' || typeof inspectImage !== 'function') throw imageError('IMAGE_ASSET_BROKER_OPTIONS');
  for (const [key, value] of Object.entries({ sceneMaxBytes, sceneMaxEntries, unusedMaxBytes, unusedMaxEntries })) if (!Number.isSafeInteger(value) || value < 0) throw imageError('IMAGE_ASSET_BUDGET', key);
  const plan = preloadPlan === null ? null : validateImagePreloadPlan(preloadPlan, catalog);
  if (plan) { sceneMaxBytes = plan.budget.max_bytes; sceneMaxEntries = plan.budget.max_entries; }
  const planSummary = plan ? Object.freeze({ version: plan.version, groups: Object.keys(plan.groups).length, startup_groups: plan.startup, budget: plan.budget }) : null;
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
    const unused = [];
    for (const entry of entries.values()) if (!entry.external && !entry.scene) {
      // A single image that cannot fit is not an LRU candidate. Retire it
      // before considering older small images, preserving the useful cache.
      if (disposed || entry.state !== 'ready' || entry.bytes > unusedMaxBytes || unusedMaxEntries === 0) forget(entry);
      else unused.push(entry);
    }
    let bytes = unused.reduce((sum, entry) => sum + entry.bytes, 0), count = unused.length;
    unused.sort((a, b) => a.stamp - b.stamp);
    for (const entry of unused) { if (bytes <= unusedMaxBytes && count <= unusedMaxEntries) break; bytes -= entry.bytes; count--; forget(entry); }
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
    const entities = scene?.entities ?? [], sceneIds = (Array.isArray(entities) ? entities : Object.values(entities)).flatMap(entity => typeof entity?.sprite?.asset === 'string' ? [entity.sprite.asset] : []);
    const startupIds = plan ? plan.startup.flatMap(name => plan.groups[name]) : [], requiredIds = new Set(startupIds), ids = [...new Set([...startupIds, ...sceneIds])];
    const previous = sceneLeases, next = new Map(); sceneLeases = next;
    for (const [id, lease] of previous) { if (ids.includes(id)) next.set(id, lease); else lease.release(); }
    const result = { declared_entries: ids.length, scene_declared_entries: new Set(sceneIds).size, startup_entries: requiredIds.size, required_entries: requiredIds.size, required_ready_entries: 0, startup_groups: plan?.startup ?? Object.freeze([]), duplicate_references: startupIds.length + sceneIds.length - ids.length, admitted_entries: 0, ready_entries: 0, reserved_bytes: 0, partial: false, unsupported: [], budget_skipped: [], errors: [], cancelled: false };
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
      try { lease = next.get(item.id); if (!lease) { lease = leaseFor(item.id, 'scene', item); next.set(item.id, lease); } await lease.promise; if (lease.state === 'ready') { result.ready_entries++; if (requiredIds.has(item.id)) result.required_ready_entries++; } else throw lease.error;
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
  const metadataInspector = createImageMetadataInspector({specFor, entries, resolveAssetUrl, inspectImage:inspectImage===inspectPngImage?inspectRasterImage:inspectImage, schedule,
    maxEntries: Math.max(1, sceneMaxEntries, unusedMaxEntries)});
  return Object.freeze({
    acquire: id => leaseFor(id), prepareScene, inspect: metadataInspector.inspect,
    report() {
      let residentBytes = 0, activeBytes = 0, sceneBytes = 0, unusedBytes = 0, activeEntries = 0, sceneEntries = 0, unusedEntries = 0, loading = 0;
      for (const entry of entries.values()) { residentBytes += entry.bytes; if (entry.state === 'loading') loading++; if (entry.external) { activeEntries++; activeBytes += entry.bytes; } if (entry.scene) { sceneEntries++; sceneBytes += entry.bytes; } if (!entry.external && !entry.scene) { unusedEntries++; unusedBytes += entry.bytes; } }
      return { catalog_generation: catalog.generation, disposed, limits, preload_plan: planSummary, resident_entries: entries.size, resident_bytes_estimate: residentBytes, active_entries: activeEntries, active_bytes_estimate: activeBytes, scene_entries: sceneEntries, scene_bytes_estimate: sceneBytes, unused_entries: unusedEntries, unused_bytes_estimate: unusedBytes, loading, active_tasks: running, queued_tasks: queue.length, loads, reuses, evictions, closed_images: closedImages, released_bytes_estimate: releasedBytes, pressure_bytes: Math.max(0, residentBytes - sceneMaxBytes - unusedMaxBytes), pressure_entries: Math.max(0, entries.size - sceneMaxEntries - unusedMaxEntries), preparation, scope: 'Decoded image RGBA estimate; scene and active sets may overlap. GPU textures, encoded bytes, browser copies and render targets are separate. Active leases are never evicted. closed_images counts logical final image-ownership retirement; released_bytes_estimate is retired decoded payload, not native-memory reclamation.' };
    },
    dispose() { if (disposed) return; disposed = true; metadataInspector.dispose(); planEpoch++; planController?.abort(); for (const lease of sceneLeases.values()) lease.release(); sceneLeases.clear(); for (const entry of entries.values()) if (entry.state === 'loading') entry.controller.abort(); sweep(); },
  });
}

// Metadata has no pixel lease. Each caller owns only its cancellation; one
// cancelled prefetch must not abort inspection still needed by another owner.
function createImageMetadataInspector({specFor, entries, resolveAssetUrl, inspectImage, schedule, maxEntries}) {
  const records = new Map(); let disposed = false;
  function start(id, asset) {
    if (records.size >= maxEntries) {
      for (const [key, value] of records) if (!value.users && value.done) { records.delete(key); break; }
      if (records.size >= maxEntries) throw imageError('IMAGE_ASSET_INSPECTION_BUSY', id);
    }
    const record = {controller: new AbortController(), users: 0, done: false};
    records.set(id, record);
    record.promise = schedule(async () => {
      const metadata = await inspectImage(await resolveAssetUrl(asset), {signal: record.controller.signal, asset});
      if (disposed || record.controller.signal.aborted) throw abortImageError();
      if (!metadata || !['png','jpeg','webp'].includes(metadata.format)) throw imageError('IMAGE_ASSET_DIMENSIONS_UNAVAILABLE', id);
      return Object.freeze({format: metadata.format, ...imageDimensions(metadata)});
    }, record.controller.signal).then(value => { record.done = true; return value; }, error => {
      record.done = true; if (records.get(id) === record) records.delete(id); throw error;
    });
    record.promise.catch(() => {}); return record;
  }
  function inspect(id, {signal} = {}) {
    const asset = specFor(id);
    if (disposed || signal?.aborted) return Promise.reject(abortImageError());
    const image = entries.get(id);
    if (image?.state === 'ready') return Promise.resolve(Object.freeze({format: asset.encoding?.format ?? 'decoded', ...imageDimensions(image.image)}));
    if (image?.reservation) return Promise.resolve(Object.freeze({format: 'png', ...imageDimensions(image.reservation)}));
    const record = records.get(id) ?? start(id, asset); record.users++;
    return new Promise((resolve, reject) => {
      let live = true;
      const finish = () => {
        if (!live) return false; live = false; signal?.removeEventListener('abort', cancel); record.users--;
        if (!record.users && !record.done) { if (records.get(id) === record) records.delete(id); record.controller.abort(); }
        return true;
      };
      const cancel = () => { if (finish()) reject(abortImageError()); };
      signal?.addEventListener('abort', cancel, {once: true});
      record.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
    });
  }
  return {inspect, dispose() { if (disposed) return; disposed = true; for (const record of records.values()) record.controller.abort(); records.clear(); }};
}
