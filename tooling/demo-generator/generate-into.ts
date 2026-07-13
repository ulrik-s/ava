/**
 * `generateInto` — delad kärna för att generera demo-data via tRPC-API:t in
 * i en git-katalog. Används av:
 *   • generate.ts          (fristående `bun run demo:generate`)
 *   • build-demo-repo.ts   (GH-Pages-demon → skriver ovanpå out/)
 *   • seed-firma-local.ts  (docker self-hosted-repo + push)
 *
 * Kör populate (entiteter) → populateBilling (faktureringsflöden) →
 * populateDocuments (metadata + binärfiler). Skriver JSON via samma writeBack
 * som appens self-hosted (`makeNodeGitWriteBack`) och binärer via en sink mot
 * `outDir`. Anroparen sköter katalog-/git-hanteringen (rm/purge/commit/push).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Principal } from "@/lib/server/auth/principal";
import { asId } from "@/lib/shared/schemas/ids";
import { buildSeed, type BuildSeedOpts } from "../scripts/seed-data";
import { createGitTarget } from "./backend-target";
import { createIdTranslator, translateSeed, type IdTranslator } from "./id-translator";
import { makeNodeGitWriteBack } from "./node-git-writeback";
import { populate, type PopulateResult } from "./populate";
import { populateInvoiceDocs } from "./populate-invoice-docs";
import { populateKostnadsrakningDocs } from "./populate-kostnadsrakning-docs";
import { runSimulation } from "./simulate/orchestrate";
import type { RunCtx } from "./simulate/runner";

export interface GenerateResult extends PopulateResult {
  /** Narrativa dokument (in/ut) skapade av simuleringen. */
  documents: number;
  invoiceDocs: number;
  kostnadsrakningDocs: number;
  /** Räknare från den kronologiska simuleringen (#880). */
  sim: RunCtx["res"];
  /** Reverse-mappning UUID → slug. meta.json + URL-routing använder den. */
  translator: IdTranslator;
}

export async function generateInto(outDir: string, seedOpts: BuildSeedOpts = {}): Promise<GenerateResult> {
  // 1. Bygg seed i slug-format (developer-ergonomi).
  // 2. Översätt alla IDs till UUIDv5(slug) → alla downstream populate-anrop
  //    skickar UUID:n till mutations precis som prod (ADR 0003).
  const translator = createIdTranslator();
  const seed = translateSeed(buildSeed(seedOpts), translator);
  const orgId = String(seed.organizations?.[0]?.id ?? "");
  if (!orgId) throw new Error("Seed saknar organization-rad");
  const currentUserIdSlug = seedOpts.currentUserId ?? "current-user";
  const currentUserId = translator.toUuid(currentUserIdSlug);
  const principal: Principal = {
    id: asId<"UserId">(currentUserId), email: "generator@ava.local", name: "Demo Generator",
    role: "ADMIN", organizationId: asId<"OrganizationId">(orgId),
  };
  const target = createGitTarget({ principal, writeBack: makeNodeGitWriteBack(outDir) });

  // Kärnentiteter FÖRE ärende-arbetet: org/users/contacts/matters/kalender/tasks/
  // mallar/jäv. Tid/utlägg/kontakter(motpart)/dokument skapas kronologiskt av
  // simuleringen (#880), inte ur seedens statiska rader → tomma här. Ärenden skapas
  // som ACTIVE (annars blockerar flödes-guarden scenariot); stängs sen i runSimulation.
  const coreSeed = {
    ...seed,
    matters: (seed.matters ?? []).map((m) => ({ ...m, status: "ACTIVE" })),
    timeEntries: [], expenses: [], matterContacts: [], documents: [], serviceNotes: [],
  };
  const res = await populate(target.caller, coreSeed);

  const sink = (storagePath: string, bytes: Uint8Array): number => {
    const full = join(outDir, storagePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    return bytes.byteLength;
  };
  // Kronologisk simulering per ärende (#880): parter → rådgivning → arbete/dokument
  // (in/ut) → aconton → kostnadsräkning/slutreglering, i tidsordning.
  const ctx: RunCtx = { c: target.caller, sink, res: { invoices: 0, documents: 0, timeEntries: 0, notes: 0, credits: 0 } };
  await runSimulation(ctx, seed);

  // Faktura-/KR-HTML-dokument som EFTER-pass (läser skapade fakturor/runs; renderar
  // settlementBreakdown efter #878).
  const invoiceDocs = await populateInvoiceDocs(target.caller, sink);
  const kostnadsrakningDocs = await populateKostnadsrakningDocs(target.caller, sink);
  await target.finalize();
  return { ...res, documents: ctx.res.documents, invoiceDocs, kostnadsrakningDocs, sim: ctx.res, translator };
}
