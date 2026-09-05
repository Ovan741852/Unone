const DB_VERSION = 1;
const DB_PREFIX = "unone-runner-save:";

function openDatabase(projectKey) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`${DB_PREFIX}${encodeURIComponent(projectKey)}`, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("save")) database.createObjectStore("save", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("save IndexedDB open failed"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("save IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("save IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("save IndexedDB transaction aborted"));
  });
}

export async function readSave(projectKey) {
  const database = await openDatabase(projectKey);
  const transaction = database.transaction("save", "readonly");
  const record = await requestResult(transaction.objectStore("save").get("current"));
  database.close();
  return record?.payload ?? null;
}

export async function writeSave(projectKey, payload) {
  const database = await openDatabase(projectKey);
  const transaction = database.transaction("save", "readwrite");
  transaction.objectStore("save").put({ key: "current", payload, saved_at: new Date().toISOString() });
  await transactionDone(transaction);
  database.close();
}
