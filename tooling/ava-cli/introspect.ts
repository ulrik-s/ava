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

/** zod → JSON-schema; fail-soft till `null` för scheman zod inte kan serialisera. */
function toJsonSchema(schema: z.ZodType | null): unknown {
  if (!schema) return null;
  try {
    return z.toJSONSchema(schema, { io: "input" });
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
