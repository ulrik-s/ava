/**
 * POST /api/passkey/register/finish
 *
 * Browser:n skickar tillbaka resultatet av navigator.credentials.create().
 * Vi verifierar och sparar passkey:n.
 *
 * Body: { response: RegistrationResponseJSON, name?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession, withApiErrors, parseJsonBody } from "@/server/api-auth";
import { prisma } from "@/server/db";
import { finishRegistration } from "@/server/auth/passkey-ceremony";
import { PrismaPasskeyStore } from "@/server/auth/prisma-passkey-store";
import { getPasskeyConfig } from "@/server/auth/passkey-config";
import { z } from "zod";

const FinishBody = z.object({
  response: z.unknown(),
  name: z.string().optional(),
});

export const POST = withApiErrors(async (req: NextRequest) => {
  const session = await requireSession();
  const body = await parseJsonBody(req, FinishBody);
  const result = await finishRegistration({
    config: getPasskeyConfig(),
    store: new PrismaPasskeyStore(prisma),
    userId: session.userId,
    response: body.response as never,
    name: body.name,
  });
  return NextResponse.json(result);
});
