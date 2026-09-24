/**
 * `contacts.search` (#1128) — klientsöket i "Välj klient…" matchar som
 * jävskontrollen: förnamn, efternamn, personnummer, var för sig eller tillsammans.
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

function caller() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrån" }, { id: "org-2", name: "Annan byrå" }],
    contacts: [
      { id: "c1", organizationId: "org-1", name: "Anna Karlsson", contactType: "PERSON", personalNumber: "19800101-1234", parentId: null },
      { id: "c2", organizationId: "org-1", name: "Annika Berg", contactType: "PERSON", personalNumber: "19750505-4321", parentId: null },
      { id: "c3", organizationId: "org-1", name: "Lindström Bygg AB", contactType: "COMPANY", orgNumber: "556677-8899", parentId: null },
      // Kontaktperson under bolaget — väljs inte som klient.
      { id: "c4", organizationId: "org-1", name: "Anna Lindström", contactType: "PERSON", parentId: "c3" },
      // Annan byrås kontakt — får aldrig synas.
      { id: "c5", organizationId: "org-2", name: "Anna Andersson", contactType: "PERSON", parentId: null },
    ],
  }, async () => { /* noop write-back */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

const names = (r: { contacts: Array<{ name: string }> }) => r.contacts.map((c) => c.name);

describe("contacts.search (#1128)", () => {
  it("förnamnet ensamt hittar klienten (prefix: 'Ann' → Anna och Annika)", async () => {
    expect(names(await caller().contacts.search({ term: "Ann" }))).toEqual(["Anna Karlsson", "Annika Berg"]);
  });

  it("efternamn, personnummer och orgnummer var för sig", async () => {
    const c = caller();
    expect(names(await c.contacts.search({ term: "Karlsson" }))).toEqual(["Anna Karlsson"]);
    expect(names(await c.contacts.search({ term: "800101-1234" }))).toEqual(["Anna Karlsson"]);
    expect(names(await c.contacts.search({ term: "5566778899" }))).toEqual(["Lindström Bygg AB"]);
  });

  it("namn + personnummer tillsammans — träff på båda rankas först", async () => {
    const r = await caller().contacts.search({ term: "Anna 19750505-4321" });
    expect(names(r)[0]).toBe("Annika Berg");
  });

  it("kontaktpersoner och andra byråers kontakter syns inte", async () => {
    const r = names(await caller().contacts.search({ term: "Anna" }));
    expect(r).not.toContain("Anna Lindström");
    expect(r).not.toContain("Anna Andersson");
  });

  it("respekterar limit", async () => {
    expect((await caller().contacts.search({ term: "Ann", limit: 1 })).contacts).toHaveLength(1);
  });
});
