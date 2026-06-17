/**
 * Test för conflictRouter — jävskontroll mot personnummer + namn (bigram).
 * Kör mot en riktig in-memory-store (repos, ADR 0020).
 */

import { describe, it, expect } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { conflictRouter } from "@/lib/server/routers/conflict";
import { prebakeJoins } from "@/lib/shared/demo-source";

const ORG = "org-a";

function makeCaller(seed: Partial<DemoSource> = {}, orgId = ORG, userId = "u1") {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-0001", title: "X" }],
    contacts: [],
    matterContacts: [],
    conflictChecks: [],
    ...seed,
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store as unknown as IDataStore);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore: store, repos,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: conflictRouter.createCaller(ctx as any), store };
}

function checks(store: LocalStore): Array<Record<string, unknown>> {
  return (store as unknown as { source: DemoSource }).source.conflictChecks as never;
}

/** Seed: en MOTPART + en KLIENT i samma ärende. */
function seedWithParty(party: Record<string, unknown>): Partial<DemoSource> {
  return {
    contacts: [
      { id: "c1", organizationId: ORG, name: "Anna", contactType: "PERSON", ...party },
      { id: "klient", organizationId: ORG, name: "Klient Klientsson", contactType: "PERSON" },
    ],
    matterContacts: [
      { id: "mc1", matterId: "m1", contactId: "c1", role: "MOTPART" },
      { id: "mc2", matterId: "m1", contactId: "klient", role: "KLIENT" },
    ],
  };
}

describe("conflict.check", () => {
  it("hittar kontakter via personnummer-substring", async () => {
    const { caller } = makeCaller(seedWithParty({ name: "Anna", personalNumber: "19850225-6655" }));
    const res = await caller.check({ searchTerm: "19850225", searchType: "personalNumber" });
    expect(res.matchCount).toBe(1);
    expect(res.results[0]!.contactName).toBe("Anna");
    expect(res.results[0]!.klient).toBe("Klient Klientsson");
  });

  it("hittar kontakter via fuzzy namn-sökning (bigram-Jaccard)", async () => {
    const { caller } = makeCaller(seedWithParty({ name: "Anna Andersson" }));
    const res = await caller.check({ searchTerm: "Anna Andersson", searchType: "name" });
    expect(res.matchCount).toBe(1);
    expect(res.results[0]!.contactName).toBe("Anna Andersson");
    expect(res.results[0]!.klient).toBe("Klient Klientsson");
  });

  it("filtrerar bort matchningar under similarity-tröskeln", async () => {
    const { caller } = makeCaller(seedWithParty({ name: "Anna Andersson" }));
    const res = await caller.check({ searchTerm: "Helt Annorlunda", searchType: "name" });
    expect(res.matchCount).toBe(0);
  });

  it("kombinerar både searchTypes utan dubblettrader", async () => {
    const { caller } = makeCaller(seedWithParty({ name: "Anna Andersson", personalNumber: "12345" }));
    const res = await caller.check({ searchTerm: "Anna Andersson", searchType: "both" });
    expect(res.matchCount).toBe(1);
  });

  it("loggar varje sökning till conflictCheck", async () => {
    const { caller, store } = makeCaller({}, ORG, "u1");
    await caller.check({ searchTerm: "test" });
    expect(checks(store)).toHaveLength(1);
    expect(checks(store)[0]).toMatchObject({ searchTerm: "test", checkedById: "u1" });
  });

  it("kräver searchTerm min(1)", async () => {
    const { caller } = makeCaller();
    await expect(caller.check({ searchTerm: "" })).rejects.toThrow();
  });

  it("scopar via matter.organizationId (ingen läcka mellan org)", async () => {
    const { caller } = makeCaller(seedWithParty({ name: "Anna", personalNumber: "19850225-6655" }), "annan-org");
    const res = await caller.check({ searchTerm: "19850225", searchType: "personalNumber" });
    expect(res.matchCount).toBe(0);
  });
});

describe("conflict.history", () => {
  it("returnerar paginerad historik", async () => {
    const { caller } = makeCaller({
      conflictChecks: [
        { id: "ck1", searchTerm: "a", searchType: "both", results: [], checkedById: "u1", createdAt: new Date() },
      ],
    });
    const res = await caller.history({ page: 1, pageSize: 20 });
    expect(res.checks).toHaveLength(1);
    expect(res.pages).toBe(1);
  });
});
