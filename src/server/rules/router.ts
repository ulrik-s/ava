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
import { authOptions } from "@/client/lib/auth";
import { prisma } from "@/server/db";
import { PostgresRuleLoader } from "./load";
import { matchHttpTrigger } from "./match";
import { executeRule } from "./execute";
import { PostgresStore } from "../data-store/PostgresStore";
import { buildLiveHandlers } from "./handlers";
import type { AvaEvent } from "../events/schema";
import { uuidv7 } from "../events/uuid7";

export async function handleRuleRequest(
  req: NextRequest,
  pathParts: string[],
): Promise<NextResponse> {
  const method = req.method as "GET" | "POST";
  const path = pathParts.join("/");

  // ─── Auth + org-context ─────────────────────────────────────────
  const session = await getServerSession(authOptions);
  let organizationId: string | undefined = session?.user?.organizationId;
  const actorId: string | undefined = session?.user?.id;

  // För shared-secret kan vi inte härleda byrå från session — användaren
  // måste skicka X-AVA-Org header. (Webhook-config:n vet vilken byrå.)
  if (!organizationId) {
    organizationId = req.headers.get("x-ava-org") ?? undefined;
  }
  if (!organizationId) {
    return NextResponse.json({ error: "Saknar organisationskontekst" }, { status: 401 });
  }

  // ─── Hitta regeln ───────────────────────────────────────────────
  const loader = new PostgresRuleLoader(prisma, organizationId);
  const rules = await loader.loadEnabled();
  const rule = matchHttpTrigger(rules, method, path);

  if (!rule) {
    return NextResponse.json({ error: "Ingen regel matchar denna endpoint" }, { status: 404 });
  }
  if (rule.trigger.kind !== "http") {
    return NextResponse.json({ error: "Internt fel: matchad regel är inte http-triggad" }, { status: 500 });
  }

  // ─── Auth-validering enligt regelns auth-läge ──────────────────
  const authMode = rule.trigger.auth;
  if (authMode === "user" && !session) {
    return NextResponse.json({ error: "Kräver inloggning" }, { status: 401 });
  }
  if (authMode === "shared-secret") {
    const expected = process.env.AVA_RULES_SHARED_SECRET;
    if (!expected) {
      return NextResponse.json({ error: "Server saknar AVA_RULES_SHARED_SECRET" }, { status: 500 });
    }
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Ogiltig shared-secret" }, { status: 401 });
    }
  }

  // ─── Bygg upp event som triggar regeln ──────────────────────────
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};
  const event: AvaEvent = {
    id: uuidv7(),
    ts: new Date().toISOString(),
    type: "user.action",
    source: "system",
    actor: { kind: actorId ? "user" : "system", id: actorId ?? "http-trigger" },
    payload: { body, method, path },
  };

  // ─── Kör regeln ─────────────────────────────────────────────────
  const dataStore = PostgresStore.forOrganization(prisma, organizationId);
  const handlers = buildLiveHandlers({ prisma, dataStore, organizationId });
  const result = await executeRule({
    rule,
    event,
    dataStore,
    handlers,
    request: { body, method, path, headers: Object.fromEntries(req.headers.entries()) },
  });

  if (result.error) {
    return NextResponse.json(
      { error: "Regeln misslyckades", details: result.error, ruleId: rule.id },
      { status: 500 },
    );
  }
  if (result.httpResponse) {
    return NextResponse.json(result.httpResponse.body ?? {}, { status: result.httpResponse.status });
  }
  return NextResponse.json({ ok: true, stepsRan: result.stepsRan, ruleId: rule.id }, { status: 200 });
}
