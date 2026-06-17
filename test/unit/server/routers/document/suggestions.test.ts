/**
 * Test för document suggestion-procedurer — accept/reject/group + dedup-grenar.
 * Kör mot en riktig in-memory-store (repos, ADR 0020); asserterar på
 * observerbart resultat (kontakt skapad, länk skapad, status uppdaterad).
 */

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
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [{ id: "doc-1", matterId: "m1", fileName: "f.pdf", title: "F" }],
    contacts: [],
    matterContacts: [],
    documentAnalysisSuggestions: [],
    ...seed,
  } as DemoSource);
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store as unknown as IDataStore);
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    dataStore: store, repos, orgId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), store };
}

function src(store: LocalStore): DemoSource {
  return (store as unknown as { source: DemoSource }).source;
}
const suggsOf = (store: LocalStore) => (src(store).documentAnalysisSuggestions ?? []) as Array<Record<string, unknown>>;
const contactsOf = (store: LocalStore) => (src(store).contacts ?? []) as Array<Record<string, unknown>>;
const linksOf = (store: LocalStore) => (src(store).matterContacts ?? []) as Array<Record<string, unknown>>;

const sugg = (o: Record<string, unknown> = {}) => ({
  id: "s1", documentId: "doc-1", name: "Anna Andersson", role: "MOTPART", contactType: "PERSON",
  email: null, phone: null, personalNumber: null, orgNumber: null, notes: null,
  status: "PENDING", acceptedContactId: null, createdAt: new Date("2026-06-01"), ...o,
});

describe("document.pendingSuggestions", () => {
  it("returnerar pending för ärendet (ej rejected/andra ärenden)", async () => {
    const { caller } = makeCaller({
      documents: [{ id: "doc-1", matterId: "m1", fileName: "f.pdf" }, { id: "doc-x", matterId: "m2", fileName: "x.pdf" }],
      documentAnalysisSuggestions: [
        sugg({ id: "s1" }),
        sugg({ id: "s-rej", status: "REJECTED" }),
        sugg({ id: "s-other", documentId: "doc-x" }),
      ],
    });
    const res = await caller.pendingSuggestions({ matterId: "m1" });
    expect(res.map((r) => r.id)).toEqual(["s1"]);
  });
});

describe("document.acceptSuggestion", () => {
  it("länkar befintlig kontakt (existingContactId) + sätter ACCEPTED", async () => {
    const { caller, store } = makeCaller({
      contacts: [{ id: "c1", organizationId: ORG, name: "Anna", contactType: "PERSON" }],
      documentAnalysisSuggestions: [sugg({})],
    });
    const res = await caller.acceptSuggestion({ suggestionId: "s1", existingContactId: "c1" });
    expect(res.contactId).toBe("c1");
    expect(linksOf(store).some((l) => l.contactId === "c1" && l.role === "MOTPART")).toBe(true);
    expect(suggsOf(store).find((s) => s.id === "s1")!.status).toBe("ACCEPTED");
  });

  it("skapar ny kontakt när ingen matchar", async () => {
    const { caller, store } = makeCaller({ documentAnalysisSuggestions: [sugg({})] });
    await caller.acceptSuggestion({ suggestionId: "s1" });
    expect(contactsOf(store)).toHaveLength(1);
    expect(linksOf(store)).toHaveLength(1);
  });

  it("dedupar mot befintlig kontakt på personnummer", async () => {
    const { caller, store } = makeCaller({
      contacts: [{ id: "c-pnr", organizationId: ORG, name: "Anna", contactType: "PERSON", personalNumber: "19850225-6655" }],
      documentAnalysisSuggestions: [sugg({ personalNumber: "19850225-6655" })],
    });
    const res = await caller.acceptSuggestion({ suggestionId: "s1" });
    expect(res.contactId).toBe("c-pnr");
    expect(contactsOf(store)).toHaveLength(1); // ingen ny
  });

  it("NOT_FOUND för okänt förslag", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [sugg({})] });
    await expect(caller.acceptSuggestion({ suggestionId: "saknas" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("BAD_REQUEST när förslaget redan hanterats", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [sugg({ status: "ACCEPTED" })] });
    await expect(caller.acceptSuggestion({ suggestionId: "s1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("vägrar acceptera förslag i annan org", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [sugg({})] }, "org-b");
    await expect(caller.acceptSuggestion({ suggestionId: "s1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("document.rejectSuggestion", () => {
  it("sätter REJECTED", async () => {
    const { caller, store } = makeCaller({ documentAnalysisSuggestions: [sugg({})] });
    await caller.rejectSuggestion({ suggestionId: "s1" });
    expect(suggsOf(store).find((s) => s.id === "s1")!.status).toBe("REJECTED");
  });

  it("NOT_FOUND i annan org", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [sugg({})] }, "org-b");
    await expect(caller.rejectSuggestion({ suggestionId: "s1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// Grupp-accept/reject + dedup-grenar täcks i document.groups.test.ts.
