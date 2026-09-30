/**
 * Dokumentsökningens omfång (ADR 0028 §4c, kapabilitets-tierad enligt ADR 0027).
 *
 * Två lägen, plus ett offline-tillstånd:
 *   - `"server"` — online mot en server-backend (`sync`-kapabilitet + nät):
 *     sök i serverns FULLA index (alla dokument).
 *   - `"local"`  — ingen server (demon, som vi betraktar som offline): sök
 *     lokalt genom dokumenten i cachen (demons in-process-index kör redan så).
 *   - `"offline"` — server finns men nätet är nere: serverns index går inte att
 *     nå. Sök i stället i det som finns på enheten (#1244): metadata för alla
 *     dokument, och innehållet i dem som förladdats (juristens aktiva ärenden)
 *     eller öppnats. Träffarna märks, så att ingen tror att sökningen var fullständig.
 *
 * Gate:as på KAPABILITET (`sync`) + online-status — aldrig på `if (isDemo)`
 * (ADR 0027). Ren funktion → trivialt testbar.
 */

export type SearchScope = "server" | "local" | "offline";

export function searchScope(sync: boolean, online: boolean): SearchScope {
  if (!sync) return "local"; // ingen server (demo) → lokal sökning i cachen
  return online ? "server" : "offline"; // server: nätet avgör
}

/** Användarsynlig etikett för sök-omfånget. */
export function searchScopeLabel(scope: SearchScope): string {
  switch (scope) {
    case "server":
      return "Söker på servern — alla dokument.";
    case "local":
      return "Söker lokalt i cachade dokument.";
    case "offline":
      return "Offline — söker i dokumenten på den här enheten: dina aktiva ärenden och dokument du öppnat. Återanslut för att söka i alla.";
  }
}
