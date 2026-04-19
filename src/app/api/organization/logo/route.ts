import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireSession, withApiErrors, ApiError } from "@/server/api-auth";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

/** GET — serve current logo as base64 JSON */
export const GET = withApiErrors(async () => {
  const { orgId } = await requireSession();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { logoPath: true },
  });

  if (!org?.logoPath || !existsSync(org.logoPath)) {
    return NextResponse.json({ logoUrl: null });
  }

  const buffer = await readFile(org.logoPath);
  const ext = path.extname(org.logoPath).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
  const base64 = `data:${mime};base64,${buffer.toString("base64")}`;
  return NextResponse.json({ logoUrl: base64 });
});

/** POST — upload new logo */
export const POST = withApiErrors(async (req: NextRequest) => {
  const { orgId } = await requireSession();

  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new ApiError(NextResponse.json({ error: "No file provided" }, { status: 400 }));
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new ApiError(
      NextResponse.json({ error: "Only PNG, JPEG, SVG or WebP allowed" }, { status: 400 }),
    );
  }

  const ext = file.name.split(".").pop() ?? "png";
  const storageDir = path.join(process.env.DOCUMENT_STORAGE_PATH ?? "./storage", "logos", orgId);
  await mkdir(storageDir, { recursive: true });

  // Remove old logo if it exists
  const existing = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { logoPath: true },
  });
  if (existing?.logoPath && existsSync(existing.logoPath)) {
    await unlink(existing.logoPath).catch(() => {});
  }

  const logoPath = path.join(storageDir, `logo.${ext}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(logoPath, buffer);

  await prisma.organization.update({
    where: { id: orgId },
    data: { logoPath },
  });

  const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;
  return NextResponse.json({ logoUrl: base64 });
});

/** DELETE — remove logo */
export const DELETE = withApiErrors(async () => {
  const { orgId } = await requireSession();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { logoPath: true },
  });

  if (org?.logoPath && existsSync(org.logoPath)) {
    await unlink(org.logoPath).catch(() => {});
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { logoPath: null },
  });

  return NextResponse.json({ ok: true });
});
