/**
 * Kopiera en IndexedDB-databas till en annan (#1347): de gemensamma
 * databaserna från före #1347 flyttas in i den ägande användarens egna.
 *
 * Som i #1346 uppgraderas källan aldrig — den öppnas i den version den har (en
 * flik med gammal kod kan hålla den öppen). Kopieringen är idempotent: en
 * nyckel som redan finns i målet skrivs inte över (målet är nyare), utom när
 * anroparen ger en `merge` för storen. Värdena kopieras ett i taget, så att
 * stora dokumentbytes aldrig ligger i minnet samtidigt.
 */

import { openDatabase, openExistingDatabase } from "./idb-open";

/** Slå ihop målets värde med källans för samma nyckel. */
export type MergeValue = (store: string, key: IDBValidKey, existing: unknown, incoming: unknown) => unknown;

interface StoreShape {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
}

/** Vänta på en begäran. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB-begäran misslyckades"));
  });
}

/** Vänta tills transaktionen gått igenom. */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB-transaktion avbröts"));
  });
}

function storeShapes(db: IDBDatabase): StoreShape[] {
  const names = [...db.objectStoreNames];
  if (names.length === 0) return [];
  const tx = db.transaction(names, "readonly");
  return names.map((name) => {
    const store = tx.objectStore(name);
    return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement };
  });
}

/** Målet; finns det inte skapas det med källans stores. */
async function openTarget(factory: IDBFactory, name: string, shapes: readonly StoreShape[]): Promise<IDBDatabase> {
  const existing = await openExistingDatabase(factory, name);
  if (existing) return existing;
  return openDatabase({
    factory, name, version: 1,
    upgrade: (db) => {
      for (const s of shapes) db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement });
    },
  });
}

/** Skriv ett värde i målet — om nyckeln saknas där, eller slå ihop med `merge`. */
async function writeOne(target: IDBDatabase, shape: StoreShape, key: IDBValidKey, value: unknown, merge?: MergeValue): Promise<void> {
  const tx = target.transaction(shape.name, "readwrite");
  const store = tx.objectStore(shape.name);
  const existing: unknown = await request(store.get(key));
  const next = existing === undefined ? value : merge?.(shape.name, key, existing, value);
  if (next !== undefined) {
    if (shape.keyPath === null) store.put(next, key);
    else store.put(next);
  }
  await committed(tx);
}

async function copyStore(source: IDBDatabase, target: IDBDatabase, shape: StoreShape, merge?: MergeValue): Promise<void> {
  if (!target.objectStoreNames.contains(shape.name)) return;
  const keys = await request(source.transaction(shape.name, "readonly").objectStore(shape.name).getAllKeys());
  for (const key of keys) {
    const value: unknown = await request(source.transaction(shape.name, "readonly").objectStore(shape.name).get(key));
    await writeOne(target, shape, key, value, merge);
  }
}

/**
 * Kopiera `from` till `to` (idempotent). `false` om `from` inte finns — då
 * skapas inte heller `to`.
 */
export async function copyDatabase(factory: IDBFactory, from: string, to: string, merge?: MergeValue): Promise<boolean> {
  const source = await openExistingDatabase(factory, from);
  if (!source) return false;
  try {
    const shapes = storeShapes(source);
    if (shapes.length === 0) return true;
    const target = await openTarget(factory, to, shapes);
    try {
      for (const shape of shapes) await copyStore(source, target, shape, merge);
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
  return true;
}
