/**
 * Test för document suggestion-procedurer — accept/reject/group + dedup-grenar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { dataStoreFromMockPrisma } from "../../helpers/mock-data-store";

vi.mock("@/lib/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn(),
}));
vi.mock("@/lib/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn(),
}));

import { documentRouter } from "@/lib/server/routers/document";

const mockPrisma = {
  documentAnalysisSuggestion: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
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
    user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma, dataStore: dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return documentRouter.createCaller(ctx as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.matterContact.findMany.mockResolvedValue([]);
  mockPrisma.matterContact.findFirst.mockResolvedValue(null);
});

describe("document.pendingSuggestions", () => {
  it("returnerar pending suggestions för matter", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      { id: "s1", name: "Anna" },
    ]);
    const result = await makeCaller().pendingSuggestions({ matterId: "m1" });
    expect(result).toHaveLength(1);
    const args = mockPrisma.documentAnalysisSuggestion.findMany.mock.calls[0][0];
    expect(args.where.status).toBe("PENDING");
    expect(args.where.document.matterId).toBe("m1");
    expect(args.where.document.matter.organizationId).toBe("org-a");
  });
});

describe("document.pendingSuggestionsGrouped", () => {
  it("anropar groupSuggestions och returnerar grupper", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "s1",
        name: "Anna",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { id: "d1", fileName: "f", title: "t" },
        createdAt: new Date(),
      },
    ]);
    const result = await makeCaller().pendingSuggestionsGrouped({ matterId: "m1" });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("document.acceptSuggestion", () => {
  it("kastar NOT_FOUND om förslaget inte finns", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().acceptSuggestion({ suggestionId: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("kastar BAD_REQUEST om redan hanterad", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "ACCEPTED",
      document: { matterId: "m1" },
    });
    await expect(
      makeCaller().acceptSuggestion({ suggestionId: "s1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("länkar via existingContactId och skapar matterContact", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "KLIENT",
      name: "Anna",
      contactType: "PERSON",
      personalNumber: null,
      orgNumber: null,
      email: null,
      phone: null,
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.matterContact.create.mockResolvedValue({});
    mockPrisma.documentAnalysisSuggestion.update.mockResolvedValue({});

    const res = await makeCaller().acceptSuggestion({
      suggestionId: "s1",
      existingContactId: "c1",
    });
    expect(res).toEqual({ contactId: "c1" });
    expect(mockPrisma.matterContact.create).toHaveBeenCalled();
    expect(mockPrisma.documentAnalysisSuggestion.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "ACCEPTED", acceptedContactId: "c1" },
    });
  });

  it("kastar NOT_FOUND om existingContactId inte tillhör org", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "KLIENT",
      name: "A",
      contactType: "PERSON",
      personalNumber: null,
      orgNumber: null,
      email: null,
      phone: null,
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().acceptSuggestion({ suggestionId: "s1", existingContactId: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hittar existerande kontakt via personalNumber", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "KLIENT",
      name: "Anna",
      contactType: "PERSON",
      personalNumber: "19800101-1234",
      orgNumber: null,
      email: null,
      phone: null,
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c-existing" });
    mockPrisma.matterContact.findFirst.mockResolvedValue({ id: "ml1" });
    mockPrisma.documentAnalysisSuggestion.update.mockResolvedValue({});

    const res = await makeCaller().acceptSuggestion({ suggestionId: "s1" });
    expect(res.contactId).toBe("c-existing");
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    expect(mockPrisma.matterContact.create).not.toHaveBeenCalled();
  });

  it("hittar existerande kontakt via orgNumber när pnr saknas", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "MOTPART",
      name: "Acme AB",
      contactType: "COMPANY",
      personalNumber: null,
      orgNumber: "556677-8899",
      email: null,
      phone: null,
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c-org" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);

    const res = await makeCaller().acceptSuggestion({ suggestionId: "s1" });
    expect(res.contactId).toBe("c-org");
    expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
      where: { orgNumber: "556677-8899", organizationId: "org-a" },
    });
  });

  it("skapar ny kontakt när inget matchar", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "KLIENT",
      name: "Helt Ny",
      contactType: "PERSON",
      personalNumber: null,
      orgNumber: null,
      email: "ny@x.se",
      phone: "070-111",
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.create.mockResolvedValue({ id: "c-new" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);

    const res = await makeCaller().acceptSuggestion({ suggestionId: "s1" });
    expect(res.contactId).toBe("c-new");
    expect(mockPrisma.contact.create).toHaveBeenCalled();
    const data = mockPrisma.contact.create.mock.calls[0][0].data;
    expect(data.name).toBe("Helt Ny");
    expect(data.email).toBe("ny@x.se");
    expect(data.organizationId).toBe("org-a");
  });

  it("använder override-fält när angivna", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "KLIENT",
      name: "Original",
      contactType: "PERSON",
      personalNumber: null,
      orgNumber: null,
      email: null,
      phone: null,
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.create.mockResolvedValue({ id: "c-new" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);

    await makeCaller().acceptSuggestion({
      suggestionId: "s1",
      override: { name: "Override Name", role: "MOTPART", email: "o@e.se" },
    });
    const data = mockPrisma.contact.create.mock.calls[0][0].data;
    expect(data.name).toBe("Override Name");
    expect(data.email).toBe("o@e.se");
    const link = mockPrisma.matterContact.create.mock.calls[0][0].data;
    expect(link.role).toBe("MOTPART");
  });

  it("hoppar över matterContact.create om länk redan finns", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({
      id: "s1",
      status: "PENDING",
      role: "KLIENT",
      name: "A",
      contactType: "PERSON",
      personalNumber: null,
      orgNumber: null,
      email: null,
      phone: null,
      notes: null,
      document: { matterId: "m1" },
    });
    mockPrisma.contact.create.mockResolvedValue({ id: "c1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue({ id: "existing-link" });

    await makeCaller().acceptSuggestion({ suggestionId: "s1" });
    expect(mockPrisma.matterContact.create).not.toHaveBeenCalled();
  });
});

describe("document.rejectSuggestion", () => {
  it("kastar NOT_FOUND när förslag saknas", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().rejectSuggestion({ suggestionId: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uppdaterar status till REJECTED", async () => {
    mockPrisma.documentAnalysisSuggestion.findFirst.mockResolvedValue({ id: "s1" });
    mockPrisma.documentAnalysisSuggestion.update.mockResolvedValue({ id: "s1", status: "REJECTED" });
    await makeCaller().rejectSuggestion({ suggestionId: "s1" });
    expect(mockPrisma.documentAnalysisSuggestion.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { status: "REJECTED" },
    });
  });
});

describe("document.acceptSuggestionGroup", () => {
  it("kastar NOT_FOUND när inga förslag matchar", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([]);
    await expect(
      makeCaller().acceptSuggestionGroup({ suggestionIds: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("kastar BAD_REQUEST när några saknas eller redan hanterade", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "X",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    await expect(
      makeCaller().acceptSuggestionGroup({ suggestionIds: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("kastar BAD_REQUEST när förslag tillhör flera ärenden", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "X",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
      {
        id: "b",
        name: "X",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m2" },
      },
    ]);
    await expect(
      makeCaller().acceptSuggestionGroup({ suggestionIds: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("länkar via existingContactId med distinkta roller", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "Anna",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: "anteckning1",
        document: { matterId: "m1" },
      },
      {
        id: "b",
        name: "Anna",
        contactType: "PERSON",
        role: "VITTNE",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: "anteckning2",
        document: { matterId: "m1" },
      },
      {
        id: "c",
        name: "Anna",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({});

    const res = await makeCaller().acceptSuggestionGroup({
      suggestionIds: ["a", "b", "c"],
      existingContactId: "c1",
    });
    expect(res.contactId).toBe("c1");
    expect(res.acceptedRoles).toEqual(expect.arrayContaining(["KLIENT", "VITTNE"]));
    expect(res.acceptedRoles).toHaveLength(2);
    // Två länkar (en per distinkt roll)
    expect(mockPrisma.matterContact.create).toHaveBeenCalledTimes(2);
  });

  it("kastar NOT_FOUND om existingContactId tillhör annan org", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "X",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue(null);
    await expect(
      makeCaller().acceptSuggestionGroup({
        suggestionIds: ["a"],
        existingContactId: "bogus",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hittar via personalNumber och hoppar över skapande", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "Anna",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: "19800101-1234",
        orgNumber: null,
        email: "a@b.se",
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c-pnr" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);

    const res = await makeCaller().acceptSuggestionGroup({ suggestionIds: ["a"] });
    expect(res.contactId).toBe("c-pnr");
    expect(mockPrisma.contact.create).not.toHaveBeenCalled();
  });

  it("hittar via orgNumber när pnr saknas", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "Acme",
        contactType: "COMPANY",
        role: "MOTPART",
        personalNumber: null,
        orgNumber: "556677-8899",
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "c-org" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);

    const res = await makeCaller().acceptSuggestionGroup({ suggestionIds: ["a"] });
    expect(res.contactId).toBe("c-org");
  });

  it("skapar ny kontakt med pickFirst-fält när inget matchar", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "Ny Person",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
      {
        id: "b",
        name: "Ny Person",
        contactType: "PERSON",
        role: "VITTNE",
        personalNumber: null,
        orgNumber: null,
        email: "first@e.se",
        phone: "070-x",
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    mockPrisma.contact.create.mockResolvedValue({ id: "c-created" });
    mockPrisma.matterContact.findFirst.mockResolvedValue(null);

    const res = await makeCaller().acceptSuggestionGroup({ suggestionIds: ["a", "b"] });
    expect(res.contactId).toBe("c-created");
    const data = mockPrisma.contact.create.mock.calls[0][0].data;
    expect(data.email).toBe("first@e.se");
    expect(data.phone).toBe("070-x");
  });

  it("undviker dubbla matterContact-länkar för samma roll", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      {
        id: "a",
        name: "X",
        contactType: "PERSON",
        role: "KLIENT",
        personalNumber: null,
        orgNumber: null,
        email: null,
        phone: null,
        notes: null,
        document: { matterId: "m1" },
      },
    ]);
    mockPrisma.contact.create.mockResolvedValue({ id: "c1" });
    mockPrisma.matterContact.findFirst.mockResolvedValue({ id: "already" });

    await makeCaller().acceptSuggestionGroup({ suggestionIds: ["a"] });
    expect(mockPrisma.matterContact.create).not.toHaveBeenCalled();
  });
});

describe("document.rejectSuggestionGroup", () => {
  it("kastar NOT_FOUND när inga förslag matchar", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([]);
    await expect(
      makeCaller().rejectSuggestionGroup({ suggestionIds: ["a"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("kastar BAD_REQUEST när några saknas", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([{ id: "a" }]);
    await expect(
      makeCaller().rejectSuggestionGroup({ suggestionIds: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("uppdaterar alla till REJECTED", async () => {
    mockPrisma.documentAnalysisSuggestion.findMany.mockResolvedValue([
      { id: "a" },
      { id: "b" },
    ]);
    mockPrisma.documentAnalysisSuggestion.updateMany.mockResolvedValue({});
    const res = await makeCaller().rejectSuggestionGroup({ suggestionIds: ["a", "b"] });
    expect(res.rejected).toBe(2);
    expect(mockPrisma.documentAnalysisSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] } },
      data: { status: "REJECTED" },
    });
  });
});
