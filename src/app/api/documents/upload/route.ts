import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireSession, withApiErrors } from "@/server/api-auth";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { extractText } from "@/server/services/tika";
import { indexDocument } from "@/server/services/meilisearch";
import { analyzeDocument } from "@/server/services/document-analysis";
import { isJunkFileName } from "@/lib/junk-files";

export const POST = withApiErrors(async (req: NextRequest) => {
  const user = await requireSession();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const matterId = formData.get("matterId") as string | null;
  const folderId = (formData.get("folderId") as string | null) || null;

  if (!file || !matterId) {
    return NextResponse.json({ error: "File and matterId required" }, { status: 400 });
  }

  // Drop OS metadata sidecars (AppleDouble ._*, .DS_Store, etc.) silently —
  // they commonly sneak in via drag-and-drop from Finder.
  if (isJunkFileName(file.name)) {
    return NextResponse.json({ skipped: true, reason: "junk-file", fileName: file.name });
  }

  // Säkerhet: verifiera att matter tillhör användarens org innan upload.
  const matter = await prisma.matter.findUnique({
    where: { id: matterId },
    select: { matterNumber: true, title: true, organizationId: true },
  });
  if (!matter || matter.organizationId !== user.orgId) {
    return NextResponse.json({ error: "Matter not found" }, { status: 404 });
  }

  const storagePath = process.env.DOCUMENT_STORAGE_PATH || "./storage/documents";
  const docId = crypto.randomUUID();
  const dirPath = path.join(storagePath, matterId, docId);
  await mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

  const document = await prisma.document.create({
    data: {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      storagePath: filePath,
      matterId,
      folderId,
      uploadedById: user.userId,
    },
  });

  // Extract text via Tika and index in Meilisearch (non-blocking)
  extractText(buffer, file.type || "application/octet-stream")
    .then((content) =>
      indexDocument({
        id: document.id,
        fileName: file.name,
        content,
        matterId,
        matterNumber: matter.matterNumber,
        matterTitle: matter.title,
        organizationId: matter.organizationId,
      })
    )
    .catch((err) => console.error("Document indexing failed:", err));

  // AI-analys (non-blocking) — extraherar titel, dokumenttyp + föreslår kontakter
  analyzeDocument(document.id).catch((err) =>
    console.error("Document analysis failed:", err),
  );

  return NextResponse.json(document);
});
