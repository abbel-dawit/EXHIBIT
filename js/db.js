// IndexedDB storage for the collector's device.
//   collection: unlocked artworks { id, edition, code, cert, meta, unlockedAt, files }
//   assets:     encrypted artwork files exactly as published  (key "<id>/<name>")
//   targets:    compiled recognition data cache
//   kv:         small settings (last backup date, etc.)
const DB_NAME = 'golden-hour';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['collection', 'assets', 'targets', 'kv']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, key) => run(store, 'readonly', s => s.get(key)).catch(() => undefined),
  put: (store, key, value) => run(store, 'readwrite', s => s.put(value, key)).then(() => true, () => false),
  del: (store, key) => run(store, 'readwrite', s => s.delete(key)).catch(() => {}),
  all: (store) => run(store, 'readonly', s => s.getAll()).then(v => v || [], () => []),
  keys: (store) => run(store, 'readonly', s => s.getAllKeys()).then(v => v || [], () => []),
};

export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
