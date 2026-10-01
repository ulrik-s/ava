/**
 * Fel vid uppspelning av en köpost (#1353) — vad gör kön med det?
 *
 * En köpost som servern aldrig tar emot får inte hålla resten av kön som
 * gisslan, men en post får heller inte avvisas för att nätet är borta. Därför
 * tre klasser:
 *
 *   - `reject` — deterministiskt: samma post ger samma fel igen (ogiltig
 *     input, en regel, raden finns inte, ingen behörighet, en konflikt). Posten
 *     flyttas till de avvisade ändringarna och kön fortsätter.
 *   - `retry`  — kanske tillfälligt, kanske postens fel (500, timeout, ett
 *     okänt fel). Försöks igen med backoff; efter ett begränsat antal försök
 *     avvisas posten så att de efter den inte blockeras.
 *   - `halt`   — inte postens fel: servern nås inte, sessionen gick ut (401),
 *     för många anrop (429), servern startar om eller är äldre än klienten
 *     (502/503), eller backenden synkar inte alls (501). Kön stannar vid
 *     posten och inget försök räknas — ett tåg utan nät avvisar ingenting.
 *
 * Duck-typat på `TRPCClientError`s form (`data.code`/`data.httpStatus`, och
 * proxyns nakna svar i `meta.response.status`) så att modulen kan delas av
 * klient och server utan att dra in tRPC-klienten.
 */

import { ZodError } from "zod";

/** Vad kön gör med en post vars uppspelning kastade. */
export type SyncErrorClass = "reject" | "retry" | "halt";

/** tRPC-koder för ett anrop som är fel i sig — samma anrop ger samma svar igen. */
const REJECT_CODES: ReadonlySet<string> = new Set([
  "BAD_REQUEST", "PARSE_ERROR", "NOT_FOUND", "FORBIDDEN", "CONFLICT", "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE", "UNPROCESSABLE_CONTENT", "UNSUPPORTED_MEDIA_TYPE", "METHOD_NOT_SUPPORTED",
]);

/** tRPC-koder som inte beror på posten. */
const HALT_CODES: ReadonlySet<string> = new Set([
  "UNAUTHORIZED", "TOO_MANY_REQUESTS", "NOT_IMPLEMENTED", "BAD_GATEWAY", "SERVICE_UNAVAILABLE",
]);

/** HTTP-status (utan tRPC-kod, t.ex. från proxyn) som inte beror på posten. */
const HALT_STATUSES: ReadonlySet<number> = new Set([401, 429, 501, 502, 503]);

/** 4xx som ändå kan gå över: timeout och avbrutet anrop. */
const TRANSIENT_4XX: ReadonlySet<number> = new Set([408, 499]);

/** Längsta feltext som sparas eller visas. */
const MAX_MESSAGE = 300;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** HTTP-status ur ett tRPC-klientfel (JSON-svar eller proxyns nakna svar). */
export function httpStatusOf(err: unknown): number | undefined {
  const status = field(field(err, "data"), "httpStatus") ?? field(field(field(err, "meta"), "response"), "status");
  return typeof status === "number" ? status : undefined;
}

/** tRPC-koden ur ett tRPC-klientfel. */
export function trpcCodeOf(err: unknown): string | undefined {
  const code = field(field(err, "data"), "code");
  return typeof code === "string" ? code : undefined;
}

function classifyCode(code: string): SyncErrorClass {
  if (REJECT_CODES.has(code)) return "reject";
  return HALT_CODES.has(code) ? "halt" : "retry";
}

function classifyStatus(status: number): SyncErrorClass {
  if (HALT_STATUSES.has(status)) return "halt";
  return status >= 400 && status < 500 && !TRANSIENT_4XX.has(status) ? "reject" : "retry";
}

/** Ett tRPC-klientfel utan svar från servern = nätet (eller servern) nås inte. */
const isUnreachable = (err: unknown): boolean => field(err, "name") === "TRPCClientError";

/** Klassa ett fel från uppspelningen av en köpost. */
export function classifySyncError(err: unknown): SyncErrorClass {
  if (err instanceof ZodError) return "reject";
  const code = trpcCodeOf(err);
  if (code !== undefined) return classifyCode(code);
  const status = httpStatusOf(err);
  if (status !== undefined) return classifyStatus(status);
  return isUnreachable(err) ? "halt" : "retry";
}

/** Felets text, kort nog att visas och sparas. */
export function syncErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}
