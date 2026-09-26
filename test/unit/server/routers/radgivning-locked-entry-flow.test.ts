/**
 * Rådgivningstimmen som LÅST tidspost genom faktureringsvägarna (#1205).
 *
 * Buggen: med `radgivningBetaldAt` satt drogs ärendets FÖRSTA 60 registrerade
 * minuter av från kostnadsräkningen — även när mötet aldrig registrerats som tid,
 * och oavsett kategori (tidsspillan åts också). Juristen såg 1 h mindre än
 * registrerat. Nu registrerar `invoice.createRadgivning` själv mötet som en låst
 * post kopplad till rådgivningsfakturan, och låsta poster når aldrig något
 * underlag: förslaget, kostnadsräkningen eller slutregleringen.
 *
 * Körs mot en riktig in-memory-store genom hela routern, så även repo-reglerna
 * (`listUnfrozenForMatter`/`freezeForMatter`) är med.
 */
import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};

const NORM_2026 = 162_600;       // timkostnadsnormen 2026, F-skatt (öre/h)
const MATTER = asId<"MatterId">("m-1");
const RADGIVNING_TEXT = "Rådgivningstimme (1 tim) har redan fakturerats klienten separat enligt rättshjälpstaxan och ingår ej i denna faktura.";

/** Användarens fall: 6,5 h arbete + 42 min tidsspillan, INGEN rådgivningspost registrerad. */
function makeCaller() {
  const entry = (id: string, date: string, minutes: number, kind: "ARBETE" | "TIDSSPILLAN") => ({
    id, organizationId: "org-1", userId: "u-1", matterId: "m-1",
    date: new Date(date), minutes, description: id, hourlyRate: 250_000, billable: true, kind,
  });
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Vårdnad", status: "ACTIVE",
      paymentMethod: "RATTSHJALP", clientShareBips: 2000, createdAt: new Date(),
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 250_000 }],
    timeEntries: [
      entry("arbete-1", "2026-03-02T09:00:00Z", 150, "ARBETE"),
      entry("resa", "2026-03-03T09:00:00Z", 42, "TIDSSPILLAN"),
      entry("arbete-2", "2026-03-04T09:00:00Z", 240, "ARBETE"),
    ],
    expenses: [],
  }, async () => { /* writable: noop write-back */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

type Caller = ReturnType<typeof makeCaller>;

async function withRadgivning(): Promise<Caller> {
  const caller = makeCaller();
  await caller.invoice.createRadgivning({ matterId: MATTER, invoiceDate: "2026-03-01" });
  return caller;
}

async function entriesOf(caller: Caller) {
  return (await caller.timeEntry.list({ matterId: MATTER, pageSize: 100 })).entries;
}

describe("invoice.createRadgivning registrerar mötet som låst post (#1205)", () => {
  it("exakt EN post: 60 min arbete, låst och kopplad till rådgivningsfakturan", async () => {
    const caller = makeCaller();
    const { invoice } = await caller.invoice.createRadgivning({ matterId: MATTER, invoiceDate: "2026-03-01" });
    const radgivning = (await entriesOf(caller)).filter((t) => t.description === "Rådgivning");
    expect(radgivning).toHaveLength(1);
    expect(radgivning[0]).toMatchObject({
      minutes: 60, kind: "ARBETE", billable: true, hourlyRate: NORM_2026, invoiceId: invoice.id, userId: "u-1",
    });
    expect(radgivning[0]!.frozenAt).toBeTruthy();
    expect(radgivning[0]!.frozenByBillingRunId ?? null).toBeNull();
  });

  it("den låsta posten kan inte ändras", async () => {
    const caller = await withRadgivning();
    const radgivning = (await entriesOf(caller)).find((t) => t.description === "Rådgivning");
    await expect(caller.timeEntry.update({ id: radgivning!.id, minutes: 30 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("låsta poster når aldrig något underlag (#1205)", () => {
  /** 6,5 h arbete + 42 min tidsspillan värderat på 2026 års normer. */
  async function registeredValue(): Promise<number> {
    // Samma poster UTAN rådgivning — referensvärdet.
    return (await makeCaller().billingRun.proposal({ matterId: MATTER })).workValueOre;
  }

  it("Upparbetat ofakturerat = exakt det registrerade, ingen timme av eller till", async () => {
    const caller = await withRadgivning();
    const proposal = await caller.billingRun.proposal({ matterId: MATTER });
    expect(proposal.timeEntries.map((t) => t.id).sort()).toEqual(["arbete-1", "arbete-2", "resa"]);
    expect(proposal.workValueOre).toBe(await registeredValue());
    // 6,5 h arbete på normen ingår helt (ingen carve av första timmen).
    expect(proposal.workValueOre).toBeGreaterThan(6.5 * NORM_2026);
  });

  it("kostnadsräkningen yrkar allt registrerat och fryser INTE rådgivningsposten", async () => {
    const caller = await withRadgivning();
    const ref = await makeCaller().billingRun.createKostnadsrakning({ matterId: MATTER });
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    expect(run.workValueOreAtRun).toBe(ref.run.workValueOreAtRun);
    const radgivning = (await entriesOf(caller)).find((t) => t.description === "Rådgivning");
    expect(radgivning!.frozenByBillingRunId ?? null).toBeNull();
  });

  it("slutregleringen: tidsspecen är det registrerade, domstolen ser info-raden", async () => {
    const caller = await withRadgivning();
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: run.workValueOreAtRun });
    const res = await caller.billingRun.settleCoverage({ matterId: MATTER, payerRecipient: "DOMSTOL", invoiceDate: "2026-06-01" });

    const lines = res.breakdown.clientArvodeLines;
    expect(lines.map((l) => l.minutes).reduce((s, m) => s + m, 0)).toBe(390 + 42);
    expect(lines.some((l) => l.description === "Rådgivning")).toBe(false);
    const rows = res.payerInvoice.settlementBreakdown?.rows ?? [];
    expect(rows.find((r) => r.kind === "info" && r.label === RADGIVNING_TEXT)).toBeTruthy();
    expect(rows.some((r) => r.label.startsWith("Avgår rådgivningstimme"))).toBe(false);
  });
});
