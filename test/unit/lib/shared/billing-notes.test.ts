/**
 * Faktureringshändelsernas anteckningstexter (#1221) — korta, sakliga, med
 * dokumentnummer och belopp.
 */
import { describe, expect, it } from "vitest-compat";
import {
  beslutRegisteredNote, creditCreatedNote, invoiceCreatedNote, invoiceQueuedNote, invoiceSentNote, invoiceStatusNote,
  insurerPruningNote, kostnadsrakningSubmittedNote, krAppealedNote, krVoidedNote, noteTimestamp,
  paymentMethodNote, radgivningInvoicedNote, rattsskyddNekadNote, settledNote,
} from "@/lib/shared/billing-notes";
import { formatKr } from "@/lib/shared/format-kr";

/** Intl sv-SE använder hårda mellanslag — jämför på normaliserad text. */
const norm = (s: string): string => s.replace(/\s/g, " ");

describe("formatKr", () => {
  it("öre → svenska kronor med två decimaler", () => {
    expect(norm(formatKr(123_450))).toBe("1 234,50 kr");
  });
});

describe("noteTimestamp", () => {
  it("datum + klockslag i svensk tid, även när UTC-dagen är en annan", () => {
    // 22:30 UTC den 24/9 = 00:30 svensk sommartid den 25/9.
    expect(noteTimestamp(new Date("2026-09-24T22:30:00Z"))).toEqual({ date: "2026-09-25", time: "00:30" });
  });
});

describe("anteckningstexter", () => {
  it("rådgivningstimmen", () => {
    expect(norm(radgivningInvoicedNote("F-2026-0001", 203_250))).toBe("Rådgivningstimme fakturerad klienten — faktura F-2026-0001, 2 032,50 kr");
  });

  it("faktura skapad: typen som etikett, eller en egen beskrivning", () => {
    expect(norm(invoiceCreatedNote("F-2026-0002", "ACCONTO", 100_000))).toBe("Faktura F-2026-0002 skapad (aconto, 1 000,00 kr)");
    expect(norm(invoiceCreatedNote(null, "FINAL", 100, "kostnadsräkning till domstol"))).toBe("Faktura (utan nummer) skapad (kostnadsräkning till domstol, 1,00 kr)");
  });

  it("kreditfaktura: nummer, (negativt) belopp och krediterad faktura; saknat nummer (#1225)", () => {
    expect(norm(creditCreatedNote("F-2026-0003", -100_000, "F-2026-0002"))).toBe("Kreditfaktura F-2026-0003 skapad (−1 000,00 kr) — krediterar faktura F-2026-0002");
    expect(norm(creditCreatedNote(null, -100, undefined))).toBe("Kreditfaktura (utan nummer) skapad (−1,00 kr) — krediterar faktura (utan nummer)");
  });

  it("kostnadsräkning skickad: med referens och domstol, annars generiskt", () => {
    expect(norm(kostnadsrakningSubmittedNote("KR-2026-0001", "Stockholms tingsrätt", 500_000))).toBe("Kostnadsräkning KR-2026-0001 skickad till Stockholms tingsrätt — 5 000,00 kr");
    expect(norm(kostnadsrakningSubmittedNote(null, null, 100))).toBe("Kostnadsräkning skickad till domstolen — 1,00 kr");
  });

  it("beslut: tingsrätt utan prutning, hovrätt med prutning", () => {
    expect(norm(beslutRegisteredNote({ hovratt: false, awardedOre: 400_000, claimedOre: 500_000, prutningOre: null })))
      .toBe("Beslut registrerat: dömt belopp 4 000,00 kr (yrkat 5 000,00 kr)");
    expect(norm(beslutRegisteredNote({ hovratt: true, awardedOre: 450_000, claimedOre: 500_000, prutningOre: -50_000 })))
      .toBe("Hovrättens beslut registrerat: dömt belopp 4 500,00 kr (yrkat 5 000,00 kr), prutning 500,00 kr");
  });

  it("överklagande och ångrad kostnadsräkning", () => {
    expect(krAppealedNote("KR-2026-0001")).toBe("Beslutet om kostnadsräkning KR-2026-0001 överklagat till hovrätten");
    expect(krAppealedNote(null)).toBe("Beslutet om kostnadsräkning överklagat till hovrätten");
    expect(krVoidedNote("KR-2026-0001")).toBe("Kostnadsräkning KR-2026-0001 ångrad — tidposter och utlägg upplåsta");
    expect(krVoidedNote(undefined)).toBe("Kostnadsräkning ångrad — tidposter och utlägg upplåsta");
  });

  it("slutreglering: faktura eller kreditfaktura till klienten + betalarens faktura", () => {
    const payer = { invoiceNumber: "F-2", amountOre: 800_000, recipientLabel: "Försäkringsbolag" };
    expect(norm(settledNote({ client: { invoiceNumber: "F-1", amountOre: 200_000, credit: false }, payer })))
      .toBe("Ärendet slutreglerat — faktura F-1 till klienten (2 000,00 kr), faktura F-2 till försäkringsbolag (8 000,00 kr)");
    expect(settledNote({ client: { invoiceNumber: "F-1", amountOre: -100, credit: true }, payer })).toContain("kreditfaktura F-1");
  });

  it("försäkringens prutning", () => {
    expect(norm(insurerPruningNote(100_000, "F-1"))).toBe("Försäkringsbolagets prutning registrerad: 1 000,00 kr exkl moms flyttat till klientens faktura F-1");
  });

  it("utskick och manuell status", () => {
    expect(invoiceSentNote("F-1", "anna@klient.se")).toBe("Faktura F-1 skickad till anna@klient.se");
    expect(invoiceQueuedNote("F-1", "anna@klient.se")).toBe("Faktura F-1 köad för utskick till anna@klient.se");
    expect(invoiceStatusNote("F-1", "SENT")).toBe("Faktura F-1 markerad som skickad");
    expect(invoiceStatusNote("F-1", "BAD_DEBT")).toBe("Faktura F-1 markerad som kundförlust");
  });

  it("betalningssätt och nekat rättsskydd", () => {
    expect(paymentMethodNote("RATTSHJALP")).toBe("Betalningssätt: Rättshjälp");
    expect(rattsskyddNekadNote("2026-02-01")).toBe("Rättsskydd nekat (2026-02-01)");
  });
});
