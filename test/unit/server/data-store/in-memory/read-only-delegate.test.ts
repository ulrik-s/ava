/**
 * Tester för `ReadOnlyDelegate<T>` — en in-memory Prisma-delegate
 * som exponerar läs-metoder mot en collection och kastar på mutations.
 */

import { describe, it, expect } from "vitest";
import { ReadOnlyDelegate, ReadOnlyError } from "@/server/data-store/in-memory/read-only-delegate";

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
