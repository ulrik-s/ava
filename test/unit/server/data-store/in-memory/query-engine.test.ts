/**
 * Tester för `InMemoryQueryEngine` — en Prisma-subset som tolkar
 * `where`/`orderBy`/`skip`/`take` mot en array.
 *
 * Pattern: ett test per Prisma-operator. Vi täcker bara den subset
 * som faktiskt används av routrarna (se grep i Fas B-PR).
 */

import { describe, it, expect } from "vitest";
import { InMemoryQueryEngine } from "@/server/data-store/in-memory/query-engine";

type Row = {
  id: string;
  name: string;
  status?: "ACTIVE" | "CLOSED";
  count?: number;
  organizationId?: string;
  createdAt?: Date;
  tags?: string[];
} & Record<string, unknown>;

const rows: Row[] = [
  { id: "1", name: "Alpha", status: "ACTIVE", count: 10, organizationId: "org1", createdAt: new Date("2025-01-01"), tags: ["a", "b"] },
  { id: "2", name: "Beta",  status: "CLOSED", count: 5,  organizationId: "org1", createdAt: new Date("2025-02-01"), tags: ["b"] },
  { id: "3", name: "Gamma", status: "ACTIVE", count: 20, organizationId: "org2", createdAt: new Date("2025-03-01"), tags: [] },
  { id: "4", name: "Delta", status: "ACTIVE", count: 15, organizationId: "org1", createdAt: new Date("2025-04-01") },
];

const engine = new InMemoryQueryEngine<Row>();

describe("InMemoryQueryEngine — where", () => {
  it("equals (implicit) matchar exakt", () => {
    const r = engine.query(rows, { where: { id: "2" } });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("2");
  });

  it("nested object equality", () => {
    const r = engine.query(rows, { where: { status: "ACTIVE", organizationId: "org1" } });
    expect(r.map(x => x.id)).toEqual(["1", "4"]);
  });

  it("contains (case-sensitive default)", () => {
    const r = engine.query(rows, { where: { name: { contains: "lph" } } });
    expect(r).toHaveLength(1);
  });

  it("contains med mode insensitive", () => {
    const r = engine.query(rows, { where: { name: { contains: "DELTA", mode: "insensitive" } } });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("4");
  });

  it("startsWith", () => {
    const r = engine.query(rows, { where: { name: { startsWith: "B" } } });
    expect(r.map(x => x.id)).toEqual(["2"]);
  });

  it("in: array av värden", () => {
    const r = engine.query(rows, { where: { id: { in: ["1", "3"] } } });
    expect(r.map(x => x.id)).toEqual(["1", "3"]);
  });

  it("gte/lte på nummer", () => {
    const r = engine.query(rows, { where: { count: { gte: 10, lte: 15 } } });
    expect(r.map(x => x.id).sort()).toEqual(["1", "4"]);
  });

  it("gt/lt", () => {
    const r = engine.query(rows, { where: { count: { gt: 10, lt: 20 } } });
    expect(r.map(x => x.id)).toEqual(["4"]);
  });

  it("not: värde", () => {
    const r = engine.query(rows, { where: { status: { not: "ACTIVE" } } });
    expect(r.map(x => x.id)).toEqual(["2"]);
  });

  it("OR-array", () => {
    const r = engine.query(rows, {
      where: { OR: [{ id: "1" }, { name: { contains: "amma" } }] },
    });
    expect(r.map(x => x.id).sort()).toEqual(["1", "3"]);
  });

  it("AND-array", () => {
    const r = engine.query(rows, {
      where: { AND: [{ status: "ACTIVE" }, { count: { gte: 15 } }] },
    });
    expect(r.map(x => x.id).sort()).toEqual(["3", "4"]);
  });

  it("date gte/lte", () => {
    const r = engine.query(rows, {
      where: { createdAt: { gte: new Date("2025-02-01"), lte: new Date("2025-03-01") } },
    });
    expect(r.map(x => x.id)).toEqual(["2", "3"]);
  });

  it("undefined i where ignoreras (samma som Prisma)", () => {
    const r = engine.query(rows, { where: { status: undefined, id: "1" } });
    expect(r.map(x => x.id)).toEqual(["1"]);
  });
});

describe("InMemoryQueryEngine — orderBy", () => {
  it("string asc", () => {
    const r = engine.query(rows, { orderBy: { name: "asc" } });
    // Alpha, Beta, Delta, Gamma
    expect(r.map(x => x.id)).toEqual(["1", "2", "4", "3"]);
  });

  it("number desc", () => {
    const r = engine.query(rows, { orderBy: { count: "desc" } });
    expect(r.map(x => x.id)).toEqual(["3", "4", "1", "2"]);
  });

  it("date desc", () => {
    const r = engine.query(rows, { orderBy: { createdAt: "desc" } });
    expect(r.map(x => x.id)).toEqual(["4", "3", "2", "1"]);
  });

  it("orderBy som array — fallback till första", () => {
    const r = engine.query(rows, { orderBy: [{ status: "asc" }, { count: "desc" }] });
    // ACTIVE först (3 st), sen CLOSED. Inom ACTIVE: count desc.
    expect(r.map(x => x.id)).toEqual(["3", "4", "1", "2"]);
  });
});

describe("InMemoryQueryEngine — pagination", () => {
  it("skip", () => {
    const r = engine.query(rows, { orderBy: { id: "asc" }, skip: 2 });
    expect(r.map(x => x.id)).toEqual(["3", "4"]);
  });

  it("take", () => {
    const r = engine.query(rows, { orderBy: { id: "asc" }, take: 2 });
    expect(r.map(x => x.id)).toEqual(["1", "2"]);
  });

  it("skip + take", () => {
    const r = engine.query(rows, { orderBy: { id: "asc" }, skip: 1, take: 2 });
    expect(r.map(x => x.id)).toEqual(["2", "3"]);
  });
});

describe("InMemoryQueryEngine — count", () => {
  it("räknar utan where", () => {
    expect(engine.count(rows)).toBe(4);
  });

  it("räknar med where", () => {
    expect(engine.count(rows, { where: { status: "ACTIVE" } })).toBe(3);
  });
});

describe("InMemoryQueryEngine — first/unique", () => {
  it("findFirst returnerar första matching eller null", () => {
    expect(engine.findFirst(rows, { where: { status: "CLOSED" } })?.id).toBe("2");
    expect(engine.findFirst(rows, { where: { id: "missing" } })).toBeNull();
  });

  it("findUnique = findFirst för in-memory (vi har inga index)", () => {
    expect(engine.findUnique(rows, { where: { id: "1" } })?.name).toBe("Alpha");
  });
});
