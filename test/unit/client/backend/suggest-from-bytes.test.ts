/**
 * `suggestFromBytes` (#988) — förslagsvägen för tier:er UTAN working copy.
 *
 * I demon (och server-first i browsern) skrivs filen aldrig till klientens
 * disk: bytes:en passerar bara förbi vid uppladdningen. Missar vi tillfället
 * där finns ingen text att extrahera senare, och panelerna förblir tomma.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { suggestFromBytes, type SuggestClient } from "@/lib/client/backend/suggest-from-bytes";
import { asId } from "@/lib/shared/schemas/ids";

const DOC_ID = asId<"DocumentId">("d-1");

function clientSpy() {
  const mutate = vi.fn(async () => ({ parties: 1, events: 0 }));
  const client: SuggestClient = { document: { suggestFromText: { mutate } } };
  return { client, mutate };
}

describe("suggestFromBytes", () => {
  it("extraherar texten ur bytes:en och skickar den till suggestFromText", async () => {
    const { client, mutate } = clientSpy();
    const bytes = new TextEncoder().encode("Kärande: Anna Andersson 850312-4567");

    const sent = await suggestFromBytes(client, DOC_ID, { bytes, mimeType: "text/plain", fileName: "a.txt" });

    expect(sent).toBe(true);
    expect(mutate).toHaveBeenCalledWith({
      documentId: "d-1", text: "Kärande: Anna Andersson 850312-4567",
    });
  });

  it("okänt format → extraktionen ger tom text → ingen mutation alls", async () => {
    // `extractText` är fail-soft och svarar med tom sträng. Att posta den vore
    // ett rundtursanrop som garanterat inte kan ge något förslag.
    const { client, mutate } = clientSpy();
    const bytes = new Uint8Array([0x00, 0x01, 0x02]);

    const sent = await suggestFromBytes(client, DOC_ID, { bytes, mimeType: "application/octet-stream", fileName: "a.bin" });

    expect(sent).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("tomt dokument räknas som ingen text", async () => {
    const { client, mutate } = clientSpy();
    const bytes = new TextEncoder().encode("   \n\t ");

    expect(await suggestFromBytes(client, DOC_ID, { bytes, mimeType: "text/plain", fileName: "tom.txt" })).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });
});
