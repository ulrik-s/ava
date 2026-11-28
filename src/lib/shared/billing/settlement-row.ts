/**
 * En rad i nedbrytningsvyns trappa (#858/#876) — och dess plats i fakturans
 * avräkningstabell (#2255; intag #151). Bara presentation: raderna bär
 * belopp som redan är uträknade. Delas av `settlement-view.ts` och
 * `acconto-view.ts`; importerar ingenting.
 */

/** `add` = delbelopp/steg i trappan, `deduct` = avgår (−), `info` = spårbarhets-
 *  rad utan beloppspåverkan (visas i parentes/grått, t.ex. rådgivnings-omnämnandet). */
export type SettlementRowKind = "add" | "deduct" | "info";

/**
 * Radens plats i fakturans avräkningstabell (#2255/#151):
 * `basis` = raden bygger underlaget (står i Underlag-kolumnen, räknas inte i
 * Belopp), `subtotal` = mellansumma (utelämnas i tabellen, som summerar själv).
 * Saknas = raden räknas i Belopp.
 */
export type SettlementRowRole = "basis" | "subtotal";

/** En rad i trappan. */
export interface SettlementRow {
  label: string;
  amountOre: number;
  kind: SettlementRowKind;
  /** Underlaget (öre) som `shareBips` räknas på — tabellens Underlag-kolumn (#151). */
  basisOre?: number | undefined;
  /** Andelen i bips (2500 = 25 %) — tabellens Andel-kolumn, i st.f. i etiketten (#151). */
  shareBips?: number | undefined;
  role?: SettlementRowRole | undefined;
}

/** Momssatsen 25 % i bips. */
const VAT_25_BIPS = 2500;

/**
 * Bär hela underlaget 25 % moms (#947)? Klientens utlägg kan ha 0/6/12 %, och då
 * är en 25 %-uppgift direkt felaktig. Fakturans moms delas ur bruttot i hela
 * kronor (#1438) och ligger då högst 62,5 öre från 25 % av nettot.
 */
export function isVat25(netOre: number, vatOre: number): boolean {
  return netOre > 0 && Math.abs(vatOre * 10_000 - netOre * VAT_25_BIPS) <= 625_000;
}

/**
 * Momsraden i trappan (#2255/#151): "Moms", med underlaget och 25 % i egna
 * fält när hela underlaget bär 25 % — så procenten inte står i etiketten.
 */
export function vatRow(netOre: number, vatOre: number): SettlementRow {
  const row: SettlementRow = { label: "Moms", amountOre: vatOre, kind: "add" };
  return isVat25(netOre, vatOre) ? { ...row, basisOre: netOre, shareBips: VAT_25_BIPS } : row;
}
