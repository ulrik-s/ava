/**
 * Grupp-accept/reject för kontaktförslag + dedup-grenar (pnr/orgnr/namn-i-ärende).
 * Kör mot en riktig in-memory-store (repos, ADR 0020); asserterar på observerbart
 * resultat (skapad kontakt, länkar, notes-merge, status).
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
    documents: [{ id: "doc-1", matterId: "mat-1", fileName: "f.pdf" }],
    contacts: [],
    matterContacts: [],
    documentAnalysisSuggestions: [],
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

const src = (s: LocalStore) => (s as unknown as { source: DemoSource }).source;
const contactsOf = (s: LocalStore) => (src(s).contacts ?? []) as Array<Record<string, unknown>>;
const linksOf = (s: LocalStore) => (src(s).matterContacts ?? []) as Array<Record<string, unknown>>;
const suggsOf = (s: LocalStore) => (src(s).documentAnalysisSuggestions ?? []) as Array<Record<string, unknown>>;

const SUGG_ANNA_KLIENT = {
  id: "s1", documentId: "doc-1", name: "Anna Svensson", role: "KLIENT", contactType: "PERSON",
  email: null, phone: null, orgNumber: null, personalNumber: "19850315-1234", notes: "Klient i ärendet",
  status: "PENDING", acceptedContactId: null, createdAt: new Date("2026-06-01"),
};
const SUGG_ANNA_VITTNE = {
  ...SUGG_ANNA_KLIENT, id: "s2", role: "VITTNE", email: "anna@example.se", notes: "Vittne i förhandling",
  createdAt: new Date("2026-06-02"),
};

describe("document.acceptSuggestionGroup — skapa kontakt + flera roller", () => {
  it("skapar kontakt och länkar alla distinkta roller", async () => {
    const { caller, store } = makeCaller({ documentAnalysisSuggestions: [SUGG_ANNA_KLIENT, SUGG_ANNA_VITTNE] });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1", "s2"] });
    expect(result.acceptedRoles.sort()).toEqual(["KLIENT", "VITTNE"]);
    expect(contactsOf(store)).toHaveLength(1);
    const created = contactsOf(store)[0]!;
    expect(created.name).toBe("Anna Svensson");
    expect(created.personalNumber).toBe("19850315-1234");
    expect(created.email).toBe("anna@example.se"); // från s2 (s1 saknade)
    expect(linksOf(store)).toHaveLength(2);
    expect(suggsOf(store).every((s) => s.status === "ACCEPTED")).toBe(true);
  });

  it("återanvänder befintlig kontakt som matchar på personalNumber", async () => {
    const { caller, store } = makeCaller({
      contacts: [{ id: "contact-existing", organizationId: ORG, name: "Anna", contactType: "PERSON", personalNumber: "19850315-1234" }],
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-existing");
    expect(contactsOf(store)).toHaveLength(1); // ingen ny
  });

  it("hoppar över rolllänk som redan finns", async () => {
    const { caller, store } = makeCaller({
      contacts: [{ id: "contact-x", organizationId: ORG, name: "Anna", contactType: "PERSON", personalNumber: "19850315-1234" }],
      matterContacts: [{ id: "existing-link", matterId: "mat-1", contactId: "contact-x", role: "KLIENT" }],
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT],
    });
    await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(linksOf(store)).toHaveLength(1); // ingen ny länk
  });

  it("använder existingContactId om det anges", async () => {
    const { caller } = makeCaller({
      contacts: [{ id: "contact-chosen", organizationId: ORG, name: "Vald", contactType: "PERSON" }],
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"], existingContactId: "contact-chosen" });
    expect(result.contactId).toBe("contact-chosen");
  });

  it("slår samman notes per roll", async () => {
    const { caller, store } = makeCaller({
      documentAnalysisSuggestions: [
        { ...SUGG_ANNA_KLIENT, notes: "Klient enligt doc1" },
        { ...SUGG_ANNA_KLIENT, id: "s3", notes: "Bekräftad klient doc2" },
      ],
    });
    await caller.acceptSuggestionGroup({ suggestionIds: ["s1", "s3"] });
    const link = linksOf(store).find((l) => l.role === "KLIENT")!;
    expect(link.notes).toBe("Klient enligt doc1\nBekräftad klient doc2");
  });

  it("dedupar rolllänkar när samma roll förekommer flera gånger", async () => {
    const { caller, store } = makeCaller({
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT, { ...SUGG_ANNA_KLIENT, id: "s3" }],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1", "s3"] });
    expect(result.acceptedRoles).toEqual(["KLIENT"]);
    expect(linksOf(store)).toHaveLength(1);
  });
});

describe("document.acceptSuggestionGroup — dedup på namn inom ärende", () => {
  const SUGG_NO_IDS = { ...SUGG_ANNA_KLIENT, personalNumber: null, orgNumber: null };
  /** Seed: en befintlig matter-kontakt (namn-match-underlag). */
  function withMatterContact(name: string, contactType = "PERSON", role = "KLIENT") {
    return {
      contacts: [{ id: "contact-existing", organizationId: ORG, name, contactType }],
      matterContacts: [{ id: "ml1", matterId: "mat-1", contactId: "contact-existing", role }],
    };
  }

  it("återanvänder befintlig matter-kontakt med samma namn när personalNumber saknas", async () => {
    const { caller, store } = makeCaller({ ...withMatterContact("Anna Svensson"), documentAnalysisSuggestions: [SUGG_NO_IDS] });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-existing");
    expect(contactsOf(store)).toHaveLength(1);
  });

  it("är case-insensitiv och ignorerar blanksteg vid namn-match", async () => {
    const { caller, store } = makeCaller({
      ...withMatterContact("Anna Svensson"),
      documentAnalysisSuggestions: [{ ...SUGG_NO_IDS, name: "  ANNA svensson  " }],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-existing");
    expect(contactsOf(store)).toHaveLength(1);
  });

  it("matchar INTE om contactType skiljer (PERSON vs COMPANY)", async () => {
    const { caller, store } = makeCaller({
      ...withMatterContact("Anna Svensson", "COMPANY", "MOTPART"),
      documentAnalysisSuggestions: [SUGG_NO_IDS],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).not.toBe("contact-existing");
    expect(contactsOf(store)).toHaveLength(2); // ny skapad
  });

  it("skapar ny kontakt när namnet inte matchar någon befintlig matter-kontakt", async () => {
    const { caller, store } = makeCaller({
      ...withMatterContact("Bo Karlsson", "PERSON", "MOTPART"),
      documentAnalysisSuggestions: [SUGG_NO_IDS],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).not.toBe("contact-existing");
    expect(contactsOf(store)).toHaveLength(2);
  });

  it("personalNumber-match går före namn-fallback", async () => {
    const { caller } = makeCaller({
      contacts: [{ id: "contact-by-pnr", organizationId: ORG, name: "Annat namn", contactType: "PERSON", personalNumber: "19850315-1234" }],
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT],
    });
    const result = await caller.acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-by-pnr");
  });
});

describe("document.acceptSuggestionGroup — valideringar", () => {
  it("kastar NOT_FOUND när inga förslag hittas", async () => {
    const { caller } = makeCaller();
    await expect(caller.acceptSuggestionGroup({ suggestionIds: ["missing"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("kastar BAD_REQUEST om bara några förslag hittas", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [SUGG_ANNA_KLIENT] });
    await expect(caller.acceptSuggestionGroup({ suggestionIds: ["s1", "s99"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar BAD_REQUEST om förslagen tillhör olika ärenden", async () => {
    const { caller } = makeCaller({
      matters: [
        { id: "mat-1", organizationId: ORG, matterNumber: "2026-1", title: "T" },
        { id: "mat-2", organizationId: ORG, matterNumber: "2026-2", title: "U" },
      ],
      documents: [{ id: "doc-1", matterId: "mat-1", fileName: "f" }, { id: "doc-2", matterId: "mat-2", fileName: "g" }],
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT, { ...SUGG_ANNA_VITTNE, documentId: "doc-2" }],
    });
    await expect(caller.acceptSuggestionGroup({ suggestionIds: ["s1", "s2"] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("olika ärenden") });
  });

  it("filtrerar på anropande organisation (annan org → NOT_FOUND)", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [SUGG_ANNA_KLIENT] }, "org-b");
    await expect(caller.acceptSuggestionGroup({ suggestionIds: ["s1"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("document.rejectSuggestionGroup", () => {
  it("avvisar alla förslag i gruppen", async () => {
    const { caller, store } = makeCaller({
      documentAnalysisSuggestions: [SUGG_ANNA_KLIENT, SUGG_ANNA_VITTNE],
    });
    const result = await caller.rejectSuggestionGroup({ suggestionIds: ["s1", "s2"] });
    expect(result).toEqual({ rejected: 2 });
    expect(suggsOf(store).every((s) => s.status === "REJECTED")).toBe(true);
  });

  it("kastar NOT_FOUND när inga förslag hittas", async () => {
    const { caller } = makeCaller();
    await expect(caller.rejectSuggestionGroup({ suggestionIds: ["s1"] })).rejects.toBeInstanceOf(TRPCError);
  });

  it("kastar BAD_REQUEST om bara vissa id:n tillhör anropande org", async () => {
    const { caller } = makeCaller({ documentAnalysisSuggestions: [SUGG_ANNA_KLIENT] });
    await expect(caller.rejectSuggestionGroup({ suggestionIds: ["s1", "s2"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
