/**
 * `timeEntry.markAsRadgivning` + `timeEntry.radgivningStatus` (#1207).
 *
 * Rättshjälpsärenden vars rådgivningsfaktura skapades före #1205 saknar den
 * låsta rådgivningsposten. Juristen pekar ut mötet i tidslistan; posten låses
 * mot rådgivningsfakturan (över 60 min delas den) och yrkas aldrig i
 * kostnadsräkningen. Körs mot en riktig in-memory-store genom hela routern.
 */
import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
const INV = asId<"InvoiceId">("inv-r");
const id = (s: string) => asId<"TimeEntryId">(s);

interface SeedOpts {
  paymentMethod?: string;
  radgivningBetaldAt?: Date | null;
  withInvoice?: boolean;
}

function entry(entryId: string, minutes: number, extra: Record<string, unknown> = {}) {
  return {
    id: entryId, organizationId: "org-1", userId: "u-1", matterId: "m-1", date: new Date("2026-03-02T09:00:00Z"),
    minutes, description: "Första möte med klient", hourlyRate: 250_000, billable: true, kind: "ARBETE", ...extra,
  };
}

/** Legacy-ärende: rådgivningsfaktura från före #1205, ingen låst post. */
function makeCaller(opts: SeedOpts = {}, timeEntries: ReturnType<typeof entry>[] = [entry("mote", 45)]) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Vårdnad", status: "ACTIVE",
      paymentMethod: opts.paymentMethod ?? "RATTSHJALP", clientShareBips: 2000, createdAt: new Date(),
      radgivningBetaldAt: opts.radgivningBetaldAt === undefined ? new Date("2026-03-01") : opts.radgivningBetaldAt,
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 250_000 }],
    invoices: opts.withInvoice === false ? [] : [{
      id: INV, organizationId: "org-1", matterId: "m-1", amount: 203_250, invoiceType: "STANDARD", status: "SENT",
      invoiceDate: new Date("2026-03-01"), notes: RADGIVNING_INVOICE_NOTES,
    }],
    timeEntries,
    expenses: [],
  }, async () => { /* writable: noop write-back */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

type Caller = ReturnType<typeof makeCaller>;

async function entriesOf(caller: Caller) {
  return (await caller.timeEntry.list({ matterId: MATTER, pageSize: 100 })).entries;
}

describe("timeEntry.markAsRadgivning — låser (#1207)", () => {
  it("≤ 60 min: posten låses mot rådgivningsfakturan, ingen delning", async () => {
    const caller = makeCaller();
    const res = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(res.remainder).toBeNull();
    expect(res.locked).toMatchObject({ id: "mote", minutes: 45, invoiceId: INV });
    expect(res.locked.frozenAt).toBeTruthy();
    expect(res.locked.frozenByBillingRunId ?? null).toBeNull();
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "present", invoiceId: INV });
  });

  it("> 60 min: den utpekade posten blir exakt 60 min låst, resten en ny olåst post", async () => {
    const caller = makeCaller({}, [entry("mote", 150, { standardAtgardId: "sa-1" })]);
    const res = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(res.locked).toMatchObject({ id: "mote", minutes: 60, invoiceId: INV });
    expect(res.remainder).toMatchObject({
      minutes: 90, description: "Första möte med klient", hourlyRate: 250_000, kind: "ARBETE", billable: true,
      standardAtgardId: "sa-1", matterId: "m-1", userId: "u-1",
    });
    expect(res.remainder!.id).not.toBe("mote");
    expect(res.remainder!.frozenAt ?? null).toBeNull();
    const all = await entriesOf(caller);
    expect(all.map((t) => t.minutes).sort((a, b) => a - b)).toEqual([60, 90]);
  });

  it("den låsta posten når inte upparbetat ofakturerat — resten gör det", async () => {
    const caller = makeCaller({}, [entry("mote", 150)]);
    const { remainder } = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    const proposal = await caller.billingRun.proposal({ matterId: MATTER });
    expect(proposal.timeEntries.map((t) => t.id)).toEqual([remainder!.id]);
  });
});

describe("timeEntry.markAsRadgivning — ej debiterbar tid (#1235)", () => {
  const FROZEN_AT = new Date("2026-05-01T10:00:00Z");
  const frozenByKr = { billable: false, frozenAt: FROZEN_AT, frozenByBillingRunId: "run-kr" };

  it("olåst ej debiterbar ≤ 60 min: kopplas + låses, ingen delning", async () => {
    const caller = makeCaller({}, [entry("mote", 60, { billable: false })]);
    const res = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(res.remainder).toBeNull();
    expect(res.locked).toMatchObject({ id: "mote", minutes: 60, invoiceId: INV, billable: false });
    expect(res.locked.frozenAt).toBeTruthy();
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "present", invoiceId: INV });
  });

  it("olåst ej debiterbar > 60 min: delas, resten behåller ej debiterbar och är olåst", async () => {
    const caller = makeCaller({}, [entry("mote", 90, { billable: false })]);
    const res = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(res.locked).toMatchObject({ id: "mote", minutes: 60, invoiceId: INV });
    expect(res.remainder).toMatchObject({ minutes: 30, billable: false });
    expect(res.remainder!.frozenAt ?? null).toBeNull();
  });

  it("prod-formen: ej debiterbar fryst av KR — kopplas, frysningen och körningen behålls", async () => {
    const caller = makeCaller({}, [entry("mote", 60, frozenByKr)]);
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "missing", invoiceId: INV });
    const res = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(res.remainder).toBeNull();
    expect(res.locked).toMatchObject({ id: "mote", minutes: 60, invoiceId: INV, billable: false, frozenByBillingRunId: "run-kr" });
    expect(new Date(res.locked.frozenAt!).toISOString()).toBe(FROZEN_AT.toISOString());
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "present", invoiceId: INV });
  });

  it("ej debiterbar fryst av KR > 60 min: resten behåller samma frysning och körning", async () => {
    const caller = makeCaller({}, [entry("mote", 100, frozenByKr)]);
    const res = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(res.locked).toMatchObject({ minutes: 60, invoiceId: INV, frozenByBillingRunId: "run-kr" });
    expect(res.remainder).toMatchObject({ minutes: 40, billable: false, frozenByBillingRunId: "run-kr" });
    expect(new Date(res.remainder!.frozenAt!).toISOString()).toBe(FROZEN_AT.toISOString());
    expect(res.remainder!.invoiceId ?? null).toBeNull();
  });
});

