/**
 * `hydrateWorkingCopy` — läser JSON-entiteterna i en (klonad) working copy
 * och bygger en `DemoSource` för `DemoDataStore`.
 *
 * Detta är invers till `fsa-write-back.ts`: samma path-konvention, åt andra
 * hållet. Används av self-hosted/OPFS-runtimen efter att repo:t klonats in i
 * arbets-mappen (FSA- eller OPFS-handle), så UI:t läser från den lokala
 * git-clone:n istället för GH-Pages.
 *
 * DRY: join-prebakningen delas med `demoSourceFromRuntime` via `prebakeJoins`.
 */

import { FsaIsoGitAdapter } from "@/lib/client/fsa/fs-adapter";
import type { DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { prebakeJoins } from "@/lib/client/demo/prebake-joins";
import { ENTITY_REGISTRY, ENTITY_NAMES, type EntityName } from "@/lib/shared/schemas";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** JSON.parse-reviver: ISO-8601-strängar → Date (write-back serialiserar Date som ISO). */
function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

async function readJsonDir(
  fs: FsaIsoGitAdapter,
  prefix: string,
): Promise<Record<string, unknown>[]> {
  let names: string[];
  try {
    names = await fs.readdir("/" + prefix);
  } catch {
    return []; // mappen finns inte i denna clone (sparse) → tom
  }
  const rows: Record<string, unknown>[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const text = (await fs.readFile("/" + prefix + "/" + name, "utf8")) as string;
      rows.push(JSON.parse(text, reviveDates) as Record<string, unknown>);
    } catch {
      // Korrupt/halv fil → hoppa över (samma tolerans som DemoLoader)
    }
  }
  return rows;
}

/**
 * Validera och normalisera en rad mot dess Zod-schema. Vid valideringsfel:
 * varna i konsolen men släpp igenom rådatan så vi inte kraschar på legacy-
 * filer. (Strikt validering kan slås på via env-flagga senare.)
 */
function validateRow(entity: EntityName, row: Record<string, unknown>): Record<string, unknown> {
  const schema = ENTITY_REGISTRY[entity].schema;
  const result = schema.safeParse(row);
  if (!result.success) {
    console.warn(
      `[hydrate] ${entity}/${String(row.id ?? "?")} schema-validering misslyckades:`,
      result.error.issues.slice(0, 3),
    );
    return row;
  }
  return result.data as Record<string, unknown>;
}

export async function hydrateWorkingCopy(
  root: FileSystemDirectoryHandle,
): Promise<DemoSource> {
  const fs = new FsaIsoGitAdapter(root);
  const out: DemoSource = {};
  for (const entity of ENTITY_NAMES) {
    const { gitPrefix, sourceKey } = ENTITY_REGISTRY[entity];
    const rows = await readJsonDir(fs, gitPrefix);
    if (!rows.length) continue;
    const validated = rows.map((r) => validateRow(entity, r));
    (out as Record<string, readonly unknown[]>)[sourceKey] = validated;
  }
  return prebakeJoins(out);
}
