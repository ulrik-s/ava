/**
 * Tester för `ReadOnlyDelegate<T>` — en in-memory Prisma-delegate
 * som exponerar läs-metoder mot en collection och kastar på mutations.
 */

import { describe, it, expect } from "vitest-compat";
import { ReadOnlyDelegate, ReadOnlyError } from "@/lib/server/data-store/in-memory/read-only-delegate";

type Matter = {
  id: string;
  title: string;
  organizationId: string;
  status: "ACTIVE" | "CLOSED";
} & Record<string, unknown>;

const data: Matter[] = [
  { id: "m1", title: "Avtal Alpha", organizationId: "org1", status: "ACTIVE" },
  { id: "m2", title: "Tvist Beta",  organizationId: "org1", status: "CLOSED" },
  { id: "m3", title: "Avtal Gamma", organizationId: "org2", status: "ACTIVE" },
];

const delegate = new ReadOnlyDelegate<Matter>(() => data);

describe("ReadOnlyDelegate — relations include", () => {
  type Invoice = { id: string } & Record<string, unknown>;
  const invoices: Invoice[] = [{ id: "inv1" }];
  const plans = [{ id: "pp1", invoiceId: "inv1" }];
  const payments = [
    { id: "pay1", invoiceId: "inv1" },
    { id: "pay2", invoiceId: "inv1" },
    { id: "pay3", invoiceId: "other" },
  ];
  const del = new ReadOnlyDelegate<Invoice>(() => invoices, {
    relations: {
      paymentPlan: { kind: "one", collection: () => plans, where: (p) => ({ invoiceId: p.id }) },
      payments: { collection: () => payments, where: (p) => ({ invoiceId: p.id }) },
    },
  });

  it("kind:'one' hydratiserar ett enskilt objekt (inte array)", async () => {
    const r = await del.findUnique({ where: { id: "inv1" }, include: { paymentPlan: true } });
    expect((r as unknown as { paymentPlan: { id: string } }).paymentPlan).toEqual({ id: "pp1", invoiceId: "inv1" });
  });

  it("kind:'one' utan träff → null", async () => {
    const empty = new ReadOnlyDelegate<Invoice>(() => invoices, {
      relations: { paymentPlan: { kind: "one", collection: () => [], where: () => ({}) } },
    });
    const r2 = await empty.findUnique({ where: { id: "inv1" }, include: { paymentPlan: true } });
    expect((r2 as unknown as { paymentPlan: unknown }).paymentPlan).toBeNull();
  });

  it("default kind (many) hydratiserar array", async () => {
    const r = await del.findUnique({ where: { id: "inv1" }, include: { payments: true } });
    expect((r as unknown as { payments: unknown[] }).payments).toHaveLength(2);
  });
});

describe("ReadOnlyDelegate — aggregate", () => {
  type Entry = { id: string; matterId: string; minutes: number } & Record<string, unknown>;
  const entries: Entry[] = [
    { id: "1", matterId: "m1", minutes: 30 },
    { id: "2", matterId: "m1", minutes: 90 },
    { id: "3", matterId: "m2", minutes: 15 },
  ];
  const del = new ReadOnlyDelegate<Entry>(() => entries);

  it("_sum med where", async () => {
    const r = await del.aggregate({ where: { matterId: "m1" }, _sum: { minutes: true } }) as { _sum: { minutes: number } };
    expect(r._sum.minutes).toBe(120);
  });

  it("_sum utan träff → 0", async () => {
    const r = await del.aggregate({ where: { matterId: "x" }, _sum: { minutes: true } }) as { _sum: { minutes: number } };
    expect(r._sum.minutes).toBe(0);
  });

  it("_count + _avg", async () => {
    const r = await del.aggregate({ _count: true, _avg: { minutes: true } }) as { _count: number; _avg: { minutes: number } };
    expect(r._count).toBe(3);
    expect(r._avg.minutes).toBe(45);
  });

  it("_min + _max över alla rader", async () => {
    const r = await del.aggregate({ _min: { minutes: true }, _max: { minutes: true } }) as {
      _min: { minutes: number }; _max: { minutes: number };
    };
    expect(r._min.minutes).toBe(15);
    expect(r._max.minutes).toBe(90);
  });

  it("_min/_max med where som snävar till en matter", async () => {
    const r = await del.aggregate({ where: { matterId: "m1" }, _min: { minutes: true }, _max: { minutes: true } }) as {
      _min: { minutes: number }; _max: { minutes: number };
    };
    expect(r._min.minutes).toBe(30);
    expect(r._max.minutes).toBe(90);
  });

  it("_min/_max utan träff → null (tom rad-mängd)", async () => {
    const r = await del.aggregate({ where: { matterId: "x" }, _min: { minutes: true }, _max: { minutes: true } }) as {
      _min: { minutes: number | null }; _max: { minutes: number | null };
    };
    expect(r._min.minutes).toBeNull();
    expect(r._max.minutes).toBeNull();
  });
});

