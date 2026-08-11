"use client";

/**
 * `suggestFromBytes` (#988) — skapa kontakt- och händelseförslag ur bytes vi
 * håller i handen.
 *
 * Vanligtvis kommer texten ur `extract-text`-jobbet, som läser filen ur
 * FSA-working-copy:n. Men utan working copy (demon, och server-first i
 * browsern) finns filen aldrig på klientens disk — bytes:en passerar bara
 * förbi vid uppladdningen. Extraherar vi inte texten då är tillfället borta,
 * och panelerna förblir tomma i just den tier där de syns mest.
 *
 * Skrivningen på serversidan är idempotent, så en dubbelkörning (t.ex.
 * server-first, där jobbet också analyserar) skapar inga dubbletter.
 */

import { extractText } from "@/lib/shared/extract-text";
import type { DocumentId } from "@/lib/shared/schemas/ids";

/** tRPC-ytan primitiven behöver (strukturell — samma mönster som `UploadClient`). */
export interface SuggestClient {
  document: {
    suggestFromText: { mutate: (input: { documentId: DocumentId; text: string }) => Promise<unknown> };
  };
}

export interface SuggestSource {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Extraherar texten och skickar den vidare. Tom text (okänt format, tomt
 *  dokument) → ingen mutation alls; det finns inget att föreslå ur. */
export async function suggestFromBytes(
  client: SuggestClient, documentId: DocumentId, src: SuggestSource,
): Promise<boolean> {
  const text = await extractText({ bytes: src.bytes, mimeType: src.mimeType, fileName: src.fileName });
  if (text.trim().length === 0) return false;
  await client.document.suggestFromText.mutate({ documentId, text });
  return true;
}
