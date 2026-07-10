// Tiny IndexedDB key-value cache for instant UI hydration (WhatsApp-style
// stale-while-revalidate): render the last-known data immediately, refresh
// from the network in the background, reconcile when it lands.
//
// IndexedDB (not localStorage) because conversation lists on busy lines run
// to several MB — far past localStorage's ~5MB global cap. Everything is
// best-effort: any failure (private mode, quota, corrupt data) silently
// falls back to network-only behavior.

const DB_NAME = 'airophone-cache'
const STORE = 'kv'

let dbPromise = null

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

export async function cacheGet(key) {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result?.value)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

export function cacheSet(key, value) {
  // Fire-and-forget — callers never wait on a cache write.
  openDb().then(db => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ value, savedAt: Date.now() }, key)
  }).catch(() => {})
}

export function cacheDelete(key) {
  openDb().then(db => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
  }).catch(() => {})
}
