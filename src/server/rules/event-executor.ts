/**
 * Glue mellan event-loggen och regelmotorn.
 *
 * Registrerar en listener på `dataStore.events.onNewEvent` som för varje
 * nytt event:
 *   1. Hämtar enabled regler för byrån
 *   2. Filtrerar till event-triggrar som matchar event-typen + predikat
 *   3. Kör varje match via `executeRule` (fire-and-forget)
 *
 * Detta är **server-lägets** rule-executor. I local-first-läget kommer
 * varje klient ha sin egen executor med claim-mekanism (Fas 3).
 *
 * Cache: rule-loadingen sker per-event för enkelhet. Optimering: TTL-cache
 * (10s) om listan blir tung att läsa — kommer senare.
 */

import type { PrismaClient } from "@prisma/client";
import type { IDataStore } from "../data-store/IDataStore";
import type { AvaEvent } from "../events/schema";
import { PostgresRuleLoader } from "./load";
import { matchEventTriggers } from "./match";
import { executeRule } from "./execute";
import { buildLiveHandlers } from "./handlers";

export function attachEventRuleExecutor(
  prisma: PrismaClient,
  dataStore: IDataStore,
  organizationId: string,
): () => void {
  const loader = new PostgresRuleLoader(prisma, organizationId);
  const handlers = buildLiveHandlers({ prisma, dataStore, organizationId });

  return dataStore.events.onNewEvent(async (event: AvaEvent) => {
    // Undvik oändlig kedjereaktion: rule.executed/rule.failed-events
    // ska INTE trigga nya regelkörningar.
    if (event.type === "rule.executed" || event.type === "rule.failed") return;

    let rules;
    try {
      rules = await loader.loadEnabled();
    } catch (err) {
      console.error("[event-executor] kunde inte ladda regler:", err);
      return;
    }

    const matched = matchEventTriggers(rules, event);
    for (const rule of matched) {
      try {
        await executeRule({ rule, event, dataStore, handlers });
      } catch (err) {
        console.error(`[event-executor] regel ${rule.id} kraschade:`, err);
      }
    }
  });
}
