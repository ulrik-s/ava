/**
 * watchlistRouter mot riktig DemoDataStore (#1167): `matterId` begränsar listan
 * till ett ärendes poster — Frister i ärendet är samma lista som sidan
 * Frister, bara filtrerad. Listan har bara tidsfrister och Bör faktureras (#1735).
 */

import { describe, expect, it, vi } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { watchlistRouter } from "@/lib/server/routers/watchlist";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { stockholmDay } from "@/lib/shared/stockholm-time";

const inDays = (n: number): Date => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

function caller(
  extraTasks: Array<Record<string, unknown>> = [],
  invoices: Array<Record<string, unknown>> = [],
  payments: Array<Record<string, unknown>> = [],
  more: {
    matters?: Array<Record<string, unknown>>; timeEntries?: Array<Record<string, unknown>>;
    contacts?: Array<Record<string, unknown>>; matterContacts?: Array<Record<string, unknown>>;
    organizations?: Array<Record<string, unknown>>;
  } = {},
) {
  const source: DemoSource = {
    matters: [
      { id: "m1", organizationId: "o1", matterNumber: "2026-0001", title: "A", responsibleLawyerId: "u1" },
      { id: "m2", organizationId: "o1", matterNumber: "2026-0002", title: "B", responsibleLawyerId: "u1" },
      ...(more.matters ?? []),
    ],
    tasks: [
      { id: "t1", organizationId: "o1", userId: "u1", title: "Frist i A", status: "TODO", dueAt: inDays(2), matterId: "m1", matter: { id: "m1", matterNumber: "2026-0001", title: "A" } },
      { id: "t2", organizationId: "o1", userId: "u1", title: "Frist i B", status: "TODO", dueAt: inDays(3), matterId: "m2", matter: { id: "m2", matterNumber: "2026-0002", title: "B" } },
      ...extraTasks,
    ],
    invoices,
    payments,
    timeEntries: more.timeEntries ?? [],
    expenses: [],
    contacts: more.contacts ?? [],
    matterContacts: more.matterContacts ?? [],
    ...(more.organizations ? { organizations: more.organizations } : {}),
  };
  const ds = new DemoDataStore(prebakeJoins(source), () => {});
  return callerFor(ds);
}

