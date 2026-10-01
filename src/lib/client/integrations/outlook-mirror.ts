"use client";

/**
 * Speglingen av ett AVA-kalenderevent till Outlook, idempotent (#1361).
 *
 * Avbröts jobbet efter att Graph skapat eventet men innan AVA sparat
 * `outlookEventId`, skapade "Försök igen" en dubblett. Nu bär varje spegling
 * AVA-eventets id som en utökad egenskap, och skapandet ett deterministiskt
 * `transactionId`:
 *
 *   - Utan känt `outlookEventId` söks först ett Outlook-event med AVA-id:t. Finns
 *     det uppdateras det i stället för att ett nytt skapas.
 *   - Skapandet skickar `transactionId` = AVA-id:t, så att Graph inte skapar
 *     eventet två gånger om samma POST görs om (svaret tappades på vägen).
 *   - Borttagning utan känt id tar bort eventet som hittas, så en avbruten
 *     spegling inte lämnar ett föräldralöst event i Outlook.
 */

import {
  createGraphEvent, deleteGraphEvent, findGraphEventByProperty, toGraphEvent, updateGraphEvent,
  type CalendarEventForMirror, type GraphEventBody, type GraphOpts,
} from "./microsoft-graph";

/**
 * Den utökade egenskapen som bär AVA-eventets id på Outlook-eventet. GUID:en är
 * AVA:s egen, fasta namnrymd — den får aldrig ändras (då hittas inte gamla
 * speglingar).
 */
export const AVA_EVENT_ID_PROPERTY = "String {c7314276-9bc2-40d6-9a33-d056ef4e7efe} Name AvaCalendarEventId";

/** Graph:s `transactionId` för skapandet av AVA-eventets spegling. */
function mirrorTransactionId(avaEventId: string): string {
  return `ava-calendar-${avaEventId}`;
}

/** Body för att skapa speglingen: märkt med AVA-id:t och idempotent vid omförsök. */
function mirrorCreateBody(avaEventId: string, body: GraphEventBody): GraphEventBody {
  return {
    ...body,
    transactionId: mirrorTransactionId(avaEventId),
    singleValueExtendedProperties: [{ id: AVA_EVENT_ID_PROPERTY, value: avaEventId }],
  };
}

/** Outlook-eventet som speglar AVA-eventet: det kända id:t, annars det som hittas. */
async function mirroredEventId(avaEventId: string, knownId: string | null | undefined, opts: GraphOpts): Promise<string | null> {
  return knownId ?? findGraphEventByProperty(AVA_EVENT_ID_PROPERTY, avaEventId, opts);
}

/** Skapa eller uppdatera speglingen; svarar med Outlook-eventets id. */
export async function upsertMirror(
  avaEventId: string,
  knownId: string | null | undefined,
  event: CalendarEventForMirror,
  opts: GraphOpts,
): Promise<string> {
  const body = toGraphEvent(event);
  const existing = await mirroredEventId(avaEventId, knownId, opts);
  if (existing) return (await updateGraphEvent(existing, body, opts)).id;
  return (await createGraphEvent(mirrorCreateBody(avaEventId, body), opts)).id;
}

/** Ta bort speglingen, om det finns någon. */
export async function deleteMirror(avaEventId: string, knownId: string | null | undefined, opts: GraphOpts): Promise<void> {
  const existing = await mirroredEventId(avaEventId, knownId, opts);
  if (existing) await deleteGraphEvent(existing, opts);
}
