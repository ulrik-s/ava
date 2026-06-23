/**
 * Test för `AnalyzeDispatcherRegistrar` (#27). Mockar trpc; verifierar att den
 * registrerade dispatchern anropar document.updateMetadata + invaliderar
 * document.tree, och att unmount avregistrerar.
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";

import { AnalyzeDispatcherRegistrar } from "@/components/documents/analyze-dispatcher-registrar";
import { dispatchAnalyze, setAnalyzeDispatcher } from "@/lib/client/jobs/analyze-dispatch";
import { asId } from "@/lib/shared/schemas/ids";

const mutateAsync = vi.fn(async () => {});
const treeInvalidate = vi.fn(async () => {});
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    document: { updateMetadata: { useMutation: () => ({ mutateAsync }) } },
    useUtils: () => ({ document: { tree: { invalidate: treeInvalidate } } }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => setAnalyzeDispatcher(null));

describe("AnalyzeDispatcherRegistrar", () => {
  it("registrerar dispatcher → updateMetadata.mutateAsync + tree.invalidate", async () => {
    const { unmount } = render(<AnalyzeDispatcherRegistrar />);
    await dispatchAnalyze({ documentId: asId<"DocumentId">("d1"), kind: "INVOICE", analyzedAt: "2026-01-01T00:00:00Z", analysisStatus: "DONE" });
    expect(mutateAsync).toHaveBeenCalledWith({
      documentId: "d1",
      documentType: "INVOICE",
      analyzedAt: "2026-01-01T00:00:00Z",
      analysisStatus: "DONE",
    });
    expect(treeInvalidate).toHaveBeenCalled();

    unmount();
    await expect(dispatchAnalyze({ documentId: asId<"DocumentId">("d2"), kind: "OTHER" }))
      .rejects.toThrow(/Ingen analyze-dispatcher/);
  });
});
