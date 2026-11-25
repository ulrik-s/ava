/**
 * Klientens principal (#1864): rollen läses ur den inloggades rad i den lokala
 * datan, och blir aldrig ADMIN som standard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import {
  bindClientOrganization, clientPrincipal, clientPrincipalId, FALLBACK_CLIENT_ROLE, MANY_ORGANIZATIONS_MESSAGE,
  NO_ORGANIZATION_MESSAGE, resolveClientPrincipal, resolveClientRole, resolveOrganizationId,
  type ClientIdentityConfig,
} from "@/lib/client/backend/client-principal";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
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

/** En store med de givna byråerna (#1865). */
function storeWithOrgs(ids: string[]): LocalStore {
  return new LocalStore({ organizations: ids.map((id) => ({ id, name: `Byrå ${id}` })) }, async () => {});
}

describe("resolveOrganizationId (#1865)", () => {
  it("det sparade org-id:t, utan att läsa storen", async () => {
    expect(await resolveOrganizationId(storeWithOrgs([]), "org-sparad")).toBe("org-sparad");
  });

  it("utan sparat id: den enda byrån i den synkade datan", async () => {
    expect(await resolveOrganizationId(storeWithOrgs(["org-server"]), "")).toBe("org-server");
  });

  it("ingen byrå: ett begripligt fel", async () => {
    await expect(resolveOrganizationId(storeWithOrgs([]), "")).rejects.toThrow(NO_ORGANIZATION_MESSAGE);
    expect(NO_ORGANIZATION_MESSAGE).toBe("Hittade ingen byrå på servern. Kontrollera att du är uppkopplad och försök igen.");
  });

  it("flera byråer: AVA väljer inte", async () => {
    await expect(resolveOrganizationId(storeWithOrgs(["a", "b"]), "")).rejects.toThrow(MANY_ORGANIZATIONS_MESSAGE);
    expect(MANY_ORGANIZATIONS_MESSAGE).toBe("Servern har flera byråer. AVA kan inte välja.");
  });
});

describe("resolveClientPrincipal i bindningsfasen (#1865)", () => {
  it("utan sparat org-id får principalen byrån ur den synkade datan", async () => {
    const p = await resolveClientPrincipal(storeWithOrgs(["org-server"]), { ...cfg, organizationId: "" }, { binding: true });
    expect(p).toMatchObject({ organizationId: "org-server", role: "ASSISTANT" });
  });
});

describe("bindClientOrganization (#1865)", () => {
  beforeEach(() => { localStorage.clear(); });

  it("ett sparat org-id: ingen bindning, ingen omladdning", () => {
    const reload = vi.fn();
    expect(bindClientOrganization({ organizationId: "org-1" }, "org-1", reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem("ava.firma")).toBeNull();
  });

  it("utan sparat org-id: sparar byrån och laddar om", () => {
    const reload = vi.fn();
    expect(bindClientOrganization({ organizationId: "" }, "org-server", reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(loadFirmaConfig().organizationId).toBe("org-server");
  });

  it("laddar om sidan som standard", () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    expect(bindClientOrganization({ organizationId: "" }, "org-server")).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    reload.mockRestore();
  });
});
