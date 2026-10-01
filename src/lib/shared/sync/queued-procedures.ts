/**
 * Köbara procedurer (#1265, ADR 0037) — tRPC-anrop som köas som ANROP och
 * körs om auktoritativt på servern, i stället för att köas som färdiga rader.
 *
 * Delas av klienten (in-process-länken spelar in anropet) och servern (som
 * bara kör om procedurer som står här). Migreringen sker entitet för entitet;
 * allt som inte står här går som förut via radkön.
 *
 * Krav för att en procedur ska få stå här (ADR 0037):
 *   - deterministisk givet input — id:n skapas i klienten (se `idField`) eller
 *     härleds ur anropets id (`newRowId`, #1276),
 *   - sidoeffekter (jobb, e-post, externa anrop) bara i serverns körning,
 *   - läser inte egen klocka för affärsbeslut (`callTime`, #1276).
 */

import { uuidv7 } from "@/lib/shared/uuid";

/** En köbar procedur. */
interface QueuedProcedureSpec {
  /** Entiteten vars rader proceduren skriver (för att läsa tillbaka serverns läge). */
  readonly entity: string;
  /** Fältet i input som bär radens klient-genererade id (bara för create). */
  readonly idField?: string;
}

/** Registret — fryst, så att det inte kan utökas i körtid. */
export const QUEUED_PROCEDURES: Readonly<Record<string, QueuedProcedureSpec>> = Object.freeze({
  "timeEntry.create": Object.freeze({ entity: "timeEntry", idField: "id" }),
  "timeEntry.update": Object.freeze({ entity: "timeEntry" }),
  "timeEntry.delete": Object.freeze({ entity: "timeEntry" }),
  // Utläggen (#1276): servern kör om routern — byrån och låsta utlägg gäller.
  "expense.create": Object.freeze({ entity: "expense", idField: "id" }),
  "expense.update": Object.freeze({ entity: "expense" }),
  "expense.delete": Object.freeze({ entity: "expense" }),
  // Faktureringen, steg 2a (#1276): rader proceduren skapar får id härlett ur
  // anropets id och affärsdatum ur när anropet gjordes (`queued-call.ts`).
  "invoice.setStatus": Object.freeze({ entity: "invoice" }),
  "invoice.recordPayment": Object.freeze({ entity: "payment" }),
  "invoice.writeOff": Object.freeze({ entity: "writeOff" }),
  "invoice.createPaymentPlan": Object.freeze({ entity: "paymentPlan", idField: "id" }),
  "invoice.cancelPaymentPlan": Object.freeze({ entity: "paymentPlan" }),
  "paymentPlan.cancel": Object.freeze({ entity: "paymentPlan" }),
  "expectedReceivable.create": Object.freeze({ entity: "expectedReceivable" }),
  "expectedReceivable.settle": Object.freeze({ entity: "expectedReceivable" }),
  "expectedReceivable.cancel": Object.freeze({ entity: "expectedReceivable" }),
  "expectedReceivable.update": Object.freeze({ entity: "expectedReceivable" }),
  // Steg 2c (#1276): fakturorna. Frysningen av posterna loggas nu i change_log
  // (#1319), och fakturanumret tilldelas i serverns körning (#1243).
  "billingRun.createAcconto": Object.freeze({ entity: "invoice", idField: "id" }),
  "billingRun.createFinal": Object.freeze({ entity: "invoice", idField: "id" }),
  "invoice.createCredit": Object.freeze({ entity: "invoice", idField: "id" }),
  "invoice.createRadgivning": Object.freeze({ entity: "invoice" }),
  // Steg 2d (#1276): kostnadsräkningsflödet och slutregleringen.
  "billingRun.createKostnadsrakning": Object.freeze({ entity: "billingRun" }),
  "billingRun.voidKostnadsrakning": Object.freeze({ entity: "billingRun" }),
  "billingRun.recordKostnadsrakningBeslut": Object.freeze({ entity: "billingRun" }),
  "billingRun.appealKostnadsrakning": Object.freeze({ entity: "billingRun" }),
  "billingRun.setVerdict": Object.freeze({ entity: "invoice" }),
  "billingRun.settleCoverage": Object.freeze({ entity: "invoice" }),
  "billingRun.recordInsurerPruning": Object.freeze({ entity: "invoice" }),
  // De sista anropen som skriver procedurägda entiteter (#1242): utskick,
  // avbetalningspåminnelser och Fortnox-markeringen. Därefter tar servern inte
  // emot färdiga rader för dem (`procedure-owned.ts`).
  "invoiceDispatch.queue": Object.freeze({ entity: "invoiceDispatch" }),
  "invoiceDispatch.recordManual": Object.freeze({ entity: "invoiceDispatch" }),
  "invoiceDispatch.updateStatus": Object.freeze({ entity: "invoiceDispatch" }),
  "paymentPlan.recordReminder": Object.freeze({ entity: "paymentPlanReminder", idField: "id" }),
  "paymentPlan.scanDueReminders": Object.freeze({ entity: "paymentPlanReminder" }),
  "invoice.markFortnoxBooked": Object.freeze({ entity: "invoice" }),
  // Ärendena (#1242, steg 3): skapandet (ärendenumret i serverns serie,
  // standardmapparna) och ändringarna (status, betalningssätt, taxa …) körs
  // om på servern. En ändring skriver bara fälten användaren ändrade.
  "matter.create": Object.freeze({ entity: "matter", idField: "id" }),
  "matter.update": Object.freeze({ entity: "matter" }),
  // Jävskontrollen (#1246): offline väntar den tills servern kört den.
  "matter.checkConflicts": Object.freeze({ entity: "matter" }),
  "matter.markConflictsReviewed": Object.freeze({ entity: "matter" }),
  // Omklassning (#1156): klassificeringen är en SERVER-sidoeffekt (jobb-kön,
  // server-LLM). Klienten kör den inte själv — servern kör om anropet.
  "document.analyze": Object.freeze({ entity: "document" }),
  // Administrationen (#1344): användare, byråinställningar, kontor, byråns
  // standardvyer och mallar. Rollen läses ur användarraden, så de tas inte
  // emot som rader — servern kör om routern, där admin-kraven gäller.
  "user.create": Object.freeze({ entity: "user", idField: "id" }),
  "user.update": Object.freeze({ entity: "user" }),
  "user.deactivate": Object.freeze({ entity: "user" }),
  "user.delete": Object.freeze({ entity: "user" }),
  "organization.updateSettings": Object.freeze({ entity: "organization" }),
  "organization.addOffice": Object.freeze({ entity: "office", idField: "id" }),
  "organization.updateOffice": Object.freeze({ entity: "office" }),
  "organization.deleteOffice": Object.freeze({ entity: "office" }),
  "documentTemplate.create": Object.freeze({ entity: "documentTemplate", idField: "id" }),
  "documentTemplate.update": Object.freeze({ entity: "documentTemplate" }),
  "documentTemplate.delete": Object.freeze({ entity: "documentTemplate" }),
  "prefs.setOrgDefault": Object.freeze({ entity: "orgPreference" }),
  "prefs.clearOrgDefault": Object.freeze({ entity: "orgPreference" }),
});

/** Är `path` en procedur som köas som anrop? (Egna nycklar — inte `__proto__` o.d.) */
export function isQueuedProcedure(path: string): boolean {
  return Object.hasOwn(QUEUED_PROCEDURES, path);
}

/** Entiteten en köbar procedur skriver, eller `undefined`. */
export function queuedProcedureEntity(path: string): string | undefined {
  return isQueuedProcedure(path) ? QUEUED_PROCEDURES[path]?.entity : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Input som ska spelas in: en create utan id får ett klient-genererat UUIDv7,
 * så att servern skapar SAMMA rad när anropet körs om. Övrigt lämnas orört.
 * Ett anrop utan input (valfri input, t.ex. `scanDueReminders()`) spelas in
 * med `{}`. `null` om input är något annat än ett objekt (sådant spelas inte
 * in — proceduren avvisar det själv).
 */
export function prepareQueuedInput(path: string, raw: unknown): Record<string, unknown> | null {
  const input = raw === undefined ? {} : raw;
  if (!isRecord(input)) return null;
  const idField = isQueuedProcedure(path) ? QUEUED_PROCEDURES[path]?.idField : undefined;
  if (!idField || input[idField] !== undefined) return input;
  return { ...input, [idField]: uuidv7() };
}
