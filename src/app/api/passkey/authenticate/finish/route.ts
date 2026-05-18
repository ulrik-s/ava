/**
 * POST /api/passkey/authenticate/finish
 *
 * Browser:n skickar resultatet av navigator.credentials.get(). Vi
 * verifierar och returnerar user-id för callern att logga in.
 *
 * För full SSO-integration: kombinera med NextAuth Credentials-provider
 * som accepterar passkey-auth-result. För denna iteration returnerar
 * vi bara user-id; UI:t får göra signIn() med det.
 */

import { NextRequest, NextResponse } from "next/server";
import { withApiErrors, parseJsonBody } from "@/server/api-auth";
import { prisma } from "@/server/db";
import { finishAuthentication } from "@/server/auth/passkey-ceremony";
import { PrismaPasskeyStore } from "@/server/auth/prisma-passkey-store";
import { getPasskeyConfig } from "@/server/auth/passkey-config";
import { z } from "zod";

const FinishBody = z.object({
  response: z.unknown(),
});

const HANDLE_COOKIE = "passkey_auth_handle";

export const POST = withApiErrors(async (req: NextRequest) => {
  const handle = req.cookies.get(HANDLE_COOKIE)?.value;
  if (!handle) {
    return NextResponse.json({ error: "Ingen pågående auth-session" }, { status: 400 });
  }
  const body = await parseJsonBody(req, FinishBody);
  const result = await finishAuthentication({
    config: getPasskeyConfig(),
    store: new PrismaPasskeyStore(prisma),
    handle,
    response: body.response as never,
  });
  const res = NextResponse.json(result);
  res.cookies.delete(HANDLE_COOKIE);
  return res;
});
