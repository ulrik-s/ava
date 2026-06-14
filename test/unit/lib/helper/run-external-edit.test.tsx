/**
 * Tester för `runExternalEdit` (#27 — otestade fel-/ok-grenar). Mockar de
 * dynamiskt importerade FSA-modulerna (open-in-finder + external-edit-tracker)
 * och verifierar varje openInFinder-resultat-kind → ModalState, samt
 * tracker-saknas och happy-path (watch anropas + ok-state returneras).
 */
import { describe, it, expect, vi, beforeEach } from "vitest-compat";

const openInFinderMock = vi.fn();
const trackerWatch = vi.fn(async () => {});
let trackerValue: { watch: typeof trackerWatch } | null = { watch: trackerWatch };

vi.mock("@/lib/client/fsa/open-in-finder", () => ({
  openInFinder: (...args: unknown[]) => openInFinderMock(...args),
}));
vi.mock("@/lib/client/fsa/external-edit-tracker", () => ({
  getExternalEditTracker: () => trackerValue,
}));

import { runExternalEdit } from "@/lib/client/firma/open-document-externally";

const DOC = { id: "d1", fileName: "rapport.pdf", storagePath: "documents/d1.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  trackerValue = { watch: trackerWatch };
});

describe("runExternalEdit", () => {
  it("unsupported → fel-modal om File System Access", async () => {
    openInFinderMock.mockResolvedValue({ kind: "unsupported" });
    const r = await runExternalEdit(DOC);
    expect(r.kind).toBe("error");
    expect((r as { title: string }).title).toMatch(/File System Access/);
  });

  it("no-handle → 'Ingen lokal mapp vald'", async () => {
    openInFinderMock.mockResolvedValue({ kind: "no-handle" });
    expect((await runExternalEdit(DOC) as { title: string }).title).toMatch(/Ingen lokal mapp/);
  });

  it("permission-denied → 'Saknar behörighet'", async () => {
    openInFinderMock.mockResolvedValue({ kind: "permission-denied" });
    expect((await runExternalEdit(DOC) as { title: string }).title).toMatch(/Saknar behörighet/);
  });

  it("file-not-found → meddelandet innehåller path:n", async () => {
    openInFinderMock.mockResolvedValue({ kind: "file-not-found", path: "documents/d1.pdf" });
    const r = await runExternalEdit(DOC) as { kind: string; message: string };
    expect(r.kind).toBe("error");
    expect(r.message).toContain("documents/d1.pdf");
  });

  it("ok men tracker saknas → 'Edit-tracker inte initialiserad'", async () => {
    trackerValue = null;
    openInFinderMock.mockResolvedValue({
      kind: "ok",
      target: { relativePath: "documents/d1.pdf", fileHandle: {}, folderName: "firma" },
    });
    expect((await runExternalEdit(DOC) as { title: string }).title).toMatch(/tracker inte initialiserad/);
  });

  it("ok + tracker → watch anropas och ok-state returneras", async () => {
    const fileHandle = { name: "d1.pdf" };
    openInFinderMock.mockResolvedValue({
      kind: "ok",
      target: { relativePath: "documents/d1.pdf", fileHandle, folderName: "firma-mapp" },
    });
    const r = await runExternalEdit(DOC);
    expect(trackerWatch).toHaveBeenCalledWith({ docId: "d1", path: "documents/d1.pdf", handle: fileHandle });
    expect(r).toEqual({
      kind: "ok",
      fileName: "rapport.pdf",
      folderName: "firma-mapp",
      relativePath: "documents/d1.pdf",
      fileHandle,
    });
  });
});
