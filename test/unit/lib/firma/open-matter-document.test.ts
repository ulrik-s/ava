/**
 * `openMatterDocument` (#651) — RUNTIME-tier-routing: demo → GH-Pages-blob,
 * self-hosted → server-backad cache-medveten fetch (ej bygg-tids-flagga).
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { openMatterDocument } from "@/lib/client/firma/open-matter-document";

let tier = "demo";
const openDocumentSpy = vi.fn(async () => "opened-gh-pages");
const createServerDownloadClientSpy = vi.fn(() => ({}));
const loadDocumentBlobSpy = vi.fn(async () => null);

vi.mock("@/lib/client/firma/firma-config", () => ({ loadFirmaConfig: () => ({ tier }) }));
vi.mock("@/lib/client/firma/open-document", () => ({ openDocument: openDocumentSpy }));
vi.mock("@/lib/client/fsa/handle-store", () => ({ loadHandle: async () => null }));
vi.mock("@/lib/client/fsa/read-from-fsa", () => ({ readFromFsa: async () => null }));
vi.mock("@/lib/client/backend/server-download-client", () => ({ createServerDownloadClient: createServerDownloadClientSpy }));
vi.mock("@/lib/client/backend/load-document-blob", () => ({ loadDocumentBlob: loadDocumentBlobSpy }));

describe("openMatterDocument (#651)", () => {
  beforeEach(() => { openDocumentSpy.mockClear(); createServerDownloadClientSpy.mockClear(); });

  it("demo → isDemo=true, ingen server-fetch (GH-Pages-blob)", async () => {
    tier = "demo";
    await openMatterDocument({ id: "d1", storagePath: "documents/content/d1.pdf", fileName: "d1.pdf" });
    const deps = openDocumentSpy.mock.calls[0]![0] as { isDemo: boolean; fetchBlob?: unknown };
    expect(deps.isDemo).toBe(true);
    expect(deps.fetchBlob).toBeUndefined();
    expect(createServerDownloadClientSpy).not.toHaveBeenCalled();
  });

  it("self-hosted → isDemo=false + server-backad fetchBlob", async () => {
    tier = "self-hosted";
    await openMatterDocument({ id: "d1", fileName: "d1.pdf" });
    const deps = openDocumentSpy.mock.calls[0]![0] as { isDemo: boolean; fetchBlob?: unknown };
    expect(deps.isDemo).toBe(false);
    expect(typeof deps.fetchBlob).toBe("function");
    expect(createServerDownloadClientSpy).toHaveBeenCalled();
  });
});
