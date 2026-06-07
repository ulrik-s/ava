/**
 * `schema-migrations` — migrate-on-read (ADR 0004). Testen lockar fast den
 * första migrationen (invoice v1→v2: stripa legacy-`type`), kedjningen och
 * de defensiva fallen i sträng-wrappern.
 */
import { describe, it, expect } from "vitest";
import { migrateRow, migrateRawJson, migrateEventPayload } from "@/lib/shared/schema-migrations";
import { CURRENT_SCHEMA_VERSION } from "@/lib/shared/schema-version";

describe("migrateRow — invoice v1→v2 (stripa legacy `type`)", () => {
  const v1Invoice = { id: "inv-1", invoiceType: "STANDARD", type: "FINAL", status: "PAID" };

  it("tar bort `type` men behåller övriga fält", () => {
    const out = migrateRow("invoice", v1Invoice, 1, 2);
    expect(out).not.toHaveProperty("type");
    expect(out).toMatchObject({ id: "inv-1", invoiceType: "STANDARD", status: "PAID" });
  });

  it("kedjar v1 → CURRENT (default toVersion)", () => {
    expect(migrateRow("invoice", v1Invoice, 1)).not.toHaveProperty("type");
  });

  it("no-op när raden redan är aktuell (from === to)", () => {
    const v2 = { id: "inv-1", invoiceType: "STANDARD" };
    expect(migrateRow("invoice", v2, 2, 2)).toBe(v2);
  });

  it("rör inte en redan migrerad rad utan `type`", () => {
    const v2 = { id: "inv-1", invoiceType: "FINAL" };
    expect(migrateRow("invoice", v2, 1, 2)).toEqual(v2);
  });

  it("identitet för entiteter utan migration", () => {
    const row = { id: "m1", title: "X" };
    expect(migrateRow("matter", row, 1, 2)).toBe(row);
  });
});

describe("migrateRawJson — sträng-wrapper", () => {
  it("migrerar ett objekt och re-serialiserar", () => {
    const out = JSON.parse(migrateRawJson("invoice", JSON.stringify({ id: "i", type: "FINAL", invoiceType: "STANDARD" }), 1, 2));
    expect(out).not.toHaveProperty("type");
    expect(out.invoiceType).toBe("STANDARD");
  });

  it("returnerar trasig JSON oförändrad (deserialize får kasta som förr)", () => {
    expect(migrateRawJson("invoice", "{ trasig", 1, 2)).toBe("{ trasig");
  });

  it("returnerar icke-objekt (array/scalar) oförändrat", () => {
    expect(migrateRawJson("invoice", "[1,2,3]", 1, 2)).toBe("[1,2,3]");
    expect(migrateRawJson("invoice", "42", 1, 2)).toBe("42");
  });

  it("no-op när from >= to (rör inte strängen)", () => {
    const raw = JSON.stringify({ id: "i", type: "FINAL" });
    expect(migrateRawJson("invoice", raw, 2, 2)).toBe(raw);
    expect(migrateRawJson("invoice", raw, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)).toBe(raw);
  });
});

describe("migrateEventPayload — event-payloads (#58)", () => {
  it("invoice.created v1→v2: renamear `type` → `invoiceType`, behåller övrigt", () => {
    const out = migrateEventPayload("invoice.created", { invoiceId: "i", type: "FINAL", amount: 1000 }, 1, 2);
    expect(out).toMatchObject({ invoiceId: "i", invoiceType: "FINAL", amount: 1000 });
    expect(out).not.toHaveProperty("type");
  });

  it("invoice.sent omfattas av samma migration", () => {
    expect(migrateEventPayload("invoice.sent", { type: "ACCONTO" }, 1, 2).invoiceType).toBe("ACCONTO");
  });

  it("no-op när invoiceType redan finns", () => {
    const p = { invoiceType: "STANDARD", type: "FINAL" };
    expect(migrateEventPayload("invoice.created", p, 1, 2)).toBe(p);
  });

  it("identitet för event-typ utan migration", () => {
    const p = { matterNumber: "2026-0001" };
    expect(migrateEventPayload("matter.created", p, 1, 2)).toBe(p);
  });

  it("no-op när from === to", () => {
    const p = { type: "FINAL" };
    expect(migrateEventPayload("invoice.created", p, 2, 2)).toBe(p);
  });
});
