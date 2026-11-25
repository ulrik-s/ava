/**
 * `timeEntry.moveToMatter` (#2042) — en tidspost registrerad i fel ärende flyttas
 * till rätt ärende och får målärendets timpris, som om den registrerats där.
 * Låsta poster vägras och då ändras ingen post i anropet (allt eller inget).
 * Körs mot en riktig in-memory-store genom hela routern.
 */
import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { IEventLog } from "@/lib/server/data-store/IDataStore";
import type { EmitInput } from "@/lib/server/events/schema";
import { appRouter } from "@/lib/server/routers/_app";
import { advokatberedskapFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1"),
};
const FROM = asId<"MatterId">("m-1");
const TO = asId<"MatterId">("m-2");
const id = (s: string) => asId<"TimeEntryId">(s);
const DATE = new Date("2026-03-02T09:00:00Z");

function entry(entryId: string, extra: Record<string, unknown> = {}) {
  return {
    id: entryId, organizationId: "org-1", userId: "u-1", matterId: "m-1", date: DATE, minutes: 45,
    description: "Genomgång av handlingar", hourlyRate: 100_000, billable: true, kind: "ARBETE",
    standardAtgardId: "sa-1", ...extra,
  };
}

function matter(matterId: string, orgId: string, hourlyRates: Record<string, number> = {}) {
  return {
    id: matterId, organizationId: orgId, matterNumber: `2026-${matterId}`, title: matterId, status: "ACTIVE",
    paymentMethod: "LOPANDE", hourlyRates, createdAt: new Date(),
  };
}

interface Seed {
  targetRates?: Record<string, number>;
  entries?: ReturnType<typeof entry>[];
}

function setup(seed: Seed = {}) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "X", hourlyRates: { ARBETE: 150_000 } }, { id: "org-2", name: "Y" }],
    matters: [matter("m-1", "org-1"), matter("m-2", "org-1", seed.targetRates), matter("m-9", "org-2")],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN", hourlyRates: { ARBETE: 250_000 } }],
    timeEntries: seed.entries ?? [entry("t-1")],
    expenses: [],
  }, async () => { /* writable: noop write-back */ });
  const emitted: EmitInput[] = [];
  const eventLog: IEventLog = {
    emit: async (input) => { emitted.push(input); return ds.events.emit(input); },
    query: (filter) => ds.events.query(filter),
    iterate: (filter) => ds.events.iterate(filter),
    onNewEvent: (handler) => ds.events.onNewEvent(handler),
  };
  const ctx = buildContext({ dataStore: ds, eventLog, ports: noopPorts, principal: PRINCIPAL });
  return { emitted, caller: appRouter.createCaller(ctx) };
}

type Caller = ReturnType<typeof setup>["caller"];

async function entriesIn(caller: Caller, matterId: typeof FROM) {
  return (await caller.timeEntry.list({ matterId, pageSize: 100 })).entries;
}

function movedEvents(emitted: EmitInput[]) {
  return emitted.filter((e) => e.type === "time-entry.moved").map((e) => ({ matterId: e.matterId, payload: e.payload }));
}

