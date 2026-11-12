// Minimal key-value store on top of IndexedDB (no library needed).
// Values are stored as structured clones, so Dates and large photo strings are fine.

const DB_NAME = "bracket-builder";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

export async function readAll(): Promise<Map<string, unknown>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out = new Map<string, unknown>();
    const cursor = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve(out);
      out.set(String(c.key), c.value);
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

/** One transaction: either every change is saved or none is. */
export async function writeBatch(puts: Map<string, unknown>, deletes: string[], clearFirst = false): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (clearFirst) store.clear();
    for (const key of deletes) store.delete(key);
    puts.forEach((value, key) => store.put(value, key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
