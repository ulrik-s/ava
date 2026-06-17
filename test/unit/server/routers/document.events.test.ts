/**
 * Test för document events (MatterEventSuggestion) — events/rejectEvent/
 * markEventAdded. Kör mot en riktig in-memory-store (repos, ADR 0020).
 */

import { TRPCError } from "@trpc/server";
import { describe, it, expect, vi } from "vitest-compat";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

vi.mock("@/lib/server/services/meilisearch", () => ({ searchDocuments: vi.fn(), removeDocument: vi.fn() }));
vi.mock("@/lib/server/services/document-analysis", () => ({ analyzeDocument: vi.fn() }));

const ORG = "org-a";

function makeCaller(seed: Partial<DemoSource> = {}, orgId = ORG) {
  const source = prebakeJoins({
    matters: [{ id: "mat-1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [{ id: "doc-1", matterId: "mat-1", fileName: "stamning.pdf", title: "Stämningsansökan" }],
    matterEventSuggestions: [],
    ...seed,
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store as unknown as IDataStore);
  const ctx = {
    user: { id: "user-1", email: "a@b.com", name: "Test", role: "ADMIN", organizationId: orgId },
    dataStore: store, repos, orgId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), store };
}

function events(store: LocalStore): Array<{ id: string; status: string }> {
  return (store as unknown as { source: DemoSource }).source.matterEventSuggestions as never;
}

const ev = (over: Record<string, unknown>) => ({
  id: "ev-1", documentId: "doc-1", title: "Huvudförhandling", description: null,
  eventType: "Förhandling", startAt: new Date("2026-05-14T09:00:00Z"), endAt: null,
  allDay: false, location: "Stockholms tingsrätt", status: "PENDING", ...over,
});

describe("document.events — lista tidpunkter för ärende", () => {
  it("returnerar ej avvisade events sorterade på startAt, med dokumentmetadata", async () => {
    const { caller } = makeCaller({
      matterEventSuggestions: [
        ev({ id: "ev-late", startAt: new Date("2026-06-01T09:00:00Z") }),
        ev({ id: "ev-1", startAt: new Date("2026-05-14T09:00:00Z") }),
        ev({ id: "ev-rejected", status: "REJECTED", startAt: new Date("2026-04-01T09:00:00Z") }),
      ],
    });
    const result = await caller.events({ matterId: "mat-1" });
    expect(result.map((r) => r.id)).toEqual(["ev-1", "ev-late"]); // sorterat, REJECTED bort
    // In-memory-motorn projicerar inte `select` strikt (Drizzle gör); asserta delmängd.
    expect(result[0]!.document).toMatchObject({ id: "doc-1", fileName: "stamning.pdf", title: "Stämningsansökan" });
  });

  it("filtrerar på anropande användares organisation", async () => {
    const { caller } = makeCaller({ matterEventSuggestions: [ev({})] }, "org-b");
    expect(await caller.events({ matterId: "mat-1" })).toHaveLength(0);
  });
});

describe("document.rejectEvent", () => {
  it("markerar event som REJECTED", async () => {
    const { caller, store } = makeCaller({ matterEventSuggestions: [ev({})] });
    const result = await caller.rejectEvent({ eventId: "ev-1" });
    expect(result.status).toBe("REJECTED");
    expect(events(store).find((e) => e.id === "ev-1")!.status).toBe("REJECTED");
  });

  it("kastar NOT_FOUND om event inte finns eller tillhör annan org", async () => {
    const { caller, store } = makeCaller({ matterEventSuggestions: [ev({})] }, "org-b");
    await expect(caller.rejectEvent({ eventId: "ev-1" })).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.rejectEvent({ eventId: "ev-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(events(store).find((e) => e.id === "ev-1")!.status).toBe("PENDING");
  });
});

describe("document.markEventAdded", () => {
  it("markerar event som ACCEPTED (tillagd i kalender)", async () => {
    const { caller, store } = makeCaller({ matterEventSuggestions: [ev({})] });
    const result = await caller.markEventAdded({ eventId: "ev-1" });
    expect(result.status).toBe("ACCEPTED");
    expect(events(store).find((e) => e.id === "ev-1")!.status).toBe("ACCEPTED");
  });

  it("org-isolation: event i annan org kan inte markeras", async () => {
    const { caller, store } = makeCaller({ matterEventSuggestions: [ev({})] }, "org-b");
    await expect(caller.markEventAdded({ eventId: "ev-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(events(store).find((e) => e.id === "ev-1")!.status).toBe("PENDING");
  });
});
