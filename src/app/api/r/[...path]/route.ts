/**
 * Catch-all för dynamiska HTTP-trigger-regler.
 *
 * En commit som lägger till en regel med `trigger.kind === "http"` registrerar
 * implicit en endpoint här utan deploy. Se `docs/architecture-future.md` §2.2
 * och `src/server/rules/router.ts`.
 */

import type { NextRequest } from "next/server";
import { handleRuleRequest } from "@/server/rules/router";

export const GET = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) =>
  ctx.params.then(({ path }) => handleRuleRequest(req, path));

export const POST = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) =>
  ctx.params.then(({ path }) => handleRuleRequest(req, path));
