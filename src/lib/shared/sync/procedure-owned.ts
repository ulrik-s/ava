/**
 * Procedurägda entiteter (#1242, ADR 0037) — rader som bara procedurkön skriver.
 *
 * Här gäller affärsregler: belopp, låsta poster, statusflöden och obrutna
 * nummerserier. Servern kör om routrarna för dem (`QUEUED_PROCEDURES`) och tar
 * inte emot färdiga rader från radkön. En ärlig klient skickar inga sådana
 * rader; en rad som ändå kommer (en manipulerad klient, eller en post som en
 * äldre version köade) avvisas med ett besked i stället för att sparas.
 *
 * Ärendet (#1242, steg 3) är procedurägt: skapandet tilldelar ärendenumret i
 * serverns serie, och en ändring kör om routern — bara de fält användaren
 * ändrade skrivs, så två ändringar av olika fält går inte förlorade.
 *
 * Användare, byrån, kontor, byråns standardvyer och dokumentmallar (#1344) är
 * procedurägda: de administreras, och rollen läses ur användarraden — en
 * färdig rad `{ id: jag, role: "ADMIN" }` gjorde annars en medlem till admin.
 * Servern kör om routrarna (`user.*`, `organization.*`, `documentTemplate.*`,
 * `prefs.setOrgDefault/clearOrgDefault`), där rollen och fälten prövas.
 *
 * Övriga entiteter är ren data (kontakter, ärendets parter, uppgifter,
 * kalender, dokumentens metadata …) och går som förut via radkön.
 */

/** Entiteterna vars rader bara skrivs av köade procedurer. */
export const PROCEDURE_OWNED_ENTITIES: ReadonlySet<string> = new Set([
  "matter", "timeEntry", "expense",
  "invoice", "billingRun", "accontoDeduction", "invoiceDispatch",
  "payment", "writeOff", "paymentPlan", "paymentPlanReminder", "expectedReceivable",
  "user", "organization", "office", "orgPreference", "documentTemplate",
]);

/** Skrivs `entity` bara av procedurkön? */
export function isProcedureOwned(entity: string): boolean {
  return PROCEDURE_OWNED_ENTITIES.has(entity);
}

/** Beskedet när en rad för en procedurägd entitet kommer via radkön. */
export const PROCEDURE_OWNED_REASON =
  "Ändringen skickades på ett sätt som servern inte längre tar emot för ärenden, tid, utlägg, fakturering, användare och byråinställningar. Gör om den i appen.";
