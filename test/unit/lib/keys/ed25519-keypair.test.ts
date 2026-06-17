/**
 * Tester för `ed25519-keypair` (#27 coverage-ratchet).
 *
 * Bun:s runtime har äkta WebCrypto-Ed25519 (happy-dom saknar det INTE här —
 * `crypto.subtle.generateKey({name:"Ed25519"})` funkar), så vi testar
 * krypto-lagret på riktigt. IndexedDB-lagret testas mot fake-indexeddb
 * (happy-dom saknar IndexedDB) genom att stoppa in en `IDBFactory` som
 * global `indexedDB` per test — `--isolate` håller mutationen i denna fil.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeEach } from "vitest-compat";
import {
  isEd25519Supported,
  generateKeypair,
  saveKeypair,
  loadKeypair,
  deleteKeypair,
  type StoredKeypair,
} from "@/lib/client/keys/ed25519-keypair";

beforeEach(() => {
  // Färsk in-memory-IndexedDB per test → ingen läckning mellan testfall.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe("isEd25519Supported", () => {
  it("returnerar true i bun-runtime (äkta WebCrypto Ed25519)", async () => {
    expect(await isEd25519Supported()).toBe(true);
  });

  it("cachar resultatet (andra anropet ger samma svar utan ny nyckel)", async () => {
    const first = await isEd25519Supported();
    const second = await isEd25519Supported();
    expect(second).toBe(first);
  });
});

describe("generateKeypair", () => {
  it("genererar ett par med non-extractable privat nyckel + 32-byte rå pubkey", async () => {
    const kp = await generateKeypair();
    expect(kp.id).toBe("primary");
    expect(kp.privateKey.type).toBe("private");
    expect(kp.privateKey.extractable).toBe(false);
    expect(kp.publicKey.type).toBe("public");
    expect(kp.rawPublicKey).toBeInstanceOf(Uint8Array);
    expect(kp.rawPublicKey.length).toBe(32);
    expect(() => new Date(kp.createdAt).toISOString()).not.toThrow();
  });

  it("privata nyckeln kan signera, publika kan verifiera (paret hör ihop)", async () => {
    const kp = await generateKeypair();
    const msg = new TextEncoder().encode("ava round-trip");
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, msg);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, kp.publicKey, sig, msg);
    expect(ok).toBe(true);
  });

  it("två anrop ger olika nycklar (slumpmässig generering)", async () => {
    const a = await generateKeypair();
    const b = await generateKeypair();
    expect(Array.from(a.rawPublicKey)).not.toEqual(Array.from(b.rawPublicKey));
  });
});

describe("IndexedDB-persistens (save / load / delete)", () => {
  it("loadKeypair på tom DB → null", async () => {
    expect(await loadKeypair()).toBeNull();
  });

  it("save → load round-trippar nyckelparet", async () => {
    const kp = await generateKeypair();
    await saveKeypair(kp);
    const loaded = await loadKeypair();
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe("primary");
    expect(Array.from(loaded!.rawPublicKey)).toEqual(Array.from(kp.rawPublicKey));
    // CryptoKey:erna överlever IndexedDB:s strukturerade kloning.
    expect(loaded?.privateKey.type).toBe("private");
    expect(loaded?.publicKey.type).toBe("public");
  });

  it("save skriver över tidigare under samma id", async () => {
    const first = await generateKeypair();
    await saveKeypair(first);
    const second = await generateKeypair();
    await saveKeypair(second);
    const loaded = await loadKeypair();
    expect(Array.from(loaded!.rawPublicKey)).toEqual(Array.from(second.rawPublicKey));
  });

  it("deleteKeypair tömmer → load returnerar null igen", async () => {
    const kp = await generateKeypair();
    await saveKeypair(kp);
    expect(await loadKeypair()).not.toBeNull();
    await deleteKeypair();
    expect(await loadKeypair()).toBeNull();
  });

  it("stödjer flera id:n parallellt (default 'primary' + custom)", async () => {
    const kp = await generateKeypair();
    await saveKeypair(kp);
    const custom: StoredKeypair = { ...kp, id: "ipad" };
    await saveKeypair(custom);
    expect((await loadKeypair("primary"))?.id).toBe("primary");
    expect((await loadKeypair("ipad"))?.id).toBe("ipad");
    await deleteKeypair("ipad");
    expect(await loadKeypair("ipad")).toBeNull();
    // 'primary' är orörd.
    expect(await loadKeypair("primary")).not.toBeNull();
  });

  it("deleteKeypair på okänt id är en no-op (kastar ej)", async () => {
    await expect(deleteKeypair("does-not-exist")).resolves.toBeUndefined();
  });
});
