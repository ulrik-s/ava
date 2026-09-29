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
  // Omklassning (#1156): klassificeringen är en SERVER-sidoeffekt (jobb-kön,
  // server-LLM). Klienten kör den inte själv — servern kör om anropet.
  "document.analyze": Object.freeze({ entity: "document" }),
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
 * `null` om input inte är ett objekt (sådant spelas inte in — proceduren
 * avvisar det själv).
 */
export function prepareQueuedInput(path: string, input: unknown): Record<string, unknown> | null {
  if (!isRecord(input)) return null;
  const idField = isQueuedProcedure(path) ? QUEUED_PROCEDURES[path]?.idField : undefined;
  if (!idField || input[idField] !== undefined) return input;
  return { ...input, [idField]: uuidv7() };
}
