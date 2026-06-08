import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { TRPCError } from "@trpc/server";
import { documentRouter } from "@/lib/server/routers/document";
import { dataStoreFromMockPrisma } from "../helpers/mock-data-store";

// ─── Helpers ─────────────────────────────────────────────────────

const mockPrisma = {
  documentAnalysisSuggestion: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  contact: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  matterContact: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
};

function makeCaller(orgId = "org-a") {
  const ctx = {
    user: { id: "user-1", email: "a@b.com", name: "Test", role: "ADMIN", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return documentRouter.createCaller(ctx as any);
}

const SUGG_ANNA_KLIENT = {
  id: "s1",
  name: "Anna Svensson",
  role: "KLIENT",
  contactType: "PERSON",
  email: null,
  phone: null,
  orgNumber: null,
  personalNumber: "19850315-1234",
  notes: "Klient i ärendet",
  status: "PENDING",
  document: { matterId: "mat-1" },
};
const SUGG_ANNA_VITTNE = {
  ...SUGG_ANNA_KLIENT,
  id: "s2",
  role: "VITTNE",
  email: "anna@example.se",
  notes: "Vittne i förhandling",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: inga befintliga matter-kontakter (namn-fallback hittar inget)
  mockPrisma.matterContact.findMany.mockResolvedValue([]);
});

// ─── acceptSuggestionGroup — happy path ──────────────────────────

describe("document.acceptSuggestionGroup — skapa kontakt + flera roller", () => {
  it("skapar kontakt och länkar alla distinkta roller till ärendet", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      SUGG_ANNA_KLIENT,
      SUGG_ANNA_VITTNE,
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue(null); // ingen befintlig kontakt
    mockPrisma.contact.create.mockResolvedValue({ id: "contact-new" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 2 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({
      suggestionIds: ["s1", "s2"],
    });

    expect(result).toEqual({ contactId: "contact-new", acceptedRoles: ["KLIENT", "VITTNE"] });

    // Kontakt skapad med förnyad info (email från s2 eftersom s1 saknade)
    expect(mockPrisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Anna Svensson",
          personalNumber: "19850315-1234",
          email: "anna@example.se",
          organizationId: "org-a",
        }),
      })
    );

    // Två matterContact-länkar skapade (KLIENT + VITTNE)
    expect(mockPrisma.matterContact.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.matterContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matterId: "mat-1", contactId: "contact-new", role: "KLIENT" }),
      })
    );
    expect(mockPrisma.matterContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matterId: "mat-1", contactId: "contact-new", role: "VITTNE" }),
      })
    );

    // Alla förslag markerade som ACCEPTED
    expect(mockPrisma.documentAnalysisSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1", "s2"] } },
      data: { status: "ACCEPTED", acceptedContactId: "contact-new" },
    });
  });

  it("återanvänder befintlig kontakt som matchar på personalNumber", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_ANNA_KLIENT]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "contact-existing" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });

    expect(result.contactId).toBe("contact-existing");
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
      where: { personalNumber: "19850315-1234", organizationId: "org-a" },
    });
  });

  it("hoppar över rolllänk som redan finns", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_ANNA_KLIENT]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "contact-x" });
    mockPrisma.matterContact.findFirst.mockResolvedValue({ id: "existing-link" }); // redan länkad
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });

    expect(mockPrisma.matterContact.create).not.toHaveBeenCalled();
  });

  it("använder existingContactId om det anges", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_ANNA_KLIENT]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "contact-chosen" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({
      suggestionIds: ["s1"],
      existingContactId: "contact-chosen",
    });

    expect(result.contactId).toBe("contact-chosen");
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "contact-chosen", organizationId: "org-a" },
    });
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it("slår samman notes per roll", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      { ...SUGG_ANNA_KLIENT, notes: "Klient enligt doc1" },
      { ...SUGG_ANNA_KLIENT, id: "s3", notes: "Bekräftad klient doc2" },
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.contact.create.mockResolvedValue({ id: "contact-1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 2 });

    await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1", "s3"] });

    expect(mockPrisma.matterContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "KLIENT",
          notes: "Klient enligt doc1\nBekräftad klient doc2",
        }),
      })
    );
  });

  it("dedupar rolllänkar när samma roll förekommer flera gånger", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      SUGG_ANNA_KLIENT,
      { ...SUGG_ANNA_KLIENT, id: "s3" }, // samma roll igen
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.contact.create.mockResolvedValue({ id: "contact-1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 2 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({
      suggestionIds: ["s1", "s3"],
    });

    // Bara EN distinkt roll
    expect(result.acceptedRoles).toEqual(["KLIENT"]);
    expect(mockPrisma.matterContact.create).toHaveBeenCalledTimes(1);
  });
});

// ─── acceptSuggestionGroup — namn-baserad dedup ──────────────────

