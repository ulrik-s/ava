/**
 * Tester för passkey-ceremony-helpers — de fyra rena funktioner som
 * orkestrerar WebAuthn-flödet utan att veta om Prisma/Next.
 *
 * SOLID:
 *   - Single responsibility: varje funktion gör ett steg av FIDO-ceremoni.
 *   - DI: storage-interface (`IPasskeyStore`) injiceras så vi kan testa
 *     utan databas.
 *   - DRY: rpId/origin är configurable via en `PasskeyConfig`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
  type IPasskeyStore,
  type PasskeyConfig,
} from "@/server/auth/passkey-ceremony";

const config: PasskeyConfig = {
  rpName: "AVA",
  rpId: "localhost",
  origin: "http://localhost:3000",
};

function makeStore(): IPasskeyStore & { _data: { challenges: Map<string, string>; passkeys: Map<string, unknown> } } {
  const challenges = new Map<string, string>();
  const passkeys = new Map<string, unknown>();
  return {
    _data: { challenges, passkeys },
    async saveChallenge(userIdOrHandle, challenge) {
      challenges.set(userIdOrHandle, challenge);
    },
    async readChallenge(userIdOrHandle) {
      return challenges.get(userIdOrHandle) ?? null;
    },
    async clearChallenge(userIdOrHandle) {
      challenges.delete(userIdOrHandle);
    },
    async savePasskey(passkey) {
      passkeys.set(passkey.id, passkey);
    },
    async findPasskeyById(id) {
      return (passkeys.get(id) as never) ?? null;
    },
    async listPasskeysForUser(userId) {
      const all: unknown[] = [];
      for (const p of passkeys.values()) {
        if ((p as { userId: string }).userId === userId) all.push(p);
      }
      return all as never;
    },
    async updateCounter(id, counter) {
      const p = passkeys.get(id) as { counter: bigint } | undefined;
      if (p) p.counter = counter;
    },
  };
}

describe("beginRegistration", () => {
  it("genererar options med rätt rp + user-fält", async () => {
    const store = makeStore();
    const result = await beginRegistration({
      config,
      store,
      user: { id: "u1", email: "anna@x", name: "Anna" },
    });
    expect(result.options.rp.name).toBe("AVA");
    expect(result.options.rp.id).toBe("localhost");
    expect(result.options.user.name).toBe("anna@x");
    expect(result.options.user.displayName).toBe("Anna");
    expect(result.options.challenge).toBeDefined();
  });

  it("sparar challenge i store så finishRegistration kan verifiera", async () => {
    const store = makeStore();
    await beginRegistration({
      config, store,
      user: { id: "u1", email: "a@b", name: "A" },
    });
    expect(store._data.challenges.has("u1")).toBe(true);
  });

  it("excludeCredentials populeras med användarens befintliga passkeys", async () => {
    const store = makeStore();
    await store.savePasskey({
      id: "existing-cred-id", userId: "u1",
      publicKey: "pk", counter: BigInt(0), transports: [],
      backedUp: false, deviceType: "Device", createdAt: new Date(),
    } as never);
    const result = await beginRegistration({
      config, store,
      user: { id: "u1", email: "a@b", name: "A" },
    });
    expect(result.options.excludeCredentials).toHaveLength(1);
    expect(result.options.excludeCredentials![0].id).toBe("existing-cred-id");
  });
});

describe("finishRegistration", () => {
  it("kastar om ingen challenge sparad för användaren", async () => {
    const store = makeStore();
    await expect(finishRegistration({
      config, store,
      userId: "u1",
      response: { id: "x", rawId: "x", type: "public-key", response: {}, clientExtensionResults: {} } as never,
    })).rejects.toThrow(/challenge/i);
  });

  it("rensar challenge efter finish (oavsett om verify lyckades)", async () => {
    const store = makeStore();
    await store.saveChallenge("u1", "test-challenge");
    try {
      await finishRegistration({
        config, store,
        userId: "u1",
        response: { id: "invalid", rawId: "invalid", type: "public-key", response: {}, clientExtensionResults: {} } as never,
      });
    } catch { /* förväntad — invalid response */ }
    expect(store._data.challenges.has("u1")).toBe(false);
  });
});

describe("beginAuthentication", () => {
  it("genererar options med tom allowCredentials för usernameless flow", async () => {
    const store = makeStore();
    const result = await beginAuthentication({ config, store, handle: "anon-session-1" });
    expect(result.options.challenge).toBeDefined();
    expect(result.options.allowCredentials).toEqual([]);
    expect(result.options.rpId).toBe("localhost");
  });

  it("sparar challenge under given handle", async () => {
    const store = makeStore();
    await beginAuthentication({ config, store, handle: "session-42" });
    expect(store._data.challenges.has("session-42")).toBe(true);
  });

  it("filtrerar allowCredentials per användare om userId ges", async () => {
    const store = makeStore();
    await store.savePasskey({
      id: "u1-cred", userId: "u1",
      publicKey: "pk", counter: BigInt(0), transports: ["internal"],
      backedUp: false, deviceType: "Device", createdAt: new Date(),
    } as never);
    await store.savePasskey({
      id: "u2-cred", userId: "u2",
      publicKey: "pk2", counter: BigInt(0), transports: [],
      backedUp: false, deviceType: "Device", createdAt: new Date(),
    } as never);

    const result = await beginAuthentication({
      config, store, handle: "session-1", userId: "u1",
    });
    expect(result.options.allowCredentials).toHaveLength(1);
    expect(result.options.allowCredentials![0].id).toBe("u1-cred");
  });
});

describe("finishAuthentication", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => { store = makeStore(); });

  it("kastar om challenge inte finns", async () => {
    await expect(finishAuthentication({
      config, store, handle: "session-1",
      response: { id: "x", rawId: "x", type: "public-key", response: {}, clientExtensionResults: {} } as never,
    })).rejects.toThrow(/challenge/i);
  });

  it("kastar om passkey-id inte är registrerat", async () => {
    await store.saveChallenge("session-1", "test");
    await expect(finishAuthentication({
      config, store, handle: "session-1",
      response: { id: "missing", rawId: "missing", type: "public-key", response: {}, clientExtensionResults: {} } as never,
    })).rejects.toThrow(/credential|passkey/i);
  });

  it("clearar challenge efter authentikation-försök", async () => {
    await store.saveChallenge("s1", "ch");
    await store.savePasskey({
      id: "cred", userId: "u1",
      publicKey: "pk", counter: BigInt(0), transports: [],
      backedUp: false, deviceType: "Device", createdAt: new Date(),
    } as never);
    try {
      await finishAuthentication({
        config, store, handle: "s1",
        response: { id: "cred", rawId: "cred", type: "public-key", response: {}, clientExtensionResults: {} } as never,
      });
    } catch { /* förväntat fel — invalid signature */ }
    expect(store._data.challenges.has("s1")).toBe(false);
  });
});
