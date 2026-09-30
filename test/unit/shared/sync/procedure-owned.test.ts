/**
 * Procedurägda entiteter (#1242) — rader som bara procedurkön skriver.
 *
 * Listan står på ett ställe. Testerna håller den i takt med registren: varje
 * entitet finns i ENTITY_REGISTRY, och varje entitet en köbar procedur skriver
 * är procedurägd (utom dokumentet — dess metadata är ren data, och
 * `document.analyze` köas för att klassningen är en serversidoeffekt).
 */
import { describe, expect, it } from "vitest-compat";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";
import { isProcedureOwned, PROCEDURE_OWNED_ENTITIES, PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";
import { QUEUED_PROCEDURES } from "@/lib/shared/sync/queued-procedures";

/** Köbara procedurer vars entitet är ren data (körs i procedurkön av andra skäl). */
const QUEUED_ON_ROW_DATA: ReadonlySet<string> = new Set(["document"]);

describe("procedurägda entiteter", () => {
  it("tid, utlägg och faktureringen är procedurägda; ren data är det inte", () => {
    for (const e of ["timeEntry", "expense", "invoice", "billingRun", "payment", "paymentPlanReminder", "invoiceDispatch"]) {
      expect(isProcedureOwned(e)).toBe(true);
    }
    for (const e of ["contact", "task", "calendarEvent", "document", "matter"]) expect(isProcedureOwned(e)).toBe(false);
  });

  it("varje procedurägd entitet finns i ENTITY_REGISTRY", () => {
    const known = new Set(Object.keys(ENTITY_REGISTRY));
    expect([...PROCEDURE_OWNED_ENTITIES].filter((e) => !known.has(e))).toEqual([]);
  });

  it("varje entitet en köbar procedur skriver är procedurägd", () => {
    const entities = new Set(Object.values(QUEUED_PROCEDURES).map((spec) => spec.entity));
    const loose = [...entities].filter((e) => !isProcedureOwned(e) && !QUEUED_ON_ROW_DATA.has(e));
    expect(loose).toEqual([]);
  });

  it("beskedet säger vad användaren ska göra", () => {
    expect(PROCEDURE_OWNED_REASON).toMatch(/Gör om den i appen/);
  });
});
