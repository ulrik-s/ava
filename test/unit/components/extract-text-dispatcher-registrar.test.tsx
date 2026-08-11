/**
 * Test för `ExtractTextDispatcherRegistrar` (#27, #988). Integrationstest mot
 * den RIKTIGA extract-text-dispatchern (ingen mock av dispatch-modulen): mount
 * registrerar en dispatcher som (1) dispatchar `ava:document-text-extracted`
 * och (2) skapar kontakt-/händelseförslag ur texten; unmount avregistrerar.
 *
 * Punkt 2 är klient-tier:ernas enda väg in i `SuggestionsPanel`/`EventsPanel`
 * — bytes:en når aldrig servern där, så förslagen måste utgå från texten
 * browsern just läst.
 */
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { ExtractTextDispatcherRegistrar } from "@/components/documents/extract-text-dispatcher-registrar";
import { dispatchExtractText, setExtractTextDispatcher } from "@/lib/client/jobs/extract-text-dispatch";
import { asId } from "@/lib/shared/schemas/ids";

const mutateAsync = vi.fn(async () => ({ parties: 2, events: 1 }));
const suggestionsInvalidate = vi.fn(async () => {});
const eventsInvalidate = vi.fn(async () => {});
vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    document: { suggestFromText: { useMutation: () => ({ mutateAsync }) } },
    useUtils: () => ({
      document: {
        pendingSuggestionsGrouped: { invalidate: suggestionsInvalidate },
        events: { invalidate: eventsInvalidate },
      },
    }),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => setExtractTextDispatcher(null));

describe("ExtractTextDispatcherRegistrar", () => {
  it("mount registrerar dispatcher → dispatchExtractText dispatchar event; unmount avregistrerar", async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("ava:document-text-extracted", listener);

    const { unmount } = render(<ExtractTextDispatcherRegistrar />);
    await dispatchExtractText({ documentId: asId<"DocumentId">("d1"), text: "hej världen" });
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toEqual({ documentId: "d1", text: "hej världen" });

    unmount();
    await expect(dispatchExtractText({ documentId: asId<"DocumentId">("d2"), text: "x" }))
      .rejects.toThrow(/Ingen extract-text-dispatcher/);

    window.removeEventListener("ava:document-text-extracted", listener);
  });

  it("texten skickas till document.suggestFromText → panelerna invalideras (#988)", async () => {
    render(<ExtractTextDispatcherRegistrar />);
    await dispatchExtractText({ documentId: asId<"DocumentId">("d1"), text: "Kärande: Anna Andersson" });

    expect(mutateAsync).toHaveBeenCalledWith({ documentId: "d1", text: "Kärande: Anna Andersson" });
    expect(suggestionsInvalidate).toHaveBeenCalled();
    expect(eventsInvalidate).toHaveBeenCalled();
  });

  it("ett fel i förslagsskrivningen förlorar INTE den extraherade texten", async () => {
    // Texten är huvudsaken — den dispatchas först och skrivs till FSA. Att
    // förslagen misslyckas (offline, 500) får inte fälla jobbet med den.
    const seen: CustomEvent[] = [];
    const listener = (e: Event) => seen.push(e as CustomEvent);
    window.addEventListener("ava:document-text-extracted", listener);
    mutateAsync.mockRejectedValueOnce(new Error("nätverk nere"));

    render(<ExtractTextDispatcherRegistrar />);
    await dispatchExtractText({ documentId: asId<"DocumentId">("d1"), text: "text" });

    expect(seen).toHaveLength(1);
    expect(suggestionsInvalidate).not.toHaveBeenCalled();

    window.removeEventListener("ava:document-text-extracted", listener);
  });
});
