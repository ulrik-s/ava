#!/usr/bin/env bun
/**
 * Träffsäkerheten för dokumentklassningen (#2018) — kör samma klassning som
 * `classify-document`-jobbet mot dokument där en person har satt typerna själv
 * (`kinds_manual = true`, ADR 0038 §2) och skriver en rapport i markdown.
 *
 * Inget jobb köas: jobbet hoppar över dokument med manuella typer och skulle
 * alltså inte klassa just facit. Klassningen anropas direkt (`segmentPages` med
 * jobbets reserv `guessFromFilename`, och LLM:en bara när `AVA_LLM_*` finns).
 * Skriptet läser bara (SELECT), skriver inga filer och kör ett dokument i taget.
 *
 * Rapporten har bara inbyggda typer och siffror — aldrig dokument-id,
 * filnamn, titel, sidtext, ärende eller byråns egna typnamn.
 *
 *   AVA_DATABASE_URL=postgres://… bun tooling/scripts/document-kinds-accuracy.ts [--limit N]
 *
 * Körinstruktionen: docs/deploy-server-first.md, "Mät träffsäkerheten".
 */

import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { createPostgresDb } from "@/lib/server/db/client";
import { documentPages, documents } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { createOllamaPartClassifier, loadLlmConfigFromEnv } from "@/lib/server/llm/ollama-classifier";
import { type DocumentKind, guessFromFilename, isDocumentKind, KNOWN_KINDS } from "@/lib/shared/document-kind";
import { documentKinds, normalizeKinds, sameKinds } from "@/lib/shared/document-kinds";
import { DEFAULT_MAX_LLM_CALLS, type PartClassifier, segmentPages } from "@/lib/shared/document-segmentation";
import type { DocumentId } from "@/lib/shared/schemas/ids";

/** Ett dokument i facit: det klassningen och läsregeln behöver. */
export interface TruthDocument {
  id: DocumentId;
  fileName: string;
  kinds: string[];
  kindsManual: boolean;
  documentType: string | null;
  tags: string[];
}

/** Ett mätt dokument: facit, klassningens typer, tid och anrop. */
export interface Measurement {
  truth: DocumentKind[];
  predicted: string[];
  ms: number;
  calls: number;
}

/** Utfallet för ett dokument: mätt, eller överhoppat (ingen sidtext, bara egna typer). */
export type Outcome = { kind: "measured"; m: Measurement } | { kind: "skipped" };

/** Siffrorna för en inbyggd typ. */
export interface KindStats {
  kind: DocumentKind;
  inTruth: number;
  hits: number;
  falseHits: number;
}

/** Spridningen för ett mått (tid eller anrop) per dokument. */
export interface Spread { median: number; p90: number; max: number }

/** Rapportens underlag. */
export interface AccuracyReport {
  model: string | null;
  measured: number;
  skipped: number;
  perKind: KindStats[];
  primaryCorrect: number;
  exactCorrect: number;
  ms: Spread;
  calls: Spread;
}

/**
 * Facit: levande dokument med manuella typer, de senaste först. Systemets
 * dokument (kostnadsräkningar och fakturor via körning/faktura, importerad
 * e-post) räknas inte — där har ingen person valt typen.
 */
export async function listTruthDocuments(db: AppDb, limit?: number): Promise<TruthDocument[]> {
  const q = db.select({
    id: documents.id, fileName: documents.fileName, kinds: documents.kinds, kindsManual: documents.kindsManual,
    documentType: documents.documentType, tags: documents.tags,
  }).from(documents).where(and(
    isNull(documents.deletedAt), eq(documents.kindsManual, true), isNull(documents.billingRunId),
    isNull(documents.invoiceId), ne(documents.mimeType, "message/rfc822"),
  )).orderBy(desc(documents.createdAt));
  return limit === undefined ? q : q.limit(limit);
}

/** Dokumentets sidtext i sidordning (tom lista utan rader i `document_pages`). */
export async function readPages(db: AppDb, id: DocumentId): Promise<string[]> {
  const rows = await db.select({ text: documentPages.text }).from(documentPages)
    .where(eq(documentPages.documentId, id)).orderBy(asc(documentPages.pageNo));
  return rows.map((r) => r.text);
}

