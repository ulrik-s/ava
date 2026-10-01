/**
 * "Markera som rådgivning" från webbläsaren i self-hosted (#1349) — klienten
 * byggd som i appen (`createServerFirstStore`, routrarna in-process,
 * procedurkön) mot servern bakom den riktiga tRPC-handlern.
 *
 * Förr köades inte anropet: den lokala körningen skrev tidsposterna som RADER,
 * och servern avvisar rader för procedurägda entiteter — markeringen syntes
 * lokalt men försvann, och ändringen hamnade bland de avvisade. Nu köas
 * ANROPET, servern kör om det, och båda körningarna ger samma rader: samma
 * id på restposten, samma låstidpunkt.
 */
import { IDBFactory } from "fake-indexeddb";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { isProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { ORG, SimClient, SimServer, userFor } from "./simulation/sync-world";

const MATTER = asId<"MatterId">(uuidv7());
const INVOICE = asId<"InvoiceId">(uuidv7());
const MEETING = asId<"TimeEntryId">(uuidv7());

/** Det som ska vara lika i klientens och serverns körning (övriga fält strippas). */
const entryShape = z.object({
  id: z.string(),
  minutes: z.number(),
  invoiceId: z.string().nullable().default(null),
  frozenAt: z.coerce.date().nullable().default(null).transform((d) => d?.getTime() ?? null),
});

function shape(rows: readonly unknown[]): Array<z.infer<typeof entryShape>> {
  return rows.map((r) => entryShape.parse(r)).sort((a, b) => a.id.localeCompare(b.id));
}

describe("Markera som rådgivning från webbläsaren (#1349)", () => {
  let server: SimServer;
  let lawyer: SimClient;
  const prevIdb = Reflect.get(globalThis, "indexedDB");

  beforeAll(async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    server = await SimServer.start(1);
    // Rättshjälpsärende vars rådgivningsfaktura skapades före #1205: ingen låst post.
    await server.repos.matters.create({
      id: MATTER, organizationId: ORG, title: "Vårdnad", status: "ACTIVE", matterNumber: "2026-1349",
      paymentMethod: "RATTSHJALP", radgivningBetaldAt: new Date("2026-03-01"), responsibleLawyerId: userFor(0).id,
    } as never);
    await server.repos.invoices.create({
      id: INVOICE, matterId: MATTER, amount: 203_250, invoiceType: "STANDARD", status: "SENT", invoiceDate: new Date("2026-03-01"), notes: RADGIVNING_INVOICE_NOTES,
    } as never);
    await server.repos.timeEntries.create({
      id: MEETING, matterId: MATTER, userId: userFor(0).id, date: new Date("2026-03-02"), minutes: 90,
      description: "Första möte", hourlyRate: 150_000, billable: true, kind: "ARBETE",
    } as never);
    lawyer = new SimClient(0, server);
    await lawyer.boot();
    expect(await lawyer.sync()).toBe("ok");
  });
  afterAll(async () => {
    Reflect.set(globalThis, "indexedDB", prevIdb);
    await server.handle.close();
  });

  it("köas som anrop, servern kör om det och får samma rader som klienten — inget avvisas", async () => {
    const res = await lawyer.api.timeEntry.markAsRadgivning.mutate({ id: MEETING });
    expect(res.remainder?.minutes).toBe(30);
    const queued = lawyer.store.pendingEntries();
    expect(queued.length).toBe(1);
    expect(queued.every(isProcedureCall)).toBe(true);
    const local = shape(lawyer.rows("timeEntries").filter((r) => r.matterId === MATTER));

    expect(await lawyer.sync()).toBe("ok");
    expect(lawyer.rejected.list()).toEqual([]);
    const remainderId = asId<"TimeEntryId">(String(res.remainder?.id));
    const onServer = shape([await server.repos.timeEntries.getById(MEETING), await server.repos.timeEntries.getById(remainderId)]);

    expect(onServer).toEqual(local);
    expect(onServer.find((e) => e.id === MEETING)).toMatchObject({ minutes: 60, invoiceId: INVOICE });
    expect(lawyer.store.pendingEntries()).toEqual([]);
  });
});
