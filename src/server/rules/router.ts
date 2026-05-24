/**
 * Server-side handler för HTTP-trigger-regler.
 *
 * Anropas från `src/app/api/r/[...path]/route.ts` (catch-all). Hittar
 * regeln som matchar (method, path), validerar auth, kör reglens steg,
 * och returnerar HTTP-response baserat på `http.respond`-steget eller
 * en default-200.
 *
 * Auth-semantik:
 *   - `auth: "user"` → vilken som helst inloggad användare i byrån
 *     (sessionen kommer via NextAuth som vanligt)
 *   - `auth: "shared-secret"` → `Authorization: Bearer <env.AVA_RULES_SHARED_SECRET>`
 *   - `auth: "none"` → ingen auth-check (publikt)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/client/lib/auth";
import { prisma } from "@/server/db";
import { PostgresRuleLoader } from "./load";
import { matchHttpTrigger } from "./match";
import { executeRule } from "./execute";
import { PostgresStore } from "../data-store/PostgresStore";
import { buildLiveHandlers } from "./handlers";
import type { AvaEvent } from "../events/schema";
import { uuidv7 } from "../events/uuid7";

type SessionOrNull = Session | null;

/**
 * Validera auth enligt regelns auth-läge. Returnerar NextResponse vid fel,
 * `null` om OK.
 */
function checkAuth(authMode: string, session: SessionOrNull, req: NextRequest): NextResponse | null {
  if (authMode === "user" && !session) {
    return NextResponse.json({ error: "Kräver inloggning" }, { status: 401 });
  }
  if (authMode !== "shared-secret") return null;
  const expected = process.env.AVA_RULES_SHARED_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Server saknar AVA_RULES_SHARED_SECRET" }, { status: 500 });
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Ogiltig shared-secret" }, { status: 401 });
  }
  return null;
}

function buildTriggerEvent(actorId: string | undefined, method: string, path: string, body: unknown): AvaEvent {
  return {
    id: uuidv7(),
    ts: new Date().toISOString(),
    type: "user.action",
    source: "system",
    actor: { kind: actorId ? "user" : "system", id: actorId ?? "http-trigger" },
    payload: { body, method, path },
  };
}

async function readRequestBody(req: NextRequest, method: "GET" | "POST"): Promise<unknown> {
  if (method !== "POST") return {};
  return req.json().catch(() => ({}));
}

function resolveOrgId(session: SessionOrNull, req: NextRequest): string | undefined {
  // För shared-secret kan vi inte härleda byrå från session — användaren
  // måste skicka X-AVA-Org header.
  return session?.user?.organizationId ?? req.headers.get("x-ava-org") ?? undefined;
}

/**
 * Hämta + validera regeln + auth. Returnerar antingen regeln eller en NextResponse
 * med fel-status.
 */
async function resolveRule(
  organizationId: string,
  method: "GET" | "POST",
  path: string,
  req: NextRequest,
  session: SessionOrNull,
): Promise<{ rule: Awaited<ReturnType<PostgresRuleLoader["loadEnabled"]>>[number] } | { error: NextResponse }> {
  const rules = await new PostgresRuleLoader(prisma, organizationId).loadEnabled();
  const rule = matchHttpTrigger(rules, method, path);
  if (!rule) return { error: NextResponse.json({ error: "Ingen regel matchar denna endpoint" }, { status: 404 }) };
  if (rule.trigger.kind !== "http") {
    return { error: NextResponse.json({ error: "Internt fel: matchad regel är inte http-triggad" }, { status: 500 }) };
  }
  const authError = checkAuth(rule.trigger.auth, session, req);
  if (authError) return { error: authError };
  return { rule };
}

function formatResult(result: { error?: { step: number; message: string }; httpResponse?: { status: number; body?: unknown }; stepsRan: number }, ruleId: string): NextResponse {
  if (result.error) {
    return NextResponse.json({ error: "Regeln misslyckades", details: result.error, ruleId }, { status: 500 });
  }
  if (result.httpResponse) {
    return NextResponse.json(result.httpResponse.body ?? {}, { status: result.httpResponse.status });
  }
  return NextResponse.json({ ok: true, stepsRan: result.stepsRan, ruleId }, { status: 200 });
}

export async function handleRuleRequest(
  req: NextRequest,
  pathParts: string[],
): Promise<NextResponse> {
  const method = req.method as "GET" | "POST";
  const path = pathParts.join("/");
  const session = await getServerSession(authOptions);
  const organizationId = resolveOrgId(session, req);
  if (!organizationId) {
    return NextResponse.json({ error: "Saknar organisationskontekst" }, { status: 401 });
  }

  const resolved = await resolveRule(organizationId, method, path, req, session);
  if ("error" in resolved) return resolved.error;
  const { rule } = resolved;

  const body = await readRequestBody(req, method);
  const event = buildTriggerEvent(session?.user?.id, method, path, body);
  const dataStore = PostgresStore.forOrganization(prisma, organizationId);
  const handlers = buildLiveHandlers({ prisma, dataStore, organizationId });
  const result = await executeRule({
    rule, event, dataStore, handlers,
    request: { body, method, path, headers: Object.fromEntries(req.headers.entries()) },
  });
  return formatResult(result, rule.id);
}
