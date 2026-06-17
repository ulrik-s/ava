/**
 * `entity-source-keys` (#415) — en sanningskälla för plural↔singular-mappningen
 * som LocalStore.entityNameFor + reconcile-apply delar.
 */

import { describe, it, expect } from "vitest-compat";
import {
  ENTITY_NAME_BY_SOURCE_KEY,
  SOURCE_KEY_BY_ENTITY,
} from "@/lib/server/data-store/in-memory/entity-source-keys";

describe("entity-source-keys", () => {
  it("SOURCE_KEY_BY_ENTITY är en exakt invers", () => {
    for (const [sourceKey, entity] of Object.entries(ENTITY_NAME_BY_SOURCE_KEY)) {
      expect(SOURCE_KEY_BY_ENTITY[entity]).toBe(sourceKey);
    }
    expect(Object.keys(SOURCE_KEY_BY_ENTITY)).toHaveLength(Object.keys(ENTITY_NAME_BY_SOURCE_KEY).length);
  });

  it("mappar kända entiteter (singular → plural)", () => {
    expect(SOURCE_KEY_BY_ENTITY.matter).toBe("matters");
    expect(SOURCE_KEY_BY_ENTITY.invoice).toBe("invoices");
    expect(SOURCE_KEY_BY_ENTITY.timeEntry).toBe("timeEntries");
    expect(SOURCE_KEY_BY_ENTITY.paymentPlanReminder).toBe("paymentPlanReminders");
  });
});
