/**
 * Lyssnar på `system.payment_scan_requested`-events och kör `runPaymentScan`
 * för byrån som triggade eventet.
 *
 * Designval: vi behandlar detta som en "domän-tjänst som svarar på events"
 * snarare än ett rule-step. Det håller rule-engine generisk; domän-specifika
 * SQL-aggregat bor i kod.
 *
 * Registrering: anropas från `/api/cron/scheduler-tick` när vi initierar
 * dataStore per byrå.
 */

import type { PrismaClient } from "@prisma/client";
import type { IDataStore } from "../data-store/IDataStore";
import type { AvaEvent } from "../events/schema";
import { runPaymentScan } from "./payment-scan";

export function attachPaymentScanListener(
  prisma: PrismaClient,
  dataStore: IDataStore,
  organizationId: string,
): () => void {
  return dataStore.events.onNewEvent(async (event: AvaEvent) => {
    if (event.type !== "system.payment_scan_requested") return;
    try {
      await runPaymentScan(prisma, dataStore, organizationId);
    } catch (err) {
      await dataStore.events.emit({
        type: "rule.failed",
        source: "system",
        actor: { kind: "system", id: "payment-scan-listener" },
        causedBy: event.id,
        payload: { error: err instanceof Error ? err.message : String(err) },
      }).catch(() => {});
    }
  });
}
