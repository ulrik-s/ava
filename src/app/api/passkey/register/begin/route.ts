/**
 * POST /api/passkey/register/begin
 *
 * Initierar registreringsceremoni för den inloggade användaren.
 * Returnerar PublicKeyCredentialCreationOptions som browsern skickar
 * till navigator.credentials.create().
 */

import { NextResponse } from "next/server";
import { requireSession, withApiErrors } from "@/server/api-auth";
import { prisma } from "@/server/db";
import { beginRegistration } from "@/server/auth/passkey-ceremony";
import { PrismaPasskeyStore } from "@/server/auth/prisma-passkey-store";
import { getPasskeyConfig } from "@/server/auth/passkey-config";

export const POST = withApiErrors(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { id: true, email: true, name: true },
  });
  const result = await beginRegistration({
    config: getPasskeyConfig(),
    store: new PrismaPasskeyStore(prisma),
    user,
  });
  return NextResponse.json(result.options);
});
