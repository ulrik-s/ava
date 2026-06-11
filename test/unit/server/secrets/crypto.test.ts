import { describe, it, expect } from "vitest-compat";
import { decryptSecret, encryptSecret, loadMasterKey } from "@/lib/server/secrets/crypto";

const key = Buffer.alloc(32, 7);
const wrongKey = Buffer.alloc(32, 9);

describe("secrets/crypto", () => {
  it("krypterar och dekrypterar (roundtrip)", () => {
    const blob = encryptSecret("hemlig text åäö", key);
    expect(blob).not.toContain("hemlig"); // klartext syns inte
    expect(blob.split(":")).toHaveLength(3); // iv:tag:ct
    expect(decryptSecret(blob, key)).toBe("hemlig text åäö");
  });

  it("fel nyckel kan inte dekryptera (GCM auth)", () => {
    const blob = encryptSecret("x", key);
    expect(() => decryptSecret(blob, wrongKey)).toThrow();
  });

  it("manipulerad ciphertext upptäcks", () => {
    const parts = encryptSecret("orörd", key).split(":");
    parts[2] = Buffer.from("manipulerad-ct").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });

  it("ogiltigt format kastar", () => {
    expect(() => decryptSecret("inte-ett-giltigt-blob", key)).toThrow(/format/);
  });

  it("loadMasterKey validerar base64 32-byte", () => {
    expect(() => loadMasterKey(undefined)).toThrow(/saknas/);
    expect(() => loadMasterKey(Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 byte/);
    expect(loadMasterKey(Buffer.alloc(32, 1).toString("base64")).length).toBe(32);
  });
});
