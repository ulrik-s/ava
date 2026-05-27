/**
 * Tester för `DemoDataStore` — en `IDataStore`-impl som backas av
 * in-memory data från `DemoRuntime`.
 */

import { describe, it, expect } from "vitest";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { ReadOnlyError } from "@/lib/server/data-store/in-memory/read-only-delegate";

const matters = [
  { id: "m1", title: "Avtal", organizationId: "org1", status: "ACTIVE", matterNumber: "2025-0001", createdAt: new Date("2025-01-01") },
  { id: "m2", title: "Tvist", organizationId: "org1", status: "CLOSED", matterNumber: "2025-0002", createdAt: new Date("2025-02-01") },
  { id: "m3", title: "Annan", organizationId: "org2", status: "ACTIVE", matterNumber: "2025-0003", createdAt: new Date("2025-03-01") },
];

const contacts = [
  { id: "c1", name: "Anna", organizationId: "org1", contactType: "PRIVATPERSON" },
  { id: "c2", name: "Björn AB", organizationId: "org1", contactType: "FORETAG" },
];

const matterContacts = [
  { id: "mc1", matterId: "m1", contactId: "c1", role: "KLIENT" },
];

const users = [{ id: "u1", name: "Demo Admin", organizationId: "org1" }];

const buildStore = () => new DemoDataStore({
  matters,
  contacts,
  matterContacts,
  users,
});

describe("DemoDataStore", () => {
  it("matters.findMany returnerar org-filtrerad data", async () => {
    const ds = buildStore();
    const r = await ds.matters.findMany({ where: { organizationId: "org1" } });
    expect(r.map((m: { id: string }) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("matters.count räknar med where", async () => {
    const ds = buildStore();
    expect(await ds.matters.count({ where: { status: "ACTIVE" } })).toBe(2);
  });

  it("contacts.findUnique fungerar", async () => {
    const ds = buildStore();
    const r = await ds.contacts.findUnique({ where: { id: "c1" } });
    expect((r as { name: string } | null)?.name).toBe("Anna");
  });

  it("matters.findFirstOrThrow kastar när inget hittas", async () => {
    const ds = buildStore();
    await expect(ds.matters.findFirstOrThrow({ where: { id: "missing" } })).rejects.toThrow();
  });

  it("matters.findMany filtrerar på timeEntries.some.userId (medarbetar-filter)", async () => {
    const ds = new DemoDataStore({
      matters,
      users,
      timeEntries: [
        { id: "t1", matterId: "m1", userId: "u-anna", organizationId: "org1" },
        { id: "t2", matterId: "m2", userId: "u-bjorn", organizationId: "org1" },
        { id: "t3", matterId: "m1", userId: "u-bjorn", organizationId: "org1" },
      ],
    });
    const anna = await ds.matters.findMany({ where: { timeEntries: { some: { userId: "u-anna" } } } });
    expect(anna.map((m: { id: string }) => m.id).sort()).toEqual(["m1"]);

    const bjorn = await ds.matters.findMany({ where: { timeEntries: { some: { userId: "u-bjorn" } } } });
    expect(bjorn.map((m: { id: string }) => m.id).sort()).toEqual(["m1", "m2"]);

    const none = await ds.matters.findMany({ where: { timeEntries: { some: { userId: "u-ingen" } } } });
    expect(none).toEqual([]);
  });

  it("matters.create kastar ReadOnlyError", async () => {
    const ds = buildStore();
    await expect(ds.matters.create({ data: {} as never })).rejects.toThrow(ReadOnlyError);
  });

  it("contacts.update kastar ReadOnlyError", async () => {
    const ds = buildStore();
    await expect(ds.contacts.update({ where: { id: "c1" }, data: {} })).rejects.toThrow(ReadOnlyError);
  });

  it("ej projicerade entiteter returnerar tom array (ingen crash)", async () => {
    const ds = buildStore();
    expect(await ds.documents.findMany()).toEqual([]);
    expect(await ds.invoices.findMany()).toEqual([]);
    expect(await ds.timeEntries.count()).toBe(0);
  });

  it("events-loggen är read-only stub", async () => {
    const ds = buildStore();
    expect(await ds.events.query({})).toEqual([]);
    await expect(ds.events.emit({ type: "test", payload: {} } as never)).rejects.toThrow(ReadOnlyError);
  });

  it("raw kastar — escape-hatch ej tillgänglig i demo-läget", () => {
    const ds = buildStore();
    expect(() => (ds.raw as unknown as { $queryRaw: () => void }).$queryRaw()).toThrow();
  });
});
