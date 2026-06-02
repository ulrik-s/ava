/**
 * `generateInto` — delad kärna för att generera demo-data via tRPC-API:t in
 * i en git-katalog. Används av:
 *   • generate.ts          (fristående `yarn demo:generate`)
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
import { buildSeed, type BuildSeedOpts } from "../scripts/seed-data";
import { makeNodeGitWriteBack } from "./node-git-writeback";
import { createGitTarget } from "./backend-target";
import { populate, type PopulateResult } from "./populate";
import { populateBilling, type BillingResult } from "./populate-billing";
import { populateDocuments } from "./populate-documents";
import { populateTemplateDocs } from "./populate-template-docs";
import { populateInvoiceDocs } from "./populate-invoice-docs";
import { populateKostnadsrakningDocs } from "./populate-kostnadsrakning-docs";
import { populateUnbilledTime } from "./populate-unbilled-time";
import { populateBillingRuns, type BillingRunsResult } from "./populate-billing-runs";
import { createIdTranslator, translateSeed, type IdTranslator } from "./id-translator";
import type { Principal } from "@/lib/server/auth/principal";

export interface GenerateResult extends PopulateResult {
  documents: number;
  templateDocs: number;
  invoiceDocs: number;
  kostnadsrakningDocs: number;
  billing: BillingResult;
  billingRuns: BillingRunsResult;
  unbilledTimeEntries: number;
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
    id: currentUserId, email: "generator@ava.local", name: "Demo Generator",
    role: "ADMIN", organizationId: orgId,
  };
  const target = createGitTarget({ principal, writeBack: makeNodeGitWriteBack(outDir) });

  const res = await populate(target.caller, seed);
  const billing = await populateBilling(target.caller, seed); // efter time/expenses
  // Nya BillingRun-modellen: aconto/slutfaktura/kostnadsräkning per paymentMethod.
  // Körs efter populateBilling så vi inte konfliktar med legacy-flow:n.
  const billingRuns = await populateBillingRuns(target.caller, seed);
  // Färsk upparbetad tid EFTER billing → entries med invoiceId=null.
  // Simulerar löpande arbete som inte hunnit faktureras ännu.
  const unbilledTimeEntries = await populateUnbilledTime(target.caller, seed);
  const sink = (storagePath: string, bytes: Uint8Array): number => {
    const full = join(outDir, storagePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    return bytes.byteLength;
  };
  const documents = await populateDocuments(target.caller, seed, sink);
  const templateDocs = await populateTemplateDocs(target.caller, seed, sink); // mall→ärende-flödet
  const invoiceDocs = await populateInvoiceDocs(target.caller, sink); // faktura-dokument länkade till fakturan
  // KR-dokument per KOSTNADSRAKNING-run → ärendet visar inte "väntar på dom"
  // utan att kostnadsräkningen faktiskt finns (kohärent demo-state).
  const kostnadsrakningDocs = await populateKostnadsrakningDocs(target.caller, sink);
  await target.finalize();
  return { ...res, documents, templateDocs, invoiceDocs, kostnadsrakningDocs, billing, billingRuns, unbilledTimeEntries, translator };
}
