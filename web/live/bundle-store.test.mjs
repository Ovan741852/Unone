import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { installGeneration } from "./bundle-store.js";

const fixture = JSON.parse(await readFile(fileURLToPath(new URL("../../tests/fixtures/bundle-manifest-validation.json", import.meta.url)), "utf8"));

class FakeRequest {
  constructor(result) {
    this.result = result;
    this.onsuccess = null;
    this.onerror = null;
  }

  succeed() {
    queueMicrotask(() => this.onsuccess?.({ target: this }));
  }
}

class FakeObjectStore {
  constructor(keyPath) {
    this.keyPath = keyPath;
    this.records = new Map();
  }

  get(key) {
    const request = new FakeRequest(this.records.get(key));
    request.succeed();
    return request;
  }

  put(value) {
    this.records.set(value[this.keyPath], structuredClone(value));
    const request = new FakeRequest(value);
    request.succeed();
    return request;
  }
}

class FakeTransaction {
  constructor(database, names) {
    this.database = database;
    this.names = Array.isArray(names) ? names : [names];
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    queueMicrotask(() => this.oncomplete?.());
  }

  objectStore(name) {
    assert.ok(this.names.includes(name));
    return this.database.stores.get(name);
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name, { keyPath }) {
    const store = new FakeObjectStore(keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(names) {
    return new FakeTransaction(this, names);
  }
}

class FakeIndexedDb {
  constructor() {
    this.databases = new Map();
  }

  open(name) {
    const request = new FakeRequest();
    const database = this.databases.get(name) ?? new FakeDatabase();
    const isNew = !this.databases.has(name);
    this.databases.set(name, database);
    queueMicrotask(() => {
      request.result = database;
      if (isNew) request.onupgradeneeded?.({ target: request });
      request.onsuccess?.({ target: request });
    });
    return request;
  }
}

function fakeVerifierModule() {
  const module = {
    HEAPU8: new Uint8Array(64 * 1024),
    nextAllocation: 1024,
    observation: new Uint8Array(),
    _unone_web_alloc(size) {
      const pointer = this.nextAllocation;
      this.nextAllocation += size;
      return pointer;
    },
    _unone_web_bundle_begin() {
      return 0;
    },
    _unone_web_bundle_write() {
      return 0;
    },
    _unone_web_bundle_finish() {
      this.observation = new TextEncoder().encode(JSON.stringify({ value: {} }));
      this.HEAPU8.set(this.observation, 0);
      return 0;
    },
    _unone_web_observation_ptr() {
      return 0;
    },
    _unone_web_observation_len() {
      return this.observation.byteLength;
    },
  };
  return module;
}

function responseFor(contentById) {
  return async (source) => {
    const id = source.includes("feature") ? "feature" : "base";
    return new Response(contentById[id], { status: 200 });
  };
}

test("shared validation fixtures reject invalid manifests before activation", async () => {
  globalThis.indexedDB = new FakeIndexedDb();
  const expectedCodes = {
    empty_bundles: "BUNDLE_MANIFEST_EMPTY",
    empty_id: "BUNDLE_MANIFEST_INVALID",
    duplicate_id: "BUNDLE_MANIFEST_DUPLICATE_ID",
    invalid_hash: "BUNDLE_MANIFEST_INVALID",
    invalid_size: "BUNDLE_MANIFEST_INVALID",
    missing_dependency: "BUNDLE_DEPENDENCY_NOT_FOUND",
    dependency_cycle: "BUNDLE_DEPENDENCY_CYCLE",
  };
  for (const [name, manifest] of Object.entries(fixture.invalid)) {
    await assert.rejects(
      installGeneration(manifest, { module: fakeVerifierModule(), databaseName: `fixture-${name}` }),
      (error) => error?.diagnostic?.code === expectedCodes[name],
      name,
    );
  }
});

test("valid fixture installs every root and keeps one active generation", async () => {
  globalThis.indexedDB = new FakeIndexedDb();
  const module = fakeVerifierModule();
  const contentById = {
    base: new TextEncoder().encode("base-content"),
    feature: new TextEncoder().encode("feature-content"),
  };
  let fetchCount = 0;
  const fetchImpl = async (...args) => {
    fetchCount += 1;
    return responseFor(contentById)(...args);
  };

  const first = await installGeneration(fixture.valid, {
    module,
    fetchImpl,
    databaseName: "fixture-valid",
  });
  assert.equal(first.status, "activated");
  assert.equal(first.generation, 1);
  assert.deepEqual(Object.keys(first.bundles).sort(), ["base", "feature"]);
  assert.equal(fetchCount, 2);

  const second = await installGeneration(fixture.valid, {
    module,
    fetchImpl,
    databaseName: "fixture-valid",
  });
  assert.equal(second.status, "already_active");
  assert.equal(second.generation, 1);
  assert.equal(fetchCount, 2);
});

test("failed later fetch leaves the previous active generation unchanged", async () => {
  globalThis.indexedDB = new FakeIndexedDb();
  const module = fakeVerifierModule();
  const contentById = {
    base: new TextEncoder().encode("base-content"),
    feature: new TextEncoder().encode("feature-content"),
  };
  const databaseName = "fixture-failure";
  await installGeneration(fixture.valid, {
    module,
    fetchImpl: responseFor(contentById),
    databaseName,
  });
  const changed = structuredClone(fixture.valid);
  changed.version = 2;
  changed.bundles[1].sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
  await assert.rejects(
    installGeneration(changed, {
      module,
      fetchImpl: async (source) => {
        if (source.includes("feature")) throw new Error("network unavailable");
        return responseFor(contentById)(source);
      },
      databaseName,
    }),
  );
  const stillActive = await installGeneration(fixture.valid, {
    module,
    fetchImpl: responseFor(contentById),
    databaseName,
  });
  assert.equal(stillActive.status, "already_active");
  assert.equal(stillActive.generation, 1);
});
