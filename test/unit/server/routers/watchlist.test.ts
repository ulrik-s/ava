/**
 * watchlistRouter mot riktig DemoDataStore (#1167): `matterId` begränsar listan
 * till ett ärendes poster — "Att bevaka" i ärendet är samma lista som den
 * globala, bara filtrerad.
 */

import { describe, expect, it } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { watchlistRouter } from "@/lib/server/routers/watchlist";
import { stockholmDay } from "@/lib/shared/watchlist";

const inDays = (n: number): Date => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

function caller(extraTasks: Array<Record<string, unknown>> = []) {
  const source: DemoSource = {
    matters: [
      { id: "m1", organizationId: "o1", matterNumber: "2026-0001", title: "A", responsibleLawyerId: "u1" },
      { id: "m2", organizationId: "o1", matterNumber: "2026-0002", title: "B", responsibleLawyerId: "u1" },
    ],
    tasks: [
      { id: "t1", organizationId: "o1", userId: "u1", title: "Frist i A", status: "TODO", dueAt: inDays(2), matterId: "m1", matter: { id: "m1", matterNumber: "2026-0001", title: "A" } },
      { id: "t2", organizationId: "o1", userId: "u1", title: "Frist i B", status: "TODO", dueAt: inDays(3), matterId: "m2", matter: { id: "m2", matterNumber: "2026-0002", title: "B" } },
      ...extraTasks,
    ],
    invoices: [],
    timeEntries: [],
    expenses: [],
  };
  const ds = new DemoDataStore(source, () => {});
  return watchlistRouter.createCaller({
    user: { id: "u1", email: "a@b.c", name: "A", role: "LAWYER", organizationId: "o1" },
    orgId: "o1",
    dataStore: ds,
    repos: buildInMemoryRepositories(ds),
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
    const { items } = await caller().list({ mine: false, matterId: "m1" as never });
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
});
