const DB_VERSION = 1;
const DB_NAME = "unone-live-bundles";
const MAX_SAFE_BUNDLE_SIZE = Number.MAX_SAFE_INTEGER;
// The current Web C ABI exposes one verifier state per Wasm module. Asset
// elements can resolve concurrently, so keep begin/write/finish transactions
// serialized at the host boundary.
let verifierTail = Promise.resolve();

function withVerifier(operation) {
  const result = verifierTail.then(operation, operation);
  verifierTail = result.catch(() => {});
  return result;
}

function engineError(code, summary, explanation, facts = {}) {
  const error = new Error(`${code}: ${summary}`);
  error.diagnostic = { code, summary, explanation, facts };
  return error;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("bundles")) database.createObjectStore("bundles", { keyPath: "sha256" });
      if (!database.objectStoreNames.contains("generations")) database.createObjectStore("generations", { keyPath: "generation" });
      if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function normalizeManifest(manifest) {
  if (!manifest || !Number.isInteger(manifest.version) || manifest.version < 0 || manifest.version > 0xffffffff || !Array.isArray(manifest.bundles)) {
    throw engineError("BUNDLE_MANIFEST_INVALID", "bundle manifest is invalid", "Expected integer version and bundles array.");
  }
  if (manifest.bundles.length === 0) {
    throw engineError("BUNDLE_MANIFEST_EMPTY", "bundle manifest is empty", "Bundle activation requires at least one bundle.");
  }
  const ids = new Set();
  const bundles = manifest.bundles.map((spec) => {
    if (!spec || typeof spec.id !== "string" || spec.id.trim() === "") {
      throw engineError("BUNDLE_MANIFEST_INVALID", "bundle id is missing or empty", "Every bundle must have a non-empty id.");
    }
    if (ids.has(spec.id)) {
      throw engineError("BUNDLE_MANIFEST_DUPLICATE_ID", "bundle id is duplicated", "Every bundle must have a unique id.", { bundle_id: spec.id });
    }
    if (typeof spec.version !== "string" || typeof spec.source !== "string" || spec.source.trim() === "") {
      throw engineError("BUNDLE_MANIFEST_INVALID", `bundle '${spec.id}' declaration is invalid`, "version and source must be non-empty strings.");
    }
    if (!Number.isSafeInteger(spec.size_bytes) || spec.size_bytes < 0 || spec.size_bytes > MAX_SAFE_BUNDLE_SIZE || !/^[0-9a-f]{64}$/.test(spec.sha256)) {
      throw engineError("BUNDLE_MANIFEST_INVALID", `bundle '${spec.id}' integrity fields are invalid`, "size_bytes must be a safe non-negative integer and sha256 must be lowercase SHA-256.");
    }
    if (spec.dependencies !== undefined && (!Array.isArray(spec.dependencies) || spec.dependencies.some((dependency) => typeof dependency !== "string" || dependency.trim() === ""))) {
      throw engineError("BUNDLE_MANIFEST_INVALID", `bundle '${spec.id}' dependencies are invalid`, "dependencies must be an array of non-empty bundle ids.");
    }
    ids.add(spec.id);
    return { ...spec, dependencies: spec.dependencies ?? [] };
  });
  return { version: manifest.version, bundles };
}

function dependencyOrder(manifest) {
  const specs = new Map(manifest.bundles.map((spec) => [spec.id, spec]));
  const visiting = new Set();
  const visited = new Set();
  const result = [];
  const visit = (id) => {
    if (visited.has(id)) return;
    const spec = specs.get(id);
    if (!spec) throw engineError("BUNDLE_DEPENDENCY_NOT_FOUND", `bundle '${id}' does not exist`, "The manifest references a missing dependency.");
    if (visiting.has(id)) throw engineError("BUNDLE_DEPENDENCY_CYCLE", `bundle '${id}' has a dependency cycle`, "Bundle activation requires an acyclic dependency graph.");
    visiting.add(id);
    for (const dependency of spec.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    result.push(spec);
  };
  for (const spec of manifest.bundles) visit(spec.id);
  return result;
}

function moduleJson(module) {
  const pointer = module._unone_web_observation_ptr();
  const length = module._unone_web_observation_len();
  const bytes = module.HEAPU8.slice(pointer, pointer + length);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function feedChunk(module, chunk, bundleId = null) {
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  const pointer = module._unone_web_alloc(bytes.byteLength);
  if (bytes.byteLength > 0) module.HEAPU8.set(bytes, pointer);
  if (module._unone_web_bundle_write(pointer, bytes.byteLength) !== 0) {
    const result = moduleJson(module);
    throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle chunk verification failed", result.diagnostic?.explanation ?? result.error ?? "The engine rejected a bundle chunk.", { ...(result.diagnostic?.facts ?? result), bundle_id: bundleId });
  }
}

async function verifyBlob(module, spec, blob) {
  return withVerifier(async () => {
    const specBytes = new TextEncoder().encode(JSON.stringify(spec));
    const specPointer = module._unone_web_alloc(specBytes.byteLength);
    module.HEAPU8.set(specBytes, specPointer);
    if (module._unone_web_bundle_begin(specPointer, specBytes.byteLength) !== 0) {
      const result = moduleJson(module);
      throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle verifier could not start", result.diagnostic?.explanation ?? result.error ?? JSON.stringify(result), result.diagnostic?.facts ?? result);
    }
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        feedChunk(module, value, spec.id);
      }
    } finally {
      reader.releaseLock();
    }
    if (module._unone_web_bundle_finish() !== 0) {
      const result = moduleJson(module);
      throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle verification failed", result.diagnostic?.explanation ?? "The engine rejected the bundle.", result.diagnostic?.facts ?? {});
    }
    return moduleJson(module).value;
  });
}

