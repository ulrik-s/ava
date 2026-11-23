/**
 * Håll bokföringsanslutningen vid liv (#1815) — konsumerar `ledger-keepalive`-
 * kön, som `JOB_SCHEDULES` köar en gång i veckan.
 *
 * Fortnox refresh-token gäller 45 dygn och förnyas annars bara när någon
 * bokför. Jobbet frågar porten (`ILedgerService.keepAlive`, #1814), som gör ett
 * röktest och förnyar vid behov under tjänstens lås. Handlern ser bara porten
 * (ADR 0011), därför heter kön inte `fortnox-…`.
 *
 * Utfallen loggas; `reconnect-required` på `error` varje vecka tills någon
 * ansluter igen. Ett fel från porten (nät, 5xx) kastas vidare så att pg-boss
 * försöker igen (ADR 0024). Inga tokenvärden passerar handlern.
 */

import type { ILedgerService, LedgerKeepAliveOutcome } from "@/lib/server/ports";
import { createLogger, type Logger } from "@/lib/shared/observability/logger";
import type { JobHandler } from "../job-worker-runtime";

/** Beroenden för keepalive-jobbet: porten och byråns id (satta tillsammans). */
export interface LedgerKeepAliveDeps {
  ledger: Pick<ILedgerService, "keepAlive">;
  orgId: string;
}

/** Logga utfallet på rätt nivå. `never`-kontrollen fångar ett nytt utfall i porten. */
function logOutcome(log: Pick<Logger, "info" | "error">, outcome: LedgerKeepAliveOutcome): void {
  switch (outcome) {
    case "alive":
    case "not-connected":
      log.info(`ledger.keepalive.${outcome}`);
      return;
    case "reconnect-required":
      log.error("ledger.keepalive.reconnect-required");
      return;
    default: {
      const unhandled: never = outcome;
      throw new Error(`Okänt utfall: ${String(unhandled)}`);
    }
  }
}

/** Bygg en handler som håller byråns bokföringsanslutning vid liv. */
export function createLedgerKeepAliveHandler(deps: LedgerKeepAliveDeps): JobHandler {
  const log = createLogger({ orgId: deps.orgId });
  return async (): Promise<void> => {
    logOutcome(log, await deps.ledger.keepAlive(deps.orgId));
  };
}
