/**
 * Flera kostnadsräkningar i samma ärende (#1892, ADR 0034).
 *
 * I rättshjälp och offentligt uppdrag kan ett slutreglerat ärende få en ny
 * kostnadsräkning. Beslutet och fakturan fryser bara körningens egna poster, så
 * arbete som inte yrkats står kvar till nästa kostnadsräkning. Slutregleringen
 * drar av ett aconto bara en gång.
 *
 * Körs mot en riktig in-memory-store genom hela routern, så repo-reglerna är med.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId, type BillingRunId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
const NOW = new Date("2026-10-15T12:00:00.000Z");
const HUF = { hufStart: "2026-10-14T09:00:00.000Z", hufEnd: "2026-10-14T10:35:00.000Z" };

type Method = "OFFENTLIGT_UPPDRAG" | "RATTSHJALP";

/** Två arbetsposter i ett ärende med `method`. */
function setup(method: Method) {
  const base = { organizationId: "org-1", userId: "u-1", matterId: MATTER, billable: true, hourlyRate: 250_000, kind: "ARBETE" };
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: MATTER, organizationId: "org-1", matterNumber: "2026-0042", title: "Mål", status: "ACTIVE",
      paymentMethod: method, isTaxeArende: false, taxaLevel: 1, clientShareBips: method === "RATTSHJALP" ? 1000 : 0, createdAt: new Date(),
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    timeEntries: [
      { ...base, id: "te-1", date: new Date("2026-09-01T10:00:00.000Z"), minutes: 120, description: "Inläsning" },
      { ...base, id: "te-2", date: new Date("2026-10-01T10:00:00.000Z"), minutes: 90, description: "Möte" },
    ],
    expenses: [],
  }, async () => { /* writable: noop write-back */ });
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
}

type Caller = ReturnType<typeof setup>;

async function frozenIds(caller: Caller): Promise<string[]> {
  const { entries } = await caller.timeEntry.list({ matterId: MATTER, pageSize: 100 });
  return entries.filter((e) => e.frozenAt).map((e) => e.id).sort();
}

/** Kostnadsräkning på `te` med fullt bifall registrerat; returnerar körningen. */
async function decidedKr(caller: Caller, method: Method, te: string): Promise<{ id: BillingRunId; awardedOre: number }> {
  const dialog = method === "RATTSHJALP" ? {} : { ...HUF, isTaxeArende: false };
  const { run } = await caller.billingRun.createKostnadsrakning({
    matterId: MATTER, ...dialog, timeEntryIds: [asId<"TimeEntryId">(te)], expenseIds: [],
  });
  await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: run.workValueOreAtRun });
  return { id: run.id, awardedOre: run.workValueOreAtRun };
}

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { vi.setSystemTime(); });

describe("offentligt uppdrag: beslut och faktura fryser bara körningens poster (#1892)", () => {
  it("ovald tid står kvar ofryst efter fakturan och går att yrka i en andra kostnadsräkning", async () => {
    const caller = setup("OFFENTLIGT_UPPDRAG");
    const first = await decidedKr(caller, "OFFENTLIGT_UPPDRAG", "te-1");
    const { invoice: inv1 } = await caller.billingRun.setVerdict({ billingRunId: first.id });
    expect(inv1.amount).toBe(first.awardedOre);
    expect(await frozenIds(caller)).toEqual(["te-1"]);

    const second = await decidedKr(caller, "OFFENTLIGT_UPPDRAG", "te-2");
    const { invoice: inv2 } = await caller.billingRun.setVerdict({ billingRunId: second.id });
    expect(inv2.amount).toBe(second.awardedOre);
    expect(await frozenIds(caller)).toEqual(["te-1", "te-2"]);
  });
});

describe("rättshjälp: två slutregleringar drar av acontot en gång (#1892)", () => {
  it("aconto, kostnadsräkning, slutreglering, ny kostnadsräkning och ny slutreglering", async () => {
    const caller = setup("RATTSHJALP");
    const { run: acconto } = await caller.billingRun.createAcconto({ matterId: MATTER, clientShareBips: 1000, amountOre: 20_000 });

    const first = await decidedKr(caller, "RATTSHJALP", "te-1");
    const s1 = await caller.billingRun.settleCoverage({ matterId: MATTER, payerRecipient: "DOMSTOL" });
    expect(s1.clientRun.deductedBillingRunIds).toEqual([acconto.id]);
    expect(s1.clientRun.workValueOreAtRun + s1.payerInvoice.amount).toBe(first.awardedOre);
    expect(await frozenIds(caller)).toEqual(["te-1"]);

    const second = await decidedKr(caller, "RATTSHJALP", "te-2");
    // Också ett explicit valt aconto som redan dragits av hoppas över.
    const s2 = await caller.billingRun.settleCoverage({ matterId: MATTER, payerRecipient: "DOMSTOL", deductedBillingRunIds: [acconto.id] });
    expect(s2.clientRun.deductedBillingRunIds).toEqual([]);
    expect(s2.clientInvoice.amount).toBe(s2.clientRun.workValueOreAtRun);
    expect(s2.clientRun.workValueOreAtRun + s2.payerInvoice.amount).toBe(second.awardedOre);
    expect(await frozenIds(caller)).toEqual(["te-1", "te-2"]);
  });
});
