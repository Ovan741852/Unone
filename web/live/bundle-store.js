const DB_VERSION = 1;
const DB_NAME = "unone-live-bundles";

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
  if (!manifest || !Number.isInteger(manifest.version) || !Array.isArray(manifest.bundles)) {
    throw engineError("BUNDLE_MANIFEST_INVALID", "bundle manifest is invalid", "Expected integer version and bundles array.");
  }
  const ids = new Set();
  const bundles = manifest.bundles.map((spec) => {
    if (!spec || typeof spec.id !== "string" || ids.has(spec.id)) {
      throw engineError("BUNDLE_MANIFEST_INVALID", "bundle id is missing or duplicated", "Every bundle must have a unique id.");
    }
    if (!Number.isSafeInteger(spec.size_bytes) || spec.size_bytes < 0 || !/^[0-9a-f]{64}$/.test(spec.sha256)) {
      throw engineError("BUNDLE_MANIFEST_INVALID", `bundle '${spec.id}' integrity fields are invalid`, "size_bytes must be non-negative and sha256 must be lowercase SHA-256.");
    }
    ids.add(spec.id);
    return { ...spec, dependencies: Array.isArray(spec.dependencies) ? spec.dependencies : [] };
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

function feedChunk(module, chunk) {
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  const pointer = module._unone_web_alloc(bytes.byteLength);
  if (bytes.byteLength > 0) module.HEAPU8.set(bytes, pointer);
  if (module._unone_web_bundle_write(pointer, bytes.byteLength) !== 0) {
    const result = moduleJson(module);
    throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle chunk verification failed", result.diagnostic?.explanation ?? "The engine rejected a bundle chunk.", result.diagnostic?.facts ?? {});
  }
}

async function verifyBlob(module, spec, blob) {
  const specBytes = new TextEncoder().encode(JSON.stringify(spec));
  const specPointer = module._unone_web_alloc(specBytes.byteLength);
  module.HEAPU8.set(specBytes, specPointer);
  if (module._unone_web_bundle_begin(specPointer, specBytes.byteLength) !== 0) {
    throw engineError("BUNDLE_VERIFY_FAILED", "bundle verifier could not start", JSON.stringify(moduleJson(module)));
  }
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      feedChunk(module, value);
    }
  } finally {
    reader.releaseLock();
  }
  if (module._unone_web_bundle_finish() !== 0) {
    const result = moduleJson(module);
    throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle verification failed", result.diagnostic?.explanation ?? "The engine rejected the bundle.", result.diagnostic?.facts ?? {});
  }
  return moduleJson(module).value;
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
  const reader = response.body.getReader();
  const chunks = [];
  const specBytes = new TextEncoder().encode(JSON.stringify(spec));
  const specPointer = module._unone_web_alloc(specBytes.byteLength);
  module.HEAPU8.set(specBytes, specPointer);
  if (module._unone_web_bundle_begin(specPointer, specBytes.byteLength) !== 0) throw engineError("BUNDLE_VERIFY_FAILED", "bundle verifier could not start", JSON.stringify(moduleJson(module)));
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      feedChunk(module, value);
    }
  } finally {
    reader.releaseLock();
  }
  if (module._unone_web_bundle_finish() !== 0) {
    const result = moduleJson(module);
    throw engineError(result.diagnostic?.code ?? "BUNDLE_VERIFY_FAILED", "bundle verification failed", result.diagnostic?.explanation ?? "The engine rejected the bundle.", result.diagnostic?.facts ?? {});
  }
  return new Blob(chunks);
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
