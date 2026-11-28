/**
 * Fakturadokumenten och kostnadsräkningens dokument öppnas med demorepot ur
 * `DEMO_REPO` (#1945), också när ingen env-variabel är satt.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { InvoiceDocumentsCard } from "@/app/invoices/[id]/_invoice-documents";
import { openKrDoc } from "@/app/matters/[id]/_billing-runs-list";
import type { DownloadClient } from "@/lib/client/backend/load-document-blob";
import { asId } from "@/lib/shared/schemas/ids";

const openDocumentSpy = vi.fn(async () => {});
vi.mock("@/lib/client/firma/open-document", () => ({ openDocument: openDocumentSpy }));
vi.mock("@/lib/client/firma/firma-config", () => ({ DEMO_REPO: "byra/demo", isDemoTier: () => true }));
vi.mock("@/lib/client/fsa/handle-store", () => ({ loadHandle: () => Promise.resolve(null) }));
vi.mock("@/lib/client/fsa/read-from-fsa", () => ({ readFromFsa: () => Promise.resolve(null) }));
vi.mock("@/lib/client/backend/load-document-blob", () => ({ loadDocumentBlob: () => Promise.resolve(new Blob()) }));
vi.mock("@/lib/client/trpc", () => ({ trpc: { useUtils: () => ({ client: {} }) } }));

const CLIENT: DownloadClient = { document: { downloadContent: { query: () => Promise.resolve({ contentBase64: "", mimeType: "application/pdf" }) } } };

const demoRepoOfLastCall = (): unknown => (openDocumentSpy.mock.calls.at(-1)?.[0] as { demoRepo?: string } | undefined)?.demoRepo;

describe("demoRepo = DEMO_REPO (#1945)", () => {
  beforeEach(() => { openDocumentSpy.mockClear(); });

  it("fakturadokumentet", async () => {
    render(<InvoiceDocumentsCard documents={[{ id: asId<"DocumentId">("d1"), fileName: "faktura.pdf", storagePath: null }]} />);
    fireEvent.click(screen.getByRole("button", { name: "faktura.pdf" }));
    await waitFor(() => expect(openDocumentSpy).toHaveBeenCalledTimes(1));
    expect(demoRepoOfLastCall()).toBe("byra/demo");
  });

  it("kostnadsräkningens dokument", async () => {
    await openKrDoc({ id: asId<"DocumentId">("d2"), fileName: "kr.pdf", storagePath: null }, CLIENT);
    expect(demoRepoOfLastCall()).toBe("byra/demo");
  });
});
