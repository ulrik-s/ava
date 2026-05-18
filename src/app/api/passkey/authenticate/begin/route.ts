/**
 * POST /api/passkey/authenticate/begin
 *
 * Initierar authentication-ceremoni. Kan vara usernameless (utan body)
 * eller user-specifik (body.email → vi slår upp user-id).
 *
 * Session-handle:n sätts som HttpOnly-cookie så finish-routen kan hitta
 * rätt challenge.
 */

import { NextRequest, NextResponse } from "next/server";
import { withApiErrors, parseJsonBody } from "@/server/api-auth";
import { prisma } from "@/server/db";
import { beginAuthentication } from "@/server/auth/passkey-ceremony";
import { PrismaPasskeyStore } from "@/server/auth/prisma-passkey-store";
import { getPasskeyConfig } from "@/server/auth/passkey-config";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const BeginBody = z.object({
  email: z.string().email().optional(),
});

const HANDLE_COOKIE = "passkey_auth_handle";

export const POST = withApiErrors(async (req: NextRequest) => {
  const body = await parseJsonBody(req, BeginBody);
  let userId: string | undefined;
  if (body.email) {
    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    userId = user?.id;
  }

  const handle = randomUUID();
  const result = await beginAuthentication({
    config: getPasskeyConfig(),
    store: new PrismaPasskeyStore(prisma),
    handle,
    userId,
  });

  const res = NextResponse.json(result.options);
  res.cookies.set(HANDLE_COOKIE, handle, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300, // 5 min
    path: "/",
  });
  return res;
});
