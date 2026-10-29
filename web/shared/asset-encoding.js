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
