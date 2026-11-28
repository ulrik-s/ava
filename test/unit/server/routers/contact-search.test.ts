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

function caller(extra: ReadonlyArray<Record<string, unknown>> = []) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrån" }, { id: "org-2", name: "Annan byrå" }],
    contacts: [
      { id: "c1", organizationId: "org-1", name: "Anna Karlsson", contactType: "PERSON", personalNumber: "19800101-1234", email: "anna@exempel.se", parentId: null },
      { id: "c2", organizationId: "org-1", name: "Annika Berg", contactType: "PERSON", personalNumber: "19750505-4321", parentId: null },
      { id: "c6", organizationId: "org-1", name: "Björn Kask", contactType: "PERSON", parentId: null },
      { id: "c3", organizationId: "org-1", name: "Lindström Bygg AB", contactType: "COMPANY", orgNumber: "556677-8899", parentId: null },
      // Kontaktperson under bolaget — väljs inte som klient.
      { id: "c4", organizationId: "org-1", name: "Anna Lindström", contactType: "PERSON", parentId: "c3" },
      // Annan byrås kontakt — får aldrig synas.
      { id: "c5", organizationId: "org-2", name: "Anna Andersson", contactType: "PERSON", parentId: null },
      ...extra,
    ],
  }, async () => { /* noop write-back */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
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

  // #1866: delsträngsregeln — e-post, de fyra sista siffrorna och mitt i ett ord.
  it("e-post, de fyra sista siffrorna och en delsträng mitt i ett ord ger träff", async () => {
    const c = caller();
    expect(names(await c.contacts.search({ term: "anna@exempel" }))).toEqual(["Anna Karlsson"]);
    expect(names(await c.contacts.search({ term: "1234" }))).toEqual(["Anna Karlsson"]);
    expect(names(await c.contacts.search({ term: "sson" }))).toEqual(["Anna Karlsson"]);
  });

  it("delsträngsträffar rangordnas efter jävsträffarna", async () => {
    // "ka": Karlsson och Kask börjar på termen; Annika har den bara mitt i ordet.
    expect(names(await caller().contacts.search({ term: "ka" }))).toEqual(["Anna Karlsson", "Björn Kask", "Annika Berg"]);
  });
});

// #1891: Välj domstol i kostnadsräkningen söker bara bland byråns domstolar.
describe("contacts.search med contactType (#1891)", () => {
  const COURTS = [
    // Prefixträff på "rätt" — rankas före domstolarna, där termen står mitt i ordet.
    { id: "p-r", organizationId: "org-1", name: "Rätt Rasmus", contactType: "PERSON", parentId: null },
    { id: "d-1", organizationId: "org-1", name: "Attunda tingsrätt", contactType: "COURT", parentId: null },
    { id: "d-2", organizationId: "org-1", name: "Svea hovrätt", contactType: "COURT", parentId: null },
    { id: "d-x", organizationId: "org-2", name: "Göta hovrätt", contactType: "COURT", parentId: null },
  ];

  it("bara kontakter av typen, och filtret gäller före limit", async () => {
    const c = caller(COURTS);
    expect(names(await c.contacts.search({ term: "rätt", limit: 1 }))).toEqual(["Rätt Rasmus"]);
    expect(names(await c.contacts.search({ term: "rätt", contactType: "COURT", limit: 1 }))).toEqual(["Attunda tingsrätt"]);
    expect(names(await c.contacts.search({ term: "rätt", contactType: "COURT" }))).toEqual(["Attunda tingsrätt", "Svea hovrätt"]);
  });

  it("en annan byrås domstol syns inte", async () => {
    expect(names(await caller(COURTS).contacts.search({ term: "Göta", contactType: "COURT" }))).toEqual([]);
  });
});

// #1868: Parter (`contacts.list` med `search`) söker med samma regel som Välj klient.
describe("contacts.list med sökterm (#1868)", () => {
  const TERMS = ["Karlsson Anna", "Karlson", "198001011234", "1234", "anna@exempel", "sson"];

  it.each(TERMS)("'%s' ger samma kontakter som contacts.search", async (term) => {
    const c = caller();
    const list = await c.contacts.list({ search: term, pageSize: 100 });
    const search = await c.contacts.search({ term, limit: 100 });
    expect(names(list)).toEqual(names(search));
    expect(list.total).toBe(search.contacts.length);
    expect(list.contacts.length).toBeGreaterThan(0);
  });

  it("sidbläddring: sida 2 är nästa del av den rangordnade listan, med total och pages", async () => {
    const c = caller();
    const all = names(await c.contacts.search({ term: "ka" }));
    const p1 = await c.contacts.list({ search: "ka", page: 1, pageSize: 2 });
    const p2 = await c.contacts.list({ search: "ka", page: 2, pageSize: 2 });
    expect([...names(p1), ...names(p2)]).toEqual(all);
    expect(p1).toMatchObject({ total: 3, pages: 2 });
    expect(names(p2)).toEqual(["Annika Berg"]);
  });

  it("en sida bortom träffarna är tom men har total", async () => {
    const r = await caller().contacts.list({ search: "ka", page: 5, pageSize: 2 });
    expect(r).toMatchObject({ contacts: [], total: 3, pages: 2 });
  });

  it("contactType tillsammans med sökning", async () => {
    const c = caller();
    expect(names(await c.contacts.list({ search: "a", contactType: "COMPANY" }))).toEqual(["Lindström Bygg AB"]);
    expect(names(await c.contacts.list({ search: "Lindström", contactType: "PERSON" }))).toEqual([]);
  });

  it("sökträffarna har _count", async () => {
    const r = await caller().contacts.list({ search: "Lindström Bygg" });
    expect(r.contacts[0]).toMatchObject({ name: "Lindström Bygg AB", _count: { children: 1, matterLinks: 0 } });
  });

  it("kontaktpersoner och andra byråers kontakter syns aldrig", async () => {
    const r = names(await caller().contacts.list({ search: "Anna" }));
    expect(r).not.toContain("Anna Lindström");
    expect(r).not.toContain("Anna Andersson");
  });

  it("utan sökterm (saknad, tom eller blanksteg) är listan namnordnad som förut", async () => {
    const c = caller();
    const expected = ["Anna Karlsson", "Annika Berg", "Björn Kask", "Lindström Bygg AB"];
    expect(names(await c.contacts.list({}))).toEqual(expected);
    expect(names(await c.contacts.list({ search: "" }))).toEqual(expected);
    const blank = await c.contacts.list({ search: "   ", pageSize: 2 });
    expect(names(blank)).toEqual(expected.slice(0, 2));
    expect(blank).toMatchObject({ total: 4, pages: 2 });
  });
});
