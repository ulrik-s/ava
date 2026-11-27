/**
 * Integrationstest för matterRouter — kör mot en riktig DemoDataStore via
 * buildContext (repos, ADR 0020). Täcker list/getById/create/update/
 * addContact/addNewContact/removeContact inkl. org-scoping + #174-serien.
 */

import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";

const ORG = "org-a";
const YEAR = stockholmYear(new Date());

function makeCaller(seed: Partial<DemoSource> = {}, orgId = ORG, userId = "user-1", role: Principal["role"] = "LAWYER") {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "X" }, { id: "org-b", name: "Y" }],
    users: [{ id: "user-1", organizationId: ORG, email: "a@b.com", name: "Test", role: "LAWYER" }],
    matters: [],
    contacts: [],
    matterContacts: [],
    ...seed,
  }, async () => { /* writable */ });
  const principal: Principal = { id: asId<"UserId">(userId), email: "a@b.com", name: "Test", role, organizationId: asId<"OrganizationId">(orgId) };
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal }));
  return { ds, caller: caller.matter };
}

function src(ds: DemoDataStore): DemoSource {
  return (ds as unknown as { source: DemoSource }).source;
}
function mcs(ds: DemoDataStore): Array<Record<string, unknown>> {
  return (src(ds).matterContacts ?? []) as Array<Record<string, unknown>>;
}

const matter = (o: Record<string, unknown> = {}) => ({
  id: "matter-1", organizationId: ORG, matterNumber: `${YEAR}-0001`, title: "Bodelning",
  status: "ACTIVE", createdAt: new Date(), ...o,
});

describe("matter.list", () => {
  it("returnerar paginerat resultat, org-scopat", async () => {
    const { caller } = makeCaller({ matters: [matter(), matter({ id: "m2", matterNumber: `${YEAR}-0002` })] });
    const res = await caller.list({ page: 1, pageSize: 20 });
    expect(res.matters).toHaveLength(2);
    expect(res.total).toBe(2);
    expect(res.pages).toBe(1);
  });

  it("scopar alltid på organizationId (ingen läcka)", async () => {
    const { caller } = makeCaller({ matters: [matter()] }, "org-b");
    expect((await caller.list({})).matters).toHaveLength(0);
  });

  it("filtrerar på status", async () => {
    const { caller } = makeCaller({
      matters: [matter(), matter({ id: "m2", matterNumber: `${YEAR}-0002`, status: "CLOSED" })],
    });
    const res = await caller.list({ status: "CLOSED" });
    expect(res.matters.map((m) => m.id)).toEqual(["m2"]);
  });

  it("filtrerar på medarbetare (tidsposter)", async () => {
    const { caller } = makeCaller({
      matters: [matter(), matter({ id: "m2", matterNumber: `${YEAR}-0002` })],
      timeEntries: [{ id: "te1", organizationId: ORG, userId: "u-bjorn", matterId: "m2", minutes: 60, date: new Date(), hourlyRate: 1000, billable: true, description: "x" }],
    });
    const res = await caller.list({ employeeId: "u-bjorn" });
    expect(res.matters.map((m) => m.id)).toEqual(["m2"]);
  });

  it("söker på titel/ärendenummer/klientnamn", async () => {
    const { caller } = makeCaller({
      matters: [matter({ title: "Tvist Bergström" }), matter({ id: "m2", matterNumber: `${YEAR}-0002`, title: "Annat" })],
    });
    expect((await caller.list({ search: "bergström" })).matters).toHaveLength(1);
  });

  it("id-filtret (#1642): bara de angivna ärendena, alla statusar, inom byrån", async () => {
    const { caller } = makeCaller({
      matters: [
        matter({ status: "CLOSED" }),
        matter({ id: "m2", matterNumber: `${YEAR}-0002` }),
        matter({ id: "m-b", organizationId: "org-b", matterNumber: `${YEAR}-0003` }),
      ],
    });
    const res = await caller.list({ ids: ["matter-1", "m-b"], page: 1, pageSize: 2 });
    expect(res.matters.map((m) => [m.id, m.status])).toEqual([["matter-1", "CLOSED"]]);
    expect(res.total).toBe(1);
    expect((await caller.list({ ids: [] })).matters).toHaveLength(0);
  });

  it("räknar pages korrekt", async () => {
    const { caller } = makeCaller({
      matters: [matter(), matter({ id: "m2", matterNumber: `${YEAR}-0002` }), matter({ id: "m3", matterNumber: `${YEAR}-0003` })],
    });
    expect((await caller.list({ pageSize: 2 })).pages).toBe(2); // ceil(3/2)
  });

  it("validerar pageSize-gränser via zod", async () => {
    const { caller } = makeCaller();
    await expect(caller.list({ pageSize: 600 })).rejects.toThrow();
    await expect(caller.list({ page: 0 })).rejects.toThrow();
  });
});

