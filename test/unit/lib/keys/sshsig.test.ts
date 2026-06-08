/**
 * Tester för SSHSIG-strukturen. Vi kan inte verifiera mot
 * `ssh-keygen -Y verify` här (saknas i Node), men vi kan kolla:
 *   - Armor-format korrekt (BEGIN/END-rader, base64-radbrytning)
 *   - Wire-format börjar med "SSHSIG" + version 1
 *   - Pubkey + namespace + signature embed:as i rätt offsets
 */

import { describe, it, expect } from "vitest-compat";
import { sshsigSign } from "@/lib/client/keys/sshsig";

const ZERO_PUBKEY = new Uint8Array(32);
// 64-byte:s signatur (alla nollor) — bara för struktur-test
const fakeSign = async (_data: Uint8Array): Promise<Uint8Array> => new Uint8Array(64);

describe("sshsigSign", () => {
  it("returnerar armored PEM-format med BEGIN/END-rader", async () => {
    const sig = await sshsigSign({
      publicKey: ZERO_PUBKEY,
      sign: fakeSign,
      message: new TextEncoder().encode("hello world"),
    });
    expect(sig.startsWith("-----BEGIN SSH SIGNATURE-----\n")).toBe(true);
    expect(sig.endsWith("\n-----END SSH SIGNATURE-----")).toBe(true);
  });

  it("base64-payload har radbrytning ≤ 70 chars", async () => {
    const sig = await sshsigSign({
      publicKey: ZERO_PUBKEY,
      sign: fakeSign,
      message: new TextEncoder().encode("hello"),
    });
    const middle = sig.split("\n").slice(1, -1);
    for (const line of middle) {
      expect(line.length).toBeLessThanOrEqual(70);
    }
  });

  it("decode:ad wire-format börjar med 'SSHSIG' + version 1", async () => {
    const sig = await sshsigSign({
      publicKey: ZERO_PUBKEY,
      sign: fakeSign,
      message: new TextEncoder().encode("data"),
    });
    const b64 = sig.split("\n").slice(1, -1).join("");
    const bytes = base64Decode(b64);
    const magic = new TextDecoder().decode(bytes.slice(0, 6));
    expect(magic).toBe("SSHSIG");
    // Nästa 4 bytes: uint32be version
    const version = (bytes[6]! << 24) | (bytes[7]! << 16) | (bytes[8]! << 8) | bytes[9]!;
    expect(version).toBe(1);
  });

  it("samma input → samma output (deterministisk för fake sign)", async () => {
    const a = await sshsigSign({ publicKey: ZERO_PUBKEY, sign: fakeSign, message: new TextEncoder().encode("x") });
    const b = await sshsigSign({ publicKey: ZERO_PUBKEY, sign: fakeSign, message: new TextEncoder().encode("x") });
    expect(a).toBe(b);
  });

  it("olika meddelanden → olika signaturer (via olika hash)", async () => {
    // Capture vad sign-funktionen får för indata
    let lastData: Uint8Array | null = null;
    const captureSign = async (data: Uint8Array): Promise<Uint8Array> => {
      lastData = data;
      return new Uint8Array(64);
    };
    await sshsigSign({ publicKey: ZERO_PUBKEY, sign: captureSign, message: new TextEncoder().encode("apple") });
    const dataA = lastData;
    await sshsigSign({ publicKey: ZERO_PUBKEY, sign: captureSign, message: new TextEncoder().encode("banana") });
    const dataB = lastData;
    expect(dataA).not.toBeNull();
    expect(dataB).not.toBeNull();
    expect(Array.from(dataA!)).not.toEqual(Array.from(dataB!));
  });

  it("kastar om sign-callback returnerar fel storlek", async () => {
    const badSign = async (): Promise<Uint8Array> => new Uint8Array(32); // för kort
    await expect(sshsigSign({
      publicKey: ZERO_PUBKEY, sign: badSign, message: new TextEncoder().encode("x"),
    })).rejects.toThrow(/64 bytes/);
  });
});

function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