/** Facit: dokumentets inbyggda typer enligt läsregeln (byråns egna filtreras bort). */
export function truthKinds(d: TruthDocument): DocumentKind[] {
  return normalizeKinds(documentKinds(d)).filter(isDocumentKind);
}

/** Klassificeraren inlindad så att anropen räknas. */
function counting(classify: PartClassifier | undefined): { classify?: PartClassifier; calls: () => number } {
  let n = 0;
  if (!classify) return { calls: () => n };
  return { classify: async (text) => { n++; return classify(text); }, calls: () => n };
}

/**
 * Klassningen som i jobbet: delarnas typer i sidordning, med filnamnet som
 * reserv. Returnerar typerna och antalet anrop till klassificeraren.
 */
export async function classifyPages(
  pages: readonly string[], fileName: string, classify?: PartClassifier,
): Promise<{ kinds: string[]; calls: number }> {
  const fallbackKind = guessFromFilename(fileName);
  const counter = counting(classify);
  const parts = await segmentPages(pages, {
    fallbackKind, maxLlmCalls: DEFAULT_MAX_LLM_CALLS, ...(counter.classify ? { classify: counter.classify } : {}),
  });
  const kinds = parts.length > 0 ? parts.map((p) => p.kind) : [fallbackKind];
  return { kinds: normalizeKinds(kinds), calls: counter.calls() };
}

/** Mät ett dokument; överhoppat utan sidtext eller utan inbyggda typer i facit. */
export async function measureDocument(
  db: AppDb, d: TruthDocument, classify: PartClassifier | undefined, now: () => number,
): Promise<Outcome> {
  const truth = truthKinds(d);
  if (truth.length === 0) return { kind: "skipped" };
  const pages = await readPages(db, d.id);
  if (pages.length === 0) return { kind: "skipped" };
  const start = now();
  const { kinds, calls } = await classifyPages(pages, d.fileName, classify);
  return { kind: "measured", m: { truth, predicted: kinds, ms: now() - start, calls } };
}

/** Träffar och falska träffar för en typ. */
export function kindStats(kind: DocumentKind, ms: readonly Measurement[]): KindStats {
  const inTruth = ms.filter((m) => m.truth.includes(kind));
  const predicted = ms.filter((m) => m.predicted.includes(kind));
  const hits = inTruth.filter((m) => m.predicted.includes(kind)).length;
  return { kind, inTruth: inTruth.length, hits, falseHits: predicted.length - hits };
}

/** Värdet på percentilen `p` (0–1, närmaste rang); 0 för en tom lista. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

/** Median, p90 och max. */
export function spread(values: readonly number[]): Spread {
  return { median: percentile(values, 0.5), p90: percentile(values, 0.9), max: percentile(values, 1) };
}

/** Sammanställ utfallen till rapportens underlag. Typer som varken finns i facit eller gissats tas inte med. */
export function summarize(outcomes: readonly Outcome[], model: string | null): AccuracyReport {
  const ms = outcomes.flatMap((o) => (o.kind === "measured" ? [o.m] : []));
  return {
    model, measured: ms.length, skipped: outcomes.length - ms.length,
    perKind: KNOWN_KINDS.map((k) => kindStats(k, ms)).filter((s) => s.inTruth + s.falseHits > 0),
    primaryCorrect: ms.filter((m) => m.predicted[0] === m.truth[0]).length,
    exactCorrect: ms.filter((m) => sameKinds(m.truth, m.predicted)).length,
    ms: spread(ms.map((m) => m.ms)), calls: spread(ms.map((m) => m.calls)),
  };
}

/** Andel i procent med en decimal; "–" när nämnaren är 0. */
export function pct(n: number, of: number): string {
  return of === 0 ? "–" : `${((100 * n) / of).toFixed(1)} %`;
}

function kindRow(s: KindStats): string {
  return `| ${s.kind} | ${s.inTruth} | ${s.hits} | ${s.falseHits} | ${pct(s.hits, s.inTruth)} | ${pct(s.hits, s.hits + s.falseHits)} |`;
}

