/**
 * `introspect` — härleder AVA:s kommandoyta ur `appRouter` (single source of
 * truth). Går igenom tRPC-routerns procedurer och exponerar path + typ
 * (query/mutation) + zod-input som JSON-schema. CLI:t (`describe`) och
 * MCP-servern (`tools/list`) bygger båda sin yta härifrån → noll handkodad
 * kommandolista, alltid i synk när routrar växer.
 *
 * Rör tRPC v11:s interna `_def`-form. Den är inte publikt typad, så vi läser
 * den defensivt via `unknown`-narrowing (inga `any`, inga double-casts).
 */

import { z } from "zod";
import { appRouter } from "@/lib/server/routers/_app";

export type ProcedureType = "query" | "mutation" | "subscription";

export interface ProcedureInfo {
  /** Punktseparerad path, t.ex. `invoice.list`. */
  path: string;
  type: ProcedureType;
  /** Input-schemat som JSON-schema, eller `null` om det saknas/inte kan serialiseras. */
  inputSchema: unknown;
}

interface ProcedureDefLike {
  type?: unknown;
  inputs?: unknown;
}

function isProcedureType(v: unknown): v is ProcedureType {
  return v === "query" || v === "mutation" || v === "subscription";
}

/** Läs `router._def.procedures` (flat map `"a.b" → procedure`) defensivt. */
function readProcedures(): Record<string, unknown> {
  // Enda beröringen med tRPC:s otypa interna form; `_def` finns i v11.
  const def = (appRouter as { _def?: { procedures?: unknown } })._def;
  const procs = def?.procedures;
  return procs !== null && typeof procs === "object" ? (procs as Record<string, unknown>) : {};
}

/** Sista zod-schemat i procedurens input-kedja (tRPC mergear flera `.input()`). */
function lastZodInput(inputs: unknown): z.ZodType | null {
  if (!Array.isArray(inputs) || inputs.length === 0) return null;
  const last: unknown = inputs[inputs.length - 1];
  return last instanceof z.ZodType ? last : null;
}

/**
 * Datumfält → `{ type: "string", format: "date-time" }` (#1010).
 *
 * zod kan inte själv uttrycka `date` i JSON Schema; utan denna override blev
 * fältet ett otypat `{}` — modellen såg ett fält utan typ, format eller
 * ledtråd. Routrarnas datum-inputs är `z.coerce.date()`, så en ISO-sträng är
 * exakt vad en JSON-klient SKA skicka: override:n annonserar den formen.
 */
function overrideDateFields(ctx: { zodSchema: unknown; jsonSchema: Record<string, unknown> }): void {
  const def = (ctx.zodSchema as { _zod?: { def?: { type?: string } } })._zod?.def;
  if (def?.type === "date") Object.assign(ctx.jsonSchema, { type: "string", format: "date-time" });
}

/**
 * zod → JSON-schema.
 *
 * `unrepresentable: "any"` är inte kosmetika (#1008): default:en är `"throw"`,
 * och zod vägrar serialisera `z.date()`. Ett enda date-fält fällde alltså HELA
 * schemat till `null` — och MCP annonserade verktyget som parameterlöst. Det
 * drabbade 13 procedurer, bl.a. `timeEntry.list` (vars `matterId`/`from`/`to`/
 * `page`/`pageSize` blev osynliga → modellen kunde bara begära ALLT) och
 * `calendar.create`/`task.create`, som såg ut att inte ta några argument alls.
 * `"any"` låter resten av objektet överleva; `overrideDateFields` ger sedan
 * date-fälten en riktig typ (#1010).
 */
function toJsonSchema(schema: z.ZodType | null): unknown {
  if (!schema) return null;
  try {
    return z.toJSONSchema(schema, { io: "input", unrepresentable: "any", override: overrideDateFields });
  } catch {
    return null;
  }
}

/** Procedurer är callable-objekt (funktioner) → `object`-test räcker inte. */
function isObjectLike(v: unknown): v is Record<string, unknown> {
  return v !== null && (typeof v === "object" || typeof v === "function");
}

function readDef(proc: unknown): ProcedureDefLike {
  if (isObjectLike(proc) && "_def" in proc) {
    const def = proc._def;
    if (isObjectLike(def)) return def as ProcedureDefLike;
  }
  return {};
}

/** Hela procedur-ytan, sorterad på path. Ren funktion (deterministisk). */
export function listProcedures(): ProcedureInfo[] {
  const out: ProcedureInfo[] = [];
  for (const [path, proc] of Object.entries(readProcedures())) {
    const def = readDef(proc);
    out.push({
      path,
      type: isProcedureType(def.type) ? def.type : "query",
      inputSchema: toJsonSchema(lastZodInput(def.inputs)),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Path → typ, för remote-callern (query vs mutate) och MCP. */
export function procedureTypeMap(procs: readonly ProcedureInfo[]): Map<string, ProcedureType> {
  return new Map(procs.map((p) => [p.path, p.type]));
}
