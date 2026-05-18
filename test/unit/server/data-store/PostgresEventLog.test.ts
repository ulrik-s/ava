/**
 * Tester för `PostgresEventLog`. Mockar Prisma så testen körs i node-projektet
 * utan riktig DB (samma mönster som övriga router-tester).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgresEventLog } from "@/server/data-store/PostgresEventLog";

const makePrismaMock = () => ({
  avaEventLog: {
    create: vi.fn().mockResolvedValue(undefined),
    findMany: vi.fn().mockResolvedValue([]),
  },
});

const ORG = "org-1";

describe("PostgresEventLog.emit", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let log: PostgresEventLog;

  beforeEach(() => {
    prisma = makePrismaMock();
    log = new PostgresEventLog(prisma as never, ORG);
  });

  it("skriver eventet med genererat id och ts", async () => {
    const event = await log.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: { matterNumber: "2026-0001" },
    });

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(prisma.avaEventLog.create).toHaveBeenCalledTimes(1);
    const args = prisma.avaEventLog.create.mock.calls[0][0];
    expect(args.data.organizationId).toBe(ORG);
    expect(args.data.actorKind).toBe("user");
    expect(args.data.actorId).toBe("anna");
    expect(args.data.type).toBe("matter.created");
    expect(args.data.payload).toEqual({ matterNumber: "2026-0001" });
  });

  it("kastar om typen är okänd", async () => {
    await expect(
      log.emit({
        type: "matter.exploded" as never,
        source: "ui",
        actor: { kind: "user", id: "anna" },
        payload: {},
      }),
    ).rejects.toThrow();
  });

  it("kallar listeners när nytt event skrivs", async () => {
    const handler = vi.fn();
    log.onNewEvent(handler);

    await log.emit({
      type: "matter.updated",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: {},
    });

    // setImmediate används så listener kallas på nästa tick
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].type).toBe("matter.updated");
  });

  it("disposer-funktionen avregistrerar listenern", async () => {
    const handler = vi.fn();
    const dispose = log.onNewEvent(handler);
    dispose();
    await log.emit({
      type: "matter.updated",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      payload: {},
    });
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  });

  it("en trasig listener kraschar inte emit-flödet", async () => {
    log.onNewEvent(() => { throw new Error("oops"); });
    await expect(
      log.emit({
        type: "matter.updated",
        source: "ui",
        actor: { kind: "user", id: "anna" },
        payload: {},
      }),
    ).resolves.toBeDefined();
  });
});

describe("PostgresEventLog.query", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let log: PostgresEventLog;

  beforeEach(() => {
    prisma = makePrismaMock();
    log = new PostgresEventLog(prisma as never, ORG);
  });

  it("filtrerar alltid på organizationId", async () => {
    await log.query({});
    const args = prisma.avaEventLog.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ organizationId: ORG });
  });

  it("översätter type-array till in-clause", async () => {
    await log.query({ type: ["matter.created", "matter.updated"] });
    const args = prisma.avaEventLog.findMany.mock.calls[0][0];
    expect(args.where.type).toEqual({ in: ["matter.created", "matter.updated"] });
  });

  it("översätter since + until till gte/lte", async () => {
    await log.query({
      since: "2026-05-01T00:00:00.000Z",
      until: "2026-05-31T23:59:59.999Z",
    });
    const args = prisma.avaEventLog.findMany.mock.calls[0][0];
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    expect(args.where.createdAt.lte).toBeInstanceOf(Date);
  });

  it("default-limit är 1000, kan överskrivas", async () => {
    await log.query({});
    expect(prisma.avaEventLog.findMany.mock.calls[0][0].take).toBe(1000);

    prisma.avaEventLog.findMany.mockClear();
    await log.query({ limit: 50 });
    expect(prisma.avaEventLog.findMany.mock.calls[0][0].take).toBe(50);
  });

  it("konverterar DB-rader tillbaka till AvaEvent-format", async () => {
    prisma.avaEventLog.findMany.mockResolvedValueOnce([
      {
        id: "01900000-0000-7000-8000-000000000001",
        type: "matter.created",
        source: "ui",
        actorKind: "user",
        actorId: "anna",
        matterId: "matter-1",
        causedBy: null,
        payload: { foo: "bar" },
        createdAt: new Date("2026-05-18T10:00:00.000Z"),
      },
    ]);

    const events = await log.query({});
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("01900000-0000-7000-8000-000000000001");
    expect(events[0].actor).toEqual({ kind: "user", id: "anna" });
    expect(events[0].matterId).toBe("matter-1");
    expect(events[0].causedBy).toBeUndefined();
    expect(events[0].payload).toEqual({ foo: "bar" });
  });
});
