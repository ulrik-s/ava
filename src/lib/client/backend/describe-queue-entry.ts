/**
 * En köpost på svenska (#1266) — så att juristen känner igen vilken ändring
 * servern avvisade: "Ny tidspost", "Ändring av faktura".
 */

import { isProcedureCall, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";

/** Köbara procedurer (`QUEUED_PROCEDURES`) med egna namn. */
const PROCEDURES: Readonly<Record<string, string>> = {
  "timeEntry.create": "Ny tidspost",
  "timeEntry.update": "Ändring av tidspost",
  "timeEntry.delete": "Borttagning av tidspost",
  "expense.create": "Nytt utlägg",
  "expense.update": "Ändring av utlägg",
  "expense.delete": "Borttagning av utlägg",
  "document.analyze": "Omklassning av dokument",
  "invoice.setStatus": "Statusändring på faktura",
  "invoice.recordPayment": "Registrerad betalning",
  "invoice.writeOff": "Kundförlust",
  "invoice.createPaymentPlan": "Ny avbetalningsplan",
  "invoice.cancelPaymentPlan": "Avbruten avbetalningsplan",
  "paymentPlan.cancel": "Avbruten avbetalningsplan",
  "invoice.createCredit": "Kreditfaktura",
  "invoice.createRadgivning": "Rådgivningsfaktura",
  "billingRun.createAcconto": "Acontofaktura",
  "billingRun.createFinal": "Slutfaktura",
  "billingRun.createKostnadsrakning": "Kostnadsräkning",
  "billingRun.voidKostnadsrakning": "Ångrad kostnadsräkning",
  "billingRun.recordKostnadsrakningBeslut": "Domstolens beslut om kostnadsräkning",
  "billingRun.appealKostnadsrakning": "Överklagad kostnadsräkning",
  "billingRun.setVerdict": "Faktura efter dom",
  "billingRun.settleCoverage": "Slutreglering",
  "billingRun.recordInsurerPruning": "Försäkringens prutning",
  "expectedReceivable.create": "Ny domstolsfordran",
  "expectedReceivable.settle": "Avprickad domstolsfordran",
  "expectedReceivable.cancel": "Avbruten domstolsfordran",
  "expectedReceivable.update": "Ändring av domstolsfordran",
};

/** Entiteter i radkön, i bestämd form efter "av". */
const ENTITIES: Readonly<Record<string, string>> = {
  matter: "ärende", contact: "kontakt", invoice: "faktura", timeEntry: "tidspost", expense: "utlägg",
  document: "dokument", documentFolder: "mapp", task: "uppgift", calendarEvent: "kalenderhändelse",
  serviceNote: "tjänsteanteckning", payment: "betalning", paymentPlan: "avbetalningsplan", user: "användare",
};

/** Ett-ord: "Nytt ärende", inte "Ny ärende". */
const NEUTER: ReadonlySet<string> = new Set(["matter", "expense", "document"]);

const KIND: Readonly<Record<string, string>> = { update: "Ändring av", delete: "Borttagning av" };

export function describeQueueEntry(entry: QueueEntry): string {
  if (isProcedureCall(entry)) return PROCEDURES[entry.path] ?? `Ändring (${entry.path})`;
  const what = ENTITIES[entry.entity] ?? entry.entity;
  if (entry.kind === "create") return `${NEUTER.has(entry.entity) ? "Nytt" : "Ny"} ${what}`;
  return `${KIND[entry.kind] ?? "Ändring av"} ${what}`;
}
