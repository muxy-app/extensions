// Imported themes live in IndexedDB, which every page of the extension shares
// (same muxy-ext:// origin) and which holds tens of megabytes, unlike
// localStorage or muxy.storage. Small metadata records are kept apart from the
// icon payloads so the theme menu can list themes without loading icons.

const DB_NAME = "muxy-files-icon-themes";
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

let dbPromise = null;

function open_db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This view can’t store icon themes (no IndexedDB)."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Can’t open the icon theme store."));
    request.onblocked = () => reject(new Error("The icon theme store is busy; try again."));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Icon theme store error."));
    tx.onabort = () => reject(tx.error ?? new Error("Icon theme store write was aborted (disk full?)."));
  });
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The metadata a menu needs, without icons. */
export function meta_of(theme, importedAt = Date.now()) {
  return {
    id: theme.id,
    format: theme.format,
    themeId: theme.themeId,
    label: theme.label,
    pack: theme.pack,
    stats: theme.stats,
    importedAt,
  };
}

export async function list_imported() {
  const db = await open_db();
  const tx = db.transaction(META, "readonly");
  const all = await req(tx.objectStore(META).getAll());
  return all.sort((a, b) => a.pack.displayName.localeCompare(b.pack.displayName) || a.label.localeCompare(b.label));
}

export async function get_imported(id) {
  const db = await open_db();
  const tx = db.transaction(DATA, "readonly");
  return (await req(tx.objectStore(DATA).get(id))) ?? null;
}

/** Replaces every theme of the same pack with `themes`, in one transaction. */
export async function save_pack(packId, themes) {
  const db = await open_db();
  const tx = db.transaction([META, DATA], "readwrite");
  const meta = tx.objectStore(META);
  const data = tx.objectStore(DATA);
  const existing = await req(meta.getAll());
  for (const record of existing) {
    if (record.pack?.id === packId) {
      meta.delete(record.id);
      data.delete(record.id);
    }
  }
  const now = Date.now();
  for (const theme of themes) {
    meta.put(meta_of(theme, now));
    data.put(theme);
  }
  await done(tx);
}

export async function delete_themes(ids) {
  const db = await open_db();
  const tx = db.transaction([META, DATA], "readwrite");
  for (const id of ids) {
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
  }
  await done(tx);
}