/** Routern mot ett givet lager — testerna nedan spionerar på dess repo. */
function callerFor(ds: DemoDataStore, repos = buildInMemoryRepositories(ds)) {
  return watchlistRouter.createCaller({
    user: { id: "u1", email: "a@b.c", name: "A", role: "LAWYER", organizationId: "o1" },
    orgId: "o1",
    dataStore: ds,
    repos,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe("watchlist.list", () => {
  it("utan matterId: alla ärendens tidsfrister, med uppgiftens id", async () => {
    const { items } = await caller().list({ mine: false });
    const deadlines = items.filter((i) => i.kind === "deadline");
    expect(deadlines.map((i) => i.matterNumber).sort()).toEqual(["2026-0001", "2026-0002"]);
    expect(deadlines.find((i) => i.matterNumber === "2026-0001")?.taskId).toBe("t1");
  });

  it("med matterId: bara det ärendets poster (#1167)", async () => {
    const { items } = await caller().list({ mine: false, matterId: "m1" });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.matterId === "m1")).toBe(true);
    expect(items.some((i) => i.title.includes("Frist i A"))).toBe(true);
  });

  it("ISO-tidpunkt på svensk midnatt (demodatalagret) → rätt svensk dag, inte UTC-dagen innan (#1167)", async () => {
    const today = stockholmDay(new Date());
    // 01:30 (+02:00) = 01:30 sommartid / 00:30 vintertid → svensk "idag",
    // men 23:30 UTC dagen innan — just det fall som räknades fel.
    const swedishMidnight = new Date(`${today}T01:30:00+02:00`);
    const { items } = await caller([
      { id: "t3", organizationId: "o1", userId: "u1", title: "Midnatt", status: "TODO", dueAt: swedishMidnight.toISOString(), matterId: null },
    ]).list({ mine: false });
    const item = items.find((i) => i.title.includes("Midnatt"));
    expect(item?.at).toBe(today);
    expect(item?.severity).toBe("approaching"); // inte "passerad" ett dygn för tidigt
  });

  it("bara tidsfrister och Bör faktureras — inga takvarningar, fakturor, utskick, faktureringssteg eller jävsträffar (#1735)", async () => {
    const matter = (id: string, p: Record<string, unknown>): Record<string, unknown> => ({
      id, organizationId: "o1", matterNumber: `2026-${id}`, title: id, status: "ACTIVE", responsibleLawyerId: "u1", ...p,
    });
    const { items } = await caller([], [
      // Förfallen och dessutom skapad men oskickad: varken förfallen faktura eller "Skicka faktura".
      { id: "F-sen", matterId: "m1", invoiceNumber: "F-sen", amount: 10_000, status: "SENT", invoiceType: "STANDARD", invoiceDate: inDays(-40), dueDate: inDays(-12), createdAt: inDays(-40) },
      { id: "F-ny", matterId: "m1", invoiceNumber: "F-ny", amount: 10_000, status: "DRAFT", invoiceType: "STANDARD", invoiceDate: inDays(-20), dueDate: inDays(10), createdAt: inDays(-20) },
    ], [], {
      matters: [
        matter("cap", { paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: 1 }),
        matter("hits", { conflictCheckStatus: "HITS", conflictCheckHits: 2 }),
        matter("pending", { conflictCheckStatus: "PENDING" }),
      ],
      timeEntries: [
        // 1 h på ett 1-timmestak (takvarning) och 300 000 kr ofakturerat (Bör faktureras).
        { id: "te1", organizationId: "o1", matterId: "cap", userId: "u1", minutes: 60, hourlyRate: 30_000_000, billable: true, date: inDays(-1) },
      ],
    }).list({ mine: false });
    expect([...new Set(items.map((i) => i.kind))].sort()).toEqual(["deadline", "unbilled"]);
    expect(items.find((i) => i.kind === "unbilled")).toMatchObject({ title: "Bör faktureras", matterNumber: "2026-cap" });
  });
});

describe("watchlist.actionItems (#1734)", () => {
  const matter = (id: string, p: Record<string, unknown>): Record<string, unknown> => ({
    id, organizationId: "o1", matterNumber: `2026-${id}`, title: id, status: "ACTIVE", responsibleLawyerId: "u1", ...p,
  });
  const more = {
    matters: [
      // Rättshjälp med 1 timmes tak och 1 timme upparbetat → takvarning.
      matter("cap", { paymentMethod: "RATTSHJALP", rattshjalpMaxTimmar: 1 }),
      matter("hits", { conflictCheckStatus: "HITS", conflictCheckHits: 2 }),
      matter("pending", { conflictCheckStatus: "PENDING" }),
      matter("reviewed", { conflictCheckStatus: "REVIEWED", conflictCheckHits: 2 }),
      matter("other", { conflictCheckStatus: "HITS", conflictCheckHits: 1, responsibleLawyerId: "u2" }),
    ],
    timeEntries: [
      { id: "te1", organizationId: "o1", matterId: "cap", userId: "u1", minutes: 60, hourlyRate: 100_000, billable: true, date: inDays(-1) },
    ],
  };
  const titles = (items: Array<{ matterNumber: string | null; kind: string }>): string[] =>
    items.map((i) => `${i.kind}:${i.matterNumber ?? ""}`).sort();

  it("bara takvarningar och jävsträffar, inte frister, väntande eller bedömda kontroller", async () => {
    const { items } = await caller([], [], [], more).actionItems({ mine: true });
    expect(titles(items)).toEqual(["conflictCheck:2026-hits", "coverageCap:2026-cap"]);
  });

  it("mine: false tar med kollegornas ärenden", async () => {
    const { items } = await caller([], [], [], more).actionItems({ mine: false });
    expect(titles(items)).toEqual(["conflictCheck:2026-hits", "conflictCheck:2026-other", "coverageCap:2026-cap"]);
  });

  it("utan indata: egna ärenden", async () => {
    const { items, generatedAt } = await caller([], [], [], more).actionItems();
    expect(titles(items)).toEqual(["conflictCheck:2026-hits", "coverageCap:2026-cap"]);
    expect(typeof generatedAt).toBe("string");
  });
});

/**
 * Byråns trösklar för "Bör faktureras" (#1911): beloppet och åldern läses ur
 * byråns inställningar; utan byrårad eller sparade värden gäller standarden
 * (25 000 kr, 60 dagar).
 */
describe("watchlist.list — byråns trösklar (#1911)", () => {
  /** Ärendet "u" med `kr` kronor ofakturerat, äldsta posten `daysAgo` dagar gammal. */
  const unbilled = (kr: number, daysAgo: number, org?: Record<string, unknown>) =>
    caller([], [], [], {
      matters: [{ id: "u", organizationId: "o1", matterNumber: "2026-u", title: "U", responsibleLawyerId: "u1" }],
      timeEntries: [{ id: "teu", organizationId: "o1", matterId: "u", userId: "u1", minutes: 60, hourlyRate: kr * 100, billable: true, date: inDays(-daysAgo) }],
      ...(org ? { organizations: [{ id: "o1", name: "Byrå", ...org }] } : {}),
    }).list({ mine: false }).then(({ items }) => items.some((i) => i.kind === "unbilled" && i.matterId === "u"));

  it("utan byrårad eller sparade värden: som i dag", async () => {
    expect(await unbilled(10_000, 1)).toBe(false);
    expect(await unbilled(30_000, 1)).toBe(true);
    expect(await unbilled(10_000, 1, {})).toBe(false);
    expect(await unbilled(30_000, 1, { unbilledThresholdOre: null, unbilledAgeDays: null })).toBe(true);
  });

  it("en lägre beloppströskel tar med ett ärende under standardbeloppet", async () => {
    expect(await unbilled(10_000, 1, { unbilledThresholdOre: 500_000 })).toBe(true);
  });

  it("en högre beloppströskel tar inte med ett ärende över standardbeloppet", async () => {
    expect(await unbilled(30_000, 1, { unbilledThresholdOre: 5_000_000 })).toBe(false);
  });

  it("åldern: en kortare ålder tar med ett litet ärende, en längre utesluter ett gammalt", async () => {
    expect(await unbilled(100, 20, { unbilledAgeDays: 10 })).toBe(true);
    expect(await unbilled(100, 20)).toBe(false);
    expect(await unbilled(100, 70)).toBe(true);
    expect(await unbilled(100, 70, { unbilledAgeDays: 90 })).toBe(false);
  });
});

describe("watchlist.list — klientens namn (#1965)", () => {
  const parties = {
    contacts: [
      { id: "c-mot", organizationId: "o1", name: "Motpart AB", contactType: "COMPANY" },
      { id: "c-kl", organizationId: "o1", name: "Klient A", contactType: "PERSON" },
    ],
    // Motparten står före klienten i indata — valet är rollen, inte ordningen.
    matterContacts: [
      { id: "mc1", matterId: "m1", contactId: "c-mot", role: "MOTPART" },
      { id: "mc2", matterId: "m1", contactId: "c-kl", role: "KLIENT" },
    ],
  };
  const oldTime = { id: "te-old", organizationId: "o1", userId: "u1", matterId: "m1", date: inDays(-90), minutes: 600, hourlyRate: 250_000, billable: true };

  it("tidsfristen och Bör faktureras i ett ärende med klient bär klientens namn", async () => {
    const { items } = await caller([], [], [], { ...parties, timeEntries: [oldTime] }).list({ mine: false });
    const inA = items.filter((i) => i.matterId === "m1");
    expect(inA.map((i) => i.kind).sort()).toEqual(["deadline", "unbilled"]);
    expect(inA.every((i) => i.klientName === "Klient A")).toBe(true);
  });

  it("ett ärende utan klient ger inget klientName, och en frist utan ärende inget", async () => {
    const { items } = await caller([
      { id: "t9", organizationId: "o1", userId: "u1", title: "Utan ärende", status: "TODO", dueAt: inDays(1), matterId: null },
    ], [], [], parties).list({ mine: false });
    expect(items.find((i) => i.matterId === "m2")).not.toHaveProperty("klientName");
    expect(items.find((i) => i.title.includes("Utan ärende"))).not.toHaveProperty("klientName");
  });

  it("parterna läses i ETT anrop för flera ärenden, och inte alls utan ärenden", async () => {
    const ds = new DemoDataStore(prebakeJoins({
      matters: [
        { id: "m1", organizationId: "o1", matterNumber: "2026-0001", title: "A", responsibleLawyerId: "u1" },
        { id: "m2", organizationId: "o1", matterNumber: "2026-0002", title: "B", responsibleLawyerId: "u1" },
      ],
      tasks: [
        { id: "t1", organizationId: "o1", userId: "u1", title: "Frist i A", status: "TODO", dueAt: inDays(2), matterId: "m1", matter: { id: "m1", matterNumber: "2026-0001", title: "A" } },
        { id: "t2", organizationId: "o1", userId: "u1", title: "Frist i B", status: "TODO", dueAt: inDays(3), matterId: "m2", matter: { id: "m2", matterNumber: "2026-0002", title: "B" } },
      ],
      timeEntries: [], expenses: [], ...parties,
    }), () => {});
    const repos = buildInMemoryRepositories(ds);
    const spy = vi.spyOn(repos.matters, "listPartiesFor");
    await callerFor(ds, repos).list({ mine: false });
    expect(spy).toHaveBeenCalledOnce();
    expect([...(spy.mock.calls[0]?.[1] ?? [])].sort()).toEqual(["m1", "m2"]);

    spy.mockClear();
    await callerFor(ds, repos).list({ mine: false, matterId: "m-finns-ej" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("actionItems sätter inget klientName", async () => {
    const { items } = await caller([], [], [], {
      ...parties,
      matters: [{ id: "m3", organizationId: "o1", matterNumber: "2026-0003", title: "C", responsibleLawyerId: "u1", conflictCheckStatus: "HITS", conflictCheckHits: 1 }],
      matterContacts: [{ id: "mc3", matterId: "m3", contactId: "c-kl", role: "KLIENT" }],
    }).actionItems({ mine: false });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !("klientName" in i))).toBe(true);
  });
});
