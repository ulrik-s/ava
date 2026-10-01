/**
 * Öppna IndexedDB utan att fastna (#1346).
 *
 * En versionshöjning väntar ("blocked") tills alla andra anslutningar till
 * databasen stängts. En flik som håller en anslutning utan
 * `onversionchange`-hanterare kan då låta en annan flik vänta för evigt.
 * Därför:
 *
 *   - våra anslutningar stänger sig själva när en annan flik vill höja
 *     versionen (`onversionchange`), så att våra egna flikar aldrig blockerar;
 *   - en öppning som blockeras ger upp efter en stund med ett fel (som når
 *     synkstatusen) och rapporteras — den hänger aldrig tyst.
 */

/** Hur länge en blockerad öppning väntar innan den ger upp. */
export const BLOCKED_TIMEOUT_MS = 5_000;

/** Rapportera ett lagringsproblem som ett fel i sidan (`reportError`), inte tyst. */
export function reportIdbProblem(error: Error): void {
  if (typeof globalThis.reportError === "function") globalThis.reportError(error);
}

export interface OpenDatabaseOptions {
  factory: IDBFactory;
  name: string;
  version: number;
  /** Skapa/ändra stores (körs bara när versionen höjs). */
  upgrade: (db: IDBDatabase) => void;
  blockedTimeoutMs?: number;
}

function blockedError(name: string): Error {
  return new Error(`IndexedDB-databasen ${name} hålls öppen av en annan flik i en äldre version. Stäng eller ladda om de andra AVA-flikarna.`);
}

/** Öppna `name` i `version`. Anslutningen stänger sig när en annan flik vill höja versionen. */
export function openDatabase(opts: OpenDatabaseOptions): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = opts.factory.open(opts.name, opts.version);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gaveUp = false;
    req.onupgradeneeded = () => opts.upgrade(req.result);
    req.onblocked = () => {
      timer = setTimeout(() => {
        gaveUp = true;
        const error = blockedError(opts.name);
        reportIdbProblem(error);
        reject(error);
      }, opts.blockedTimeoutMs ?? BLOCKED_TIMEOUT_MS);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => db.close();
      if (gaveUp) db.close();
      else resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error(`indexedDB open av ${opts.name} misslyckades`));
    };
  });
}

/**
 * Öppna en befintlig databas i den version den har — utan versionshöjning, så
 * öppningen kan inte blockeras. Finns databasen inte skapas den inte (`null`).
 * Ett fel ger också `null` (rapporterat): den gamla databasen lämnas orörd.
 */
export function openExistingDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = factory.open(name);
    // Version 0 → 1 betyder att databasen inte fanns: avbryt, så skapas den inte.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => {
      if (req.error?.name !== "AbortError") reportIdbProblem(new Error(`Kunde inte öppna ${name}`, { cause: req.error }));
      resolve(null);
    };
  });
}

/**
 * Radera databasen `name` (#1347). Väntar medan en annan anslutning håller den
 * öppen (våra stänger sig vid `versionchange`), men högst `timeoutMs`.
 * `true` = raderad (eller fanns inte); `false` = blockerad eller fel — då
 * ligger raderingen kvar som begäran och anroparen får försöka igen.
 */
export function deleteDatabase(factory: IDBFactory, name: string, timeoutMs: number = BLOCKED_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const done = (ok: boolean) => { clearTimeout(timer); resolve(ok); };
    const req = factory.deleteDatabase(name);
    req.onsuccess = () => done(true);
    req.onerror = () => done(false);
  });
}
