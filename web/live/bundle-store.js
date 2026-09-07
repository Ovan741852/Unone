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

function validateManifestGraph(manifestInput) {
  const manifest = normalizeManifest(manifestInput);
  return { manifest, order: dependencyOrder(manifest) };
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidGeneration(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidBundleMap(value) {
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([id, hash]) => id.trim() !== "" && typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash));
}

function activeGenerationUnreadable(summary, explanation, facts = {}) {
  throw engineError("BUNDLE_ACTIVE_GENERATION_UNREADABLE", summary, explanation, facts);
}

async function getActiveGeneration(database) {
  const transaction = database.transaction("meta", "readonly");
  const pointer = await requestResult(transaction.objectStore("meta").get("activeGeneration"));
  if (pointer === undefined) return null;
  if (!isRecord(pointer) || pointer.key !== "activeGeneration" || !isValidGeneration(pointer.generation)) {
    activeGenerationUnreadable("active generation pointer is invalid", "The active generation pointer must identify a positive integer generation.");
  }
  const generationTransaction = database.transaction("generations", "readonly");
  const record = await requestResult(generationTransaction.objectStore("generations").get(pointer.generation));
  const validRecord = isRecord(record)
    && isValidGeneration(record.generation)
    && record.generation === pointer.generation
    && Number.isInteger(record.manifest_version)
    && record.manifest_version >= 0
    && record.manifest_version <= 0xffffffff
    && isValidBundleMap(record.bundles);
  if (!validRecord) {
    activeGenerationUnreadable("active generation record is missing or invalid", "The active generation pointer must resolve to a valid generation record with matching identity and bundle metadata.", { generation: pointer.generation });
  }
  return record;
}