describe("ReadOnlyDelegate — läsning", () => {
  it("findMany med where", async () => {
    const r = await delegate.findMany({ where: { organizationId: "org1" } });
    expect(r.map(m => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("findMany utan args returnerar allt", async () => {
    expect((await delegate.findMany()).length).toBe(3);
  });

  it("findFirst", async () => {
    const r = await delegate.findFirst({ where: { status: "CLOSED" } });
    expect(r?.id).toBe("m2");
  });

  it("findUnique", async () => {
    const r = await delegate.findUnique({ where: { id: "m3" } });
    expect(r?.title).toBe("Avtal Gamma");
  });

  it("findFirstOrThrow kastar när inget hittas", async () => {
    await expect(delegate.findFirstOrThrow({ where: { id: "missing" } })).rejects.toThrow();
  });

  it("findUniqueOrThrow returnerar raden vid träff, kastar annars", async () => {
    expect((await delegate.findUniqueOrThrow({ where: { id: "m1" } })).id).toBe("m1");
    await expect(delegate.findUniqueOrThrow({ where: { id: "missing" } })).rejects.toThrow();
  });

  it("count", async () => {
    expect(await delegate.count({ where: { status: "ACTIVE" } })).toBe(2);
    expect(await delegate.count()).toBe(3);
  });
});

describe("ReadOnlyDelegate — mutationsförbud", () => {
  it("create kastar ReadOnlyError", async () => {
    await expect(delegate.create({ data: { id: "x", title: "y" } })).rejects.toThrow(ReadOnlyError);
  });

  it("update kastar", async () => {
    await expect(delegate.update({ where: { id: "m1" }, data: {} })).rejects.toThrow(ReadOnlyError);
  });

  it("delete kastar", async () => {
    await expect(delegate.delete({ where: { id: "m1" } })).rejects.toThrow(ReadOnlyError);
  });

  it("upsert kastar", async () => {
    await expect(delegate.upsert({ where: { id: "m1" }, create: {}, update: {} })).rejects.toThrow(ReadOnlyError);
  });

  it("deleteMany kastar", async () => {
    await expect(delegate.deleteMany()).rejects.toThrow(ReadOnlyError);
  });

  it("updateMany kastar", async () => {
    await expect(delegate.updateMany({ data: {} })).rejects.toThrow(ReadOnlyError);
  });

  it("createMany kastar", async () => {
    await expect(delegate.createMany({ data: [] })).rejects.toThrow(ReadOnlyError);
  });
});

describe("ReadOnlyDelegate — relations via include", () => {
  it("include-funktion får relationsdata via resolver-tabell", async () => {
    type Contact = { id: string; name: string; matterId: string } & Record<string, unknown>;
    type ParentMatter = { id: string; title: string } & Record<string, unknown>;
    const matters: ParentMatter[] = [{ id: "m1", title: "X" }];
    const contacts: Contact[] = [
      { id: "c1", name: "Anna", matterId: "m1" },
      { id: "c2", name: "Björn", matterId: "m2" },
    ];

    const matterDelegate = new ReadOnlyDelegate<ParentMatter>(() => matters, {
      relations: {
        contacts: {
          collection: () => contacts,
          where: (parent) => ({ matterId: parent.id }),
        },
      },
    });

    const r = await matterDelegate.findUnique({ where: { id: "m1" }, include: { contacts: true } });
    expect(r).toBeDefined();
    expect((r as unknown as { contacts: Contact[] }).contacts.map(c => c.id)).toEqual(["c1"]);
  });
});
