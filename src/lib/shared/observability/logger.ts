/**
 * `logger` — strukturerad loggning (#1080).
 *
 * ## Problemet
 *
 * Före det här fanns sex `console.error` i hela serverkoden och inget annat.
 * I drift betyder det att du får reda på fel genom att någon ringer — och för
 * en advokatbyrå är den som ringer sannolikt redan förbannad, eftersom något
 * inte gick att fakturera eller en frist inte visades.
 *
 * ## Varför en fast form och inte fria fält
 *
 * `LogRecord` bär BARA deklarerade fält. Det finns ingen `meta: unknown` att
 * hälla in en tRPC-input i, och det är hela poängen: indatat här är klientens
 * personnummer och vad tvisten gäller. Samma resonemang som fältprojektionen
 * på MCP-ytan (#1014) — en tillåtlista gör fel-läckan omöjlig i stället för
 * osannolik. `redact.ts` är andra försvaret, för texten som ändå måste med.
 *
 * ## Varför `lib/shared` och inte `lib/server`
 *
 * tRPC-middleware:n ligger i `trpc-core.ts`, som är browser-safe (demo-läget
 * kör `appRouter.createCaller` i klient-bundlen). Loggern måste därför också
 * vara det: inga `node:`-importer, ingen `process`-åtkomst utan vakt.
 *
 * ## Sink:en injiceras
 *
 * Modulen skriver inte själv. `setLogSink` byter destination — JSON till
 * stdout i drift, en array i tester, och senare en fel-rapportör vid sidan av.
 * Utan det hade varje test som råkar logga spammat testutskriften.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Nivåernas inbördes ordning — används av tröskeln, inte av sink:en. */
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * En loggpost. Varje fält är där för att det går att felsöka MED — och inget
 * fält bär fritt innehåll.
 */
export interface LogRecord {
  /** ISO-8601 med millisekunder. */
  ts: string;
  level: LogLevel;
  /** Maskinläsbar händelse, t.ex. `trpc.call` eller `job.failed`. Inte fri text. */
  event: string;
  /**
   * Korrelations-id. Det här är fältet som gör en användarrapport sökbar:
   * "det small klockan tio" → `requestId` i felrutan → alla poster för just
   * det anropet.
   */
  requestId?: string;
  /** Ids, ALDRIG namn eller e-post. Ett id går att slå upp av den som har rätt. */
  userId?: string;
  orgId?: string;
  /** tRPC-procedurens path, t.ex. `billingRun.settleCoverage`. */
  path?: string;
  durationMs?: number;
  outcome?: "ok" | "error";
  /** Felkod (TRPCError.code eller motsvarande) — stabil, går att larma på. */
  code?: string;
  /** Maskerat felmeddelande. Går genom `redactMessage` före det hamnar här. */
  message?: string;
}

export type LogSink = (record: LogRecord) => void;

/** Fälten en logger bär med sig till varje post den skriver. */
export type LogContext = Pick<LogRecord, "requestId" | "userId" | "orgId" | "path">;

/** Det anroparen fyller i per post (utöver kontexten). */
export type LogFields = Omit<LogRecord, "ts" | "level" | "event" | keyof LogContext> & Partial<LogContext>;

/**
 * JSON per rad till stderr. En rad = en post, så `docker logs | jq` fungerar
 * utan att någon behöver parsa flerradiga stack traces.
 *
 * stderr och inte stdout: stdout är serverns nyttolast i vissa lägen (CLI:t,
 * MCP-servern över stdio) och en loggrad där korrumperar protokollet.
 */
export const jsonSink: LogSink = (record) => {
   
  console.error(JSON.stringify(record));
};

/** Kastar bort allt. Default i tester och i browser-bundlen. */
export const nullSink: LogSink = () => {};

/** Samlar i en array — för tester som vill assertera på vad som loggades. */
export function arraySink(into: LogRecord[]): LogSink {
  return (record) => void into.push(record);
}

let sink: LogSink = nullSink;
let threshold: LogLevel = "info";

/** Byt destination. Returnerar den förra, så tester kan återställa. */
export function setLogSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}

/** Lägsta nivå som släpps igenom. Poster under tröskeln byggs inte ens. */
export function setLogLevel(next: LogLevel): void {
  threshold = next;
}

/** Är nivån påslagen? Exporterad så dyra fält kan hoppas över av anroparen. */
export function isEnabled(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[threshold];
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Ny logger med utökad kontext — t.ex. `requestId` för ett enskilt anrop. */
  child(extra: LogContext): Logger;
}

/** Utelämna undefined så JSON-raden inte fylls av tomma nycklar. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function emit(level: LogLevel, context: LogContext, event: string, fields?: LogFields): void {
  if (!isEnabled(level)) return;
  sink(defined({ ts: new Date().toISOString(), level, event, ...context, ...fields }));
}

/** Skapa en logger. `context` följer med varje post den skriver. */
export function createLogger(context: LogContext = {}): Logger {
  return {
    debug: (event, fields) => emit("debug", context, event, fields),
    info: (event, fields) => emit("info", context, event, fields),
    warn: (event, fields) => emit("warn", context, event, fields),
    error: (event, fields) => emit("error", context, event, fields),
    child: (extra) => createLogger(defined({ ...context, ...extra })),
  };
}

/** Rot-loggern för kod som inte har en request-kontext. */
export const log = createLogger();