function sameBundles(left, right) {
  const leftEntries = Object.entries(left ?? {}).sort();
  const rightEntries = Object.entries(right ?? {}).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function generationState(record, database, status) {
  return {
    status,
    generation: record.generation,
    manifest_version: record.manifest_version,
    bundles: { ...record.bundles },
    database,
  };
}

function generationRecordMatches(record, state) {
  return isRecord(record)
    && record.generation === state.generation
    && record.manifest_version === state.manifest_version
    && sameBundles(record.bundles, state.bundles);
}

function readableGenerationRecord(record, generation) {
  return isRecord(record)
    && record.generation === generation
    && Number.isInteger(record.manifest_version)
    && record.manifest_version >= 0
    && record.manifest_version <= 0xffffffff
    && isValidBundleMap(record.bundles);
}

function activePointerGeneration(pointer) {
  if (pointer === undefined) return null;
  if (!isRecord(pointer) || pointer.key !== "activeGeneration" || !isValidGeneration(pointer.generation)) {
    activeGenerationUnreadable("active generation pointer is invalid", "The active generation pointer must identify a positive integer generation.");
  }
  return pointer.generation;
}

/**
 * Compare the active pointer and write its replacement in one IndexedDB
 * readwrite transaction. A read followed by a later transaction is not a CAS:
 * another tab could activate between those two operations.
 */
function compareAndSetGeneration({ database, expectedGeneration, targetState, status }) {
  return new Promise((resolve, reject) => {
    let failure = null;
    let targetRecord = null;
    const transaction = database.transaction(["generations", "meta"], "readwrite");
    const generations = transaction.objectStore("generations");
    const meta = transaction.objectStore("meta");

    const fail = (error) => {
      failure ??= error;
    };

    const pointerRequest = meta.get("activeGeneration");
    pointerRequest.onerror = () => fail(pointerRequest.error ?? new Error("IndexedDB active pointer read failed"));
    pointerRequest.onsuccess = () => {
      if (failure) return;
      let actualGeneration;
      try {
        actualGeneration = activePointerGeneration(pointerRequest.result);
      } catch (error) {
        fail(error);
        return;
      }
      if (actualGeneration !== expectedGeneration) {
        fail(engineError(
          "BUNDLE_ACTIVATION_STALE",
          "bundle activation lost a concurrent update",
          "The active generation changed while this candidate was being committed; keep the current session and retry from a fresh stage.",
          { expected_generation: expectedGeneration, actual_generation: actualGeneration },
        ));
        return;
      }

      const verifyPrevious = (callback) => {
        if (actualGeneration === null) {
          callback();
          return;
        }
        const previousRequest = generations.get(actualGeneration);
        previousRequest.onerror = () => fail(previousRequest.error ?? new Error("IndexedDB active generation read failed"));
        previousRequest.onsuccess = () => {
          if (!readableGenerationRecord(previousRequest.result, actualGeneration)) {
            fail(engineError(
              "BUNDLE_ACTIVE_GENERATION_UNREADABLE",
              "active generation record is missing or invalid",
              "The active generation pointer must resolve to a valid generation record before it can be replaced.",
              { generation: actualGeneration },
            ));
            return;
          }
          callback();
        };
      };

      verifyPrevious(() => {
        if (failure) return;
        if (targetState === null) {
          meta.delete("activeGeneration");
          return;
        }
        const targetRequest = generations.get(targetState.generation);
        targetRequest.onerror = () => fail(targetRequest.error ?? new Error("IndexedDB target generation read failed"));
        targetRequest.onsuccess = () => {
          if (!generationRecordMatches(targetRequest.result, targetState)) {
            fail(engineError(
              "BUNDLE_STAGE_INVALID",
              "target generation metadata is missing or changed",
              "The generation record no longer matches the validated content.",
              { generation: targetState.generation },
            ));
            return;
          }
          targetRecord = {
            ...targetRequest.result,
            activated_at: new Date().toISOString(),
          };
          generations.put(targetRecord);
          meta.put({ key: "activeGeneration", generation: targetState.generation });
        };
      });
    };
    transaction.onerror = () => {
      failure ??= transaction.error ?? new Error("IndexedDB generation transaction failed");
    };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("IndexedDB generation transaction aborted"));
    transaction.oncomplete = () => {
      if (failure) reject(failure);
      else if (targetState === null) resolve(null);
      else resolve(generationState(targetRecord, database, status));
    };
  });
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
 * Stage all manifest bundles in dependency order without changing the active
 * generation pointer. Network policy belongs to fetchImpl; this module only
 * owns browser persistence and delegates integrity to the Rust/Wasm engine.
 *
 * Keeping the candidate unclaimed is important for hosts that have to ask a
 * live runtime to accept a script before the browser's durable pointer moves.
 */
export async function stageGeneration(manifestInput, { module, fetchImpl = fetch, databaseName = DB_NAME } = {}) {
  const { manifest, order } = validateManifestGraph(manifestInput);
  const database = await openDatabase(databaseName);
  const previous = await getActiveGeneration(database);
  const bundles = Object.fromEntries(order.map((spec) => [spec.id, spec.sha256]));
  if (previous && previous.manifest_version === manifest.version && sameBundles(previous.bundles, bundles)) {
    return generationState(previous, database, "already_active");
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

  // This transaction deliberately excludes `meta`. The active pointer is a
  // commit made only by activateGeneration after the consumer validates the
  // staged candidate. Read existing generations in the same readwrite
  // transaction so identifiers remain monotonic after rollback; an old
  // activated state must never be confused with a newer candidate that reuses
  // its number.
  const transaction = database.transaction(["bundles", "generations"], "readwrite");
  const generationsStore = transaction.objectStore("generations");
  const allocationRequest = generationsStore.getAll();
  let record = null;
  let allocationError = null;
  allocationRequest.onerror = () => {
    allocationError = allocationRequest.error ?? new Error("IndexedDB generation allocation read failed");
  };
  allocationRequest.onsuccess = () => {
    try {
      const highestExisting = (allocationRequest.result ?? [])
        .map((candidate) => candidate?.generation)
        .filter(isValidGeneration)
        .reduce((highest, candidate) => Math.max(highest, candidate), 0);
      const generation = Math.max(highestExisting, previous?.generation ?? 0) + 1;
      if (!isValidGeneration(generation)) {
        throw engineError(
          "BUNDLE_GENERATION_EXHAUSTED",
          "bundle generation limit has been reached",
          "The generation identifier cannot increase safely; the active generation was left unchanged.",
          { highest_existing_generation: highestExisting, active_generation: previous?.generation ?? null },
        );
      }
      record = {
        generation,
        manifest_version: manifest.version,
        bundles,
        staged_at: new Date().toISOString(),
        previous_generation: previous?.generation ?? null,
      };
      for (const item of staged) transaction.objectStore("bundles").put(item);
      generationsStore.put(record);
    } catch (error) {
      allocationError = error;
    }
  };
  await transactionDone(transaction);
  if (allocationError) throw allocationError;
  return {
    ...generationState(record, database, "staged"),
    previous_generation: previous?.generation ?? null,
  };
}

/**
 * Commit a previously staged candidate as the active generation.
 *
 * The active pointer is re-read immediately before the commit. A candidate
 * staged against an older active generation is rejected instead of silently
 * overwriting a concurrent host update.
 */
export async function activateGeneration(stagedState) {
  if (!stagedState || stagedState.status === "already_active") return stagedState;
  if (stagedState.status !== "staged" || !stagedState.database || !isValidGeneration(stagedState.generation)) {
    throw engineError("BUNDLE_STAGE_INVALID", "bundle candidate is not activatable", "Only a staged generation returned by stageGeneration may be activated.");
  }
  const expectedPrevious = stagedState.previous_generation ?? null;
  return compareAndSetGeneration({
    database: stagedState.database,
    expectedGeneration: expectedPrevious,
    targetState: stagedState,
    status: "activated",
  });
}

/**
 * Restore a prior pointer only if the generation being undone is still active.
 * This is used when a script candidate fails after storage activation.
 */
export async function rollbackGeneration(currentState, previousState) {
  if (!currentState || currentState.status !== "activated" || !currentState.database) {
    throw engineError("BUNDLE_STAGE_INVALID", "active generation state is missing", "Rollback requires the activated generation returned by activateGeneration.");
  }
  if (previousState !== null && (!previousState || !isValidGeneration(previousState.generation))) {
    throw engineError("BUNDLE_STAGE_INVALID", "previous generation state is invalid", "Rollback requires the previous generation returned by the same host session.");
  }
  return compareAndSetGeneration({
    database: currentState.database,
    expectedGeneration: currentState.generation,
    targetState: previousState,
    status: "rolled_back",
  });
}

/**
 * Backwards-compatible install helper for hosts that can activate as soon as
 * content verification completes. Live script reload uses the explicit
 * stage/activate pair above.
 */
export async function installGeneration(manifestInput, options = {}) {
  const staged = await stageGeneration(manifestInput, options);
  return staged.status === "already_active" ? staged : activateGeneration(staged);
}

export async function readGenerationBundle(generationState, bundleId, module, manifestInput) {
  const { manifest } = validateManifestGraph(manifestInput);
  const spec = manifest.bundles.find((candidate) => candidate.id === bundleId);
  if (!spec) throw engineError("BUNDLE_NOT_FOUND", `bundle '${bundleId}' does not exist`, "The requested bundle is not in the manifest.");
  if (!generationState || !isRecord(generationState.bundles)) {
    throw engineError("BUNDLE_STAGE_INVALID", "bundle generation state is missing", "Read content through a generation returned by stageGeneration or installGeneration.");
  }
  const hash = generationState.bundles?.[bundleId];
  if (hash !== spec.sha256) throw engineError("BUNDLE_GENERATION_MISMATCH", `bundle '${bundleId}' is not active`, "The active generation does not match the requested manifest.");
  const database = generationState.database ?? await openDatabase();
  const record = await getBundleRecord(database, hash);
  if (!record) throw engineError("BUNDLE_CACHE_MISS", `bundle '${bundleId}' is not cached`, "Activate the generation before reading its content.");
  await verifyBlob(module, spec, record.bytes);
  return record.bytes;
}

export async function readActiveBundle(generationState, bundleId, module, manifestInput) {
  return readGenerationBundle(generationState, bundleId, module, manifestInput);
}

export async function readActiveText(generationState, bundleId, module, manifestInput) {
  const blob = await readGenerationBundle(generationState, bundleId, module, manifestInput);
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
