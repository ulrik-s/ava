/**
 * `error-reporter` — vilka fel som får lämna processen, och i vilken form (#1343).
 *
 * Loggen (`logger.ts`) stannar på byråns egen server. En felrapport går till en
 * mottagare (PostHog i EU-regionen, se `posthog-sink.ts`) och är därför
 * smalare än loggposten:
 *
 * - **Bara serverfel.** Ett `TRPCError` med 4xx-status (BAD_REQUEST, FORBIDDEN,
 *   NOT_FOUND …) är ett förväntat utfall, inte en bugg, och skickas aldrig.
 *   Bara 5xx och fel som inte är `TRPCError` alls rapporteras.
 * - **Ingen fri text.** Felets klass, en eventuell maskinkod (`23505`,
 *   `ECONNREFUSED`), procedurens path, requestId och ramarna (`fil:rad`).
 *   Aldrig `message`, aldrig användar- eller org-id, aldrig input.
 *
 * Mottagaren injiceras (`setErrorReporter`); default gör ingenting, så demon i
 * webbläsaren och testerna rapporterar aldrig någonstans. En trasig mottagare
 * fäller inte anropet som rapporterade.
 *
 * Browser-safe (ingen `node:`-import): anropas från `trpc-core.ts`.
 */

import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { stackFrames, type StackFrame } from "./stack-frames";

/** Allt en felrapport bär. Varje fält är kod eller id — inget innehåll. */
export interface ErrorReport {
  /** ISO-8601 när felet rapporterades. */
  timestamp: string;
  /** Felets klass, t.ex. `TypeError` eller `PostgresError`. */
  type: string;
  /** Maskinläsbar felkod om felet hade en (`23505`, `ECONNREFUSED`). */
  errorCode?: string;
  /** tRPC-procedurens path, t.ex. `invoice.create`. */
  path?: string;
  /** Korrelations-id:t — samma som i loggen och i användarens felruta. */
  requestId?: string;
  /** `fil:rad:kolumn` + funktionsnamn, äldst först. */
  frames: StackFrame[];
}

/** Var felet inträffade — det enda anroparen bidrar med utöver felet. */
export interface ReportContext {
  path?: string;
  requestId?: string;
}

export type ErrorReporter = (report: ErrorReport) => void;

/** Identifierare: en klass, en path, ett id. Fri text matchar inte. */
const IDENTIFIER = /^[A-Za-z_$][\w$]{0,63}$/;
const PATH = /^[\w.]{1,128}$/;
const REQUEST_ID = /^[\w-]{1,64}$/;
/** Stora bokstäver, siffror, `_`: SQLSTATE, errno-koder, egna felkoder. */
const ERROR_CODE = /^[A-Z0-9_]{1,40}$/;

function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  return IDENTIFIER.test(error.name) ? error.name : "Error";
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : undefined;
}

/** Värdet om det har rätt form, annars inget. */
function shaped(value: string | undefined, shape: RegExp): string | undefined {
  return value !== undefined && shape.test(value) ? value : undefined;
}

/**
 * Felet som rapporteras: för ett `TRPCError` den underliggande orsaken (det
 * är den som har den intressanta stacken), null om det är ett klientfel.
 * Inlindat, eftersom även `null` kan kastas.
 */
export function reportableError(error: unknown): { target: unknown } | null {
  if (!(error instanceof TRPCError)) return { target: error };
  if (getHTTPStatusCodeFromError(error) < 500) return null;
  return { target: error.cause ?? error };
}

/** Rapporten för ett fel, eller null om det inte ska rapporteras. */
export function toErrorReport(error: unknown, context: ReportContext, now: Date = new Date()): ErrorReport | null {
  const reportable = reportableError(error);
  if (reportable === null) return null;
  const { target } = reportable;
  const errorCode = errorCodeOf(target);
  const path = shaped(context.path, PATH);
  const requestId = shaped(context.requestId, REQUEST_ID);
  return {
    timestamp: now.toISOString(),
    type: errorClass(target),
    ...(errorCode ? { errorCode } : {}),
    ...(path ? { path } : {}),
    ...(requestId ? { requestId } : {}),
    frames: stackFrames(target),
  };
}

const noopReporter: ErrorReporter = () => {};
let reporter: ErrorReporter = noopReporter;

/** Byt mottagare. Returnerar den förra, så tester kan återställa. */
export function setErrorReporter(next: ErrorReporter): ErrorReporter {
  const previous = reporter;
  reporter = next;
  return previous;
}

/** Rapportera ett fel om det är ett serverfel. Kastar aldrig. */
export function reportError(error: unknown, context: ReportContext): void {
  try {
    const report = toErrorReport(error, context);
    if (report) reporter(report);
  } catch {
    // Felrapporteringen får aldrig fälla det den rapporterar.
  }
}