describe("matter.list — mina ärenden och senast hänt (#1967)", () => {
  const at = (iso: string): Date => new Date(`${iso}T08:00:00.000Z`);
  const three = () => [
    matter({ id: "m-a", matterNumber: `${YEAR}-0001`, createdAt: at("2026-01-01"), responsibleLawyerId: "user-1" }),
    matter({ id: "m-b", matterNumber: `${YEAR}-0002`, createdAt: at("2026-01-02"), responsibleLawyerId: "user-2", status: "CLOSED" }),
    matter({ id: "m-c", matterNumber: `${YEAR}-0003`, createdAt: at("2026-01-03"), responsibleLawyerId: "user-1", status: "CLOSED" }),
  ];

  it("mine: bara den inloggades ärenden, aldrig en kollegas", async () => {
    const { caller } = makeCaller({ matters: three() });
    expect((await caller.list({ mine: true })).matters.map((m) => m.id)).toEqual(["m-c", "m-a"]);
    const colleague = makeCaller({ matters: three() }, ORG, "user-2").caller;
    expect((await colleague.list({ mine: true })).matters.map((m) => m.id)).toEqual(["m-b"]);
    expect((await caller.list({ mine: false })).total).toBe(3);
  });

  it("mine tillsammans med status", async () => {
    const { caller } = makeCaller({ matters: three() });
    const res = await caller.list({ mine: true, status: "CLOSED" });
    expect(res.matters.map((m) => m.id)).toEqual(["m-c"]);
    expect(res.total).toBe(1);
  });

  it("orderBy lastActivity: senast hänt överst, utan poster på skapad", async () => {
    const { caller } = makeCaller({
      matters: three(),
      timeEntries: [{ id: "te1", organizationId: ORG, userId: "user-1", matterId: "m-a", minutes: 60, date: at("2026-01-05"), hourlyRate: 1000, billable: true, description: "x", updatedAt: at("2026-02-01") }],
      expenses: [{ id: "ex1", organizationId: ORG, userId: "user-1", matterId: "m-b", amount: 100, date: at("2026-01-05"), description: "y", billable: true, updatedAt: at("2026-03-01"), deletedAt: at("2026-03-02") }],
    });
    expect((await caller.list({ orderBy: "lastActivity" })).matters.map((m) => m.id)).toEqual(["m-a", "m-c", "m-b"]);
    expect((await caller.list({ orderBy: "createdAt" })).matters.map((m) => m.id)).toEqual(["m-c", "m-b", "m-a"]);
  });

  it("utan de nya fälten som i dag; ett okänt orderBy avvisas", async () => {
    const { caller } = makeCaller({ matters: three() });
    const res = await caller.list({});
    expect(res.matters.map((m) => m.id)).toEqual(["m-c", "m-b", "m-a"]);
    expect(Object.keys(res).sort()).toEqual(["matters", "pages", "total"]);
    // @ts-expect-error -- ett värde utanför MATTER_LIST_ORDERS
    await expect(caller.list({ orderBy: "title" })).rejects.toThrow();
  });
});

