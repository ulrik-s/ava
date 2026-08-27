/**
 * Delad rigg för server-first-E2E:erna (#1030).
 *
 * `billing-pipeline-e2e.ts` och `billing-scenarios-e2e.ts` behöver samma fyra
 * saker: en allowlistad användare i databasen, en tRPC-klient som autentiserar
 * som hen, en väntan tills containern lyssnar, och en assert som säger vad som
 * gick fel. Utan den här modulen kopieras de mellan skripten — och då glider
 * de isär (jscpd fångar dubbletten, men först efter att skadan är gjord).
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import postgres from "postgres";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";

export const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
export const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
export const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

export type Ava = TRPCClient<AppRouter>;

export function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert: ${msg}`);
}

/** Öre → läsbara kronor. Alla belopp i domänen är öre (heltal). */
export function kr(ore: number): string {
  return `${(ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Seeda en allowlistad användare — `orgProcedure` släpper bara igenom dessa. */
export async function seedUser(email: string, name: string): Promise<string> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    const existing = await sql<Array<{ id: string }>>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (existing[0]) return existing[0].id;
    const id = uuidv7();
    await sql`INSERT INTO users (id, organization_id, email, name, role, active)
              VALUES (${id}, ${ORG}, ${email}, ${name}, 'LAWYER', true)`;
    return id;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export function clientFor(email: string): Ava {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: `${SERVER_URL}/api/trpc`,
      transformer: superjson,
      headers: () => ({ "X-Auth-Request-Email": email }),
    })],
  });
}

/** Vänta tills servern svarar — containern kan behöva en stund på sig. */
export async function waitForServer(client: Ava): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try { await client.documentTemplate.list.query(); return; } catch { await sleep(1000); }
  }
  throw new Error(`server-first svarade inte på ${SERVER_URL} inom 30s`);
}