async function getBundleRecord(database, sha256) {
  const transaction = database.transaction("bundles", "readonly");
  return requestResult(transaction.objectStore("bundles").get(sha256));
}

async function getActiveGeneration(database) {
  const transaction = database.transaction("meta", "readonly");
  const pointer = await requestResult(transaction.objectStore("meta").get("activeGeneration"));
  if (!pointer) return null;
  const generationTransaction = database.transaction("generations", "readonly");
  return requestResult(generationTransaction.objectStore("generations").get(pointer.generation));
}

function sameBundles(left, right) {
  const leftEntries = Object.entries(left ?? {}).sort();
  const rightEntries = Object.entries(right ?? {}).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

async function fetchBlobAndVerify(module, spec, fetchImpl) {
  const response = await fetchImpl(spec.source, { cache: "no-store" });
  if (!response.ok) throw engineError("BUNDLE_FETCH_FAILED", `bundle '${spec.id}' request failed`, `HTTP ${response.status} for ${spec.source}.`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const blob = new Blob([bytes]);
    await verifyBlob(module, spec, blob);
    return blob;
  }
  return withVerifier(async () => {
    const reader = response.body.getReader();
    const chunks = [];
    const specBytes = new TextEncoder().encode(JSON.stringify(spec));
    const specPointer = module._unone_web_alloc(specBytes.byteLength);
    module.HEAPU8.set(specBytes, specPointer);
    if (module._unone_web_bundle_begin(specPointer, specBytes.byteLength) !== 0) {
      const result = moduleJson(module);
      throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle verifier could not start", result.diagnostic?.explanation ?? result.error ?? JSON.stringify(result), result.diagnostic?.facts ?? result);
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        feedChunk(module, value, spec.id);
      }
    } finally {
      reader.releaseLock();
    }
    if (module._unone_web_bundle_finish() !== 0) {
      const result = moduleJson(module);
      throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle verification failed", result.diagnostic?.explanation ?? "The engine rejected the bundle.", result.diagnostic?.facts ?? {});
    }
    return new Blob(chunks);
  });
}

/**
 * Install all manifest bundles in dependency order and atomically activate a
 * new generation. Network policy belongs to fetchImpl; this module only owns
 * browser persistence and delegates integrity to the Rust/Wasm engine.
 */
export async function installGeneration(manifestInput, { module, fetchImpl = fetch, databaseName = DB_NAME } = {}) {
  const manifest = normalizeManifest(manifestInput);
  const database = await openDatabase(databaseName);
  const previous = await getActiveGeneration(database);
  const order = dependencyOrder(manifest);
  const bundles = Object.fromEntries(order.map((spec) => [spec.id, spec.sha256]));
  if (previous && previous.manifest_version === manifest.version && sameBundles(previous.bundles, bundles)) {
    return { status: "already_active", generation: previous.generation, manifest_version: manifest.version, bundles, database };
  }

  const staged = [];
  for (const spec of order) {
    let blob = null;
    const cached = await getBundleRecord(database, spec.sha256);
    if (cached && cached.size_bytes === spec.size_bytes) {
      try {
        await verifyBlob(module, spec, cached.bytes);
        blob = cached.bytes;
      } catch (_error) {
        blob = null;
      }
    }
    if (!blob) blob = await fetchBlobAndVerify(module, spec, fetchImpl);
    staged.push({ sha256: spec.sha256, size_bytes: spec.size_bytes, bytes: blob });
  }

  const generation = (previous?.generation ?? 0) + 1;
  const record = {
    generation,
    manifest_version: manifest.version,
    bundles,
    activated_at: new Date().toISOString(),
  };
  const transaction = database.transaction(["bundles", "generations", "meta"], "readwrite");
  for (const item of staged) transaction.objectStore("bundles").put(item);
  transaction.objectStore("generations").put(record);
  transaction.objectStore("meta").put({ key: "activeGeneration", generation });
  await transactionDone(transaction);
  return { status: "activated", generation, manifest_version: manifest.version, bundles, database };
}

