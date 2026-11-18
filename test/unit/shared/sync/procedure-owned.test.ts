/**
 * Procedurägda entiteter (#1242) — rader som bara procedurkön skriver.
 *
 * Listan står på ett ställe. Att den stämmer med de andra synkregistren
 * (radvägen, procedurkön, konfliktpolicyn) prövas i
 * `test/unit/server/sync/sync-registry-coverage.test.ts` (#1678).
 */
import { describe, expect, it } from "vitest-compat";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { isProcedureOwned, PROCEDURE_OWNED_ENTITIES, PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";

describe("procedurägda entiteter", () => {
  it("ärenden, tid, utlägg och faktureringen är procedurägda; ren data är det inte", () => {
    for (const e of ["matter", "timeEntry", "expense", "invoice", "billingRun", "payment", "paymentPlanReminder", "invoiceDispatch"]) {
      expect(isProcedureOwned(e)).toBe(true);
    }
    for (const e of ["contact", "matterContact", "task", "calendarEvent", "document", "documentFolder"]) expect(isProcedureOwned(e)).toBe(false);
  });

  it("varje procedurägd entitet finns i ENTITY_REGISTRY", () => {
    const known = new Set(Object.keys(ENTITY_REGISTRY));
    expect([...PROCEDURE_OWNED_ENTITIES].filter((e) => !known.has(e))).toEqual([]);
  });

  it("beskedet säger vad användaren ska göra", () => {
    expect(PROCEDURE_OWNED_REASON).toMatch(/Gör om den i appen/);
  });
});
