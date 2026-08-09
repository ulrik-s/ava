/**
 * Momsen på utlägg som biträdet debiterar vidare (#975).
 *
 * ## Regeln
 *
 * NJA 2005 s. 606: ett rättsligt biträde som är skyldigt att redovisa
 * mervärdesskatt ska lägga **25 %** på samtliga kostnadselement som ingår i
 * utförandet av tjänsten. Resa, hotell och liknande är omkostnader i byråns egen
 * verksamhet — inte ett momsfritt genomflöde — och ingår därför i byråns
 * skattepliktiga omsättning.
 *
 * Domstolsverkets praxis ger mekaniken i två steg:
 *
 *   1. Räkna AV den ingående moms byrån själv betalade (den lyfts som avdrag).
 *   2. Debitera 25 % på det som blir kvar.
 *
 * En tågbiljett för 1 060 kr inkl. 6 % moms blir alltså 1 000 kr netto som
 * debiteras med 250 kr moms — inte 60 kr.
 *
 * ## Undantaget
 *
 * **Äkta utlägg** — fakturan är ställd direkt till klienten och byrån har bara
 * förmedlat betalningen — vidarefaktureras utan moms. Det är undantaget, inte
 * huvudregeln, och kräver att någon aktivt intygar det. Därför är `passThrough`
 * default `false`: ett utlägg är ett kostnadselement tills motsatsen är sagd.
 *
 * ## Varför modulen finns
 *
 * Logiken låg förr i `billingRun.ts` som `courtExpenseLines` och tillämpades BARA
 * när betalaren var en domstol (#945). Men regeln följer biträdets omsättning,
 * inte vem som betalar — klientens och försäkringens fakturor ska hanteras
 * likadant. I demons data gav den avgränsningen 782,80 kr för lite utgående moms.
 */

import type { VatBreakdownLine } from "@/lib/shared/accounting/semantic-voucher";
import { splitVat } from "@/lib/shared/vat";

/** Satsen biträdet debiterar vidare med, oavsett vad byrån själv betalade. */
export const CHARGED_EXPENSE_VAT_RATE = 2500;

/** Det som behövs för att momsberäkna ett utlägg. */
export interface ChargeableExpense {
  /** Belopp i öre — netto om `vatIncluded` är falskt (default sedan #782). */
  amount: number;
  /** Momssatsen BYRÅN BETALADE (basis points). Styr avräkningen i steg 1. */
  vatRate?: number | null | undefined;
  vatIncluded?: boolean | null | undefined;
  /** Äkta utlägg — faktura ställd till klienten. Vidarefaktureras utan moms. */
  passThrough?: boolean | null | undefined;
}

/** Är utlägget ett äkta utlägg (vidarefaktureras utan moms)? */
const isPassThrough = (e: ChargeableExpense): boolean => e.passThrough === true;

/**
 * Underlaget som debiteras vidare (steg 1).
 *
 * Kostnadselement: byråns ingående moms räknas av — den lyfts som avdrag och ska
 * inte vidarefaktureras. Äkta utlägg: beloppet as-is, eftersom byrån inte har
 * betalat momsen för egen räkning och därför inte heller kan lyfta den.
 */
export function expenseNetOre(e: ChargeableExpense): number {
  if (isPassThrough(e)) return e.amount;
  return splitVat({
    amount: e.amount,
    vatRate: e.vatRate ?? CHARGED_EXPENSE_VAT_RATE,
    vatIncluded: e.vatIncluded ?? false,
  }).exclVat;
}

/** 25 % på ett netto, avrundat till hela ören. */
export function chargedVatOre(netOre: number): number {
  return Math.round((netOre * CHARGED_EXPENSE_VAT_RATE) / 10_000);
}

/**
 * Fakturans utläggsrader: **en** 25 %-rad för kostnadselementen och **en** 0 %-rad
 * för de äkta utläggen. Att hålla dem isär är inte kosmetika — klienten ska kunna
 * se vad som vidarefakturerats obeskattat, och SIE bokför per sats (#790).
 *
 * Tomma grupper utelämnas så fakturan inte bär nollrader.
 */
export function chargedExpenseLines(expenses: readonly ChargeableExpense[]): VatBreakdownLine[] {
  let chargedNetOre = 0;
  let passThroughOre = 0;
  for (const e of expenses) {
    if (isPassThrough(e)) passThroughOre += expenseNetOre(e);
    else chargedNetOre += expenseNetOre(e);
  }
  const lines: VatBreakdownLine[] = [];
  if (chargedNetOre !== 0) {
    lines.push({ kind: "utlagg", vatRate: CHARGED_EXPENSE_VAT_RATE, netOre: chargedNetOre, vatOre: chargedVatOre(chargedNetOre) });
  }
  // Äkta utlägg: beloppet är vad klienten ska betala; ingen moms läggs på.
  if (passThroughOre !== 0) lines.push({ kind: "utlagg", vatRate: 0, netOre: passThroughOre, vatOre: 0 });
  return lines;
}