export async function readActiveBundle(generationState, bundleId, module, manifestInput) {
  const manifest = normalizeManifest(manifestInput);
  const spec = manifest.bundles.find((candidate) => candidate.id === bundleId);
  if (!spec) throw engineError("BUNDLE_NOT_FOUND", `bundle '${bundleId}' does not exist`, "The requested bundle is not in the manifest.");
  const hash = generationState.bundles?.[bundleId];
  if (hash !== spec.sha256) throw engineError("BUNDLE_GENERATION_MISMATCH", `bundle '${bundleId}' is not active`, "The active generation does not match the requested manifest.");
  const database = generationState.database ?? await openDatabase();
  const record = await getBundleRecord(database, hash);
  if (!record) throw engineError("BUNDLE_CACHE_MISS", `bundle '${bundleId}' is not cached`, "Activate the generation before reading its content.");
  await verifyBlob(module, spec, record.bytes);
  return record.bytes;
}

export async function readActiveText(generationState, bundleId, module, manifestInput) {
  const blob = await readActiveBundle(generationState, bundleId, module, manifestInput);
  return new TextDecoder().decode(await blob.arrayBuffer());
}

const ASSET_ARCHIVE_MAGIC = new TextEncoder().encode("UNONE-BUNDLE-1\n");

/**
 * Read one file from an engine-produced uncompressed asset bundle. The
 * archive is deliberately a host/content boundary: Rust writes deterministic
 * bytes and verifies the outer bundle hash; the Web host resolves a file to a
 * Blob URL and owns its lifetime.
 */
export async function readActiveAsset(generationState, asset, module, manifestInput) {
  if (!asset || typeof asset.bundle !== "string" || typeof asset.source !== "string") {
    throw engineError("ASSET_SPEC_INVALID", "asset spec is incomplete", "An asset needs source and bundle before a host can resolve it.");
  }
  const bundle = await readActiveBundle(generationState, asset.bundle, module, manifestInput);
  const bytes = new Uint8Array(await bundle.arrayBuffer());
  const headerLengthOffset = ASSET_ARCHIVE_MAGIC.byteLength;
  const headerOffset = headerLengthOffset + 4;
  const matchesMagic = ASSET_ARCHIVE_MAGIC.every((value, index) => bytes[index] === value);
  if (!matchesMagic || bytes.byteLength < headerOffset) {
    throw engineError("ASSET_ARCHIVE_INVALID", `asset bundle '${asset.bundle}' is invalid`, "The active bundle is not an engine asset archive.");
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(headerLengthOffset, true);
  const payloadOffset = headerOffset + headerLength;
  if (payloadOffset > bytes.byteLength) {
    throw engineError("ASSET_ARCHIVE_INVALID", `asset bundle '${asset.bundle}' has an invalid header`, "The archive header extends beyond the verified bundle bytes.");
  }
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.slice(headerOffset, payloadOffset)));
  } catch (error) {
    throw engineError("ASSET_ARCHIVE_INVALID", `asset bundle '${asset.bundle}' has invalid metadata`, `The archive header is not valid JSON: ${error.message}.`);
  }
  if (header?.version !== 1 || !Array.isArray(header.files)) {
    throw engineError("ASSET_ARCHIVE_INVALID", `asset bundle '${asset.bundle}' has an unsupported version`, "Only asset archive version 1 is supported by this host.");
  }
  const source = asset.source.replaceAll("\\", "/");
  const entry = header.files.find((candidate) => candidate?.path === source);
  if (!entry || !Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.size_bytes) || entry.offset < 0 || entry.size_bytes < 0) {
    throw engineError("ASSET_NOT_IN_BUNDLE", `asset '${asset.id}' is not in bundle '${asset.bundle}'`, "The asset manifest source does not match an entry in the active archive.", { asset_id: asset.id, source, bundle: asset.bundle });
  }
  const start = payloadOffset + entry.offset;
  const end = start + entry.size_bytes;
  if (end > bytes.byteLength) {
    throw engineError("ASSET_ARCHIVE_INVALID", `asset '${asset.id}' has an out-of-range entry`, "The archive metadata points outside the verified bundle bytes.");
  }
  const content = bytes.slice(start, end);
  await verifyArchiveEntry(asset, entry, content);
  return content;
}

/**
 * Verify one archive entry against its declared digest. This mirrors the Rust
 * host reader in `unone_engine::read_asset_from_archive`, so the same asset id
 * either resolves to identical bytes on both hosts or fails with the same code.
 */
async function verifyArchiveEntry(asset, entry, content) {
  if (typeof entry.sha256 !== "string" || entry.sha256.length !== 64) {
    throw engineError("ASSET_ARCHIVE_INVALID", `asset '${asset.id}' has no entry digest`, "Archive version 1 declares a sha256 for every file.");
  }
  if (!globalThis.crypto?.subtle) {
    throw engineError("ASSET_CONTENT_UNVERIFIABLE", "this host cannot verify asset content", "Web Crypto is unavailable, so the archive entry digest cannot be checked. Serve the host from a secure context such as localhost or https.");
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", content));
  const actual = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
  if (actual !== entry.sha256) {
    throw engineError("ASSET_CONTENT_CORRUPT", `asset '${asset.id}' content does not match the archive digest`, "The host must not use bytes the engine cannot verify.", { asset_id: asset.id, bundle: asset.bundle, expected_sha256: entry.sha256, actual_sha256: actual });
  }
}
