/**
 * Test för `mail.saveIncoming` (#72 slice 1, ADR 0013) — spara inkommande
 * mail (.eml) till ett ärende + valfri tidspost. Mockar dataStore + ports.content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { mailRouter } from "@/lib/server/routers/mail";
import { dataStoreFromMockPrisma, type MockDataStore } from "../helpers/mock-data-store";

// Data-skrivningar går via repos (ADR 0020) som delegerar till samma mock-
// delegates; emit använder dataStore.events.emit (kvarvarande events-söm).
const mockPrisma = {
  matter: { findFirst: vi.fn() },
  document: { create: vi.fn() },
  user: { findFirst: vi.fn() },
  timeEntry: { create: vi.fn() },
};

let dataStore: MockDataStore;
const contentWrite = vi.fn();

const mockPorts = {
  email: { send: vi.fn() },
  paymentScanner: { scan: vi.fn() },
  documentAnalyzer: { analyze: vi.fn() },
  searchIndex: { search: vi.fn(), upsert: vi.fn(), remove: vi.fn() },
  content: { write: contentWrite },
};

function makeCaller(orgId = "org-a", userId = "u1") {
  dataStore = dataStoreFromMockPrisma(mockPrisma as unknown as Record<string, unknown>);
  const ctx = {
    user: { id: userId, email: "a@b.se", name: "T", role: "LAWYER", organizationId: orgId },
    prisma: mockPrisma,
    dataStore,
    repos: buildInMemoryRepositories(dataStore as unknown as IDataStore),
    ports: mockPorts,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mailRouter.createCaller(ctx as any);
}

// Råa MIME-bytes → base64 (det add-in:en skickar). "Subject: Hej\r\n\r\nKropp"
const RAW_EML = "Subject: Hej\r\n\r\nKropp";
const EML_B64 = Buffer.from(RAW_EML, "utf8").toString("base64");

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.matter.findFirst.mockResolvedValue({ id: "m1", organizationId: "org-a" });
  mockPrisma.document.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  mockPrisma.user.findFirst.mockResolvedValue({ id: "u1", hourlyRate: 1800 });
  mockPrisma.timeEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "te-1", ...data }));
});

describe("mail.saveIncoming", () => {
  const base = { matterId: "m1", emlBase64: EML_B64, subject: "Hej", receivedAt: "2026-06-14T08:00:00Z" };

  it("verifierar att ärendet tillhör org:n", async () => {
    await makeCaller("org-a").saveIncoming({ ...base, documentId: "doc-1" });
    expect(mockPrisma.matter.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", organizationId: "org-a" },
    });
  });

  it("skriver .eml-bytes till documents/content/<id>.eml via content-port", async () => {
    await makeCaller().saveIncoming({ ...base, documentId: "doc-1" });
    expect(contentWrite).toHaveBeenCalledTimes(1);
    const [path, bytes] = contentWrite.mock.calls[0]!;
    expect(path).toBe("documents/content/doc-1.eml");
    // Bytes:en måste avkoda tillbaka till exakt rå-MIME:n.
    expect(Buffer.from(bytes as Uint8Array).toString("utf8")).toBe(RAW_EML);
  });

  it("registrerar dokumentet med .eml-metadata", async () => {
    await makeCaller("org-a").saveIncoming({ ...base, documentId: "doc-1" });
    expect(mockPrisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "doc-1",
        matterId: "m1",
        mimeType: "message/rfc822",
        documentType: "E-post",
        title: "Hej",
        fileName: "Hej.eml",
        storagePath: "documents/content/doc-1.eml",
        organizationId: "org-a",
        sizeBytes: Buffer.byteLength(RAW_EML, "utf8"),
        uploadedById: "u1",
      }),
    });
  });

  it("emit:ar document.uploaded", async () => {
    await makeCaller().saveIncoming({ ...base, documentId: "doc-1" });
    expect(dataStore.events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "document.uploaded", matterId: "m1" }),
    );
  });

  it("utan time → ingen tidspost skapas, timeEntry=null", async () => {
    const res = await makeCaller().saveIncoming({ ...base, documentId: "doc-1" });
    expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    expect(res.timeEntry).toBeNull();
  });

  it("med time → skapar tidspost (datum=mottaget, beskrivning faller tillbaka på ämne)", async () => {
    await makeCaller("org-a", "u9").saveIncoming({
      ...base, documentId: "doc-1", time: { minutes: 15 },
    });
    expect(mockPrisma.timeEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u9",
        matterId: "m1",
        minutes: 15,
        description: "Hej", // fallback till ämnet
        hourlyRate: 1800,
        billable: true,
      }),
    });
    const args = mockPrisma.timeEntry.create.mock.calls[0]![0] as { data: { date: Date } };
    expect(args.data.date).toBeInstanceOf(Date);
  });

  it("med time + egen beskrivning → använder den + emit:ar time-entry.added", async () => {
    await makeCaller().saveIncoming({
      ...base, documentId: "doc-1", time: { minutes: 30, description: "Genomläsning" },
    });
    expect(mockPrisma.timeEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: "Genomläsning", minutes: 30 }),
    });
    expect(dataStore.events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "time-entry.added", matterId: "m1" }),
    );
  });

  it("genererar uuidv7-id när documentId saknas", async () => {
    await makeCaller().saveIncoming(base);
    const [path] = contentWrite.mock.calls[0]!;
    expect(path).toMatch(/^documents\/content\/[0-9a-f-]{36}\.eml$/);
  });

  it("saniterar osäkra tecken i ämnet → filnamn", async () => {
    await makeCaller().saveIncoming({ ...base, subject: "Re: a/b\\c:d?", documentId: "doc-1" });
    const data = mockPrisma.document.create.mock.calls[0]![0]!.data as { fileName: string };
    expect(data.fileName).toBe("Re_ a_b_c_d_.eml");
  });

  it("propagerar fel om ärendet inte tillhör org:n", async () => {
    mockPrisma.matter.findFirst.mockResolvedValue(null);
    await expect(makeCaller().saveIncoming({ ...base, documentId: "doc-1" })).rejects.toThrow();
    expect(contentWrite).not.toHaveBeenCalled();
  });
});