describe("document.acceptSuggestionGroup — dedup på namn inom ärende", () => {
  const SUGG_NO_IDS = {
    ...SUGG_ANNA_KLIENT,
    personalNumber: null,
    orgNumber: null,
  };

  it("återanvänder befintlig matter-kontakt med samma namn när personalNumber saknas", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_NO_IDS]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.findMany.mockResolvedValue([
      {
        matterId: "mat-1",
        contactId: "contact-existing",
        role: "KLIENT",
        contact: {
          id: "contact-existing",
          name: "Anna Svensson",
          contactType: "PERSON",
          organizationId: "org-a",
        },
      },
    ]);
    mockPrisma.matterContact.findFirst.mockResolvedValue({ id: "existing-link" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });

    expect(result.contactId).toBe("contact-existing");
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it("är case-insensitiv och ignorerar blanksteg vid namn-match", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      { ...SUGG_NO_IDS, name: "  ANNA svensson  " },
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.findMany.mockResolvedValue([
      {
        matterId: "mat-1",
        contactId: "contact-existing",
        role: "KLIENT",
        contact: {
          id: "contact-existing",
          name: "Anna Svensson",
          contactType: "PERSON",
          organizationId: "org-a",
        },
      },
    ]);
    mockPrisma.matterContact.findFirst.mockResolvedValue({ id: "existing-link" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-existing");
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it("matchar INTE om contactType skiljer (PERSON vs COMPANY)", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_NO_IDS]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.findMany.mockResolvedValue([
      {
        matterId: "mat-1",
        contactId: "contact-company",
        role: "MOTPART",
        contact: {
          id: "contact-company",
          name: "Anna Svensson",
          contactType: "COMPANY",
          organizationId: "org-a",
        },
      },
    ]);
    mockPrisma.contact.create.mockResolvedValue({ id: "contact-new" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-new");
    expect(mockPrisma.contact.create).toHaveBeenCalled();
  });

  it("skapar ny kontakt när namnet inte matchar någon befintlig matter-kontakt", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_NO_IDS]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.findMany.mockResolvedValue([
      {
        matterId: "mat-1",
        contactId: "contact-other",
        role: "MOTPART",
        contact: {
          id: "contact-other",
          name: "Bo Karlsson",
          contactType: "PERSON",
          organizationId: "org-a",
        },
      },
    ]);
    mockPrisma.contact.create.mockResolvedValue({ id: "contact-new" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-new");
    expect(mockPrisma.contact.create).toHaveBeenCalled();
  });

  it("personalNumber-match går före namn-fallback", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_ANNA_KLIENT]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "contact-by-pnr" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    const result = await makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1"] });
    expect(result.contactId).toBe("contact-by-pnr");
    // findMany ska inte ha använts eftersom personalNumber-matchen tog över
    expect(mockPrisma.matterContact.findMany).not.toHaveBeenCalled();
  });
});

// ─── acceptSuggestionGroup — säkerhet ────────────────────────────

describe("document.acceptSuggestionGroup — valideringar", () => {
  it("kastar NOT_FOUND när inga förslag hittas", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([]);

    await expect(
      makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["missing"] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("kastar BAD_REQUEST om bara några förslag hittas (delvis annan org)", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_ANNA_KLIENT]);

    await expect(
      makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1", "s99"] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar BAD_REQUEST om förslagen tillhör olika ärenden", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      SUGG_ANNA_KLIENT,
      { ...SUGG_ANNA_VITTNE, document: { matterId: "mat-2" } },
    ]);

    await expect(
      makeCaller("org-a").acceptSuggestionGroup({ suggestionIds: ["s1", "s2"] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("olika ärenden") });
  });

  it("filtrerar på anropande organisation i findMany-query", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([SUGG_ANNA_KLIENT]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({ id: "mc-1" });
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 1 });

    await makeCaller("org-b").acceptSuggestionGroup({ suggestionIds: ["s1"] });

    expect(mockPrisma.documentAnalysisSuggestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          document: { matter: { organizationId: "org-b" } },
        }),
      })
    );
  });
});

// ─── rejectSuggestionGroup ───────────────────────────────────────

describe("document.rejectSuggestionGroup", () => {
  it("avvisar alla förslag i gruppen", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      { id: "s1" },
      { id: "s2" },
    ]);
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({ count: 2 });

    const result = await makeCaller("org-a").rejectSuggestionGroup({
      suggestionIds: ["s1", "s2"],
    });

    expect(result).toEqual({ rejected: 2 });
    expect(mockPrisma.documentAnalysisSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1", "s2"] } },
      data: { status: "REJECTED" },
    });
  });

  it("kastar NOT_FOUND när inga förslag hittas", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([]);

    await expect(
      makeCaller("org-a").rejectSuggestionGroup({ suggestionIds: ["s1"] })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("kastar BAD_REQUEST om bara vissa id:n tillhör anropande org", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([{ id: "s1" }]);

    await expect(
      makeCaller("org-a").rejectSuggestionGroup({ suggestionIds: ["s1", "s2"] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
