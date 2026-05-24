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

import { FsaIsoGitAdapter } from "@/client/lib/fsa/fs-adapter";
import type { DemoSource } from "@/server/data-store/DemoDataStore";
import { prebakeJoins } from "@/client/lib/demo/prebake-joins";

/** Path-prefix → DemoSource-fält. Speglar ENTITY_TO_PATH i fsa-write-back. */
const PREFIX_TO_KEY: Array<[string, keyof DemoSource]> = [
  ["matters/active", "matters"],
  ["contacts", "contacts"],
  ["matter-contacts", "matterContacts"],
  ["documents", "documents"],
  ["document-folders", "documentFolders"],
  ["document-analysis-suggestions", "documentAnalysisSuggestions"],
  ["matter-event-suggestions", "matterEventSuggestions"],
  ["time-entries", "timeEntries"],
  ["expenses", "expenses"],
  ["invoices", "invoices"],
  ["payments", "payments"],
  ["payment-plans", "paymentPlans"],
  ["acconto-deductions", "accontoDeductions"],
  ["offices", "offices"],
  ["conflict-checks", "conflictChecks"],
  [".ava/users", "users"],
  [".ava/templates", "documentTemplates"],
  [".ava/organizations", "organizations"],
];

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

export async function hydrateWorkingCopy(
  root: FileSystemDirectoryHandle,
): Promise<DemoSource> {
  const fs = new FsaIsoGitAdapter(root);
  const out: DemoSource = {};
  for (const [prefix, key] of PREFIX_TO_KEY) {
    const rows = await readJsonDir(fs, prefix);
    if (rows.length) (out as Record<string, readonly unknown[]>)[key as string] = rows;
  }
  return prebakeJoins(out);
}
