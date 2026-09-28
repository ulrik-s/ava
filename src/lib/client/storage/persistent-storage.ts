/**
 * `ensurePersistentStorage` (#1241) — be webbläsaren att inte rensa AVA:s
 * lokala lagring.
 *
 * IndexedDB håller snapshotet och mutationskön — dvs. ändringar som ännu inte
 * nått servern. Utan `navigator.storage.persist()` är lagringen "best effort":
 * webbläsaren får tömma den vid lagringsbrist, och Safari rensar skriptlagrad
 * data efter en tids inaktivitet. Svaret visas för användaren (StorageStatus,
 * varningen i synk-raden) i stället för att tyst antas.
 */

/** Vad webbläsaren lovade. */
export type StoragePersistence =
  /** Webbläsaren rensar inte datan utan användarens medgivande. */
  | "persisted"
  /** Nekat: datan kan rensas vid lagringsbrist/inaktivitet. */
  | "not-persisted"
  /** API:t saknas (gammal webbläsare, osäker kontext). */
  | "unsupported";

/** Den del av `StorageManager` som används; metoderna saknas i äldre webbläsare. */
export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/** Fråga (om det behövs) och rapportera utfallet. Kastar aldrig. */
export async function ensurePersistentStorage(storage: StorageManagerLike | undefined): Promise<StoragePersistence> {
  if (!storage?.persist || !storage.persisted) return "unsupported";
  try {
    if (await storage.persisted()) return "persisted";
    return (await storage.persist()) ? "persisted" : "not-persisted";
  } catch {
    return "not-persisted";
  }
}

// En fråga per flik: persist() kan visa en dialog i vissa webbläsare, och
// svaret ändras inte under sessionen.
let once: Promise<StoragePersistence> | null = null;

/** `ensurePersistentStorage` mot `navigator.storage`, en gång per flik. */
export function requestPersistentStorageOnce(): Promise<StoragePersistence> {
  once ??= ensurePersistentStorage(typeof navigator === "undefined" ? undefined : navigator.storage);
  return once;
}

/** Bara för tester: glöm det sparade svaret. */
export function resetPersistentStorageRequestForTests(): void {
  once = null;
}