describe("timeEntry.markAsRadgivning — avvisar (#1207)", () => {
  it("en post per ärende: andra markeringen avvisas", async () => {
    const caller = makeCaller({}, [entry("mote", 45), entry("annan", 30)]);
    await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    await expect(caller.timeEntry.markAsRadgivning({ id: id("annan") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "Ärendet har redan en låst rådgivningspost." });
  });

  it("redan låst post avvisas", async () => {
    const caller = makeCaller({}, [entry("mote", 45, { frozenAt: new Date() })]);
    await expect(caller.timeEntry.markAsRadgivning({ id: id("mote") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("redan låst") });
  });

  it("debiterbar post fryst av kostnadsräkningens körning avvisas (#1235)", async () => {
    const caller = makeCaller({}, [entry("mote", 45, { frozenAt: new Date(), frozenByBillingRunId: "run-kr" })]);
    await expect(caller.timeEntry.markAsRadgivning({ id: id("mote") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("redan låst") });
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "missing", invoiceId: INV });
  });

  it("inte rättshjälp avvisas", async () => {
    const caller = makeCaller({ paymentMethod: "PRIVAT" });
    await expect(caller.timeEntry.markAsRadgivning({ id: id("mote") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("rättshjälpsärende") });
  });

  it("rättshjälp utan registrerad rådgivning avvisas", async () => {
    const caller = makeCaller({ radgivningBetaldAt: null });
    await expect(caller.timeEntry.markAsRadgivning({ id: id("mote") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("rättshjälpsärende") });
  });

  it("rådgivningsfakturan saknas avvisas", async () => {
    const caller = makeCaller({ withInvoice: false });
    await expect(caller.timeEntry.markAsRadgivning({ id: id("mote") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("hittades inte") });
  });

  it("okänd post → NOT_FOUND", async () => {
    await expect(makeCaller().timeEntry.markAsRadgivning({ id: id("finns-inte") }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ärende skapat efter #1205 (createRadgivning låste redan mötet) avvisas", async () => {
    const caller = makeCaller({ radgivningBetaldAt: null, withInvoice: false });
    await caller.invoice.createRadgivning({ matterId: MATTER, invoiceDate: "2026-03-01" });
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toMatchObject({ kind: "present" });
    await expect(caller.timeEntry.markAsRadgivning({ id: id("mote") }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: "Ärendet har redan en låst rådgivningspost." });
  });
});

describe("timeEntry.radgivningStatus (#1207)", () => {
  it("legacy-ärende → missing med fakturan", async () => {
    expect(await makeCaller().timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "missing", invoiceId: INV });
  });
  it("okänt ärende → NOT_FOUND", async () => {
    await expect(makeCaller().timeEntry.radgivningStatus({ matterId: asId<"MatterId">("nope") }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ångrad kostnadsräkning efter markering (#1235)", () => {
  it("den kopplade rådgivningsposten förblir låst mot fakturan; övrig tid låses upp", async () => {
    const caller = makeCaller({}, [entry("mote", 60, { billable: false }), entry("arbete", 90)]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    const { locked } = await caller.timeEntry.markAsRadgivning({ id: id("mote") });
    expect(locked).toMatchObject({ invoiceId: INV, frozenByBillingRunId: run.id });

    await caller.billingRun.voidKostnadsrakning({ billingRunId: run.id });
    const byId = new Map((await entriesOf(caller)).map((t) => [t.id, t]));
    expect(byId.get(id("mote"))).toMatchObject({ invoiceId: INV });
    expect(byId.get(id("mote"))!.frozenAt).toBeTruthy();
    expect(byId.get(id("mote"))!.frozenByBillingRunId ?? null).toBeNull();
    expect(byId.get(id("arbete"))!.frozenAt ?? null).toBeNull();
    expect(await caller.timeEntry.radgivningStatus({ matterId: MATTER })).toEqual({ kind: "present", invoiceId: INV });
    const proposal = await caller.billingRun.proposal({ matterId: MATTER });
    expect(proposal.timeEntries.map((t) => t.id)).toEqual(["arbete"]);
  });
});
