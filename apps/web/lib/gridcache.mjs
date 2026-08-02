// Persistence for the reach map.
//
// Two layers, deliberately separate:
//   * localStorage holds the last *session* -- which transmitter, hour, theme.
//     Small, synchronous, and the thing that makes a return visit show
//     something instead of a blank map.
//   * IndexedDB holds computed *grids*, which are far too large for
//     localStorage's ~5 MB budget and are expensive to recompute (tens of
//     seconds of on-device work).
//
// Nothing here leaves the device. The whole point of computing on-device
// (ADR-0001) is that a QTH never has to be sent anywhere, and caching it
// server-side would give that away.

const SESSION_KEY = 'hfkit.reach.session.v1';
const DB_NAME = 'hfkit';
const STORE = 'reach-grids';
const DB_VERSION = 1;

/** Cache key for a computed grid. Rounded so that nudging the transmitter by a
 *  few hundred metres reuses the cached grid rather than recomputing it — the
 *  grid itself is only 6° resolution, so finer precision is meaningless. */
export function gridKey({ lat, lon, month, ssn, hours, stepDeg }) {
  const r = (v) => Math.round(v * 10) / 10;
  return `${r(lat)},${r(lon)}|m${month}|s${Math.round(ssn)}|h${hours.length}|d${stepDeg}`;
}

export function saveSession(state) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    /* private browsing, quota, or storage disabled — not worth surfacing */
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putGrid(key, payload) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, savedAt: Date.now(), ...payload });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* caching is an optimisation; failing to cache must never break a run */
  }
}

export async function getGrid(key) {
  try {
    const db = await openDb();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return rec;
  } catch {
    return null;
  }
}

/** Keep the store bounded. Grids are large and a user wandering the gazetteer
 *  could accumulate many; nothing here is precious, so evict oldest first. */
export async function pruneGrids(maxEntries = 12) {
  try {
    const db = await openDb();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
    if (all.length > maxEntries) {
      const doomed = all.sort((a, b) => a.savedAt - b.savedAt).slice(0, all.length - maxEntries);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const os = tx.objectStore(STORE);
        for (const rec of doomed) os.delete(rec.key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  } catch {
    /* best effort */
  }
}
