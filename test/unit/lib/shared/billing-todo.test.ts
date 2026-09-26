/**
 * Faktureringens "måste göras"-predikat (#1221) — delas av panelen och
 * Att bevaka-signalen `billingAction`.
 */
import { describe, expect, it } from "vitest-compat";
import {
  hasSjalvriskAconto, insurerPruningPending, isActiveKr, isUnsentInvoice, krAwaitingBeslut,
  paymentMethodPending, rattshjalpSjalvriskOre, sjalvriskAccontoDue, type TodoRun,
} from "@/lib/shared/billing-todo";
import { timkostnadsnormFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { asId } from "@/lib/shared/schemas/ids";

const kr = (kostnadsrakningStatus: TodoRun["kostnadsrakningStatus"], extra: Partial<TodoRun> = {}): TodoRun => ({
  type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL", kostnadsrakningStatus, ...extra,
});

describe("paymentMethodPending", () => {
  it("PENDING eller saknat betalningssätt → väntar", () => {
    expect(paymentMethodPending("PENDING")).toBe(true);
    expect(paymentMethodPending(null)).toBe(true);
    expect(paymentMethodPending(undefined)).toBe(true);
    expect(paymentMethodPending("PRIVAT")).toBe(false);
  });
});

describe("isActiveKr / krAwaitingBeslut", () => {
  it("inskickad → tingsrättens beslut väntar", () => {
    expect(isActiveKr(kr("INSKICKAD"))).toBe(true);
    expect(krAwaitingBeslut([kr("INSKICKAD")])).toBe("TINGSRATT");
  });

  it("överklagad → hovrättens beslut väntar", () => {
    expect(krAwaitingBeslut([kr("OVERKLAGAD")])).toBe("HOVRATT");
  });

  it("beslutad → inget beslut väntar (nästa steg är fakturan)", () => {
    expect(krAwaitingBeslut([kr("BESLUTAD")])).toBeNull();
  });

  it("ångrad, fakturerad eller statuslös KR är inte aktiv", () => {
    expect(isActiveKr(kr("INSKICKAD", { status: "VOIDED" }))).toBe(false);
    expect(isActiveKr(kr("FAKTURERAD"))).toBe(false);
    expect(isActiveKr(kr(null))).toBe(false);
    expect(krAwaitingBeslut([])).toBeNull();
  });
});

describe("självrisk-aconto", () => {
  const aconto: TodoRun = { type: "ACCONTO", status: "SENT", recipient: "KLIENT" };

  it("rättshjälp, över tröskeln, inget aconto → dags", () => {
    expect(sjalvriskAccontoDue({ method: "RATTSHJALP", clientOre: 150_000, thresholdOre: 150_000, runs: [] })).toBe(true);
  });

  it("under tröskeln, redan aconto eller annat betalningssätt → inte", () => {
    expect(sjalvriskAccontoDue({ method: "RATTSHJALP", clientOre: 149_999, thresholdOre: 150_000, runs: [] })).toBe(false);
    expect(hasSjalvriskAconto([aconto])).toBe(true);
    expect(sjalvriskAccontoDue({ method: "RATTSHJALP", clientOre: 999_999, thresholdOre: 150_000, runs: [aconto] })).toBe(false);
    expect(sjalvriskAccontoDue({ method: "PRIVAT", clientOre: 999_999, thresholdOre: 150_000, runs: [] })).toBe(false);
  });
});

describe("insurerPruningPending", () => {
  const payer: TodoRun = { type: "FINAL", status: "SENT", recipient: "FORSAKRING" };

  it("rättsskydd med obetald försäkringsfaktura och ingen prutning → väntar", () => {
    expect(insurerPruningPending("RATTSSKYDD", [payer])).toBe(true);
    expect(insurerPruningPending("RATTSSKYDD", [{ ...payer, invoice: { status: "SENT" } }])).toBe(true);
  });

  it("registrerad prutning, betald faktura, ingen försäkringsfaktura eller annat betalningssätt → inte", () => {
    expect(insurerPruningPending("RATTSSKYDD", [{ ...payer, prutningOre: -100 }])).toBe(false);
    expect(insurerPruningPending("RATTSSKYDD", [{ ...payer, invoice: { status: "PAID" } }])).toBe(false);
    expect(insurerPruningPending("RATTSSKYDD", [])).toBe(false);
    expect(insurerPruningPending("PRIVAT", [payer])).toBe(false);
  });
});

describe("isUnsentInvoice", () => {
  it("bara Skapad (DRAFT) räknas som oskickad", () => {
    expect(isUnsentInvoice({ status: "DRAFT" })).toBe(true);
    expect(isUnsentInvoice({ status: "SENT" })).toBe(false);
  });
});

describe("rattshjalpSjalvriskOre", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const norm = timkostnadsnormFtaxForDate(now);
  const entry = (minutes: number, extra: Record<string, unknown> = {}) => ({
    minutes, hourlyRate: 0, billable: true, date: now, kind: "ARBETE" as const, ...extra,
  });

  it("ofryst arbete på normen × klientens andel; låsta poster ingår inte", () => {
    const entries = [entry(120), entry(60, { frozenAt: now })];
    expect(rattshjalpSjalvriskOre(entries, [], 2500, now)).toBe(Math.round((2 * norm * 2500) / 10000));
  });

  it("väntar en kostnadsräkning på dom räknas dess frysta poster", () => {
    const krId = asId<"BillingRunId">("kr-1");
    const entries = [entry(60, { frozenAt: now, frozenByBillingRunId: krId }), entry(600)];
    const runs: TodoRun[] = [{ id: krId, type: "KOSTNADSRAKNING", status: "PENDING_VERDICT", recipient: "DOMSTOL" }];
    expect(rattshjalpSjalvriskOre(entries, runs, 10000, now)).toBe(norm);
  });
});
