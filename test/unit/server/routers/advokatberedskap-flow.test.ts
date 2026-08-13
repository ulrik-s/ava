/**
 * Advokatberedskapen genom faktureringsvägarna (#950).
 *
 * Enhetstesterna i `advokatberedskap.test.ts` täcker normen och § 2-regeln som
 * ren logik. Här testas det som gör den lätt att tappa: kategorin bär NOLL
 * minuter, och varje väg som räknar `minuter × taxa` ger då tyst noll. Det
 * hände inte hypotetiskt — `carveEarliestMinutes` svalde hela posten och
 * `arvodeNetOre` värderade den till 0 innan de fixades.
 *
 * Vägarna som måste bära beloppet:
 *   - kostnadsräkningen till domstol (offentligt uppdrag — beredskapens hem)
 *   - fakturaförslaget ("Upparbetat ofakturerat")
 *   - slutregleringen i täckningsärenden (rättshjälp)
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

const DAG_2026 = 255_000; // 2 550 kr (DVFS 2025:9 § 1)
const HELG = new Date("2026-05-02T09:00:00.000Z"); // beredskapsdag med förhandling
const LUGN = new Date("2026-05-03T00:00:00.000Z"); // beredskapsdag utan arbete

interface EntrySpec {
  id: string;
  date: Date;
  minutes: number;
  kind?: "ADVOKATBEREDSKAP" | "ARBETE_OBEKVAM_TID" | "TIDSSPILLAN";
  hourlyRate?: number;
  billable?: boolean;
}

function makeCaller(entries: readonly EntrySpec[], paymentMethod = "OFFENTLIGT_UPPDRAG") {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X" }],
    matters: [{ id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "Brottmål", status: "ACTIVE", paymentMethod, createdAt: new Date() }],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRate: 250_000 }],
    timeEntries: entries.map((e) => ({
      id: e.id, organizationId: "org-1", userId: "u-1", matterId: "m-1",
      date: e.date, minutes: e.minutes, description: "Post",
      hourlyRate: e.hourlyRate ?? 250_000, billable: e.billable ?? true,
      ...(e.kind ? { kind: e.kind } : {}),
    })),
    expenses: [],
  }, async () => { /* writable: noop write-back */ });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any);
}

/** En beredskapsdag: noll minuter, dagbeloppet som á-pris. */
const beredskap = (id: string, date: Date): EntrySpec =>
  ({ id, date, minutes: 0, kind: "ADVOKATBEREDSKAP", hourlyRate: DAG_2026 });

describe("advokatberedskap i kostnadsräkningen (offentligt uppdrag)", () => {
  it("dagbeloppet kommer med i det yrkade — inte noll", async () => {
    const caller = makeCaller([beredskap("te-1", LUGN)]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    // Enda posten är beredskapen → arvodet är dagbeloppet, brutto inkl 25 % moms.
    expect(run.workValueOreAtRun).toBe(Math.round(DAG_2026 * 1.25));
  });

  it("beredskapen läggs till arbetet, inte i stället för", async () => {
    const caller = makeCaller([
      beredskap("te-1", LUGN),
      { id: "te-2", date: LUGN, minutes: 120, hourlyRate: 250_000 }, // 2 h × 2 500 kr
    ]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    expect(run.workValueOreAtRun).toBe(Math.round((DAG_2026 + 500_000) * 1.25));
  });

  it("§ 2: dag med helgförhandling ger arbetet — inte garantin", async () => {
    const caller = makeCaller([
      beredskap("te-1", HELG),
      { id: "te-2", date: HELG, minutes: 90, kind: "ARBETE_OBEKVAM_TID", hourlyRate: 325_600 },
    ]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    // Bara arbetet: 90 min × 3 256 kr/h = 4 884 kr.
    expect(run.workValueOreAtRun).toBe(Math.round(488_400 * 1.25));
  });

  it("två beredskapsdygn där ETT förbrukas → ett dygn kvar", async () => {
    const caller = makeCaller([
      beredskap("te-1", LUGN),
      beredskap("te-2", HELG),
      { id: "te-3", date: HELG, minutes: 90, kind: "ARBETE_OBEKVAM_TID", hourlyRate: 325_600 },
    ]);
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    expect(run.workValueOreAtRun).toBe(Math.round((DAG_2026 + 488_400) * 1.25));
  });
});

describe("advokatberedskap i fakturaförslaget", () => {
  it("syns som en rad med dagbeloppet i 'Upparbetat ofakturerat'", async () => {
    const caller = makeCaller([beredskap("te-1", LUGN)]);
    const proposal = await caller.billingRun.proposal({ matterId: "m-1" });
    const row = proposal.timeEntries.find((t) => t.id === "te-1");
    expect(row, "beredskapsposten ska finnas i förslaget").toBeDefined();
    expect(row?.valueOre).toBe(DAG_2026);
    expect(proposal.workValueOre).toBe(DAG_2026);
  });

  it("en förbrukad beredskapsdag erbjuds inte alls", async () => {
    const caller = makeCaller([
      beredskap("te-1", HELG),
      { id: "te-2", date: HELG, minutes: 90, kind: "ARBETE_OBEKVAM_TID", hourlyRate: 325_600 },
    ]);
    const proposal = await caller.billingRun.proposal({ matterId: "m-1" });
    expect(proposal.timeEntries.map((t) => t.id)).toEqual(["te-2"]);
  });
});

describe("advokatberedskap i täckningsärenden (rättshjälp)", () => {
  it("värderas på Domstolsverkets dagbelopp, inte på postens timtaxa", async () => {
    // Posten bär medvetet en felaktig timtaxa: årstabellen ska vinna.
    const caller = makeCaller(
      [{ ...beredskap("te-1", LUGN), hourlyRate: 1 }],
      "RATTSHJALP",
    );
    const proposal = await caller.billingRun.proposal({ matterId: "m-1" });
    expect(proposal.workValueOre).toBe(DAG_2026);
  });

  it("överlever rådgivningstimmens carve-out (noll minuter äts inte upp)", async () => {
    // Rättshjälpens första timme carvas bort ur kostnadsräkningen. En post utan
    // minuter kan inte vara en del av den — men `0 <= 60` svalde den förut.
    const caller = makeCaller([
      beredskap("te-1", LUGN),
      { id: "te-2", date: LUGN, minutes: 60, hourlyRate: 162_600 },
    ], "RATTSHJALP");
    const { run } = await caller.billingRun.createKostnadsrakning({ matterId: "m-1" });
    // Rådgivningstimmen (60 min) carvas → bara beredskapens dagbelopp kvar.
    expect(run.workValueOreAtRun).toBe(Math.round(DAG_2026 * 1.25));
  });
});

describe("tidsposten som bär beredskapen", () => {
  it("noll minuter accepteras för beredskap", async () => {
    const caller = makeCaller([]);
    const entry = await caller.timeEntry.create({
      matterId: "m-1", date: "2026-05-03", minutes: 0,
      description: "Advokatberedskap", kind: "ADVOKATBEREDSKAP",
    });
    expect(entry.minutes).toBe(0);
    // Á-priset sätts till dagbeloppet, inte användarens timtaxa.
    expect((entry as { hourlyRate: number }).hourlyRate).toBe(DAG_2026);
  });

  it("noll minuter avvisas för vanliga kategorier", async () => {
    const caller = makeCaller([]);
    await expect(caller.timeEntry.create({
      matterId: "m-1", date: "2026-05-03", minutes: 0, description: "Möte",
    })).rejects.toThrow(/minst en minut/i);
  });
});
