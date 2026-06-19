/**
 * `LogBuffer` + `installConsoleCapture` — en liten in-memory ringbuffert som
 * fångar de senaste console-utskrifterna och okatchade felen i webbläsaren.
 *
 * Bakgrund: DevTools-konsolen (F12) går INTE att läsa från sidans JavaScript
 * — webbläsaren exponerar medvetet ingen API för det. För att en felrapport
 * ska kunna bifoga "de senaste utskrifterna och felen" måste vi alltså fånga
 * samma rader själva, genom att lägga en tunn shim runt `console.*` och
 * lyssna på `error`/`unhandledrejection`. Originalbeteendet bevaras (vi
 * anropar alltid igenom), så F12 ser exakt samma rader som vanligt.
 *
 * Modulen är fri från React/DOM-typberoenden i sin kärna och tar emot
 * console + event-target via parametrar, så den kan node-testas utan jsdom.
 */

export type LogLevel = "log" | "info" | "warn" | "error" | "uncaught" | "rejection";

export interface LogEntry {
  level: LogLevel;
  /** Epoch-ms när raden fångades. */
  ts: number;
  /** Hopslagen text-representation av argumenten. */
  text: string;
}

const DEFAULT_CAPACITY = 200;

/** Serialisera ett console-argument till en kort, läsbar sträng. */
function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg === undefined) return "undefined";
  try {
    return JSON.stringify(arg);
  } catch {
    // Cirkulär struktur el. dyl. — falla tillbaka på String().
    return String(arg);
  }
}

export function formatArgs(args: readonly unknown[]): string {
  return args.map(stringifyArg).join(" ");
}

/**
 * Fast-storlek ringbuffert. När kapaciteten nås skrivs äldsta posten över.
 * `recent()` returnerar i kronologisk ordning (äldst → nyast).
 */
export class LogBuffer {
  private readonly entries: LogEntry[] = [];

  constructor(private readonly capacity: number = DEFAULT_CAPACITY) {
    if (capacity <= 0) throw new Error("LogBuffer-kapacitet måste vara > 0");
  }

  push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  /** De `n` senaste posterna (alla om n utelämnas), äldst först. */
  recent(n?: number): LogEntry[] {
    if (n === undefined || n >= this.entries.length) return [...this.entries];
    return this.entries.slice(this.entries.length - n);
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }

  /** Plain-text-dump (en rad per post) lämplig för en felrapport. */
  toText(n?: number): string {
    return this.recent(n)
      .map((e) => `[${new Date(e.ts).toISOString()}] ${e.level.toUpperCase()} ${e.text}`)
      .join("\n");
  }
}

/** Delmängd av Console som vi shimmar. */
type ConsoleLike = Pick<Console, "log" | "info" | "warn" | "error">;

/** Delmängd av EventTarget vi behöver — håller modulen oberoende av DOM-lib. */
interface EventTargetLike {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: unknown) => void): void;
}

export interface InstallOptions {
  buffer: LogBuffer;
  /** Console att shimma (default: global console). */
  console?: ConsoleLike;
  /** Target för error/unhandledrejection (default: globalThis om EventTarget). */
  target?: EventTargetLike | null;
  /** Klocka — injicerbar för deterministiska tester. */
  now?: () => number;
}

/** Marker så dubbel-install (t.ex. React StrictMode) blir no-op. */
const INSTALLED = Symbol.for("ava.diagnostics.consoleCaptureInstalled");

const CONSOLE_LEVELS: ReadonlyArray<keyof ConsoleLike> = ["log", "info", "warn", "error"];

function extractErrorEvent(ev: unknown): string {
  const e = ev as { message?: unknown; error?: unknown; filename?: unknown; lineno?: unknown };
  if (e?.error instanceof Error) return `${e.error.name}: ${e.error.message}`;
  const loc = e?.filename ? ` (${String(e.filename)}:${String(e.lineno ?? "")})` : "";
  return `${String(e?.message ?? "okänt fel")}${loc}`;
}

function extractRejection(ev: unknown): string {
  const reason = (ev as { reason?: unknown })?.reason;
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return formatArgs([reason]);
}

/**
 * Installera console-capture + global felfångst. Idempotent: andra anropet
 * mot samma console blir no-op och returnerar en no-op-uninstall.
 *
 * Returnerar en `uninstall()` som återställer originalmetoderna och tar bort
 * lyssnarna — användbar i tester och vid teardown.
 */
export function installConsoleCapture(opts: InstallOptions): () => void {
  const { buffer } = opts;
  const con = (opts.console ?? globalThis.console) as ConsoleLike & { [INSTALLED]?: boolean };
  const now = opts.now ?? (() => Date.now());
  const target = opts.target === undefined ? defaultTarget() : opts.target;

  if (con[INSTALLED]) return () => { /* redan installerad — no-op */ };
  con[INSTALLED] = true;

  const originals = new Map<keyof ConsoleLike, ConsoleLike[keyof ConsoleLike]>();
  for (const level of CONSOLE_LEVELS) {
    const original = con[level].bind(con);
    originals.set(level, con[level]);
    con[level] = ((...args: unknown[]) => {
      buffer.push({ level, ts: now(), text: formatArgs(args) });
      original(...args);
    }) as Console[typeof level];
  }

  const onError = (ev: unknown): void => {
    buffer.push({ level: "uncaught", ts: now(), text: extractErrorEvent(ev) });
  };
  const onRejection = (ev: unknown): void => {
    buffer.push({ level: "rejection", ts: now(), text: extractRejection(ev) });
  };
  if (target) {
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
  }

  return () => {
    for (const [level, fn] of originals) con[level] = fn as Console[typeof level];
    if (target) {
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
    }
    delete con[INSTALLED];
  };
}

function defaultTarget(): EventTargetLike | null {
  return typeof globalThis.addEventListener === "function" ? globalThis : null;
}
