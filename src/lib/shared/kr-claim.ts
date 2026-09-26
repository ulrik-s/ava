/**
 * Kostnadsräkningens yrkade belopp (#1218) — avrundat som byråerna och
 * domstolarna gör på en kostnadsräkning:
 *
 *   - varje rad i sammanställningen (arvode per kategori och á-pris, taxan,
 *     tidsspillan, utläggen) avrundas till HELA KRONOR
 *     (31,35 h × 1 626 kr = 50 975,10 → 50 975,00 kr),
 *   - "Belopp exkl. moms" är summan av de avrundade raderna,
 *   - momsen är 25 % av det — utom på äkta utlägg (#975) — avrundad till hela
 *     kronor (72 550 × 25 % = 18 137,50 → 18 138,00 kr),
 *   - "Belopp inkl. moms" = exkl + moms.
 *
 * Det är det YRKADE beloppet: samma regel används för dokumentet
 * (`buildKostnadsrakningContext`) och för körningens lagrade belopp
 * (`krGrossOre` → `billingRun.createKostnadsrakning`), så räkningen och det
 * som sparas/stäms av mot domen alltid är samma tal. Gäller BARA
 * kostnadsräkningen — fakturor avrundas som förut (öre).
 */

import { CHARGED_EXPENSE_VAT_RATE } from "./expense-vat";

/** Öre → närmaste hela krona (i öre). Den enda platsen avrundningen görs. */
export function roundToKronor(ore: number): number {
  return Math.round(ore / 100) * 100;
}

/** Underlaget för ett yrkande, oavrundat (öre). */
export interface KrClaimInput {
  /** Sammanställningens arvodesrader — en per rad, oavrundade. */
  arvodeRowsOre: readonly number[];
  /** Momspliktiga utlägg (kostnadselement), netto. */
  expenseChargedNetOre: number;
  /** Äkta utlägg — vidarefaktureras utan moms (#975). */
  expensePassThroughOre: number;
}

/** Det yrkade beloppet, avrundat enligt kostnadsräkningens praxis (öre). */
export interface KrClaim {
  /** Arvodesraderna avrundade till hela kronor, i samma ordning som indata. */
  arvodeRowsOre: number[];
  arvodeExclVat: number;
  /** Utläggsraden, avrundad till hela kronor. */
  expenseExclVat: number;
  exclVat: number;
  vat: number;
  inclVat: number;
}

/** Räkna fram yrkandet ur de oavrundade raderna. */
export function krClaim(input: KrClaimInput): KrClaim {
  const arvodeRowsOre = input.arvodeRowsOre.map(roundToKronor);
  const arvodeExclVat = arvodeRowsOre.reduce((s, r) => s + r, 0);
  const expenseExclVat = roundToKronor(input.expenseChargedNetOre + input.expensePassThroughOre);
  const exclVat = arvodeExclVat + expenseExclVat;
  const vat = roundToKronor(((exclVat - input.expensePassThroughOre) * CHARGED_EXPENSE_VAT_RATE) / 10_000);
  return { arvodeRowsOre, arvodeExclVat, expenseExclVat, exclVat, vat, inclVat: exclVat + vat };
}
