/**
 * `stack-frames` — en stack trace som bara bär kod, aldrig innehåll (#1343).
 *
 * `error.stack` börjar med `Namn: meddelande`, och meddelandet kan bära vad
 * som helst — en domänregel formulerar sig gärna med klientens namn. Det
 * här modulens enda jobb är att plocka ut `fil:rad:kolumn` + funktionsnamn och
 * kasta resten:
 *
 * 1. Meddelandet tas bort ur stacken innan raderna tolkas, så ett meddelande
 *    som själv ser ut som en `at …`-rad inte kan smyga in som en ram.
 * 2. Bara rader som exakt matchar ramformen (V8/JavaScriptCore:
 *    `at fn (fil:rad:kol)` eller `at fil:rad[:kol]`) blir ramar. Allt annat
 *    kastas — det finns ingen "okänd rad"-väg ut.
 * 3. Filnamnet kortas till sökvägen från projektroten (`src/…`), så serverns
 *    katalogstruktur inte följer med.
 *
 * Browser-safe (ingen `node:`-import): anropas från `trpc-core.ts`.
 */

/** En ram i Sentry-protokollets form (`frames`), äldst först. */
export interface StackFrame {
  filename: string;
  function?: string;
  lineno: number;
  colno?: number;
  in_app: boolean;
}

/** Fler ramar än så hjälper ingen; de nyaste behålls. */
export const MAX_FRAMES = 50;

/**
 * `at [async |new ]fn (fil:rad[:kol])` eller `at fil:rad[:kol]`. Funktionsnamnet
 * får bara innehålla identifierar-tecken (plus `.`, `<>`, `[]` för
 * `Object.<anonymous>`) och inga mellanslag — fri text matchar inte.
 */
const FRAME = /^\s*at (?:(?<fn>(?:async |new )?[\w$.<>[\]]{1,200}) \()?(?<file>[^\s()]{1,500}?):(?<line>\d{1,7})(?::(?<col>\d{1,7}))?\)?$/;

/** Projektrelativ sökväg; okänd placering → bara filnamnet. */
const ROOTS = /\/(?:src|node_modules|tooling|test)\//;

export function relativeFilename(file: string): string {
  const path = file.replace(/^file:\/\//, "");
  const at = path.search(ROOTS);
  return at >= 0 ? path.slice(at + 1) : path.slice(path.lastIndexOf("/") + 1);
}

function toFrame(line: string): StackFrame | null {
  const m = FRAME.exec(line)?.groups;
  if (!m?.file || !m.line) return null;
  const filename = relativeFilename(m.file);
  return {
    filename,
    ...(m.fn ? { function: m.fn } : {}),
    lineno: Number(m.line),
    ...(m.col ? { colno: Number(m.col) } : {}),
    in_app: !filename.startsWith("node_modules/") && filename !== "native",
  };
}

/** Stacken utan meddelandet — varje förekomst, inte bara rubrikraden. */
function withoutMessage(stack: string, message: string): string {
  return message ? stack.split(message).join("") : stack;
}

/** Ramarna i ett fel, äldst först (Sentry: anroparen före den som kastade). */
export function stackFrames(error: unknown): StackFrame[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return [];
  const frames = withoutMessage(error.stack, error.message)
    .split("\n")
    .map(toFrame)
    .filter((f): f is StackFrame => f !== null)
    .slice(0, MAX_FRAMES);
  return frames.reverse();
}
