/**
 * Scheduler för regler med `trigger.kind === "schedule"`.
 *
 * Designprincip: en klient kör schemalagda regler genom att i loopen
 * "tick" var 60:e sekund kolla:
 *
 *   1. Vilka regler har trigger.kind === "schedule"?
 *   2. För varje regel, beräkna senaste tick som "skulle ha hänt" sedan
 *      vi sist tittade
 *   3. För varje sådan tick, generera idempotency-key `${ruleId}:${isoTick}`
 *      och kolla i event-loggen om regeln redan kört för den ticken
 *   4. Om inte → tryClaim och kör regeln
 *
 * I server-läget kör en singel scheduler-instans (vi kallar `tick()` från
 * en setInterval i en lång-körande process eller från en extern cron som
 * triggar `/api/r/_/scheduler-tick`).
 *
 * I local-first-läget kör varje klients tick. Claim-mekanismen säkrar att
 * exakt en exekverar varje tick.
 *
 * Inga setInterval startas från denna fil — orkestrering är extern.
 */

import { CronExpressionParser } from "cron-parser";
import type { IDataStore } from "../data-store/IDataStore";
import type { AvaEvent } from "../events/schema";
import { uuidv7 } from "../events/uuid7";
import { executeRule, type StepHandlers } from "./execute";
import type { AvaRule } from "./schema";

export interface SchedulerDeps {
  rules: AvaRule[];
  dataStore: IDataStore;
  handlers: StepHandlers;
  /** Returnera de tick-keys vi redan har kört för. */
  alreadyRan: (idempotencyKey: string) => Promise<boolean>;
  /** Hur långt bakåt vi kollar för missade ticks. Default 1 timme. */
  lookbackMs?: number;
}

/**
 * Beräkna alla "ticks" som infaller mellan `from` och `to` enligt cron-uttrycket.
 *
 * @param cron — t.ex. "0 9 * * 1-5"
 * @param timezone — t.ex. "Europe/Stockholm"
 */
export function expandTicks(cron: string, from: Date, to: Date, timezone = "Europe/Stockholm"): Date[] {
  const expr = CronExpressionParser.parse(cron, { currentDate: from, endDate: to, tz: timezone });
  const ticks: Date[] = [];
  while (true) {
    try {
      const next = expr.next();
      const d = next.toDate();
      if (d > to) break;
      ticks.push(d);
    } catch {
      break;
    }
  }
  return ticks;
}

/** Bygg idempotency-key från regel + tick-timestamp. */
export function idempotencyKey(ruleId: string, tick: Date): string {
  return `schedule:${ruleId}@${tick.toISOString()}`;
}

/**
 * Kör en tick — för varje schemalagd regel, hitta ticks sedan senaste
 * lookback och exekvera de som inte redan körts.
 */
export async function runScheduledTick(deps: SchedulerDeps, now: Date = new Date()): Promise<{
  rulesChecked: number;
  ticksFound: number;
  ticksExecuted: number;
  ticksSkipped: number;
}> {
  const lookback = deps.lookbackMs ?? 3600_000;
  const from = new Date(now.getTime() - lookback);
  let ticksFound = 0;
  let ticksExecuted = 0;
  let ticksSkipped = 0;
  let rulesChecked = 0;

  const scheduled = deps.rules.filter((r) => r.trigger.kind === "schedule");
  for (const rule of scheduled) {
    if (rule.trigger.kind !== "schedule") continue; // narrow
    rulesChecked++;
    const ticks = expandTicks(rule.trigger.cron, from, now, rule.trigger.timezone);
    for (const tick of ticks) {
      ticksFound++;
      const key = idempotencyKey(rule.id, tick);
      if (await deps.alreadyRan(key)) { ticksSkipped++; continue; }

      const event: AvaEvent = {
        id: uuidv7(),
        ts: tick.toISOString(),
        type: "system.heartbeat",
        source: "schedule",
        actor: { kind: "system", id: "scheduler" },
        payload: { ruleId: rule.id, scheduledFor: tick.toISOString(), idempotencyKey: key },
      };

      // Logga själva tick-eventet så vi har en idempotency-key i loggen
      // som senare `alreadyRan` kan se.
      await deps.dataStore.events.emit(event).catch((e) => {
        console.error("[scheduler] kunde inte logga tick-event:", e);
      });

      await executeRule({ rule, event, dataStore: deps.dataStore, handlers: deps.handlers });
      ticksExecuted++;
    }
  }

  return { rulesChecked, ticksFound, ticksExecuted, ticksSkipped };
}

/**
 * Bygg en `alreadyRan` som kollar event-loggen efter `system.heartbeat`-events
 * med matchande idempotencyKey i payloaden.
 */
export function alreadyRanFromEventLog(dataStore: IDataStore) {
  return async (idempotencyKey: string): Promise<boolean> => {
    const events = await dataStore.events.query({
      type: "system.heartbeat",
      limit: 1000,
    });
    return events.some((e) => e.payload.idempotencyKey === idempotencyKey);
  };
}