describe("timeEntry.moveToMatter — flyttar (#2042)", () => {
  it("posten byter ärende och får målärendets eget timpris; övriga fält är orörda", async () => {
    const { caller } = setup({ targetRates: { ARBETE: 400_000 } });
    expect(await caller.timeEntry.moveToMatter({ ids: [id("t-1")], matterId: TO })).toEqual({ moved: 1 });
    expect(await entriesIn(caller, FROM)).toEqual([]);
    const [moved] = await entriesIn(caller, TO);
    expect(moved).toMatchObject({
      id: "t-1", matterId: "m-2", hourlyRate: 400_000, minutes: 45, description: "Genomgång av handlingar",
      billable: true, kind: "ARBETE", standardAtgardId: "sa-1", userId: "u-1",
    });
    expect(new Date(String(moved?.date)).getTime()).toBe(DATE.getTime());
  });

  it("saknar målärendet eget pris gäller juristens", async () => {
    const { caller } = setup();
    await caller.timeEntry.moveToMatter({ ids: [id("t-1")], matterId: TO });
    expect((await entriesIn(caller, TO))[0]?.hourlyRate).toBe(250_000);
  });

  it("beredskap får dagbeloppet för sitt datum", async () => {
    const { caller } = setup({ entries: [entry("t-1", { kind: "ADVOKATBEREDSKAP", minutes: 0, hourlyRate: 1 })] });
    await caller.timeEntry.moveToMatter({ ids: [id("t-1")], matterId: TO });
    expect((await entriesIn(caller, TO))[0]?.hourlyRate).toBe(advokatberedskapFtaxForDate(DATE));
  });

  it("en post som redan ligger i målärendet lämnas orörd och räknas inte", async () => {
    const { caller, emitted } = setup({ targetRates: { ARBETE: 400_000 }, entries: [entry("t-1"), entry("t-2", { matterId: "m-2" })] });
    expect(await caller.timeEntry.moveToMatter({ ids: [id("t-1"), id("t-2")], matterId: TO })).toEqual({ moved: 1 });
    const t2 = (await entriesIn(caller, TO)).find((e) => e.id === "t-2");
    expect(t2?.hourlyRate).toBe(100_000);
    expect(movedEvents(emitted)).toHaveLength(1);
  });

  it("en händelse time-entry.moved per flyttad post, på målärendet med ärendet posten kom från", async () => {
    const { caller, emitted } = setup({ entries: [entry("t-1"), entry("t-2")] });
    await caller.timeEntry.moveToMatter({ ids: [id("t-1"), id("t-2")], matterId: TO });
    const events = movedEvents(emitted);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual({ matterId: "m-2", payload: { entryId: "t-1", fromMatterId: "m-1" } });
    expect(events).toContainEqual({ matterId: "m-2", payload: { entryId: "t-2", fromMatterId: "m-1" } });
  });
});

describe("timeEntry.moveToMatter — vägrar (#2042)", () => {
  const LOCKS: Array<[string, Record<string, unknown>]> = [
    ["fakturerad (invoiceId)", { invoiceId: "inv-1" }],
    ["fryst (frozenAt)", { frozenAt: new Date("2026-04-01") }],
    ["fryst av en körning (frozenByBillingRunId)", { frozenByBillingRunId: "run-1" }],
  ];

  for (const [label, lock] of LOCKS) {
    it(`en låst post, ${label}, vägras och ingen post i anropet ändras`, async () => {
      const { caller, emitted } = setup({ entries: [entry("t-1"), entry("t-2", lock)] });
      await expect(caller.timeEntry.moveToMatter({ ids: [id("t-1"), id("t-2")], matterId: TO }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect((await entriesIn(caller, FROM)).map((e) => e.id).sort()).toEqual(["t-1", "t-2"]);
      expect(await entriesIn(caller, TO)).toEqual([]);
      expect(movedEvents(emitted)).toEqual([]);
    });
  }

  it("en post i en annan byrå ger NOT_FOUND, och ingen post ändras", async () => {
    const { caller } = setup({ entries: [entry("t-1"), entry("t-x", { organizationId: "org-2", matterId: "m-9" })] });
    await expect(caller.timeEntry.moveToMatter({ ids: [id("t-1"), id("t-x")], matterId: TO }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await entriesIn(caller, TO)).toEqual([]);
  });

  it("ett målärende i en annan byrå vägras", async () => {
    const { caller } = setup();
    await expect(caller.timeEntry.moveToMatter({ ids: [id("t-1")], matterId: asId<"MatterId">("m-9") })).rejects.toThrow();
    expect((await entriesIn(caller, FROM)).map((e) => e.id)).toEqual(["t-1"]);
  });

  it("samma post två gånger, eller inga poster, vägras", async () => {
    const { caller } = setup();
    await expect(caller.timeEntry.moveToMatter({ ids: [id("t-1"), id("t-1")], matterId: TO }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.timeEntry.moveToMatter({ ids: [], matterId: TO }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
