import {IMAGE_DIMENSIONS_MAX_PREFIX_BYTES,inspectImageDimensions} from './image-dimensions.mjs';
export const imageDimensionsPrefixLimit=IMAGE_DIMENSIONS_MAX_PREFIX_BYTES;
export function inspectAuthoredImageDimensions(bytes){return inspectImageDimensions(bytes);}
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
  const specs = assetCatalogSpecs(catalog); preloadRecord(value, 'plan', ['version','groups','startup','budget','dimensions','streamable']);
  function imageSpec(id) {
    preloadString(id, 'asset ID', 2048);
    const asset = specs.get(id);
    if (!asset || asset.kind !== 'texture2d') preloadInvalid(`image must be a declared texture2d: ${id}`);
    requireAssetEncoding(asset, 'image');
    return asset;
  }
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
    for (const id of authored) { imageSpec(id); reserve(quotedUtf8Length(id) + (ids.length ? 1 : 0)); ids.push(id); }
    Object.defineProperty(groups, name, { value: Object.freeze(ids), enumerable: true });
  }
  preloadArray(value.startup, 'startup', 128); const startup = [], seen = new Set();
  for (const name of value.startup) { preloadString(name, 'startup group', 128); if (!Object.hasOwn(groups, name) || seen.has(name)) preloadInvalid('startup groups must exist and be unique'); reserve(quotedUtf8Length(name) + (startup.length ? 1 : 0)); seen.add(name); startup.push(name); }
  const canonical = { version: IMAGE_PRELOAD_PLAN_VERSION, groups: Object.freeze(groups), startup: Object.freeze(startup), budget: canonicalBudget };
  if (Object.hasOwn(value, 'streamable')) {
    preloadArray(value.streamable, 'streamable', 16384);
    const ids = new Set();
    for (const id of value.streamable) {
      imageSpec(id);
      if (ids.has(id) || Object.hasOwn(groups, id)) preloadInvalid('duplicate image preload selector: '+id);
      reserve(quotedUtf8Length(id) + (ids.size ? 1 : 0));
      ids.add(id);
    }
    canonical.streamable = Object.freeze([...ids]);
  }
  if(Object.hasOwn(value,'dimensions')){
    preloadRecord(value.dimensions,'dimensions');const dimensions={};
    if(Object.keys(value.dimensions).length>16384)preloadInvalid('dimensions exceeds16384');
    for(const [id,d]of Object.entries(value.dimensions)){imageSpec(id);preloadRecord(d,'dimensions entry',['format','width','height']);
      if(!['png','jpeg','webp'].includes(d.format)||!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<=0||d.height<=0||d.width>65536||d.height>65536||!Number.isSafeInteger(d.width*d.height*4))preloadInvalid('dimensions must be bounded raster sizes');
      if(specs.get(id).encoding&&specs.get(id).encoding.format!==d.format)preloadInvalid('dimensions format disagrees with manifest: '+id);
      Object.defineProperty(dimensions,id,{value:Object.freeze({format:d.format,width:d.width,height:d.height}),enumerable:true});
    }canonical.dimensions=Object.freeze(dimensions);
  }
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
const imageClock = () => globalThis.performance?.now?.() ?? Date.now();
function loadDecodedImage(url, { signal, onTiming } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortImageError()); return; }
    const image = new Image(),started=imageClock(); let settled = false, loaded = false;
    const cleanup = () => { image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
    const fail = (error, cancelPending = false) => { if (settled) return; settled = true; cleanup(); if (cancelPending && !loaded) image.removeAttribute?.('src'); closeDecodedImage(image); reject(error); };
    const abort = () => fail(abortImageError(), true);
    image.onload = () => {
      if (settled) return; loaded = true;const loadedAt=imageClock(),hasDecode=typeof image.decode==='function';
      let decoded; try { imageDimensions(image); decoded = image.decode?.(); } catch (error) { fail(error); return; }
      Promise.resolve(decoded).then(() => { if (settled) return; settled = true; cleanup();try{onTiming?.({load_event_ms:Math.max(0,loadedAt-started),decode_ms:hasDecode?Math.max(0,imageClock()-loadedAt):null});}catch{} resolve(image); }, fail);
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
const WEBP_DIMENSIONS_PREFIX_BYTES=64; // RIFF header, first chunk header and its size fields
// A declared encoding wins; a legacy manifest without one is read by the file's extension, which only picks how
// many header bytes to request: the bytes themselves still decide the format.
function rasterFormat(asset){const declared=asset?.encoding?.format;if(declared)return declared;const ext=/\.([a-z0-9]+)$/i.exec(String(asset?.source??''))?.[1]?.toLowerCase();return ext==='jpg'?'jpeg':ext;}
async function inspectRasterImage(url,options={}) {
  const format=rasterFormat(options.asset);
  if(format==='png')return inspectPngImage(url,options);
  if(format==='svg')return null;
  const prefix=await readImageHeader(url,options.signal,format==='webp'?WEBP_DIMENSIONS_PREFIX_BYTES:IMAGE_DIMENSIONS_MAX_PREFIX_BYTES);
  return prefix?inspectImageDimensions(prefix):null;
}

// How many header preflights and image loads may be in flight at once. Each one is mostly a network wait, so two made a
// scene of many small images pay one round trip after another: over a real connection that queueing, not the bytes,
// dominated start-up. Six matches what browsers allow per host on HTTP/1.1. Decoded memory is still bounded by the
// scene and unused budgets, which reserve bytes before a decode starts; this only bounds how much work overlaps.
export const IMAGE_TASK_CONCURRENCY = 6, IMAGE_TASK_CONCURRENCY_MAX = 16;

// Presentation-owned decoded pixels. GPU textures/samplers remain owned by
// their renderer. Only exact immutable catalog membership authorizes id reuse.
export function createImageAssetBroker(catalog, { resolveAssetUrl, loadImage = loadDecodedImage, inspectImage = inspectPngImage,
  sceneMaxBytes = 64 * 1024 * 1024, sceneMaxEntries = 128, unusedMaxBytes = 16 * 1024 * 1024, unusedMaxEntries = 128, preloadPlan = null,
  maxConcurrentTasks = IMAGE_TASK_CONCURRENCY } = {}) {
  const specs = assetCatalogSpecs(catalog);
  if (typeof resolveAssetUrl !== 'function' || typeof loadImage !== 'function' || typeof inspectImage !== 'function') throw imageError('IMAGE_ASSET_BROKER_OPTIONS');
  for (const [key, value] of Object.entries({ sceneMaxBytes, sceneMaxEntries, unusedMaxBytes, unusedMaxEntries })) if (!Number.isSafeInteger(value) || value < 0) throw imageError('IMAGE_ASSET_BUDGET', key);
  if (!Number.isSafeInteger(maxConcurrentTasks) || maxConcurrentTasks < 1 || maxConcurrentTasks > IMAGE_TASK_CONCURRENCY_MAX) throw imageError('IMAGE_ASSET_BUDGET', 'maxConcurrentTasks');
  const plan = preloadPlan === null ? null : validateImagePreloadPlan(preloadPlan, catalog);
  if (plan) { sceneMaxBytes = plan.budget.max_bytes; sceneMaxEntries = plan.budget.max_entries; }
  const planSummary = plan ? Object.freeze({ version: plan.version, groups: Object.keys(plan.groups).length, startup_groups: plan.startup, budget: plan.budget }) : null;
  const authoredDimensions=id=>plan?.dimensions&&Object.hasOwn(plan.dimensions,id)?plan.dimensions[id]:null;
  // Scene preparation and groups read sizes the same way: authored plan dimensions first, then a bounded header prefix.
  const rasterInspector=inspectImage===inspectPngImage?inspectRasterImage:inspectImage;
  const entries = new Map(), imageOwners = new Map(), queue = []; let running = 0, stamp = 0, disposed = false, planEpoch = 0, planController = null, sceneLeases = new Map(), preparation = null;
  let loads = 0, reuses = 0, evictions = 0, closedImages = 0, releasedBytes = 0;
  const loadTimings=[];let loadingTotalMs=0,completedLoads=0,failedLoads=0,cancelledLoads=0;
  function recordLoad(entry,state,error){
    const end=imageClock(),row={id:entry.id,state,queued_at_ms:entry.queuedAt,started_at_ms:entry.startedAt,completed_at_ms:end,elapsed_ms:Math.max(0,end-entry.queuedAt),queue_ms:entry.startedAt===null?null:Math.max(0,entry.startedAt-entry.queuedAt),visible_queue_ms:entry.longestVisibleWait,load_event_ms:entry.imageTiming?.load_event_ms??null,decode_ms:entry.imageTiming?.decode_ms??null,network_ms:null,transfer_bytes:null,encoded_body_bytes:null,error:error?String(error?.code??error?.name??'IMAGE_ASSET_ERROR'):null};
    if(entry.url)try{const rows=globalThis.performance?.getEntriesByName?.(entry.url,'resource'),resource=rows?.[rows.length-1];if(resource&&resource.startTime>=entry.queuedAt){row.network_ms=Number.isFinite(resource.duration)?resource.duration:null;row.transfer_bytes=resource.transferSize>0?resource.transferSize:null;row.encoded_body_bytes=resource.encodedBodySize>0?resource.encodedBodySize:null;}}catch{}
    loadTimings.push(Object.freeze(row));if(loadTimings.length>128)loadTimings.shift();
    if(state==='ready'){completedLoads++;loadingTotalMs+=row.elapsed_ms;}else if(state==='cancelled')cancelledLoads++;else failedLoads++;
  }
  const limits = Object.freeze({ sceneMaxBytes, sceneMaxEntries, unusedMaxBytes, unusedMaxEntries, maxConcurrentTasks });
  const ownImage = image => imageOwners.set(image, (imageOwners.get(image) ?? 0) + 1);
  const dropImage = image => { const remaining = (imageOwners.get(image) ?? 1) - 1; if (remaining) imageOwners.set(image, remaining); else { imageOwners.delete(image); closeDecodedImage(image); closedImages++; } };
  let foregroundBypasses = 0;
  function endVisibleWait(entry) {
    if (entry.visibleWaitSince === null) return;
    entry.longestVisibleWait = Math.max(entry.longestVisibleWait ?? 0, imageClock() - entry.visibleWaitSince);
    entry.visibleWaitSince = null;
  }
  function leaveQueue(entry) {
    if (!entry) return; // Header preflights do not have image leases.
    entry.awaitingSlot = false;
    endVisibleWait(entry);
  }
  function pump() {
    while (running < maxConcurrentTasks && queue.length) {
      // A renderer can acquire a lease after a group already queued the same image.
      // Read the live lease count so releasing that renderer also withdraws its priority.
      const front = foregroundBypasses < maxConcurrentTasks
        ? queue.findIndex(task => task.entry?.visibleLeases > 0) : -1;
      const task = front > 0 ? queue.splice(front, 1)[0] : queue.shift();
      leaveQueue(task.entry);
      // After one wave of bypasses, give the oldest queued task a turn.
      foregroundBypasses = front > 0 ? foregroundBypasses + 1 : 0;
      if (task.signal.aborted) { task.cleanup(); continue; } running++;
      Promise.resolve().then(task.work).then(task.resolve, task.reject).finally(() => { running--; task.cleanup(); pump(); });
    }
  }
  function schedule(work, signal, entry = null) {
    return new Promise((resolve, reject) => {
      const abort = () => { const queued = queue.indexOf(task); if (queued >= 0) { queue.splice(queued, 1); leaveQueue(entry); task.cleanup(); } reject(abortImageError()); pump(); };
      const task = { work: () => { if (signal.aborted) throw abortImageError(); return work(); }, signal, entry, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) };
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
    reservation??=authoredDimensions(id);
    const asset = specFor(id); let entry = entries.get(id);
    if (entry) {
      if (reservation) {
        if ((entry.reservation && (entry.reservation.width !== reservation.width || entry.reservation.height !== reservation.height)) || (entry.state === 'ready' && (imageDimensions(entry.image).width !== reservation.width || imageDimensions(entry.image).height !== reservation.height))) throw imageError('IMAGE_ASSET_DIMENSIONS_CHANGED', id);
        entry.reservation = reservation;
      }
      reuses++; return entry;
    }
    entry = { id, asset, state: 'loading', image: null, error: null, bytes: 0, external: 0, scene: 0, visibleLeases: 0,
      awaitingSlot: true, visibleWaitSince: null, longestVisibleWait: null,
      stamp: ++stamp, retired: false, controller: new AbortController(), reservation,queuedAt:imageClock(),startedAt:null,url:null,imageTiming:null };
    entries.set(id, entry); loads++;
    entry.promise = schedule(async () => {
      entry.startedAt=imageClock();const url = await resolveAssetUrl(asset);entry.url=String(url); if (entry.controller.signal.aborted) throw abortImageError();
      const image = await loadImage(url, { signal: entry.controller.signal, asset,onTiming:value=>{entry.imageTiming=value;} });
      if (!image || typeof image !== 'object') throw imageError('IMAGE_ASSET_INVALID', id);
      ownImage(image);
      if (disposed || entry.retired || entry.controller.signal.aborted || entries.get(id) !== entry) { dropImage(image); throw abortImageError(); }
      let dimensions; try { dimensions = imageDimensions(image); } catch (error) { dropImage(image); throw error; }
      if (entry.reservation && (dimensions.width !== entry.reservation.width || dimensions.height !== entry.reservation.height)) { dropImage(image); throw imageError('IMAGE_ASSET_DIMENSIONS_CHANGED', id); }
      entry.image = image; entry.bytes = dimensions.bytes; entry.state = 'ready'; entry.stamp = ++stamp;recordLoad(entry,'ready'); sweep(); return image;
    }, entry.controller.signal, entry).catch(error => { if (!entry.image) { entry.state = 'error'; entry.error = error; }recordLoad(entry,error?.name==='AbortError'?'cancelled':'error',error); throw error; });
    // Consumers own rejection handling; unused/released async work must never
    // manufacture an unhandled rejection during teardown.
    entry.promise.catch(() => {}); return entry;
  }
  function leaseFor(id, role = 'external', reservation = null, visible = false) {
    const entry = entryFor(id, reservation); entry[role]++; entry.stamp = ++stamp; let released = false;
    if (visible) {
      if (entry.awaitingSlot && entry.visibleLeases === 0) entry.visibleWaitSince = imageClock();
      entry.visibleLeases++;
    }
    const releasedError = imageError('IMAGE_ASSET_LEASE_RELEASED', id);
    return Object.freeze({
      get state() { return released ? 'error' : entry.state; }, get image() { return !released && entry.state === 'ready' ? entry.image : null; },
      get error() { return released ? releasedError : entry.error; }, promise: entry.promise,
      release() {
        if (released) return;
        released = true; entry[role]--;
        if (visible && --entry.visibleLeases === 0) endVisibleWait(entry);
        entry.stamp = ++stamp; sweep();
      },
    });
  }
  function freezePreparation(value) { for (const key of ['unsupported','budget_skipped','errors']) { value[key].forEach(Object.freeze); Object.freeze(value[key]); } return Object.freeze(value); }
  // onProgress({done,total}) counts the work entries: half an entry for its inspection, half for its
  // decode, a whole one when inspection rejects it. A startup screen reads it; it never fails preparation.
  async function prepareScene(scene, { onProgress = null } = {}) {
    if (disposed) throw imageError('IMAGE_ASSET_BROKER_DISPOSED');
    planController?.abort(); const controller = new AbortController(); planController = controller; const epoch = ++planEpoch;
    // Scene sprites and image particles (emitter texture) are admitted before READY.
    const entities = scene?.entities ?? [], particleIds = Object.values(scene?.particle_effects ?? {}).flatMap(effect => (effect?.emitters ?? []).flatMap(emitter => typeof emitter?.texture === 'string' && emitter.texture ? [emitter.texture] : []));
    const sceneIds = [...(Array.isArray(entities) ? entities : Object.values(entities)).flatMap(entity => typeof entity?.sprite?.asset === 'string' ? [entity.sprite.asset] : []), ...particleIds];
    const startupIds = plan ? plan.startup.flatMap(name => plan.groups[name]) : [], requiredIds = new Set(startupIds), ids = [...new Set([...startupIds, ...sceneIds])];
    const previous = sceneLeases, next = new Map(); sceneLeases = next;
    for (const [id, lease] of previous) { if (ids.includes(id)) next.set(id, lease); else lease.release(); }
    const result = { declared_entries: ids.length, scene_declared_entries: new Set(sceneIds).size, startup_entries: requiredIds.size, required_entries: requiredIds.size, required_ready_entries: 0, startup_groups: plan?.startup ?? Object.freeze([]), duplicate_references: startupIds.length + sceneIds.length - ids.length, admitted_entries: 0, ready_entries: 0, reserved_bytes: 0, partial: false, unsupported: [], budget_skipped: [], errors: [], cancelled: false };
    const candidates = ids.slice(0, sceneMaxEntries), inspected = new Array(candidates.length); let position = 0, inspectedCount = 0, settledCount = 0, rejectedCount = 0;
    const progress = () => { if (onProgress && candidates.length) try { onProgress({ done: (inspectedCount + settledCount + rejectedCount) / 2, total: candidates.length }); } catch {} };
    for (const id of ids.slice(sceneMaxEntries)) result.budget_skipped.push({ id, reason: 'scene_entry_budget' });
    const worker = async work => { while (!controller.signal.aborted && position < candidates.length) { const index = position++; await work(candidates[index], index); } };
    const inspect = async (id, index) => {
      try { const asset = specFor(id), known = entries.get(id); const metadata = known?.reservation ?? authoredDimensions(id) ?? await schedule(async () => rasterInspector(await resolveAssetUrl(asset), { signal: controller.signal, asset }), controller.signal);
        // Any raster whose size is known is admitted before READY; the decoder still has to produce exactly that size.
        if (!metadata || !['png','jpeg','webp'].includes(metadata.format)) { inspected[index] = { id, unsupported: true }; return; }
        const dimensions = imageDimensions(metadata); inspected[index] = { id, ...dimensions, format: metadata.format };
      } catch (error) { inspected[index] = { id, error }; }
      inspectedCount++; progress();
    };
    await Promise.all(Array.from({ length: maxConcurrentTasks }, () => worker(inspect)));
    if (controller.signal.aborted || epoch !== planEpoch || disposed) { result.cancelled = result.partial = true; return freezePreparation(result); }
    const selected = [];
    for (const item of inspected) {
      if (item.error) { result.errors.push({ id: item.id, message: String(item.error.message ?? item.error) }); continue; }
      if (item.unsupported) { result.unsupported.push({ id: item.id, reason: 'unknown_bounded_dimensions_or_non_png' }); continue; }
      if (result.reserved_bytes + item.bytes > sceneMaxBytes) { result.budget_skipped.push({ id: item.id, reason: 'scene_byte_budget' }); continue; }
      selected.push(item); result.reserved_bytes += item.bytes;
    }
    const selectedIds = new Set(selected.map(item => item.id)); for (const [id, lease] of next) if (!selectedIds.has(id)) { next.delete(id); lease.release(); }
    result.admitted_entries = selected.length; position = 0; rejectedCount = candidates.length - selected.length; progress();
    const decode = async () => { while (!controller.signal.aborted && position < selected.length) { const item = selected[position++]; let lease;
      try { lease = next.get(item.id); if (!lease) { lease = leaseFor(item.id, 'scene', item); next.set(item.id, lease); } await lease.promise; if (lease.state === 'ready') { result.ready_entries++; if (requiredIds.has(item.id)) result.required_ready_entries++; } else throw lease.error;
      } catch (error) {
        result.errors.push({ id: item.id, message: String(error?.message ?? error) });
        // A speculative failure must not poison the later required load. A
        // superseded plan must also never release a lease transferred to its successor.
        if (lease && epoch === planEpoch && sceneLeases === next && next.get(item.id) === lease) { next.delete(item.id); lease.release(); }
      }
      settledCount++; progress();
    } };
    await Promise.all(Array.from({ length: maxConcurrentTasks }, () => decode()));
    result.cancelled = controller.signal.aborted || epoch !== planEpoch || disposed;
    if (!result.cancelled) { result.admitted_entries = next.size; result.reserved_bytes = selected.reduce((bytes, item) => bytes + (next.has(item.id) ? item.bytes : 0), 0); }
    result.partial = result.cancelled || result.ready_entries !== result.declared_entries;
    if (!result.cancelled) preparation = freezePreparation(result); else freezePreparation(result);
    return result;
  }
  const metadataInspector = createImageMetadataInspector({specFor, entries, dimensions:plan?.dimensions,resolveAssetUrl, inspectImage:rasterInspector, schedule,
    maxEntries: Math.max(1, sceneMaxEntries, unusedMaxEntries)});
  const groups=createImageAssetGroups({catalog,plan,inspect:metadataInspector.inspect,acquire:leaseFor,isReady:id=>entries.get(id)?.state==='ready',evict:ids=>{for(const id of ids){const entry=entries.get(id);if(entry&&!entry.external&&!entry.scene)forget(entry);}}});
  return Object.freeze({
    acquire: id => leaseFor(id, 'external', null, true), prepareScene, inspect: metadataInspector.inspect,
    groups,
    report({includeTimings=false}={}) {
      let residentBytes = 0, activeBytes = 0, sceneBytes = 0, unusedBytes = 0, activeEntries = 0, sceneEntries = 0, unusedEntries = 0, loading = 0;
      for (const entry of entries.values()) { residentBytes += entry.bytes; if (entry.state === 'loading') loading++; if (entry.external) { activeEntries++; activeBytes += entry.bytes; } if (entry.scene) { sceneEntries++; sceneBytes += entry.bytes; } if (!entry.external && !entry.scene) { unusedEntries++; unusedBytes += entry.bytes; } }
      return { catalog_generation: catalog.generation, disposed, limits, preload_plan: planSummary,groups:groups.snapshot(),loading_metrics:{visible_queue_supported:true,completed:completedLoads,failed:failedLoads,cancelled:cancelledLoads,total_elapsed_ms:loadingTotalMs,recent_capacity:128,...(includeTimings?{recent:loadTimings.slice()}:{}),scope:'Queue and image readiness wall time; load_event includes browser fetch/event wait. Resource Timing values are nullable, zero transfer is ambiguous. Decode duration only when supplied by the default HTML image loader.'}, resident_entries: entries.size, resident_bytes_estimate: residentBytes, active_entries: activeEntries, active_bytes_estimate: activeBytes, scene_entries: sceneEntries, scene_bytes_estimate: sceneBytes, unused_entries: unusedEntries, unused_bytes_estimate: unusedBytes, loading, active_tasks: running, queued_tasks: queue.length, loads, reuses, evictions, closed_images: closedImages, released_bytes_estimate: releasedBytes, pressure_bytes: Math.max(0, residentBytes - sceneMaxBytes - unusedMaxBytes), pressure_entries: Math.max(0, entries.size - sceneMaxEntries - unusedMaxEntries), preparation, scope: 'Decoded image RGBA estimate; scene, active and group sets may overlap. GPU textures, encoded bytes, browser copies and render targets are separate. Active leases are never evicted. closed_images counts logical final image-ownership retirement; released_bytes_estimate is retired decoded payload, not native-memory reclamation.' };
    },
    dispose() { if (disposed) return; disposed = true;groups.dispose(); metadataInspector.dispose(); planEpoch++; planController?.abort(); for (const lease of sceneLeases.values()) lease.release(); sceneLeases.clear(); for (const entry of entries.values()) if (entry.state === 'loading') entry.controller.abort(); sweep(); },
  });
}

// Runtime image groups are presentation leases, not game rules or a second
// decoder/cache. Membership is authorized only by the validated image plan.
function createImageAssetGroups({catalog,plan,inspect,acquire,isReady,evict}) {
  const specs=plan?.groups??Object.freeze({}),records=new Map(),reservations=new Map();let disposed=false,epoch=0,admission=Promise.resolve(),heldBytes=0;
  const streamable = new Set(plan?.streamable), retiredStreams = new Set();
  const groupIds = new Map(Object.entries(specs).map(([name, ids]) => [name, [...new Set(ids)]]));
  const budget=Object.freeze({max_bytes:plan?.budget.max_bytes??64*1024*1024,max_entries:plan?.budget.max_entries??128});
  function nameOf(name){if(!groupIds.has(name)&&!streamable.has(name))throw imageError('IMAGE_ASSET_GROUP_MISSING',String(name));return name;}
  function row(name){const r=records.get(name);return Object.freeze({name,catalog_generation:catalog.generation,state:r?.state??(retiredStreams.has(name)?'unloaded':'idle'),mode:r?.mode??null,total:groupIds.get(name)?.length??1,ready:r?.ready??0,held:r?.leases.size??0,reserved_bytes_estimate:r?.reservedBytes??0,cache_hits:r?.cacheHits??0,cancelled:r?.cancelled??false,elapsed_ms:r?Math.max(0,(r.completedAt??imageClock())-r.startedAt):0,error:r?.error??null});}
  function release(r){
    const ids=[...r.leases.keys()];for(const lease of r.leases.values())lease.release();r.leases.clear();
    for(const id of r.reservedIds){const value=reservations.get(id);if(!value)continue;value.owners.delete(r);if(!value.owners.size){heldBytes-=value.bytes;reservations.delete(id);}}
    r.reservedIds=[];r.reservedBytes=0;evict(ids);
  }
  function retain(r,id,metadata){
    const hit=isReady(id);
    const lease=acquire(id,'external',metadata);
    let reservation=reservations.get(id);
    if(!reservation){
      reservation={bytes:metadata.bytes,owners:new Set()};
      reservations.set(id,reservation);heldBytes+=reservation.bytes;
    }
    reservation.owners.add(r);r.reservedIds.push(id);r.reservedBytes+=reservation.bytes;
    r.leases.set(id,lease);
    if(hit)r.cacheHits++;
  }
  function request(name,mode){
    nameOf(name);if(disposed)throw imageError('IMAGE_ASSET_BROKER_DISPOSED');
    const current=records.get(name);
    if(current&&(current.state==='loading'||current.state==='ready')){if(mode==='load')current.mode='load';return current.state==='ready'?Promise.resolve(row(name)):current.promise;}
    const r={name,epoch:++epoch,mode,state:'loading',ready:0,leases:new Map(),reservedIds:[],reservedBytes:0,cacheHits:0,cancelled:false,error:null,startedAt:imageClock(),completedAt:null,controller:new AbortController(),promise:null};records.set(name,r);
    const live=()=>!disposed&&!r.controller.signal.aborted&&records.get(name)===r;
    r.promise=(async()=>{
      try{
        const ids=groupIds.get(name)??[name];
        if(ids.length>budget.max_entries)throw imageError('IMAGE_ASSET_GROUP_BUDGET',name);
        // Another selector already admitted these exact pixels. Take its shared
        // reservation before yielding so a same-tick handoff cannot evict them.
        for(const id of ids)if(reservations.has(id))retain(r,id,null);
        const metadata=await Promise.all(ids.map(id=>inspect(id,{signal:r.controller.signal})));
        const reserve=admission.then(()=>{
          if(!live())throw abortImageError();
          let bytes=0,count=0;for(let i=0;i<ids.length;i++)if(!reservations.has(ids[i])){bytes+=metadata[i].bytes;count++;}
          if(heldBytes+bytes>budget.max_bytes||reservations.size+count>budget.max_entries)throw imageError('IMAGE_ASSET_GROUP_BUDGET',name);
          for(let i=0;i<ids.length;i++)if(!r.leases.has(ids[i]))retain(r,ids[i],metadata[i]);
        });admission=reserve.catch(()=>{});await reserve;
        await Promise.all([...r.leases.values()].map(lease=>lease.promise.then(()=>{if(live()&&lease.state==='ready')r.ready++;})));
        if(!live())throw abortImageError();r.state='ready';r.completedAt=imageClock();return row(name);
      }catch(error){
        if(records.get(name)===r){r.cancelled=r.controller.signal.aborted||disposed||error?.name==='AbortError';r.state=r.cancelled?'unloaded':'error';r.error=r.cancelled?null:String(error?.message??error).slice(0,256);r.completedAt=imageClock();r.controller.abort();release(r);}
        throw error;
      }
    })();r.promise.catch(()=>{});return r.promise;
  }
  function unload(name){
    nameOf(name);
    const r=records.get(name);
    if(r&&(r.state==='loading'||r.state==='ready'||r.state==='error')){
      r.cancelled=r.state==='loading';r.state='unloaded';r.completedAt=imageClock();r.controller.abort();release(r);
      if(streamable.has(name)){retiredStreams.add(name);records.delete(name);}
    }
    return row(name);
  }
  // Each client owns an idempotent claim; all claims for one name share the physical request.
  const pageOwner=Symbol('page'),owners=new Map();
  function strongestMode(claims){for(const claim of claims.values())if(claim.mode==='load')return 'load';return 'preload';}
  function hold(name,mode,owner=pageOwner) {
    nameOf(name);if(disposed)throw imageError('IMAGE_ASSET_BROKER_DISPOSED');
    let claims=owners.get(name);if(!claims){claims=new Map();owners.set(name,claims);}
    let claim=claims.get(owner);
    if(!claim){claim={mode,request:null,promise:null,cancel:null};claims.set(owner,claim);}
    if(mode==='load')claim.mode='load';
    const pending=request(name,strongestMode(claims));
    if(records.get(name).state!=='loading')return pending;
    if(claim.request===pending)return claim.promise;
    claim.request=pending;
    claim.promise=new Promise((resolve,reject)=>{
      claim.cancel=()=>reject(abortImageError());
      pending.then(resolve,reject);
    });
    claim.promise.catch(()=>{});
    return claim.promise;
  }
  function drop(name,owner=pageOwner) {
    nameOf(name);
    const claims=owners.get(name),claim=claims?.get(owner);
    if(!claim)return row(name);
    claim.cancel?.();claims.delete(owner);
    if(!claims.size){owners.delete(name);return unload(name);}
    records.get(name).mode=strongestMode(claims);
    return row(name);
  }
  const forOwner=owner=>Object.freeze({preload:name=>hold(name,'preload',owner),load:name=>hold(name,'load',owner),unload:name=>drop(name,owner)});
  const api={...forOwner(pageOwner),forOwner,status:name=>{nameOf(name);return row(name);},snapshot(){return Object.freeze({version:1,available:!!plan,catalog_generation:catalog.generation,disposed,budget,held_entries:reservations.size,held_bytes_estimate:heldBytes,groups:Object.freeze([...groupIds.keys()].map(row)),streamable_count:streamable.size,streams:Object.freeze([...records.keys()].filter(id=>streamable.has(id)).map(row)),scope:'Group-owned decoded RGBA estimates only; overlapping groups share one reservation and broker image. Scene/renderer owners can retain additional or overlapping pixels. Unload never closes another active owner; browser/OS and GPU reclamation are not measured.'});},dispose(){if(disposed)return;disposed=true;for(const claims of owners.values())for(const claim of claims.values())claim.cancel?.();owners.clear();for(const name of records.keys())unload(name);}};
  return Object.freeze(api);
}

export function installPlayerAssetGroups(target,getBroker){
  if(!target||typeof getBroker!=='function')throw imageError('IMAGE_ASSET_GROUP_HOST_INVALID');
  if('unonePlayerAssets'in target)return ()=>{};
  const manager=()=>{const value=getBroker()?.groups;if(!value)throw imageError('IMAGE_ASSET_GROUPS_NOT_READY');return value;};
  const api=Object.freeze({preload:name=>{try{return manager().preload(name);}catch(error){return Promise.reject(error);}},load:name=>{try{return manager().load(name);}catch(error){return Promise.reject(error);}},unload:name=>manager().unload(name),status:name=>name===undefined?api.snapshot():manager().status(name),snapshot:(options={})=>{if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='includeTimings')||('includeTimings'in options&&typeof options.includeTimings!=='boolean'))throw imageError('IMAGE_ASSET_GROUP_OPTIONS_INVALID');const broker=getBroker();if(!broker)return Object.freeze({version:1,available:false,groups:Object.freeze([])});const report=broker.report(options);const loading=Object.freeze({...report.loading_metrics,...(report.loading_metrics.recent?{recent:Object.freeze(report.loading_metrics.recent)}:{})});return Object.freeze({...report.groups,loading,broker:Object.freeze({resident_entries:report.resident_entries,resident_bytes_estimate:report.resident_bytes_estimate,loading:report.loading,active_tasks:report.active_tasks,queued_tasks:report.queued_tasks,loads:report.loads,reuses:report.reuses,evictions:report.evictions})});}});
  Object.defineProperty(target,'unonePlayerAssets',{value:api,configurable:true});return ()=>{if(target.unonePlayerAssets===api)delete target.unonePlayerAssets;};
}

// Metadata has no pixel lease. Each caller owns only its cancellation; one
// cancelled prefetch must not abort inspection still needed by another owner.
function createImageMetadataInspector({specFor, entries, dimensions,resolveAssetUrl, inspectImage, schedule, maxEntries}) {
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
    if(dimensions&&Object.hasOwn(dimensions,id))return Promise.resolve(Object.freeze({...dimensions[id],...imageDimensions(dimensions[id])}));
    const image = entries.get(id);
    if (image?.state === 'ready') return Promise.resolve(Object.freeze({format: asset.encoding?.format ?? 'decoded', ...imageDimensions(image.image)}));
    if (image?.reservation) return Promise.resolve(Object.freeze({format: image.reservation.format ?? 'png', ...imageDimensions(image.reservation)}));
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