/** Rapporten som markdown. */
export function formatReport(r: AccuracyReport): string {
  return [
    "# Dokumentklassningens träffsäkerhet",
    "",
    `- Modell: ${r.model ?? "ingen LLM: bara rubrik och filnamn"}`,
    `- Mätta dokument: ${r.measured}`,
    `- Överhoppade dokument (ingen sidtext eller bara byråns egna typer): ${r.skipped}`,
    `- Rätt primärtyp: ${pct(r.primaryCorrect, r.measured)}`,
    `- Exakt samma typer: ${pct(r.exactCorrect, r.measured)}`,
    `- Tid per dokument (ms): median ${r.ms.median}, p90 ${r.ms.p90}, max ${r.ms.max}`,
    `- Anrop till klassificeraren per dokument: median ${r.calls.median}, p90 ${r.calls.p90}, max ${r.calls.max}`,
    "",
    "| Typ | I facit | Träffar | Falska träffar | Träffsäkerhet | Precision |",
    "|---|---|---|---|---|---|",
    ...r.perKind.map(kindRow),
    "",
  ].join("\n");
}

/** Klassificeraren och modellens namn ur env; utan LLM-konfig bara rubrik och filnamn. */
export function classifierFromEnv(env: Record<string, string | undefined>): { classify?: PartClassifier; model: string | null } {
  const config = loadLlmConfigFromEnv(env);
  return config ? { classify: createOllamaPartClassifier(config), model: config.model } : { model: null };
}

/** Det mätningen behöver utöver databasen — injicerbart i tester. */
export interface AccuracyOptions {
  limit?: number;
  classify?: PartClassifier;
  model: string | null;
  now?: () => number;
}

/** Mät facit, ett dokument i taget, och returnera rapportens underlag. */
export async function measureAccuracy(db: AppDb, opts: AccuracyOptions): Promise<AccuracyReport> {
  const now = opts.now ?? (() => performance.now());
  const outcomes: Outcome[] = [];
  for (const d of await listTruthDocuments(db, opts.limit)) {
    outcomes.push(await measureDocument(db, d, opts.classify, now));
  }
  return summarize(outcomes, opts.model);
}

/** Anslutningen mätningen behöver — injicerbar i tester. */
export interface AccuracyConnection {
  db: AppDb;
  close: () => Promise<void>;
}

function connect(url: string): Promise<AccuracyConnection> {
  return Promise.resolve(createPostgresDb(url, { max: 1 }));
}

/** Anslut, mät, stäng (även när mätningen fallerar). Returnerar rapporten. */
export async function runAccuracy(
  url: string, opts: AccuracyOptions, open: (url: string) => Promise<AccuracyConnection> = connect,
): Promise<string> {
  const conn = await open(url);
  try {
    return formatReport(await measureAccuracy(conn.db, opts));
  } finally {
    await conn.close();
  }
}

/** `--limit N` → N (ett positivt heltal); annars undefined. */
export function parseLimit(argv: readonly string[]): number | undefined {
  const i = argv.indexOf("--limit");
  const n = Number(argv[i + 1]);
  return i >= 0 && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Skriptets ingång, med process-I/O injicerbar för testet. */
export async function main(
  argv: readonly string[], env: Record<string, string | undefined>,
  out: { stdout: (s: string) => void; stderr: (s: string) => void; fail: () => void },
  open: (url: string) => Promise<AccuracyConnection> = connect,
): Promise<void> {
  const url = env.AVA_DATABASE_URL;
  if (!url) {
    out.stderr("document-kinds-accuracy: ange Postgres-URL via AVA_DATABASE_URL\n");
    out.fail();
    return;
  }
  const limit = parseLimit(argv);
  out.stdout(await runAccuracy(url, { ...classifierFromEnv(env), ...(limit === undefined ? {} : { limit }) }, open));
}

// Kör bara som script (inte vid import i tester).
if (import.meta.main) {
  const out = {
    stdout: (s: string) => { process.stdout.write(s); },
    stderr: (s: string) => { process.stderr.write(s); },
    fail: () => { process.exitCode = 1; },
  };
  main(process.argv.slice(2), process.env, out).catch((err: unknown) => {
    process.stderr.write(`document-kinds-accuracy: ${String(err)}\n`);
    process.exitCode = 1;
  });
}
