import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { readFile } from "fs/promises";

// MIME types that browsers can render inline
const INLINE_VIEWABLE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/plain",
  "text/html",
  "text/css",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
]);

/**
 * Encode a filename for Content-Disposition so non-ASCII characters survive
 * transport. Uses RFC 5987 (filename*=UTF-8''…) with an ASCII fallback.
 */
function encodeFilename(name: string): string {
  const asciiSafe = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name);
  return `filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readFile(doc.storagePath);

  // ?download=1 forces attachment; otherwise inline when viewable
  const forceDownload = req.nextUrl.searchParams.get("download") === "1";
  const disposition =
    !forceDownload && INLINE_VIEWABLE.has(doc.mimeType) ? "inline" : "attachment";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `${disposition}; ${encodeFilename(doc.fileName)}`,
      "Content-Length": String(buffer.length),
    },
  });
}
