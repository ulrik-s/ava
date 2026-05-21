"use client";

/**
 * Ed25519-nyckelpar genererade i browser via WebCrypto.
 *
 * Privata nyckeln lagras i IndexedDB som CryptoKey-objekt med
 * `extractable: false` — det betyder att den ALDRIG kan exporteras
 * från browser:n, inte ens av AVA-koden. Det är max-säkerhet
 * (motsvarande hårdvarunyckel i mjukvara).
 *
 * Konsekvenser:
 *   - Nycklarna är *per device*. Anna:s MacBook-nyckel finns inte
 *     på hennes iPad — hon registrerar två nycklar på GitHub, en
 *     per device.
 *   - Vi kan inte säkerhetskopiera privata nyckeln. Om Anna byter
 *     dator → generera ny nyckel + registrera på GH.
 *   - Vi kan inte heller läcka den via console.log eller fetch.
 *
 * Browser-stöd:
 *   - Chrome 113+, Edge 113+, Brave: ✅
 *   - Safari 17+ (sedan 2023): ✅
 *   - Firefox 130+ (sedan 2024): ✅
 */

const DB_NAME = "ava-keys";
const STORE_NAME = "ed25519";
const DEFAULT_KEY_ID = "primary";

export interface StoredKeypair {
  /** Identifierare i lokal lagring. */
  id: string;
  /** CryptoKey-objekt för privata nyckeln (extractable:false). */
  privateKey: CryptoKey;
  /** Publika nyckeln (extractable så vi kan exportera SPKI). */
  publicKey: CryptoKey;
  /** Råa 32-byte:s pubkey-värdet (för SSH-format-konvertering). */
  rawPublicKey: Uint8Array;
  createdAt: string;
}

/**
 * Är WebCrypto Ed25519 tillgängligt i den här browser:n?
 * Testar genom att försöka generera ett nyckelpar. Cachar resultatet
 * mellan anrop.
 */
let cachedSupport: boolean | null = null;
export async function isEd25519Supported(): Promise<boolean> {
  if (cachedSupport !== null) return cachedSupport;
  if (typeof crypto === "undefined" || !crypto.subtle) {
    cachedSupport = false;
    return false;
  }
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    cachedSupport = true;
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

/**
 * Generera ett nytt Ed25519-nyckelpar. Privata nyckeln är
 * non-extractable; publika nyckeln är extractable så vi kan
 * konvertera den till SSH-format.
 */
export async function generateKeypair(): Promise<StoredKeypair> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    false, // extractable false → privata nyckeln kan aldrig läcka
    ["sign", "verify"],
  ) as CryptoKeyPair;

  // Publika nyckeln behöver vi få ut råa byte:s från. Den genererade
  // pubkey:n är extractable (Web Crypto-API:t skapar dem som extractable
  // när vi sätter privata sidan icke-extractable).
  const spki = await crypto.subtle.exportKey("raw", pair.publicKey);
  const rawPublicKey = new Uint8Array(spki);

  return {
    id: DEFAULT_KEY_ID,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    rawPublicKey,
    createdAt: new Date().toISOString(),
  };
}

/** Spara nyckelpar i IndexedDB. */
export async function saveKeypair(kp: StoredKeypair): Promise<void> {
  const db = await openDb();
  await put(db, kp.id, {
    id: kp.id,
    privateKey: kp.privateKey,
    publicKey: kp.publicKey,
    rawPublicKey: kp.rawPublicKey,
    createdAt: kp.createdAt,
  });
  db.close();
}

/** Ladda sparat nyckelpar (eller null om ingenting finns). */
export async function loadKeypair(id = DEFAULT_KEY_ID): Promise<StoredKeypair | null> {
  const db = await openDb();
  const value = await get(db, id);
  db.close();
  if (!value) return null;
  return value as StoredKeypair;
}

/** Radera lagrat nyckelpar. */
export async function deleteKeypair(id = DEFAULT_KEY_ID): Promise<void> {
  const db = await openDb();
  await del(db, id);
  db.close();
}

// ─── IndexedDB-helpers ───────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    void key;
  });
}

function get(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function del(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
