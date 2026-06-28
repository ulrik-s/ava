/**
 * Tester för generateKrDoc (#828 steg 4) — rättshjälpens KR-dokument:
 * bygger en non-taxa-kontext (timkostnadsnorm), renderar PDF och registrerar
 * ett document med documentType "Kostnadsräkning" så panelens doc-länk hittar det.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { generateKrDoc } from "@/lib/client/kostnadsrakning/generate-kr-doc";
import { asId } from "@/lib/shared/schemas/ids";

const renderKostnadsrakningPdf = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
const persistGeneratedDoc = vi.fn(async () => {});

vi.mock("@/lib/client/kostnadsrakning/render-pdf", () => ({ renderKostnadsrakningPdf }));
vi.mock("@/lib/client/demo/persist-generated-doc", () => ({ persistGeneratedDoc }));

const registerMutateAsync = vi.fn(async () => {});
const utils = {
  document: {
    tree: { invalidate: vi.fn(async () => {}), refetch: vi.fn(async () => {}) },
    list: { invalidate: vi.fn(async () => {}) },
  },
};

const baseArgs = {
  matterId: asId<"MatterId">("m1"),
  meta: { matterNumber: "Ä-2026-1", matterTitle: "Vårdnadstvist", defenderName: "Anna Advokat", clientName: "Klient AB", courtName: "Stockholms TR" },
  expenses: [{ id: "e1", date: "2026-03-01", description: "Ansökningsavgift", amount: 90000, billable: true }],
  timeEntries: [{ id: "t1", date: "2026-03-01", description: "Möte", minutes: 120, billable: true }],
  register: { mutateAsync: registerMutateAsync },
  utils,
};

beforeEach(() => { vi.clearAllMocks(); });

describe("generateKrDoc", () => {
  it("registrerar ett Kostnadsräkning-dokument + persisterar bytes:erna", async () => {
    await generateKrDoc(baseArgs);
    expect(renderKostnadsrakningPdf).toHaveBeenCalled();
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      matterId: "m1", documentType: "Kostnadsräkning", mimeType: "application/pdf", sizeBytes: 4,
    }));
    const arg = registerMutateAsync.mock.calls[0]![0] as { fileName: string };
    expect(arg.fileName).toMatch(/^Kostnadsräkning Ä-2026-1/);
    expect(persistGeneratedDoc).toHaveBeenCalled();
  });

  it("dokument-registreringen får DONE-analysstatus (ingen AI-körning behövs)", async () => {
    await generateKrDoc(baseArgs);
    expect(registerMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ analysisStatus: "DONE" }));
  });
});
