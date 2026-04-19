import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { spawn } from "child_process";
import { access } from "fs/promises";
import * as path from "path";

/**
 * Opens a document in an external macOS app via the WebDAV mount.
 *
 * Expects the volume mounted at `/Volumes/localhost/` (configurable via
 * `WEBDAV_MOUNT_PATH` env var). For PDFs we try PDFGear first, falling
 * back to the default app. For other files we use the default app.
 *
 * Returns JSON so it can be called from a fetch() handler without leaving
 * the current page. (Previously returned HTML with window.close() but
 * browsers block that for target=_blank tabs, leaving users stranded.)
 */

const MOUNT_PATH = process.env.WEBDAV_MOUNT_PATH ?? "/Volumes/localhost";

/** Must match the `matterSlug()` in scripts/webdav-server.ts exactly. */
function matterSlug(m: { matterNumber: string; title: string }): string {
  const safeTitle = m.title.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 80);
  return `${m.matterNumber} - ${safeTitle}`;
}

function jsonResponse(message: string, ok: boolean): NextResponse {
  return NextResponse.json(
    { ok, message },
    { status: ok ? 200 : 500 },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      matter: { select: { matterNumber: true, title: true } },
      folder: { select: { id: true, name: true, parentId: true } },
    },
  });
  if (!doc) return jsonResponse("Dokumentet hittades inte.", false);

  // Walk folder chain upward to build the path segments.
  const folderSegments: string[] = [];
  let currentId: string | null = doc.folderId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const f = await prisma.documentFolder.findUnique({
      where: { id: currentId },
      select: { name: true, parentId: true },
    });
    if (!f) break;
    folderSegments.unshift(f.name);
    currentId = f.parentId;
  }

  const slug = matterSlug(doc.matter);
  const fullPath = path.join(MOUNT_PATH, slug, ...folderSegments, doc.fileName);

  try {
    await access(fullPath);
  } catch {
    return jsonResponse(
      `WebDAV-volymen verkar inte vara monterad. Öppna Finder, tryck Cmd+K och anslut till http://localhost:3001/ — försök sedan igen.`,
      false,
    );
  }

  // Pick the target app based on mime/extension.
  const isPdf = doc.mimeType === "application/pdf" || doc.fileName.toLowerCase().endsWith(".pdf");
  const args = isPdf ? ["-a", "PDFGear", fullPath] : [fullPath];

  const child = spawn("open", args, { detached: true, stdio: "ignore" });
  child.unref();

  return jsonResponse(`Öppnar ${doc.fileName} i ${isPdf ? "PDFGear" : "standardappen"}.`, true);
}
