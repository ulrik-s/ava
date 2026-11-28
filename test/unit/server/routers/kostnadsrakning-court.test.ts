/**
 * Kostnadsräkningens domstol väljs i dialogen (#1891).
 *
 * `billingRun.createKostnadsrakning` tar det valfria `courtContactId`: en kontakt
 * i byrån med typen Domstol, vars namn står i anteckningen. Utan fältet gäller
 * ärendets domstol. Ärendets parter ändras inte. Körs genom hela routern mot en
 * riktig in-memory-store.
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const M = asId<"MatterId">("m-1");
const REJECTED = { code: "BAD_REQUEST", message: "Domstolen finns inte." };

function makeCaller() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }, { id: "org-2", name: "Y" }],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "AA2026-0001", title: "T", status: "ACTIVE",
      paymentMethod: "OFFENTLIGT_UPPDRAG", courtCaseNumber: "B 123-26", responsibleLawyerId: "u-1", createdAt: new Date(),
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRates: { ARBETE: 250_000 } }],
    contacts: [
      { id: "c-dom", organizationId: "org-1", name: "Stockholms tingsrätt", contactType: "COURT" },
      { id: "c-hov", organizationId: "org-1", name: "Svea hovrätt", contactType: "COURT" },
      { id: "c-per", organizationId: "org-1", name: "Per Person", contactType: "PERSON" },
      { id: "c-annan", organizationId: "org-2", name: "Göta hovrätt", contactType: "COURT" },
    ],
    // Kontakt-joinen förbakad som i demo-seeden.
    matterContacts: [{ id: "mc-1", matterId: "m-1", contactId: "c-dom", role: "DOMSTOL", contact: { id: "c-dom", name: "Stockholms tingsrätt" } }],
    timeEntries: [{
      id: "te-1", organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date(),
      minutes: 120, description: "Möte", hourlyRate: 250_000, billable: true,
    }],
    expenses: [],
    invoices: [],
  }, async () => { /* skrivbar: noop write-back */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}
type Caller = ReturnType<typeof makeCaller>;

const norm = (s: string): string => s.replace(/\s/g, " ");
async function noteTexts(c: Caller): Promise<string[]> {
  return (await c.serviceNote.list({ matterId: M })).map((n) => norm(n.text));
}

describe("createKostnadsrakning med vald domstol (#1891)", () => {
  it("anteckningen nämner den valda domstolen; ärendets parter och målnummer är oförändrade", async () => {
    const c = makeCaller();
    const before = await c.matter.getById({ id: M });
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: M, courtContactId: asId("c-hov") });
    expect((await noteTexts(c)).at(-1)).toMatch(new RegExp(`^Kostnadsräkning ${run.reference ?? ""} till Svea hovrätt skapad — `));
    const after = await c.matter.getById({ id: M });
    expect(after.courtCaseNumber).toBe("B 123-26");
    expect(after.contacts.map((mc) => [mc.role, mc.contactId])).toEqual(before.contacts.map((mc) => [mc.role, mc.contactId]));
  });

  it("utan courtContactId: ärendets domstol, som förut", async () => {
    const c = makeCaller();
    const { run } = await c.billingRun.createKostnadsrakning({ matterId: M });
    expect((await noteTexts(c)).at(-1)).toMatch(new RegExp(`^Kostnadsräkning ${run.reference ?? ""} till Stockholms tingsrätt skapad — `));
  });

  it.each([
    ["en kontakt som inte är en domstol", "c-per"],
    ["en annan byrås domstol", "c-annan"],
    ["ett id som inte finns", "c-saknas"],
  ])("%s ger BAD_REQUEST, och ingen kostnadsräkning skapas", async (_label, id) => {
    const c = makeCaller();
    await expect(c.billingRun.createKostnadsrakning({ matterId: M, courtContactId: asId(id) })).rejects.toMatchObject(REJECTED);
    expect(await noteTexts(c)).toEqual([]);
    expect((await c.billingRun.proposal({ matterId: M })).timeEntries.map((t) => t.id)).toEqual(["te-1"]);
  });
});
