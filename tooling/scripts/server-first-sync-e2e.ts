#!/usr/bin/env bun
/**
 * Server-first DEPLOY-E2E (#410, ADR 0016) — kör mot en KÖRANDE server-first-
 * container (docker-compose.server-first.yml). Seedar en användare i Postgres,
 * och synkar push/pull via `TrpcSyncTransport` över HTTP mot containern — bevisar
 * att den deployade artefakten (binär i docker) fungerar end-to-end.
 *
 *   bun run server-first:build
 *   docker compose -f tooling/docker/docker-compose.server-first.yml up -d --build --wait
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test bun run db:migrate
 *   SERVER_URL=http://localhost:3001 \
 *   AVA_DATABASE_URL=postgres://ava:ava@localhost:5433/ava_test \
 *   AVA_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001 \
 *     bun tooling/scripts/server-first-sync-e2e.ts
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import postgres from "postgres";
import superjson from "superjson";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import type { AppRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:3001";
const DB_URL = process.env.AVA_DATABASE_URL ?? "postgres://ava:ava@localhost:5433/ava_test";
const ORG = process.env.AVA_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";
const EMAIL = "anna@byra.se";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Seeda en allowlistad användare så orgProcedure släpper igenom. */
async function seedUser(): Promise<void> {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`INSERT INTO users (id, organization_id, email, name, role, active)
              VALUES (${uuidv7()}, ${ORG}, ${EMAIL}, 'Anna', 'LAWYER', true)
              ON CONFLICT DO NOTHING`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function makeTransport(): TrpcSyncTransport {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${SERVER_URL}/api/trpc`,
        transformer: superjson,
        headers: () => ({ "X-Auth-Request-Email": EMAIL }),
      }),
    ],
  });
  return new TrpcSyncTransport(client);
}

/** Vänta tills servern svarar (containern kan ta en stund att lyssna). */
async function waitForServer(transport: TrpcSyncTransport): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await transport.pull(0);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`server-first svarade inte på ${SERVER_URL} inom 30s`);
}

async function main(): Promise<void> {
  await seedUser();
  const transport = makeTransport();
  await waitForServer(transport);

  const m1 = uuidv7();
  const push = await transport.push({
    mutationId: uuidv7(),
    entity: "matter",
    kind: "create",
    row: { id: m1, organizationId: ORG, title: "Deploy-E2E-ärende", status: "ACTIVE", matterNumber: "2026-0123" },
    enqueuedAt: 0,
  });
  if (push.status !== "accepted") throw new Error(`push ej accepterad: ${push.status}`);

  const pull = await transport.pull(0);
  if (!pull.changes.some((c) => c.row.id === m1)) throw new Error("pull saknar den pushade raden");

  console.log(`✓ server-first deploy-E2E: push accepted, pull cursor ${pull.cursor}, rad synlig`);
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ server-first deploy-E2E: ${String(err)}\n`);
  process.exitCode = 1;
});
