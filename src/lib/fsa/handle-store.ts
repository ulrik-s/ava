/**
 * Persistens av `FileSystemDirectoryHandle` mellan sessions.
 *
 * FSA-handles kan serialiseras direkt i IndexedDB. När appen
 * öppnas nästa session läser vi handle:n + anropar
 * `verifyPermission({mode:"readwrite"})` för att åter-bekräfta
 * användarens tillstånd.
 *
 * Källa: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
 */

const DB_NAME = "ava-fsa";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await tx<IDBValidKey>("readwrite", (s) => s.put(handle, key));
}

export async function loadHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const value = await tx<unknown>("readonly", (s) => s.get(key) as IDBRequest<unknown>);
  return (value as FileSystemDirectoryHandle | undefined) ?? null;
}

export async function deleteHandle(key: string): Promise<void> {
  await tx<undefined>("readwrite", (s) => s.delete(key) as IDBRequest<undefined>);
}

/**
 * Säkerställ att vi har read/write-permission på handle:n. Om
 * tillståndet är `prompt` så visas browser-dialog (kräver
 * user-gesture — anropa från click-handler).
 */
export async function ensureReadWrite(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  // queryPermission/requestPermission finns på handle men inte i alla TS-libs.
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission?: (o: typeof opts) => Promise<PermissionState>;
    requestPermission?: (o: typeof opts) => Promise<PermissionState>;
  };
  if (await h.queryPermission?.(opts) === "granted") return true;
  return (await h.requestPermission?.(opts)) === "granted";
}

export function isFsaSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}
