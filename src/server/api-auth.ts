/**
 * Delad auth + input-validering för Next.js REST-routes.
 *
 * tRPC-rutterna har `protectedProcedure`/`orgProcedure` — denna modul ger
 * motsvarande byggstenar för de rena REST-routerna under `src/app/api/…`.
 *
 * Designval:
 *   - `requireSession` kastar ett NextResponse-objekt (via ett thrown-paket)
 *     så att routen kan returnera det direkt. Alternativ: returnera union,
 *     men då tvingar man varje caller till en `if ("error" in …)`-gren.
 *     Thrown-response är idiomatiskt i Next.js App Router.
 *   - `parseJsonBody` tar ett zod-schema och ger en hårt typad retur, eller
 *     kastar ApiError som blir ett 400-svar.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/server/db";
import type { z } from "zod";

// ─── Error-wrapper ──────────────────────────────────────────────

/**
 * Kastas av `requireSession`/`parseJsonBody` och fångas av `withApiErrors`
 * (eller av callern direkt). Bär med sig ett färdigbakat `NextResponse`.
 */
export class ApiError extends Error {
  constructor(public readonly response: NextResponse) {
    super("ApiError");
    this.name = "ApiError";
  }
}

function apiError(body: { error: string }, status: number): ApiError {
  return new ApiError(NextResponse.json(body, { status }));
}

// ─── Auth ───────────────────────────────────────────────────────

export interface AuthedUser {
  readonly userId: string;
  readonly orgId: string;
  readonly email: string;
  readonly role: string;
}

/**
 * Försök 1: en riktig NextAuth-session.
 * Försök 2: dev-fallback (bara i NODE_ENV=development eller DEV_USER=true).
 * Annars: kastar ApiError(401).
 */
export async function requireSession(): Promise<AuthedUser> {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    return {
      userId: session.user.id,
      orgId: session.user.organizationId,
      email: session.user.email ?? "",
      role: session.user.role,
    };
  }

  if (process.env.NODE_ENV === "development" || process.env.DEV_USER === "true") {
    const dev = await prisma.user.findFirst({ where: { email: "dev@example.com" } });
    if (dev) {
      return {
        userId: dev.id,
        orgId: dev.organizationId,
        email: dev.email,
        role: dev.role,
      };
    }
  }

  throw apiError({ error: "Not authenticated" }, 401);
}

// ─── JSON-body + zod-validering ─────────────────────────────────

/**
 * Läser och validerar JSON-body mot ett zod-schema.
 * Returnerar den typade outputen. Kastar ApiError(400) vid ogiltig input.
 *
 * Generisk över exakt zod-schema → `z.infer<S>` ger pretty types i IDE:n.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw apiError({ error: "Invalid JSON body" }, 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw apiError(
      { error: "Validation failed: " + result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ") },
      400,
    );
  }
  return result.data;
}

// ─── Higher-order wrapper ───────────────────────────────────────

/**
 * Slå in en route-handler för att fånga `ApiError` och returnera dess
 * pre-bakade response. Okända fel re-throw:as så Next.js egen logg
 * får dem. Användning:
 *
 *   export const POST = withApiErrors(async (req) => {
 *     const user = await requireSession();
 *     const body = await parseJsonBody(req, MySchema);
 *     ...
 *     return NextResponse.json({ ok: true });
 *   });
 */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse> | NextResponse,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof ApiError) return err.response;
      throw err;
    }
  };
}
