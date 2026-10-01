/**
 * `chunk-reload` (#1355) — en flik som kör ett äldre bygge än servern.
 *
 * Efter en deploy byter prod release atomärt, och den förra raderas vid nästa
 * deploy. En flik som laddades före bytet ber om chunks som inte längre finns:
 * dynamiska importer och Turbopacks chunk-laddning kastar då (`ChunkLoadError`
 * eller webbläsarens "Failed to fetch dynamically imported module"), och sidan
 * kraschar mitt i en navigering. Lösningen är att ladda om — en gång. Kommer
 * felet igen direkt efter omladdningen hjälper inte fler omladdningar (servern
 * kan vara nere); då får användaren ett besked i stället för en loop.
 */

/** Webbläsarnas meddelanden när en dynamisk import eller ett chunk inte går att hämta. */
const CHUNK_ERROR_MESSAGE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (?:CSS )?chunk \S+ failed|Failed to load chunk/i;

/** Är felet ett chunk som inte gick att ladda (och inte ett vanligt fel)? */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_ERROR_MESSAGE.test(error.message);
}

/** Den del av `Storage` som används. */
type ReloadStorage = Pick<Storage, "getItem" | "setItem">;

const RELOAD_KEY = "ava.chunk-reload-at";
/** Inom den här tiden efter förra omladdningen laddas inte om igen. */
const RELOAD_COOLDOWN_MS = 60_000;

/**
 * Ladda om för ett chunk-fel, men högst en gång per minut och flik. Returnerar
 * false när en omladdning nyss gjorts (då hjälper inte en till).
 */
export function reloadOnce(storage: ReloadStorage, now: number, reload: () => void): boolean {
  const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
  if (now - last < RELOAD_COOLDOWN_MS) return false;
  storage.setItem(RELOAD_KEY, String(now));
  reload();
  return true;
}

/** Sidans minne, när sessionStorage inte går att nå (privat läge, blockerad lagring). */
const memory = new Map<string, string>();
const memoryStorage: ReloadStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); } };

/** Flikens sessionStorage, eller sidans minne där den inte går att nå. */
function tabStorage(): ReloadStorage {
  try {
    const storage = window.sessionStorage;
    storage.getItem(RELOAD_KEY);
    return storage;
  } catch {
    return memoryStorage;
  }
}

/**
 * Chunk-fel efter en deploy: ladda om fliken en gång. Returnerar true när en
 * omladdning nyss gjorts utan att hjälpa — då ska anroparen visa ett besked.
 */
export function recoverFromChunkError(reload: () => void = () => window.location.reload()): boolean {
  return !reloadOnce(tabStorage(), Date.now(), reload);
}

/** Där fel och avvisade löften rapporteras (`window`). */
interface ChunkErrorTarget {
  addEventListener(type: "error", listener: (e: ErrorEvent) => void): void;
  addEventListener(type: "unhandledrejection", listener: (e: PromiseRejectionEvent) => void): void;
  removeEventListener(type: "error", listener: (e: ErrorEvent) => void): void;
  removeEventListener(type: "unhandledrejection", listener: (e: PromiseRejectionEvent) => void): void;
}

/** Anropa `onChunkError` för varje ofångat chunk-fel. Returnerar en avregistrering. */
export function watchChunkErrors(target: ChunkErrorTarget, onChunkError: () => void): () => void {
  const onError = (e: ErrorEvent): void => { if (isChunkLoadError(e.error)) onChunkError(); };
  const onRejection = (e: PromiseRejectionEvent): void => { if (isChunkLoadError(e.reason)) onChunkError(); };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
