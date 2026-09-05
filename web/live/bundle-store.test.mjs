import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { installGeneration, readActiveBundle } from "./bundle-store.js";

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

function persistenceSnapshot(database) {
  const snapshot = (name) => structuredClone([...database.stores.get(name).records.entries()]);
  return {
    meta: snapshot("meta"),
    generations: snapshot("generations"),
    bundles: [...database.stores.get("bundles").records.entries()].map(([key, value]) => [key, {
      sha256: value.sha256,
      size_bytes: value.size_bytes,
      byte_length: value.bytes?.size ?? value.bytes?.byteLength,
    }]),
  };
}

test("shared validation fixtures reject invalid manifests before activation", async () => {
  globalThis.indexedDB = new FakeIndexedDb();
  const expectedCodes = {
    empty_bundles: "BUNDLE_MANIFEST_EMPTY",
    missing_bundles: "BUNDLE_MANIFEST_INVALID",
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

test("read validates an unrelated dependency graph before reading an active base", async () => {
  globalThis.indexedDB = new FakeIndexedDb();
  const module = fakeVerifierModule();
  const contentById = {
    base: new TextEncoder().encode("base-content"),
    feature: new TextEncoder().encode("feature-content"),
  };
  const active = await installGeneration(fixture.valid, {
    module,
    fetchImpl: responseFor(contentById),
    databaseName: "fixture-read-invalid-graph",
  });
  const generationState = { database: active.database, bundles: active.bundles };
  const base = await readActiveBundle(generationState, "base", module, fixture.valid);
  assert.deepEqual(new Uint8Array(await base.arrayBuffer()), contentById.base);

  const invalidGraphs = [
    { name: "missing dependency", dependencies: ["missing"], code: "BUNDLE_DEPENDENCY_NOT_FOUND" },
    { name: "dependency cycle", dependencies: ["feature"], code: "BUNDLE_DEPENDENCY_CYCLE" },
  ];
  for (const { name, dependencies, code } of invalidGraphs) {
    const manifest = structuredClone(fixture.valid);
    manifest.bundles.find((spec) => spec.id === "feature").dependencies = dependencies;
    await assert.rejects(
      readActiveBundle(generationState, "base", module, manifest),
      (error) => error?.diagnostic?.code === code,
      name,
    );
  }
});

test("corrupt active generation metadata fails closed without rewriting persistence", async () => {
  const corruptions = [
    {
      name: "pointer without record",
      mutate(database, active) {
        database.stores.get("generations").records.delete(active.generation);
      },
    },
    {
      name: "invalid pointer",
      mutate(database) {
        database.stores.get("meta").records.set("activeGeneration", { key: "activeGeneration", generation: 0 });
      },
    },
    {
      name: "invalid record identity",
      mutate(database, active) {
        const record = database.stores.get("generations").records.get(active.generation);
        database.stores.get("generations").records.set(active.generation, { ...record, generation: active.generation + 1 });
      },
    },
  ];
  const contentById = {
    base: new TextEncoder().encode("base-content"),
    feature: new TextEncoder().encode("feature-content"),
  };

  for (const { name, mutate } of corruptions) {
    globalThis.indexedDB = new FakeIndexedDb();
    const module = fakeVerifierModule();
    const active = await installGeneration(fixture.valid, {
      module,
      fetchImpl: responseFor(contentById),
      databaseName: `fixture-corrupt-${name}`,
    });
    mutate(active.database, active);
    const before = persistenceSnapshot(active.database);
    let fetchCount = 0;
    await assert.rejects(
      installGeneration(fixture.valid, {
        module,
        fetchImpl: async () => {
          fetchCount += 1;
          throw new Error("fetch must not run after active metadata corruption");
        },
        databaseName: `fixture-corrupt-${name}`,
      }),
      (error) => error?.diagnostic?.code === "BUNDLE_ACTIVE_GENERATION_UNREADABLE",
      name,
    );
    assert.equal(fetchCount, 0, `${name}: no fetch after metadata corruption`);
    assert.deepEqual(persistenceSnapshot(active.database), before, `${name}: persistence unchanged`);
  }
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
