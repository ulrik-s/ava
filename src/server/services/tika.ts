const TIKA_URL = process.env.TIKA_URL || "http://localhost:9998";

/**
 * Extract text content from a file using Apache Tika.
 * Sends the raw file buffer and returns the extracted plain text.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  const res = await fetch(`${TIKA_URL}/tika`, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Accept": "text/plain",
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    throw new Error(`Tika extraction failed: ${res.status} ${res.statusText}`);
  }

  return res.text();
}
