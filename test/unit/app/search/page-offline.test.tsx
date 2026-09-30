/**
 * Dokumentsökningen offline mot en server (#1244): sökningen körs på enheten,
 * träffarna märks "Lokal cache", och en träff öppnas via cachen på träffsidan.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

const HIT = {
  documentId: "d1", fileName: "stamning.pdf", storagePath: "documents/d1.pdf", matterId: "m1",
  matterNumber: "2026-0001", matterTitle: "Bodelning", highlight: "<mark>stämning</mark>", page: 3,
};
const searchQuery = { data: { hits: [HIT], totalHits: 1 }, isFetching: false, error: null };
let online = false;
const openMatterDocument = vi.fn(async () => undefined);

vi.mock("@/lib/client/search/use-document-search", () => ({ useDocumentSearch: () => searchQuery }));
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ sync: true }) }));
vi.mock("@/lib/client/sync/use-online-status", () => ({ useOnlineStatus: () => online }));
vi.mock("@/lib/client/firma/open-matter-document", () => ({ openMatterDocument }));
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate: vi.fn() } } }),
    document: { listDocumentTypes: { useQuery: () => ({ data: [] }) } },
    prefs: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
      save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clear: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      setOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      clearOrgDefault: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    user: { current: { useQuery: () => ({ data: { id: "u1", role: "LAWYER" } }) } },
  },
}));

const { default: DocumentSearchPage } = await import("@/app/search/page");

function search(term: string): void {
  const input = screen.getByPlaceholderText(/Sök i dokument/i);
  fireEvent.change(input, { target: { value: term } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

beforeEach(() => { online = false; vi.clearAllMocks(); });

describe("DocumentSearchPage offline (#1244)", () => {
  it("sökrutan går att använda, och omfånget säger vad som söks", () => {
    render(<DocumentSearchPage />);
    expect(screen.getByPlaceholderText(/Sök i dokument/i)).toBeEnabled();
    expect(screen.getByText(/söker i dokumenten på den här enheten/)).toBeInTheDocument();
  });

  it("träffarna märks som lokal cache", () => {
    render(<DocumentSearchPage />);
    search("stämning");
    expect(screen.getByText("Lokal cache")).toBeInTheDocument();
  });

  it("online märks träffarna inte", () => {
    online = true;
    render(<DocumentSearchPage />);
    search("stämning");
    expect(screen.queryByText("Lokal cache")).not.toBeInTheDocument();
  });

  it("en träff öppnas via ärendets dokumentväg, på träffsidan", async () => {
    render(<DocumentSearchPage />);
    search("stämning");
    fireEvent.click(screen.getByRole("button", { name: "stamning.pdf" }));
    await waitFor(() => expect(openMatterDocument).toHaveBeenCalledWith(
      { id: "d1", storagePath: "documents/d1.pdf", fileName: "stamning.pdf" }, 3,
    ));
  });
});
