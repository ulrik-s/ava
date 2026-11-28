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
    documents?: Array<Record<string, unknown>>;
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
    documents: more.documents ?? [],
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

describe("watchlist.actionItems — Ska ärendet markeras som avslutat? (#2100)", () => {
  const matter = (id: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, organizationId: "o1", matterNumber: `2026-${id}`, title: `Ärende ${id}`, status: "ACTIVE",
    responsibleLawyerId: "u1", createdAt: inDays(-200), ...p,
  });
  const entry = (id: string, matterId: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, organizationId: "o1", matterId, userId: "u1", minutes: 30, hourlyRate: 100_000, billable: true,
    date: inDays(-100), createdAt: inDays(-100), ...p,
  });
  const close = (items: Array<{ kind: string; matterId: string | null }>): Array<string | null> =>
    items.filter((i) => i.kind === "closeSuggestion").map((i) => i.matterId).sort();
  const run = async (matters: Array<Record<string, unknown>>, timeEntries: Array<Record<string, unknown>>, mine = false) =>
    close((await caller([], [], [], { matters, timeEntries }).actionItems({ mine })).items);

  it("ett aktivt ärende med gammal tid ger en post med titeln och dagen", async () => {
    const { items } = await caller([], [], [], { matters: [matter("old")], timeEntries: [entry("e1", "old")] }).actionItems({ mine: false });
    const item = items.find((i) => i.kind === "closeSuggestion");
    expect(item?.matterId).toBe("old");
    expect(item?.closeSuggestion).toEqual({ matterTitle: "Ärende old", noTimeSince: stockholmDay(inDays(-100)), documents: [] });
  });

  it("stängda och arkiverade ärenden ger ingen post", async () => {
    const matters = [matter("closed", { status: "CLOSED" }), matter("archived", { status: "ARCHIVED" })];
    expect(await run(matters, [entry("e1", "closed"), entry("e2", "archived")])).toEqual([]);
  });

  it("en ny tidspost som inte är debiterbar tar bort posten", async () => {
    const fresh = entry("e2", "old", { billable: false, date: inDays(-3), createdAt: inDays(-3) });
    expect(await run([matter("old")], [entry("e1", "old"), fresh])).toEqual([]);
  });

  it("en sent registrerad tidspost räknas från registreringen", async () => {
    const late = entry("e2", "old", { date: inDays(-120), createdAt: inDays(-2) });
    expect(await run([matter("old")], [entry("e1", "old"), late])).toEqual([]);
  });

  it("ett nytt Behåll som aktivt tar bort posten", async () => {
    expect(await run([matter("old", { keptActiveAt: inDays(-1) })], [entry("e1", "old")])).toEqual([]);
  });

  it("mine begränsar som för de andra posterna", async () => {
    const matters = [matter("own"), matter("other", { responsibleLawyerId: "u2" })];
    expect(await run(matters, [], true)).toEqual(["own"]);
    expect(await run(matters, [], false)).toEqual(["other", "own"]);
  });

  it("tidsposterna läses i ETT anrop för flera ärenden, och inte alls utan aktiva ärenden", async () => {
    const ds = new DemoDataStore(prebakeJoins({
      matters: [matter("a"), matter("b"), matter("c", { status: "CLOSED" })],
      tasks: [], timeEntries: [], expenses: [], contacts: [], matterContacts: [],
    }), () => {});
    const repos = buildInMemoryRepositories(ds);
    const spy = vi.spyOn(repos.timeEntries, "latestEntryAtForMatters");
    await callerFor(ds, repos).actionItems({ mine: false });
    expect(spy).toHaveBeenCalledOnce();
    expect([...(spy.mock.calls[0]?.[0] ?? [])].sort()).toEqual(["a", "b"]);

    spy.mockClear();
    await callerFor(ds, repos).actionItems({ mine: true, userId: "u-utan-arenden" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("watchlist.actionItems — slutligt avgörande (#2101)", () => {
  const matter = (id: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, organizationId: "o1", matterNumber: `2026-${id}`, title: `Ärende ${id}`, status: "ACTIVE",
    responsibleLawyerId: "u1", createdAt: inDays(-5), ...p,
  });
  const doc = (id: string, matterId: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, matterId, fileName: `${id}.pdf`, storagePath: `documents/content/${id}.pdf`, mimeType: "application/pdf",
    sizeBytes: 1, uploadedById: "u1", createdAt: inDays(-1), finalRuling: "DOM_HD", ...p,
  });
  const closeItems = async (matters: Array<Record<string, unknown>>, documents: Array<Record<string, unknown>>) =>
    (await caller([], [], [], { matters, documents }).actionItems({ mine: false })).items
      .filter((i) => i.kind === "closeSuggestion");

  it("ett dokument i ett aktivt ärende ger en post, i ett stängt ingen", async () => {
    const items = await closeItems(
      [matter("open"), matter("closed", { status: "CLOSED" })],
      [doc("d1", "open"), doc("d2", "closed"), doc("d3", "open", { finalRuling: null })],
    );
    expect(items.map((i) => i.matterId)).toEqual(["open"]);
    expect(items[0]?.closeSuggestion).toEqual({
      matterTitle: "Ärende open", noTimeSince: null,
      documents: [{ id: "d1", fileName: "d1.pdf", storagePath: "documents/content/d1.pdf", ruling: "DOM_HD" }],
    });
    expect(items[0]?.detail).toBe("d1.pdf ser ut att vara en dom från Högsta domstolen.");
  });

  it("dokumenten läses i ETT anrop för flera ärenden, och inte alls utan aktiva ärenden", async () => {
    const ds = new DemoDataStore(prebakeJoins({
      matters: [matter("a"), matter("b"), matter("c", { status: "CLOSED" })],
      tasks: [], timeEntries: [], expenses: [], contacts: [], matterContacts: [], documents: [],
    }), () => {});
    const repos = buildInMemoryRepositories(ds);
    const spy = vi.spyOn(repos.documents, "listFinalRulingsForMatters");
    await callerFor(ds, repos).actionItems({ mine: false });
    expect(spy).toHaveBeenCalledOnce();
    expect([...(spy.mock.calls[0]?.[0] ?? [])].sort()).toEqual(["a", "b"]);

    spy.mockClear();
    await callerFor(ds, repos).actionItems({ mine: true, userId: "u-utan-arenden" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("watchlist.actionItems — avbetalningar som ligger efter (#2137)", () => {
  const matter = (id: string, p: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, organizationId: "o1", matterNumber: `2026-${id}`, title: id, status: "ACTIVE", responsibleLawyerId: "u1", ...p,
  });
  const invoice = (id: string, matterId: string): Record<string, unknown> => ({
    id, organizationId: "o1", matterId, amount: 1_000_000, invoiceType: "STANDARD", status: "INSTALLMENT_PLAN", invoiceDate: inDays(-200),
  });
  /** Startad för `startDaysAgo` dagar sedan, förfaller den 1:a varje månad. */
  const plan = (id: string, invoiceId: string, p: Record<string, unknown> = {}, startDaysAgo = 100): Record<string, unknown> => ({
    id, invoiceId, monthlyAmount: 100_000, dayOfMonth: 1, startDate: inDays(-startDaysAgo), status: "ACTIVE", createdAt: inDays(-startDaysAgo), ...p,
  });

  function setup(plans: Array<Record<string, unknown>>, payments: Array<Record<string, unknown>> = []) {
    const ds = new DemoDataStore(prebakeJoins({
      matters: [matter("own"), matter("own2"), matter("other", { responsibleLawyerId: "u2" }), matter("hits", { conflictCheckStatus: "HITS", conflictCheckHits: 1 })],
      invoices: [invoice("i-own", "own"), invoice("i-own2", "own2"), invoice("i-other", "other"), invoice("i-hits", "hits")],
      payments, paymentPlans: plans,
      tasks: [], timeEntries: [], expenses: [], contacts: [], matterContacts: [], documents: [],
    }), () => {});
    return { ds, repos: buildInMemoryRepositories(ds) };
  }
  const planRows = async (plans: Array<Record<string, unknown>>, mine: boolean, payments: Array<Record<string, unknown>> = []) => {
    const { ds, repos } = setup(plans, payments);
    return (await callerFor(ds, repos).actionItems({ mine })).items.filter((i) => i.kind === "paymentPlan");
  };

  it("en plan som ligger efter i ett eget ärende ger raden, med länk till planen", async () => {
    const items = await planRows([plan("pp-own", "i-own")], true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      severity: "passed", matterId: "own", matterNumber: "2026-own",
      link: { route: "payment-plans", id: "pp-own" },
    });
    expect(items[0]?.title).toMatch(/^Delbetalning förfallen \d+ dag(ar)?$/);
    expect(items[0]?.amountOre).toBeGreaterThan(0);
  });

  it("i en kollegas ärende bara med mine: false", async () => {
    const plans = [plan("pp-other", "i-other")];
    expect(await planRows(plans, true)).toEqual([]);
    expect((await planRows(plans, false)).map((i) => i.matterId)).toEqual(["other"]);
  });

  it("slutförd, avbruten och ikapp ger ingen rad", async () => {
    const plans = [
      plan("pp-done", "i-own", { status: "COMPLETED" }),
      plan("pp-stop", "i-own2", { status: "CANCELLED" }),
      plan("pp-paid", "i-other"),
    ];
    const paid = [{ id: "pay", invoiceId: "i-other", amount: 1_000_000, paidAt: inDays(-1) }];
    expect(await planRows(plans, false, paid)).toEqual([]);
  });

  it("planerna läses i ETT anrop, bara de aktiva", async () => {
    const { ds, repos } = setup([plan("pp-own", "i-own"), plan("pp-own2", "i-own2")]);
    const spy = vi.spyOn(repos.paymentPlans, "listForOrg");
    await callerFor(ds, repos).actionItems({ mine: false });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[1]).toBe("ACTIVE");
  });

  it("raden sorteras bland de passerade posterna efter datum, äldst först", async () => {
    const { ds, repos } = setup([plan("pp-new", "i-own", {}, 40), plan("pp-old", "i-own2", {}, 100)]);
    const { items } = await callerFor(ds, repos).actionItems({ mine: true });
    expect(items.map((i) => `${i.kind}:${i.matterId ?? ""}`)).toEqual([
      "paymentPlan:own2", "paymentPlan:own", "conflictCheck:hits",
    ]);
  });
});
