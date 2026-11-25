import { describe, it, expect } from "vitest-compat";
import {
  invoicesToSie,
  countExportable,
  DEFAULT_BAS_ACCOUNT_MAP,
  type ExportableInvoice,
} from "@/lib/shared/accounting/sie-from-invoices";

const company = { name: "Advokatbyrå AB", orgNr: "5566778899" };

const inv = (over: Partial<ExportableInvoice> = {}): ExportableInvoice => ({
  amount: 12_500,
  invoiceDate: "2026-05-25",
  invoiceNumber: "F-2026-0042",
  status: "SENT",
  ...over,
});

const lines = (sie: string) => sie.split("\r\n");

describe("countExportable", () => {
  it("räknar utställda fakturor, kundförlust inräknad (#1676)", () => {
    const rows = [inv(), inv({ status: "PAID" }), inv({ status: "BAD_DEBT" }), inv({ status: "INSTALLMENT_PLAN" }), inv({ status: "DRAFT" }), inv({ status: "CANCELLED" })];
    expect(countExportable(rows)).toBe(4);
  });
});

describe("kundförlust i SIE (#1676)", () => {
  it("en kundförlust bokförs som i Fortnox-flödet (ADR 0007)", () => {
    const sie = invoicesToSie([inv({ status: "BAD_DEBT" })], { company, generatedDate: "20260612" });
    expect(sie).toContain('#VER "A" "20260042" 20260525 "Faktura F-2026-0042"');
  });
});

describe("moms på en sats utan momskonto i SIE (#1902)", () => {
  const bad = { amount: 10_100, vatBreakdown: [{ kind: "utlagg" as const, vatRate: 0, netOre: 10_000, vatOre: 100 }] };

  it("en utställd felaktig faktura kastar med fakturanumret i texten", () => {
    expect(() => invoicesToSie([inv(), inv({ ...bad, invoiceNumber: "F-2026-0043" })], { company, generatedDate: "20260612" }))
      .toThrow("Faktura F-2026-0043: en rad i momsuppdelningen har 1,00 kr moms på satsen 0 %");
  });

  it("ett felaktigt utkast stoppar inte exporten", () => {
    const sie = invoicesToSie([inv(), inv({ ...bad, status: "DRAFT", invoiceNumber: "F-2026-0043" })], { company, generatedDate: "20260612" });
    expect(sie).toContain('#VER "A" "20260042"');
    expect(sie.includes("F-2026-0043")).toBe(false);
  });
});

describe("invoicesToSie", () => {
  it("renderar utfärdade fakturor med BAS-default-konton + #GEN", () => {
    const sie = invoicesToSie([inv()], { company, generatedDate: "20260612" });
    expect(sie).toContain("#GEN 20260612");
    expect(sie).toContain('#FNAMN "Advokatbyrå AB"');
    expect(sie).toContain("#ORGNR 5566778899");
    expect(sie).toContain('#KONTO 1510 "Kundfordringar"');
    // Verifikatnr ur fakturanumrets siffror
    expect(sie).toContain('#VER "A" "20260042" 20260525 "Faktura F-2026-0042"');
    expect(sie).toContain("#TRANS 1510 {} 125.00");
  });

  it("hoppar över ej utfärdade fakturor (DRAFT/CANCELLED)", () => {
    const sie = invoicesToSie([inv({ status: "DRAFT" }), inv({ status: "CANCELLED" })], {
      company,
      generatedDate: "20260612",
    });
    expect(sie.includes("#VER")).toBe(false);
  });

  it("faller tillbaka på löpande verifikatnr när fakturanummer saknas", () => {
    const sie = invoicesToSie([inv({ invoiceNumber: null })], { company, generatedDate: "20260612" });
    expect(sie).toContain('#VER "A" "1"');
  });

  it("kreditfaktura (negativt belopp) renderas med vänd debet/kredit", () => {
    const sie = lines(invoicesToSie([inv({ amount: -12_500, invoiceNumber: "K-1" })], { company, generatedDate: "20260612" }));
    // kundfordran krediteras → negativt belopp på 1510
    expect(sie).toContain("   #TRANS 1510 {} -125.00");
  });

  it("DEFAULT_BAS_ACCOUNT_MAP täcker alla roller inkl. per-sats moms (#790)", () => {
    expect(Object.keys(DEFAULT_BAS_ACCOUNT_MAP).sort()).toEqual(
      ["bank", "intaktArvode", "intaktUtlagg", "kundfordran", "momsUtgaende", "momsUtgaende06", "momsUtgaende12"].sort(),
    );
  });
});
