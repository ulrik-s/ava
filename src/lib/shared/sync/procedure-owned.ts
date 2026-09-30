/**
 * Procedurägda entiteter (#1242, ADR 0037) — rader som bara procedurkön skriver.
 *
 * Här gäller affärsregler: belopp, låsta poster, statusflöden och obrutna
 * nummerserier. Servern kör om routrarna för dem (`QUEUED_PROCEDURES`) och tar
 * inte emot färdiga rader från radkön. En ärlig klient skickar inga sådana
 * rader; en rad som ändå kommer (en manipulerad klient, eller en post som en
 * äldre version köade) avvisas med ett besked i stället för att sparas.
 *
 * Övriga entiteter är ren data (kontakter, uppgifter, kalender, dokumentens
 * metadata …) och går som förut via radkön.
 */

/** Entiteterna vars rader bara skrivs av köade procedurer. */
export const PROCEDURE_OWNED_ENTITIES: ReadonlySet<string> = new Set([
  "timeEntry", "expense",
  "invoice", "billingRun", "accontoDeduction", "invoiceDispatch",
  "payment", "writeOff", "paymentPlan", "paymentPlanReminder", "expectedReceivable",
]);

/** Skrivs `entity` bara av procedurkön? */
export function isProcedureOwned(entity: string): boolean {
  return PROCEDURE_OWNED_ENTITIES.has(entity);
}

/** Beskedet när en rad för en procedurägd entitet kommer via radkön. */
export const PROCEDURE_OWNED_REASON =
  "Ändringen skickades på ett sätt som servern inte längre tar emot för tid, utlägg och fakturering. Gör om den i appen.";
