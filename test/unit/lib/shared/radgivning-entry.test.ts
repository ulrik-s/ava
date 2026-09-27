/**
 * Rådgivningspostens regel (#1207) — när ett rättshjälpsärende saknar den
 * låsta rådgivningsposten och vilken post som får markeras som den.
 */
import { describe, expect, it } from "vitest-compat";
import {
  RADGIVNING_INVOICE_NOTES,
  entryMarkBlocker,
  findRadgivningInvoiceId,
  hasRadgivningEntry,
  markTarget,
  needsRadgivningEntry,
  radgivningEntryStatus,
  splitRadgivningMinutes,
} from "@/lib/shared/radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";

const INV = asId<"InvoiceId">("inv-r");
const RUN = asId<"BillingRunId">("run-1");
const RATTSHJALP = { paymentMethod: "RATTSHJALP" as const, radgivningBetaldAt: "2026-03-01" };

describe("findRadgivningInvoiceId", () => {
  it("hittar fakturan på noteringen, oavsett typ (ACCONTO före #853)", () => {
    expect(findRadgivningInvoiceId([
      { id: asId<"InvoiceId">("a"), notes: "Annat", invoiceType: "STANDARD" },
      { id: INV, notes: RADGIVNING_INVOICE_NOTES, invoiceType: "ACCONTO" },
    ])).toBe(INV);
  });
  it("aldrig en kreditnota, och null när ingen finns", () => {
    expect(findRadgivningInvoiceId([{ id: INV, notes: RADGIVNING_INVOICE_NOTES, invoiceType: "CREDIT" }])).toBeNull();
    expect(findRadgivningInvoiceId([])).toBeNull();
  });
});

describe("hasRadgivningEntry", () => {
  it("varje post kopplad till rådgivningsfakturan räknas — även fryst av en körning (#1235)", () => {
    expect(hasRadgivningEntry([{ frozenAt: new Date() }])).toBe(true);
    expect(hasRadgivningEntry([{ frozenAt: new Date(), frozenByBillingRunId: RUN }])).toBe(true);
    expect(hasRadgivningEntry([{}])).toBe(true);
    expect(hasRadgivningEntry([])).toBe(false);
  });
});

describe("radgivningEntryStatus + needsRadgivningEntry", () => {
  it("inte rättshjälp eller ingen rådgivning → not-applicable", () => {
    expect(radgivningEntryStatus({ paymentMethod: "PRIVAT", radgivningBetaldAt: "2026-03-01" }, INV, [])).toEqual({ kind: "not-applicable" });
    expect(radgivningEntryStatus({ paymentMethod: "RATTSHJALP" }, INV, [])).toEqual({ kind: "not-applicable" });
  });
  it("rådgivning men fakturan hittas inte → no-invoice", () => {
    expect(radgivningEntryStatus(RATTSHJALP, null, [])).toEqual({ kind: "no-invoice" });
  });
  it("ingen post kopplad till fakturan → missing (behöver post)", () => {
    const s = radgivningEntryStatus(RATTSHJALP, INV, []);
    expect(s).toEqual({ kind: "missing", invoiceId: INV });
    expect(needsRadgivningEntry(s)).toBe(true);
  });
  it("fakturan med låst post → present", () => {
    const s = radgivningEntryStatus(RATTSHJALP, INV, [{ frozenAt: "2026-03-01" }]);
    expect(s).toEqual({ kind: "present", invoiceId: INV });
    expect(needsRadgivningEntry(s)).toBe(false);
  });
  it("prod-formen (#1235): ej debiterbart möte fryst av KR-körningen — saknas utan koppling, finns med", () => {
    const mote = { billable: false, frozenAt: "2026-05-01", frozenByBillingRunId: RUN };
    expect(radgivningEntryStatus(RATTSHJALP, INV, [])).toEqual({ kind: "missing", invoiceId: INV });
    expect(entryMarkBlocker(mote)).toBeNull();
    expect(radgivningEntryStatus(RATTSHJALP, INV, [mote])).toEqual({ kind: "present", invoiceId: INV });
  });
});

describe("markTarget", () => {
  it("missing → fakturan att låsa mot", () => {
    expect(markTarget({ kind: "missing", invoiceId: INV })).toEqual({ ok: true, invoiceId: INV });
  });
  it("övriga lägen → skäl på svenska", () => {
    expect(markTarget({ kind: "not-applicable" })).toEqual({ ok: false, reason: expect.stringContaining("rättshjälpsärende") });
    expect(markTarget({ kind: "no-invoice" })).toEqual({ ok: false, reason: expect.stringContaining("hittades inte") });
    expect(markTarget({ kind: "present", invoiceId: INV })).toEqual({ ok: false, reason: expect.stringContaining("redan en låst") });
  });
});

describe("entryMarkBlocker", () => {
  it("olåst tid får markeras — debiterbar eller ej (#1235)", () => {
    expect(entryMarkBlocker({ billable: true, kind: "ARBETE" })).toBeNull();
    expect(entryMarkBlocker({ billable: true })).toBeNull();
    expect(entryMarkBlocker({ billable: false })).toBeNull();
  });
  it("ej debiterbar tid fryst av en körning får markeras — den yrkas inte (#1235)", () => {
    expect(entryMarkBlocker({ billable: false, frozenAt: new Date(), frozenByBillingRunId: RUN })).toBeNull();
  });
  it("debiterbar tid fryst av en körning avvisas — den ingår i det yrkade beloppet", () => {
    expect(entryMarkBlocker({ billable: true, frozenAt: new Date(), frozenByBillingRunId: RUN })).toContain("redan låst");
    expect(entryMarkBlocker({ billable: true, frozenByBillingRunId: RUN })).toContain("redan låst");
  });
  it("låst direkt mot en faktura avvisas oavsett debiterbar", () => {
    expect(entryMarkBlocker({ billable: true, frozenAt: new Date() })).toContain("redan låst");
    expect(entryMarkBlocker({ billable: false, frozenAt: new Date() })).toContain("redan låst");
  });
  it("beredskap avvisas", () => {
    expect(entryMarkBlocker({ billable: true, kind: "ADVOKATBEREDSKAP" })).toContain("beredskap");
  });
});

describe("splitRadgivningMinutes", () => {
  it("≤ 60 min låses helt", () => {
    expect(splitRadgivningMinutes(45)).toEqual({ locked: 45, rest: 0 });
    expect(splitRadgivningMinutes(60)).toEqual({ locked: 60, rest: 0 });
  });
  it("> 60 min delas: exakt en timme låses", () => {
    expect(splitRadgivningMinutes(150)).toEqual({ locked: 60, rest: 90 });
  });
});
