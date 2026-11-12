/**
 * Kostnadsräkningens KÖRNING i taxeärenden (#1024, #1182).
 *
 * Förut lagrade `createKostnadsrakning` posternas egna á-priser som yrkat
 * (`workValueOreAtRun`) även när brottmålstaxan styr arvodet — medan dokumentet
 * yrkade taxan. KR-panelens "yrkat", beslutet och prutningen räknades mot ett
 * belopp domstolen aldrig såg. Nu räknar servern yrkandet med SAMMA funktion
 * som dokumentet (`kostnadsrakningClaimInclVat`).
 *
 * Utan huvudförhandlingens tid går taxan inte att räkna — då vägrar servern i
 * stället för att yrka fel belopp. Över taxans maxgräns likaså (räknas löpande).
 */
import { describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { advokatberedskapFtaxForDate, tidsspillanFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { asId } from "@/lib/shared/schemas/ids";
import { roundToKronor } from "@/lib/shared/whole-kronor";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const MATTER = asId<"MatterId">("m-1");
const NOW = new Date();
const TAXA_95_NIVA1 = 563_500; // 1 tim 30 min – 1 tim 44 min, nivå 1 (2026)
/** Yrkat brutto (#1218): exkl (hela kronor) + 25 % moms avrundad till hela kronor. */
const yrkat = (exklOre: number): number => exklOre + roundToKronor(exklOre * 0.25);
const HUF = { hufStart: "2026-09-22T09:00:00.000Z", hufEnd: "2026-09-22T10:35:00.000Z" }; // 95 min

interface EntrySpec { id: string; minutes: number; kind?: "ADVOKATBEREDSKAP" | "TIDSSPILLAN" | "ARBETE" | "FORHANDLING"; hourlyRate?: number }

function setup(entries: readonly EntrySpec[], matterExtra: Record<string, unknown> = {}) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{
      id: MATTER, organizationId: "org-1", matterNumber: "2026-0016", title: "Brottmål", status: "ACTIVE",
      paymentMethod: "OFFENTLIGT_UPPDRAG", isTaxeArende: true, taxaLevel: 1, createdAt: new Date(), ...matterExtra,
    }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    timeEntries: entries.map((e) => ({
      id: e.id, organizationId: "org-1", userId: "u-1", matterId: MATTER, date: new Date("2026-09-20T10:00:00.000Z"),
      minutes: e.minutes, description: "Post", hourlyRate: e.hourlyRate ?? 250_000, billable: true, kind: e.kind ?? "ARBETE",
    })),
    expenses: [],
  }, async () => { /* writable */ });
  const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }));
  return { caller, ds };
}

describe("createKostnadsrakning — taxeärende yrkar brottmålstaxan (#1024)", () => {
  it("yrkat = taxan (inte posternas á-priser) — samma belopp som dokumentet", async () => {
    const { caller } = setup([{ id: "te-1", minutes: 300, hourlyRate: 250_000 }]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, taxaLevel: 1 });
    expect(run.workValueOreAtRun).toBe(yrkat(TAXA_95_NIVA1));
    expect(run.proposedAmountOre).toBe(run.workValueOreAtRun);
    expect(run.amountOre).toBe(run.workValueOreAtRun);
  });

  it("nivån i dialogen gäller (nivå 2 = häktningsförhandling m.m.)", async () => {
    const { caller } = setup([]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, taxaLevel: 2 });
    expect(run.workValueOreAtRun).toBe(yrkat(701_100));
  });

  it("dialogens HUF och nivå sparas på ärendet — yrkandet går att räkna om", async () => {
    const { caller } = setup([]);
    await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, taxaLevel: 2 });
    const matter = await caller.matter.getById({ id: MATTER });
    expect(matter).toMatchObject({ taxaHuvudforhandlingMin: 95, taxaLevel: 2 });
    expect(new Date(String(matter.taxaHufStart)).toISOString()).toBe(HUF.hufStart);
  });

  it("utan dialog: ärendets sparade HUF-tid används (demo-generatorn, skript)", async () => {
    const { caller } = setup([], { taxaHuvudforhandlingMin: 95, taxaHufStart: new Date(HUF.hufStart) });
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER });
    expect(run.workValueOreAtRun).toBe(yrkat(TAXA_95_NIVA1));
  });

  it("tidsspillan utöver timmen och beredskapsdygn yrkas ovanpå taxan (#1182)", async () => {
    const { caller } = setup([
      { id: "ts", minutes: 150, kind: "TIDSSPILLAN" },
      { id: "b", minutes: 0, kind: "ADVOKATBEREDSKAP", hourlyRate: 255_000 },
    ]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, taxaLevel: 1 });
    const extraTs = roundToKronor(Math.round(1.5 * tidsspillanFtaxForDate(NOW)));
    expect(run.workValueOreAtRun).toBe(yrkat(TAXA_95_NIVA1 + extraTs + advokatberedskapFtaxForDate(NOW)));
  });

  it("dialogen avmarkerade taxeärendet → löpande (norm per kategori), inte taxan", async () => {
    const { caller } = setup([{ id: "te-1", minutes: 60 }]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, isTaxeArende: false });
    expect(run.workValueOreAtRun).not.toBe(yrkat(TAXA_95_NIVA1));
    expect((await caller.matter.getById({ id: MATTER })).isTaxeArende).toBe(false);
  });

  it("beslut och prutning räknas mot taxans belopp", async () => {
    const { caller } = setup([]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, taxaLevel: 1 });
    await caller.billingRun.recordKostnadsrakningBeslut({ billingRunId: run.id, awardedOre: yrkat(TAXA_95_NIVA1) - 50_000, prutningOre: -50_000 });
    const { invoice } = await caller.billingRun.setVerdict({ billingRunId: run.id });
    expect(invoice.amount).toBe(yrkat(TAXA_95_NIVA1) - 50_000);
  });
});

