/**
 * Avgör vilka regler som triggas av ett event.
 *
 * Filtrerar i två steg:
 *   1. `trigger.kind === "event"` + `trigger.type === event.type`
 *   2. Om `trigger.predicate` finns: utvärdera JsonLogic mot event-data
 */

import jsonLogic from "json-logic-js";
import type { AvaRule } from "./schema";
import type { AvaEvent } from "../events/schema";

export function matchEventTriggers(rules: AvaRule[], event: AvaEvent): AvaRule[] {
  return rules.filter((rule) => {
    if (rule.trigger.kind !== "event") return false;
    if (rule.trigger.type !== event.type) return false;
    if (!rule.trigger.predicate) return true;
    try {
      return !!jsonLogic.apply(rule.trigger.predicate as never, {
        event,
        payload: event.payload,
        actor: event.actor,
      });
    } catch {
      return false;
    }
  });
}

/** För HTTP-triggers: hitta första matchande regel. */
export function matchHttpTrigger(rules: AvaRule[], method: "GET" | "POST", path: string): AvaRule | null {
  return (
    rules.find(
      (rule) =>
        rule.trigger.kind === "http" &&
        rule.trigger.method === method &&
        rule.trigger.path === path,
    ) ?? null
  );
}
