/**
 * Klientens principal (#1864): rollen läses ur den inloggades rad i den lokala
 * datan, och blir aldrig ADMIN som standard.
 */
import { describe, expect, it } from "vitest-compat";
import {
  clientPrincipal, clientPrincipalId, FALLBACK_CLIENT_ROLE, resolveClientPrincipal, resolveClientRole,
  type ClientIdentityConfig,
} from "@/lib/client/backend/client-principal";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";

function storeWith(): LocalStore {
  return new LocalStore({
    users: [
      { id: "u-lawyer", organizationId: "org-1", email: "l@byra.se", name: "Lena", role: "LAWYER" },
      { id: "u-admin", organizationId: "org-1", email: "a@byra.se", name: "Adam", role: "ADMIN" },
      { id: "u-gone", organizationId: "org-1", email: "g@byra.se", name: "Borta", role: "ADMIN", deletedAt: new Date() },
    ],
  }, async () => {});
}

const { principalId: _unbound, ...unbound } = {
  tier: "self-hosted" as const, principalId: "u-lawyer", organizationId: "org-1", authorEmail: "l@byra.se", authorName: "Lena",
};
const cfg: ClientIdentityConfig = {
  tier: "self-hosted", principalId: "u-lawyer", organizationId: "org-1", authorEmail: "l@byra.se", authorName: "Lena",
};

describe("resolveClientRole", () => {
  it("ger radens roll", async () => {
    expect(await resolveClientRole(storeWith(), "u-lawyer", "org-1")).toBe("LAWYER");
    expect(await resolveClientRole(storeWith(), "u-admin", "org-1")).toBe("ADMIN");
  });

  it("ASSISTANT utan rad, i en annan byrå, för en raderad rad och med tomt id — aldrig ADMIN", async () => {
    expect(await resolveClientRole(storeWith(), "okand", "org-1")).toBe("ASSISTANT");
    expect(await resolveClientRole(storeWith(), "u-admin", "org-2")).toBe("ASSISTANT");
    expect(await resolveClientRole(storeWith(), "u-gone", "org-1")).toBe("ASSISTANT");
    expect(await resolveClientRole(storeWith(), "", "org-1")).toBe("ASSISTANT");
    expect(FALLBACK_CLIENT_ROLE).toBe("ASSISTANT");
  });
});

describe("clientPrincipalId", () => {
  it("den bundna användaren, annars current-user i self-hosted och tomt i demon", () => {
    expect(clientPrincipalId(cfg)).toBe("u-lawyer");
    expect(clientPrincipalId(unbound)).toBe("current-user");
    expect(clientPrincipalId({ ...cfg, tier: "demo", principalId: "" })).toBe("");
  });
});

describe("clientPrincipal", () => {
  it("bygger principalen ur configen och rollen", () => {
    expect(clientPrincipal(cfg, "LAWYER")).toEqual({
      id: "u-lawyer", email: "l@byra.se", name: "Lena", role: "LAWYER", organizationId: "org-1",
    });
  });
});

describe("resolveClientPrincipal", () => {
  it("läser rollen ur den inloggades rad", async () => {
    expect((await resolveClientPrincipal(storeWith(), cfg)).role).toBe("LAWYER");
    expect((await resolveClientPrincipal(storeWith(), { ...cfg, principalId: "u-admin" })).role).toBe("ADMIN");
  });

  it("demon utan principal ger ASSISTANT, inte ADMIN", async () => {
    const p = await resolveClientPrincipal(storeWith(), { ...cfg, tier: "demo", principalId: "" });
    expect(p).toMatchObject({ id: "", role: "ASSISTANT" });
  });

  it("bindningsfasen ger ASSISTANT utan att läsa storen", async () => {
    const p = await resolveClientPrincipal(storeWith(), { ...cfg, principalId: "u-admin" }, { binding: true });
    expect(p.role).toBe("ASSISTANT");
  });
});
