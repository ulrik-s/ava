/**
 * `cli` — ren argument-parsing + körning för `ava`-CLI:t.
 *
 * `parseArgs` (ren) → en diskriminerad union; `runParsed` (I/O via injicerade
 * deps) → `{ code, stdout, stderr }`. Bin:en (`ava.ts`) är ett tunt skal runt
 * dessa två + `console`/`process.exit`, så all logik är enhetstestbar utan att
 * spawna en process.
 */

import type { AvaCaller } from "./caller";
import type { ProcedureInfo } from "./introspect";

export type Mode = "local" | "remote";

export type Parsed =
  | { kind: "help" }
  | { kind: "describe"; prefix: string | null }
  | { kind: "call"; path: string; input: unknown; mode: Mode }
  | { kind: "error"; message: string };

export const USAGE = `ava — CLI över AVA:s tRPC-API (auto-härlett ur appRouter)

Användning:
  ava describe [prefix]            Lista procedurer (+ JSON-schema för input)
  ava <router.procedur> [flaggor]  Anropa en procedur, skriv resultatet som JSON

Flaggor:
  --input <json>   Input som JSON (default {}). Bin stödjer även @fil och -.
  --local          In-process mot seedad store (default; ingen server/auth)
  --remote         Mot server-first över HTTP (AVA_SERVER_URL + AVA_TOKEN)
  --help           Visa den här hjälpen

Exempel:
  ava describe invoice
  ava invoice.list --input '{"status":"SENT"}'
  ava contacts.getById --input '{"id":"c-1"}'
  ava --remote invoice.createRadgivning --input '{"matterId":"m-1"}'`;

interface Flags {
  input: string | null;
  mode: Mode;
  help: boolean;
}

/**
 * Matcha en flagga → mutera `flags`, returnera antal *extra* argv-tokens som
 * konsumerats (0/1), eller `null` om `a` inte är en känd flagga.
 */
/** Value-lösa flaggor → mutator. Håller `matchFlag` under complexity-taket. */
const SIMPLE_FLAGS: Record<string, (f: Flags) => void> = {
  "--help": (f) => {
    f.help = true;
  },
  "-h": (f) => {
    f.help = true;
  },
  "--local": (f) => {
    f.mode = "local";
  },
  "--remote": (f) => {
    f.mode = "remote";
  },
};

function matchFlag(a: string, next: string | undefined, flags: Flags): number | null {
  const simple = SIMPLE_FLAGS[a];
  if (simple) {
    simple(flags);
    return 0;
  }
  if (a === "--input" || a === "--input=") {
    flags.input = next ?? "";
    return 1;
  }
  if (a.startsWith("--input=")) {
    flags.input = a.slice("--input=".length);
    return 0;
  }
  return null;
}

/** Dela argv i positionella + flaggor. `--k v` och `--k=v` stöds. */
function splitArgs(argv: readonly string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = { input: null, mode: "local", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const consumed = matchFlag(a, argv[i + 1], flags);
    if (consumed === null) {
      if (!a.startsWith("-")) positionals.push(a);
    } else {
      i += consumed;
    }
  }
  return { positionals, flags };
}

/** Tolka --input-strängen till ett JSON-värde (default {}). */
function parseInput(raw: string | null): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw === null || raw.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: `Ogiltig JSON i --input: ${raw}` };
  }
}

/** Ren parsning av `ava`-argv → diskriminerad union. */
export function parseArgs(argv: readonly string[]): Parsed {
  const { positionals, flags } = splitArgs(argv);
  if (flags.help || positionals.length === 0) return { kind: "help" };
  const [cmd, ...rest] = positionals;
  if (cmd === "describe") return { kind: "describe", prefix: rest[0] ?? null };
  const parsed = parseInput(flags.input);
  if (!parsed.ok) return { kind: "error", message: parsed.message };
  return { kind: "call", path: cmd!, input: parsed.value, mode: flags.mode };
}

export interface RunDeps {
  procedures: readonly ProcedureInfo[];
  /** Öppna en caller för valt läge (bin läser env för remote; tester stubbar). */
  openCaller: (mode: Mode) => AvaCaller;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const json = (v: unknown): string => JSON.stringify(v, null, 2);

function runDescribe(prefix: string | null, procs: readonly ProcedureInfo[]): RunResult {
  const hits = prefix ? procs.filter((p) => p.path.startsWith(prefix)) : procs;
  return { code: 0, stdout: json(hits), stderr: "" };
}

const errResult = (err: unknown): RunResult => ({
  code: 1,
  stdout: "",
  stderr: json({ error: err instanceof Error ? err.message : String(err) }),
});

async function invokeWith(caller: AvaCaller, call: Extract<Parsed, { kind: "call" }>): Promise<RunResult> {
  try {
    const result = await caller.invoke(call.path, call.input);
    return { code: 0, stdout: json(result ?? null), stderr: "" };
  } catch (err) {
    return errResult(err);
  } finally {
    await caller.close();
  }
}

async function runCall(call: Extract<Parsed, { kind: "call" }>, deps: RunDeps): Promise<RunResult> {
  if (!deps.procedures.some((p) => p.path === call.path)) {
    return { code: 1, stdout: "", stderr: json({ error: `Okänd procedur: ${call.path} (kör 'ava describe')` }) };
  }
  let caller: AvaCaller;
  try {
    caller = deps.openCaller(call.mode);
  } catch (err) {
    return errResult(err);
  }
  return invokeWith(caller, call);
}

/** Kör ett redan parsat kommando. I/O via `deps` → helt testbar. */
export function runParsed(parsed: Parsed, deps: RunDeps): Promise<RunResult> {
  switch (parsed.kind) {
    case "help":
      return Promise.resolve({ code: 0, stdout: USAGE, stderr: "" });
    case "error":
      return Promise.resolve({ code: 2, stdout: "", stderr: `${parsed.message}\n\n${USAGE}` });
    case "describe":
      return Promise.resolve(runDescribe(parsed.prefix, deps.procedures));
    case "call":
      return runCall(parsed, deps);
  }
}
