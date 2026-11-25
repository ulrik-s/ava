/**
 * Loggen över skickade mejl (#1901, ADR 0024 lager 2) — `email_dispatch_log`.
 * E-posthandlern frågar `has` före utskicket och skriver `record` efter ett
 * lyckat utskick, så att samma idempotensnyckel aldrig skickas två gånger per
 * byrå, inte heller långt senare. Förebild: `RowPushLedger` (en läsning och en
 * `record`, `select … limit 1` och `insert … onConflictDoNothing`).
 */

import { and, eq } from "drizzle-orm";
import { emailDispatchLog } from "../db/schema";
import type { DrizzleRepositories } from "../repositories/drizzle-repositories";

/** Byråns logg över skickade idempotensnycklar. */
export interface EmailDispatchLog {
  /** Har ett mejl med nyckeln redan skickats för byrån? */
  has(organizationId: string, key: string): Promise<boolean>;
  /** Spara att nyckeln skickats (en andra gång är ingen ändring). */
  record(organizationId: string, key: string): Promise<void>;
}

/** Loggen mot Postgres, via repo-aggregatets transaktion för server-only-tabeller. */
export function createDrizzleEmailDispatchLog(repos: Pick<DrizzleRepositories, "transactionWithDb">): EmailDispatchLog {
  return {
    has: (organizationId, key) => repos.transactionWithDb(async (_repos, tx) => {
      const rows = await tx.select({ key: emailDispatchLog.idempotencyKey }).from(emailDispatchLog)
        .where(and(eq(emailDispatchLog.organizationId, organizationId), eq(emailDispatchLog.idempotencyKey, key))).limit(1);
      return rows.length > 0;
    }),
    record: (organizationId, key) => repos.transactionWithDb(async (_repos, tx) => {
      await tx.insert(emailDispatchLog).values({ organizationId, idempotencyKey: key })
        .onConflictDoNothing({ target: [emailDispatchLog.organizationId, emailDispatchLog.idempotencyKey] });
    }),
  };
}
