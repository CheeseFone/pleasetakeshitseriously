// Tiny IndexedDB wrapper: stool photo thumbnails never leave this device. Keyed by entry id.
const DB = 'take-shit-seriously', STORE = 'thumbs'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    r.onsuccess = () => res(r.result as T)
    r.onerror = () => rej(r.error)
    t.oncomplete = () => db.close()
  })
}

export const thumbs = {
  put: (id: string, dataUrl: string) => tx('readwrite', s => s.put(dataUrl, id)).catch(() => {}),
  get: (id: string) => tx<string | undefined>('readonly', s => s.get(id)).catch(() => undefined),
  del: (id: string) => tx('readwrite', s => s.delete(id)).catch(() => {}),
  keys: () => tx<IDBValidKey[]>('readonly', s => s.getAllKeys()).catch(() => [] as IDBValidKey[]),
  clear: () => tx('readwrite', s => s.clear()).catch(() => {}),
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('tss-device')
    if (!id) { id = 'dev-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('tss-device', id) }
    return id
  } catch { return 'dev-unknown' }
}
