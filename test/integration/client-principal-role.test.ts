/**
 * Klientens principal i in-process-klienten (#1864): routrarna körs lokalt med
 * den roll som lästs ur den inloggades rad. En jurist som försöker en
 * adminhandling avvisas redan lokalt med serverns fel; en admin släpps igenom.
 */
import { createTRPCClient, type TRPCClient } from "@trpc/client";
import { describe, expect, it } from "vitest-compat";
import { resolveClientPrincipal } from "@/lib/client/backend/client-principal";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import type { AppRouter } from "@/lib/server/routers/_app";

const ORG = "00000000-0000-7000-8000-000000000001";
const LAWYER = "00000000-0000-7000-8000-000000000002";
const ADMIN = "00000000-0000-7000-8000-000000000003";

function world(): LocalStore {
  return new LocalStore({
    organizations: [{ id: ORG, name: "Byrån", bankgiro: "111-1111" }],
    users: [
      { id: LAWYER, organizationId: ORG, email: "l@byra.se", name: "Lena", role: "LAWYER" },
      { id: ADMIN, organizationId: ORG, email: "a@byra.se", name: "Adam", role: "ADMIN" },
    ],
  }, async () => {});
}

/** Klienten som i appen: principalen löst ur storen, routrarna in-process. */
async function clientAs(store: LocalStore, principalId: string): Promise<TRPCClient<AppRouter>> {
  const principal = await resolveClientPrincipal(store, {
    tier: "self-hosted", principalId, organizationId: ORG, authorEmail: "x@byra.se", authorName: "X",
  });
  const link = new GitBackendRuntime({ dataStore: store, authProvider: new GitAuthProvider(principal) }).createLink();
  return createTRPCClient<AppRouter>({ links: [link] });
}

describe("klientens principal i in-process-klienten (#1864)", () => {
  it("en jurist som byter sin egen roll avvisas lokalt", async () => {
    const api = await clientAs(world(), LAWYER);
    await expect(api.user.update.mutate({ id: LAWYER, role: "ADMIN" }))
      .rejects.toThrow("Endast administratörer kan ändra roller.");
  });

  it("en jurist som ändrar byråns uppgifter avvisas lokalt", async () => {
    const store = world();
    const api = await clientAs(store, LAWYER);
    await expect(api.organization.updateSettings.mutate({ bankgiro: "222-2222" })).rejects.toThrow();
    expect((await store.organizations.findFirst({ where: { id: ORG } }) as { bankgiro: string }).bankgiro).toBe("111-1111");
  });

  it("en admin får byta roll och ändra byråns uppgifter", async () => {
    const store = world();
    const api = await clientAs(store, ADMIN);
    await api.user.update.mutate({ id: LAWYER, role: "ASSISTANT" });
    await api.organization.updateSettings.mutate({ bankgiro: "222-2222" });
    expect((await store.users.findFirst({ where: { id: LAWYER } }) as { role: string }).role).toBe("ASSISTANT");
    expect((await store.organizations.findFirst({ where: { id: ORG } }) as { bankgiro: string }).bankgiro).toBe("222-2222");
  });
});
