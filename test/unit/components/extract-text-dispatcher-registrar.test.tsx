/**
 * Test för `ExtractTextDispatcherRegistrar` (#27). Integrationstest mot den
 * RIKTIGA extract-text-dispatchern (ingen mock): mount registrerar en dispatcher
 * som dispatchar `ava:document-text-extracted`; unmount avregistrerar.
 */
import { describe, it, expect, afterEach } from "vitest-compat";
import { render } from "@testing-library/react";
import { ExtractTextDispatcherRegistrar } from "@/components/documents/extract-text-dispatcher-registrar";
import { dispatchExtractText, setExtractTextDispatcher } from "@/lib/client/jobs/extract-text-dispatch";

afterEach(() => setExtractTextDispatcher(null));

describe("ExtractTextDispatcherRegistrar", () => {
  it("mount registrerar dispatcher → dispatchExtractText dispatchar event; unmount avregistrerar", async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("ava:document-text-extracted", listener);

    const { unmount } = render(<ExtractTextDispatcherRegistrar />);
    await dispatchExtractText({ documentId: "d1", text: "hej världen" });
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toEqual({ documentId: "d1", text: "hej världen" });

    unmount();
    await expect(dispatchExtractText({ documentId: "d2", text: "x" }))
      .rejects.toThrow(/Ingen extract-text-dispatcher/);

    window.removeEventListener("ava:document-text-extracted", listener);
  });
});