describe("matter.getById", () => {
  it("hämtar matter med kontakter", async () => {
    const { caller } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "c1", organizationId: ORG, name: "Klient", contactType: "PERSON" }],
      matterContacts: [{ id: "mc1", matterId: "matter-1", contactId: "c1", role: "KLIENT" }],
    });
    const res = await caller.getById({ id: "matter-1" });
    expect(res.id).toBe("matter-1");
    expect(res.contacts).toHaveLength(1);
  });

  it("NOT_FOUND när matter saknas / fel org", async () => {
    const { caller } = makeCaller({ matters: [matter()] }, "org-b");
    await expect(caller.getById({ id: "matter-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("matter.create", () => {
  it("genererar matterNumber YYYY-0001 i tom serie", async () => {
    const { caller } = makeCaller();
    expect((await caller.create({ title: "Nytt" })).matterNumber).toBe(`${YEAR}-0001`);
  });

  it("ökar serienumret från juristens senaste ärende", async () => {
    const { caller } = makeCaller({
      matters: [matter({ id: "m0", matterNumber: `${YEAR}-0042`, responsibleLawyerId: "user-1" })],
    });
    expect((await caller.create({ title: "T" })).matterNumber).toBe(`${YEAR}-0043`);
  });

  it("efter 9999 kommer 10000 och 10001 — serien börjar inte om på 0001 (#1350)", async () => {
    const { caller } = makeCaller({
      matters: [matter({ id: "m0", matterNumber: `${YEAR}-9999`, responsibleLawyerId: "user-1" })],
    });
    expect((await caller.create({ title: "T" })).matterNumber).toBe(`${YEAR}-10000`);
    expect((await caller.create({ title: "T2" })).matterNumber).toBe(`${YEAR}-10001`);
  });

  it("persisterar clientShareBips + rattshjalpMaxTimmar vid skapande (#872)", async () => {
    const { caller } = makeCaller();
    const created = await caller.create({ title: "Rättshjälp", paymentMethod: "RATTSHJALP", clientShareBips: 4000, rattshjalpMaxTimmar: 100 });
    const fetched = await caller.getById({ id: created.id });
    expect(fetched.clientShareBips).toBe(4000);
    expect(fetched.rattshjalpMaxTimmar).toBe(100);
  });

  it("prefixar med ansvarig jurists prefix (#174)", async () => {
    const { caller } = makeCaller({
      users: [{ id: "user-1", organizationId: ORG, email: "a@b.com", name: "T", role: "LAWYER", matterNumberPrefix: "AA" }],
    });
    expect((await caller.create({ title: "T" })).matterNumber).toBe(`AA${YEAR}-0001`);
  });

  it("fortsätter serien vid prefix-byte (räknar juristens egna ärenden, #174)", async () => {
    const { caller } = makeCaller({
      users: [{ id: "user-1", organizationId: ORG, email: "a@b.com", name: "T", role: "LAWYER", matterNumberPrefix: "AB" }],
      matters: [
        matter({ id: "m1", matterNumber: `AA${YEAR}-0001`, responsibleLawyerId: "user-1" }),
        matter({ id: "m2", matterNumber: `AA${YEAR}-0002`, responsibleLawyerId: "user-1" }),
      ],
    });
    expect((await caller.create({ title: "T" })).matterNumber).toBe(`AB${YEAR}-0003`);
  });

  it("kopplar klient när klientId angivits", async () => {
    const { caller, ds } = makeCaller({
      contacts: [{ id: "c1", organizationId: ORG, name: "K", contactType: "PERSON" }],
    });
    await caller.create({ title: "T", klientId: "c1" });
    expect(mcs(ds).some((mc) => mc.contactId === "c1" && mc.role === "KLIENT")).toBe(true);
  });

  it("vägrar koppla klient från annan org", async () => {
    const { caller, ds } = makeCaller({
      contacts: [{ id: "c1", organizationId: "org-b", name: "K", contactType: "PERSON" }],
    });
    await expect(caller.create({ title: "T", klientId: "c1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mcs(ds)).toHaveLength(0);
  });

  it("#1228: skapar standardmapparna (rot + Domstols undermappar) för det nya ärendet", async () => {
    const { caller, ds } = makeCaller();
    const m = await caller.create({ title: "Mappar" });
    const folders = ((src(ds).documentFolders ?? []) as Array<Record<string, unknown>>)
      .filter((f) => f.matterId === m.id);
    const roots = folders.filter((f) => f.parentId === null).map((f) => f.name);
    expect(roots).toEqual(["Faktura", "Domstol", "Beslut", "Korrespondens", "Avtal", "Övrigt"]);
    const domstol = folders.find((f) => f.name === "Domstol");
    expect(folders.filter((f) => f.parentId === domstol?.id).map((f) => f.name))
      .toEqual(["Kallelse", "Föreläggande", "Förordnande", "Inlagor"]);
  });

  it("#1228: två ärenden får var sitt träd, inga dubbletter inom ärendet", async () => {
    const { caller, ds } = makeCaller();
    const a = await caller.create({ title: "A" });
    const b = await caller.create({ title: "B" });
    const all = (src(ds).documentFolders ?? []) as Array<Record<string, unknown>>;
    for (const id of [a.id, b.id]) {
      const mine = all.filter((f) => f.matterId === id);
      expect(mine).toHaveLength(10);
      expect(new Set(mine.map((f) => `${String(f.parentId)}/${String(f.name)}`)).size).toBe(10);
    }
  });

  it.each([
    ["matterNumber", { matterNumber: "1999-0001" }],
    ["status", { status: "CLOSED" as const }],
    ["createdAt", { createdAt: "2020-01-01T00:00:00.000Z" }],
  ])("en jurist kan inte sätta %s — FORBIDDEN, inget ärende (#1345)", async (_label, extra) => {
    const { caller, ds } = makeCaller();
    await expect(caller.create({ title: "T", ...extra })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(src(ds).matters ?? []).toHaveLength(0);
  });

  it("ADMIN kan sätta ärendenummer, status och skapad-datum direkt (demo-generator/seed, #1345)", async () => {
    const { caller } = makeCaller({}, ORG, "user-1", "ADMIN");
    const m = await caller.create({ title: "T", matterNumber: "1999-0001", status: "CLOSED", createdAt: "2020-01-01T00:00:00.000Z" });
    expect(m).toMatchObject({ matterNumber: "1999-0001", status: "CLOSED" });
    expect(new Date(m.createdAt).toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  it("ansvarig jurist i en annan byrå → NOT_FOUND, inget ärende (#1345)", async () => {
    const { caller, ds } = makeCaller({
      users: [
        { id: "user-1", organizationId: ORG, email: "a@b.com", name: "Test", role: "LAWYER" },
        { id: "user-b", organizationId: "org-b", email: "b@b.com", name: "B", role: "LAWYER" },
      ],
    });
    await expect(caller.create({ title: "T", responsibleLawyerId: "user-b" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(src(ds).matters ?? []).toHaveLength(0);
  });

  it("kräver title (zod min(1))", async () => {
    const { caller } = makeCaller();
    await expect(caller.create({ title: "" })).rejects.toThrow();
  });
});

describe("matter.update", () => {
  it("uppdaterar status", async () => {
    const { caller, ds } = makeCaller({ matters: [matter()] });
    await caller.update({ id: "matter-1", status: "CLOSED" });
    expect((src(ds).matters as Array<{ id: string; status: string }>).find((m) => m.id === "matter-1")!.status).toBe("CLOSED");
  });

  it("konverterar paymentMethodDecidedAt-sträng till Date", async () => {
    const { caller, ds } = makeCaller({ matters: [matter()] });
    await caller.update({ id: "matter-1", paymentMethod: "RATTSHJALP", paymentMethodDecidedAt: "2026-03-02" });
    const m = (src(ds).matters as Array<{ id: string; paymentMethodDecidedAt?: Date }>).find((x) => x.id === "matter-1")!;
    expect(m.paymentMethodDecidedAt).toBeInstanceOf(Date);
  });

  it("nullar paymentMethodDecidedAt när null", async () => {
    const { caller, ds } = makeCaller({ matters: [matter({ paymentMethodDecidedAt: new Date() })] });
    await caller.update({ id: "matter-1", paymentMethodDecidedAt: null });
    const m = (src(ds).matters as Array<{ id: string; paymentMethodDecidedAt?: Date | null }>).find((x) => x.id === "matter-1")!;
    expect(m.paymentMethodDecidedAt).toBeNull();
  });

  it("byte av målnummer sparar det gamla som tidigare målnummer, sökbart (#1510)", async () => {
    const { caller, ds } = makeCaller({ matters: [matter({ courtCaseNumber: "T 1-26" })] });
    type Row = { id: string; courtCaseNumber?: string | null; previousCourtCaseNumber?: string | null };
    const row = () => (src(ds).matters as Row[]).find((x) => x.id === "matter-1");
    await caller.update({ id: "matter-1", courtCaseNumber: "T 2-26" });
    expect(row()).toMatchObject({ courtCaseNumber: "T 2-26", previousCourtCaseNumber: "T 1-26" });
    expect((await caller.list({ search: "t 1-26" })).matters.map((m) => m.id)).toEqual(["matter-1"]);
    await caller.update({ id: "matter-1", courtCaseNumber: "T 2-26" }); // samma värde igen
    await caller.update({ id: "matter-1", title: "Ny titel" }); // målnumret utelämnat
    expect(row()?.previousCourtCaseNumber).toBe("T 1-26");
    await caller.update({ id: "matter-1", courtCaseNumber: null }); // tömt
    expect(row()).toMatchObject({ courtCaseNumber: null, previousCourtCaseNumber: "T 1-26" });
  });

  it("försäkringsreferensen sparas, är sökbar och kan nollställas (#1511)", async () => {
    const { caller, ds } = makeCaller({ matters: [matter()] });
    type Row = { id: string; insuranceReference?: string | null };
    const row = () => (src(ds).matters as Row[]).find((x) => x.id === "matter-1");
    await caller.update({ id: "matter-1", insuranceReference: "SK-4711" });
    expect(row()?.insuranceReference).toBe("SK-4711");
    expect((await caller.list({ search: "sk-47" })).matters.map((m) => m.id)).toEqual(["matter-1"]);
    await caller.update({ id: "matter-1", title: "Ny titel" }); // utelämnad → orörd
    expect(row()?.insuranceReference).toBe("SK-4711");
    await caller.update({ id: "matter-1", insuranceReference: null });
    expect(row()?.insuranceReference).toBeNull();
  });

  it("första målnumret ger inget tidigare målnummer (#1510)", async () => {
    const { caller, ds } = makeCaller({ matters: [matter()] });
    await caller.update({ id: "matter-1", courtCaseNumber: "T 1-26" });
    const m = (src(ds).matters as Array<{ id: string; previousCourtCaseNumber?: string | null }>).find((x) => x.id === "matter-1");
    expect(m).toBeDefined();
    expect(m?.previousCourtCaseNumber ?? null).toBeNull();
  });

  it("vägrar uppdatera matter från annan org", async () => {
    const { caller } = makeCaller({ matters: [matter()] }, "org-b");
    await expect(caller.update({ id: "matter-1", status: "CLOSED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sparar ärendets avvikande timpriser per kategori — hela kartan ersätts (#1206)", async () => {
    const { caller, ds } = makeCaller({ matters: [matter({ hourlyRates: { ARBETE: 300000 } })] });
    await caller.update({ id: "matter-1", hourlyRates: { TIDSSPILLAN: 150000 } });
    const m = (src(ds).matters as Array<{ id: string; hourlyRates?: unknown }>).find((x) => x.id === "matter-1")!;
    expect(m.hourlyRates).toEqual({ TIDSSPILLAN: 150000 });
    await expect(caller.update({ id: "matter-1", hourlyRates: { ADVOKATBEREDSKAP: 1 } as never })).rejects.toThrow();
  });
});

describe("matter.addContact", () => {
  it("kopplar befintlig kontakt", async () => {
    const { caller, ds } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "c1", organizationId: ORG, name: "K", contactType: "PERSON" }],
    });
    await caller.addContact({ matterId: "matter-1", contactId: "c1", role: "MOTPART" });
    expect(mcs(ds).some((mc) => mc.contactId === "c1" && mc.role === "MOTPART")).toBe(true);
  });

  it("vägrar koppla matter från annan org", async () => {
    const { caller } = makeCaller({ matters: [matter()] }, "org-b");
    await expect(
      caller.addContact({ matterId: "matter-1", contactId: "c1", role: "MOTPART" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("vägrar koppla kontakt från annan org", async () => {
    const { caller } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "c1", organizationId: "org-b", name: "K", contactType: "PERSON" }],
    });
    await expect(
      caller.addContact({ matterId: "matter-1", contactId: "c1", role: "MOTPART" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("matter.addNewContact", () => {
  it("återanvänder befintlig kontakt med samma personnummer", async () => {
    const { caller, ds } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "existing", organizationId: ORG, name: "P", contactType: "PERSON", personalNumber: "19850225-6655" }],
    });
    await caller.addNewContact({
      matterId: "matter-1", name: "Test Person", contactType: "PERSON", personalNumber: "19850225-6655", role: "MOTPART",
    });
    expect((src(ds).contacts as unknown[]).length).toBe(1); // ingen ny kontakt
    expect(mcs(ds).some((mc) => mc.contactId === "existing")).toBe(true);
  });

  it("skapar ny kontakt när ingen matchar", async () => {
    const { caller, ds } = makeCaller({ matters: [matter()] });
    await caller.addNewContact({ matterId: "matter-1", name: "Ny", contactType: "PERSON", role: "MOTPART" });
    expect((src(ds).contacts as unknown[]).length).toBe(1);
    expect(mcs(ds)).toHaveLength(1);
  });

  it("matchar på orgnummer för företag", async () => {
    const { caller, ds } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "co", organizationId: ORG, name: "AB", contactType: "COMPANY", orgNumber: "556677-8899" }],
    });
    await caller.addNewContact({
      matterId: "matter-1", name: "AB", contactType: "COMPANY", orgNumber: "556677-8899", role: "MOTPART",
    });
    expect((src(ds).contacts as unknown[]).length).toBe(1);
    expect(mcs(ds).some((mc) => mc.contactId === "co")).toBe(true);
  });
});

describe("matter.removeContact", () => {
  it("tar bort koppling med korrekt org-scoping", async () => {
    const { caller, ds } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "c1", organizationId: ORG, name: "K", contactType: "PERSON" }],
      matterContacts: [{ id: "mc1", matterId: "matter-1", contactId: "c1", role: "MOTPART" }],
    });
    await caller.removeContact({ matterContactId: "mc1" });
    expect(mcs(ds).some((mc) => mc.id === "mc1")).toBe(false);
  });

  it("vägrar ta bort koppling från annan org", async () => {
    const { caller, ds } = makeCaller({
      matters: [matter()],
      contacts: [{ id: "c1", organizationId: ORG, name: "K", contactType: "PERSON" }],
      matterContacts: [{ id: "mc1", matterId: "matter-1", contactId: "c1", role: "MOTPART" }],
    }, "org-b");
    await expect(caller.removeContact({ matterContactId: "mc1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mcs(ds).some((mc) => mc.id === "mc1")).toBe(true);
  });
});

describe("offentligt uppdrag per ärendetyp (#1639)", () => {
  const PUBLIC_ORGS = [{ id: ORG, name: "X", matterTypes: ["Försvar", "Bodelning"], publicAssignmentMatterTypes: ["Försvar"] }];
  const caller = (matters: unknown[] = []) => makeCaller({ organizations: PUBLIC_ORGS, matters } as Partial<DemoSource>);
  const notes = (ds: DemoDataStore) => (src(ds).serviceNotes ?? []) as Array<{ text: string }>;
  const stored = (ds: DemoDataStore) => (src(ds).matters as Array<{ id: string; paymentMethod?: string }>).find((m) => m.id === "matter-1");

  it("create med markerad typ ger Offentligt uppdrag även om klienten skickar annat", async () => {
    const { caller: c } = caller();
    expect((await c.create({ title: "T", matterType: "Försvar", paymentMethod: "PRIVAT" })).paymentMethod).toBe("OFFENTLIGT_UPPDRAG");
    expect((await c.create({ title: "T2", matterType: "Försvar" })).paymentMethod).toBe("OFFENTLIGT_UPPDRAG");
  });

  it("create med omarkerad typ eller utan typ: som i dag", async () => {
    const { caller: c } = caller();
    expect((await c.create({ title: "T", matterType: "Bodelning", paymentMethod: "PRIVAT" })).paymentMethod).toBe("PRIVAT");
    expect((await c.create({ title: "T2", paymentMethod: "RATTSHJALP" })).paymentMethod).toBe("RATTSHJALP");
  });

  it("update avvisar ett annat betalningssätt för markerad typ, med svenskt felmeddelande", async () => {
    const { caller: c, ds } = caller([matter({ matterType: "Försvar", paymentMethod: "OFFENTLIGT_UPPDRAG" })]);
    await expect(c.update({ id: "matter-1", paymentMethod: "PRIVAT" })).rejects.toThrow(/bestäms av ärendetypen/);
    await expect(c.update({ id: "matter-1", matterType: "Försvar", paymentMethod: "PRIVAT" })).rejects.toThrow(/offentligt uppdrag/);
    expect(stored(ds)?.paymentMethod).toBe("OFFENTLIGT_UPPDRAG");
  });

  it("byte till markerad typ sätter Offentligt uppdrag och loggar betalningssättsändringen", async () => {
    const { caller: c, ds } = caller([matter({ matterType: "Bodelning", paymentMethod: "PENDING" })]);
    await c.update({ id: "matter-1", matterType: "Försvar" });
    expect(stored(ds)?.paymentMethod).toBe("OFFENTLIGT_UPPDRAG");
    expect(notes(ds).map((n) => n.text)).toEqual([expect.stringContaining("Offentligt uppdrag")]);
  });

  it("byte bort från markerad typ släpper låset", async () => {
    const { caller: c, ds } = caller([matter({ matterType: "Försvar", paymentMethod: "OFFENTLIGT_UPPDRAG" })]);
    await c.update({ id: "matter-1", matterType: "Bodelning", paymentMethod: "PRIVAT" });
    expect(stored(ds)?.paymentMethod).toBe("PRIVAT");
  });

  it("en uppdatering som varken rör typ eller betalningssätt lämnar betalningssättet", async () => {
    const { caller: c, ds } = caller([matter({ matterType: "Försvar", paymentMethod: "PENDING" })]);
    await c.update({ id: "matter-1", title: "Ny" });
    expect(stored(ds)?.paymentMethod).toBe("PENDING");
    expect(notes(ds)).toHaveLength(0);
  });
});

describe("matter.keepActive (#2098)", () => {
  it("sätter datumet för Behåll som aktivt, och getById returnerar det", async () => {
    const { caller } = makeCaller({ matters: [matter()] });
    const before = Math.floor(Date.now() / 1000) * 1000; // lagras i hela sekunder
    const res = await caller.keepActive({ id: asId<"MatterId">("matter-1") });
    expect(new Date(String(res.keptActiveAt)).getTime()).toBeGreaterThanOrEqual(before);
    const got = await caller.getById({ id: asId<"MatterId">("matter-1") });
    expect(new Date(String(got.keptActiveAt)).getTime()).toBe(new Date(String(res.keptActiveAt)).getTime());
    expect(got.status).toBe("ACTIVE");
  });

  it("ett ärende i en annan byrå ger NOT_FOUND", async () => {
    const { caller } = makeCaller({ matters: [matter({ organizationId: "org-b" })] });
    await expect(caller.keepActive({ id: asId<"MatterId">("matter-1") })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
