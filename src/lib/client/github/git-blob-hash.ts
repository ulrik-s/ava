"use client";

/**
 * Beräkna git:s blob-SHA-1 för en byte-stream. Git har ett specifikt
 * format för objekt-hashar:
 *
 *   SHA1(  "blob " + length + "\0" + content  )
 *
 * Det här är samma värde som `git hash-object <file>` skulle returnera.
 * Vi behöver det för att avgöra om en lokal fil är likadan som en
 * blob på GitHub (jämför SHA — slipper ladda ner blob:n om de matchar).
 */

/**
 * Returnerar hex-strängen (40 chars lowercase) för git:s blob-SHA.
 */
export async function gitBlobSha1(content: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${content.byteLength}\0`);
  const full = new Uint8Array(header.length + content.length);
  full.set(header, 0);
  full.set(content, header.length);
  const hash = await crypto.subtle.digest("SHA-1", full.buffer as ArrayBuffer);
  return hexEncode(new Uint8Array(hash));
}

function hexEncode(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) {
    s += byte.toString(16).padStart(2, "0");
  }
  return s;
}
