/**
 * Skriv kontakt- och händelseförslag ur ett dokuments text (#988).
 *
 * Den här funktionen är den PRODUCENT som saknades. `SuggestionsPanel` och
 * `EventsPanel` var fullt utbyggda — accept/reject per förslag och per grupp,
 * repositories, routrar, relations, Postgres-tabeller — men ingenting skapade
 * raderna, så panelerna stod tomma i alla tier.
 *
 * Extraktionen själv är ren och bor i `@/lib/shared/document-extraction`. Här
 * ligger bara IO: dedup mot redan skapade förslag, och skrivningen.
 *
 * **Idempotent.** Samma dokument kan analyseras om hur många gånger som helst
 * (uppladdning, manuell "Analysera", reconcile-replay) utan att förslagen
 * dubbleras. Ett förslag som användaren redan AVFÄRDAT återuppstår inte heller
 * — dedupen tittar på alla statusar, inte bara PENDING. Att få tillbaka ett
 * bortvalt förslag vid varje omanalys vore värre än att inte få det alls.
 */

import {
  extractEventSuggestions, extractPartySuggestions,
} from "@/lib/shared/document-extraction";
import type { DocumentAnalysisSuggestion, MatterEventSuggestion } from "@/lib/shared/schemas/document";
import type { DocumentId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";

/**
 * Bara de två repositories funktionen faktiskt rör. Smalare än `Repositories`
 * med flit: anropare (och tester) slipper bygga hela sömmen, och beroendet
 * syns i signaturen i stället för att gömma sig i kroppen.
 */
export type SuggestionRepos = Pick<Repositories, "documentAnalysisSuggestions" | "matterEventSuggestions">;

export interface SuggestFromTextResult {
  parties: number;
  events: number;
}

/** Nyckel för ett kontaktförslag — samma part i samma roll är samma förslag. */
function partyKey(p: { name: string; role: string }): string {
  return `${p.name.trim().toLowerCase()}|${p.role}`;
}

/** Nyckel för ett händelseförslag — samma rubrik vid samma tidpunkt. */
function eventKey(e: { title: string; startAt: Date | string }): string {
  return `${e.title.trim().toLowerCase()}|${new Date(e.startAt).toISOString()}`;
}

/**
 * Extrahera ur `text` och skapa de förslag som inte redan finns på dokumentet.
 * Returnerar antalet NYA rader — noll vid omkörning på oförändrad text.
 */
export async function writeSuggestionsFromText(
  repos: SuggestionRepos, documentId: DocumentId, text: string,
): Promise<SuggestFromTextResult> {
  if (text.trim().length === 0) return { parties: 0, events: 0 };

  const [existingParties, existingEvents] = await Promise.all([
    repos.documentAnalysisSuggestions.listForDocument(documentId),
    repos.matterEventSuggestions.listForDocument(documentId),
  ]);
  const seenParties = new Set(existingParties.map(partyKey));
  const seenEvents = new Set(existingEvents.map(eventKey));

  let parties = 0;
  for (const p of extractPartySuggestions(text)) {
    if (seenParties.has(partyKey(p))) continue;
    seenParties.add(partyKey(p));
    await repos.documentAnalysisSuggestions.create({
      documentId, name: p.name, role: p.role, contactType: p.contactType,
      personalNumber: p.personalNumber, orgNumber: p.orgNumber,
      notes: p.notes, status: "PENDING",
    } satisfies Partial<DocumentAnalysisSuggestion>);
    parties++;
  }

  let events = 0;
  for (const e of extractEventSuggestions(text)) {
    if (seenEvents.has(eventKey(e))) continue;
    seenEvents.add(eventKey(e));
    await repos.matterEventSuggestions.create({
      documentId, title: e.title, description: e.description,
      eventType: e.eventType, startAt: e.startAt, allDay: false, status: "PENDING",
    } satisfies Partial<MatterEventSuggestion>);
    events++;
  }

  return { parties, events };
}