describe("createKostnadsrakning — taxeärende utan giltig huvudförhandling vägras", () => {
  it("ingen HUF-tid (varken i dialogen eller på ärendet) → PRECONDITION_FAILED, ingen körning, inget fryst", async () => {
    const { caller } = setup([{ id: "te-1", minutes: 60 }]);
    await expect(caller.billingRun.createKostnadsrakning({ matterId: MATTER })).rejects.toThrow(/huvudförhandling/i);
    expect((await caller.billingRun.list({ matterId: MATTER })).runs).toHaveLength(0);
    const { entries } = await caller.timeEntry.list({ matterId: MATTER, pageSize: 10 });
    expect(entries.every((e) => !e.frozenAt)).toBe(true);
  });

  it("över taxans maxgräns (3 tim 45 min) → vägras med hänvisning till löpande räkning", async () => {
    const { caller } = setup([]);
    await expect(caller.billingRun.createKostnadsrakning({
      matterId: MATTER, hufStart: "2026-09-22T09:00:00.000Z", hufEnd: "2026-09-22T13:00:00.000Z", taxaLevel: 1,
    })).rejects.toThrow(/maxgräns.*löpande|löpande.*maxgräns/i);
  });

  it("slut före start → vägras", async () => {
    const { caller } = setup([]);
    await expect(caller.billingRun.createKostnadsrakning({
      matterId: MATTER, hufStart: "2026-09-22T11:00:00.000Z", hufEnd: "2026-09-22T09:00:00.000Z",
    })).rejects.toThrow();
  });
});

describe("\"Deltagit i förhandling\"-posten (FORHANDLING)", () => {
  it("räknas inte som arbete i körningen — förhandlingstiden är klockans, aldrig dubbelt", async () => {
    const without = setup([{ id: "a", minutes: 120 }], { isTaxeArende: false });
    const withHearing = setup([{ id: "a", minutes: 120 }, { id: "h", minutes: 95, kind: "FORHANDLING" }], { isTaxeArende: false });
    const claim = { matterId: MATTER, ...HUF, isTaxeArende: false };
    const r1 = await without.caller.billingRun.createKostnadsrakning(claim);
    const r2 = await withHearing.caller.billingRun.createKostnadsrakning(claim);
    expect(r2.run.workValueOreAtRun).toBe(r1.run.workValueOreAtRun);
  });

  it("fryses ändå med körningen — den blir inte kvar som ofakturerat arbete", async () => {
    const { caller } = setup([{ id: "h", minutes: 95, kind: "FORHANDLING" }], { isTaxeArende: false });
    await caller.billingRun.createKostnadsrakning({ matterId: MATTER, ...HUF, isTaxeArende: false });
    const { entries } = await caller.timeEntry.list({ matterId: MATTER, pageSize: 10 });
    expect(entries.find((e) => e.id === "h")?.frozenAt).toBeTruthy();
  });

  it("nedlagt ärende: ingen förhandlingstid (start = slut), ingen taxa — bara posterna yrkas", async () => {
    const { caller } = setup([{ id: "a", minutes: 120 }], { isTaxeArende: false });
    const { run } = await caller.billingRun.createKostnadsrakning({
      matterId: MATTER, hufStart: HUF.hufStart, hufEnd: HUF.hufStart, isTaxeArende: false,
    });
    expect(run.workValueOreAtRun).toBeGreaterThan(0);
  });

  it("en ny förhandlingspost får timarvodets pris, inte beredskapens dagbelopp", async () => {
    const { caller } = setup([]);
    await caller.organization.updateSettings({ hourlyRates: { ARBETE: 200_000 } });
    const created = await caller.timeEntry.create({
      matterId: MATTER, date: "2026-09-22", minutes: 96, description: "Huvudförhandling", kind: "FORHANDLING",
    });
    expect(created.hourlyRate).toBe(200_000);
  });
});
