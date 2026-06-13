import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  acceptedPublicKeys,
  assertSignature,
  RELEASE_PUBLIC_KEY_SPKI_B64,
  signatureAssetName,
  verifyEd25519,
} from "../src/update-verify.ts";

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, pubB64: publicKey.export({ format: "der", type: "spki" }).toString("base64") };
}

describe("signatureAssetName", () => {
  test("lägger .sig efter binär-assetens namn", () => {
    expect(signatureAssetName("ava-helper-linux-x64")).toBe("ava-helper-linux-x64.sig");
  });
});

describe("verifyEd25519", () => {
  const data = Buffer.from("AVA helper binär-bytes");

  test("true för en signatur som matchar pubkey + data", () => {
    const { privateKey, pubB64 } = keypair();
    expect(verifyEd25519(data, sign(null, data, privateKey), pubB64)).toBe(true);
  });

  test("false när datat manipulerats", () => {
    const { privateKey, pubB64 } = keypair();
    const sig = sign(null, data, privateKey);
    expect(verifyEd25519(Buffer.from("manipulerat"), sig, pubB64)).toBe(false);
  });

  test("false för fel nyckel", () => {
    const { privateKey } = keypair();
    const { pubB64: otherPub } = keypair();
    expect(verifyEd25519(data, sign(null, data, privateKey), otherPub)).toBe(false);
  });

  test("false (kastar ej) för skräp-nyckel", () => {
    const { privateKey } = keypair();
    expect(verifyEd25519(data, sign(null, data, privateKey), "inte-base64-spki")).toBe(false);
  });
});

describe("assertSignature", () => {
  const data = Buffer.from("payload");

  test("ingen pinnad nyckel → kastar (fail-closed)", () => {
    const { privateKey } = keypair();
    expect(() => assertSignature(data, sign(null, data, privateKey), [])).toThrow(/ingen pinnad release-nyckel/);
  });

  test("matchande nyckel → kastar inte", () => {
    const { privateKey, pubB64 } = keypair();
    expect(() => assertSignature(data, sign(null, data, privateKey), [pubB64])).not.toThrow();
  });

  test("accepterar om NÅGON av flera nycklar matchar (rotation)", () => {
    const { privateKey, pubB64 } = keypair();
    const { pubB64: oldPub } = keypair();
    expect(() => assertSignature(data, sign(null, data, privateKey), [oldPub, pubB64])).not.toThrow();
  });

  test("ingen nyckel matchar → kastar", () => {
    const { privateKey } = keypair();
    const { pubB64: wrong } = keypair();
    expect(() => assertSignature(data, sign(null, data, privateKey), [wrong])).toThrow(/matchar ingen pinnad/);
  });
});

describe("RELEASE_PUBLIC_KEY_SPKI_B64 / acceptedPublicKeys", () => {
  test("oprovisionerad pinnad nyckel är tom → inga accepterade nycklar (fail-closed default)", () => {
    // Tom tills release-nyckeln bakats in; säkerställer att osignerade
    // uppdateringar vägras out-of-the-box (#110).
    expect(RELEASE_PUBLIC_KEY_SPKI_B64).toBe("");
    expect(acceptedPublicKeys()).toEqual([]);
  });
});
