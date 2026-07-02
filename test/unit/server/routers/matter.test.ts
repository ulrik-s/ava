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

const ORG = "org-a";
const YEAR = new Date().getFullYear();

function makeCaller(seed: Partial<DemoSource> = {}, orgId = ORG, userId = "user-1") {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "X" }, { id: "org-b", name: "Y" }],
    users: [{ id: "user-1", organizationId: ORG, email: "a@b.com", name: "Test", role: "LAWYER" }],
    matters: [],
    contacts: [],
    matterContacts: [],
    ...seed,
  } as DemoSource, async () => { /* writable */ });
  const principal: Principal = { id: asId<"UserId">(userId), email: "a@b.com", name: "Test", role: "LAWYER", organizationId: asId<"OrganizationId">(orgId) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal }) as any);
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

  it("vägrar uppdatera matter från annan org", async () => {
    const { caller } = makeCaller({ matters: [matter()] }, "org-b");
    await expect(caller.update({ id: "matter-1", status: "CLOSED" })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
