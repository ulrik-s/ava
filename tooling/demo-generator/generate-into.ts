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
import type { Principal } from "@/lib/server/auth/principal";

export interface GenerateResult extends PopulateResult {
  documents: number;
  billing: BillingResult;
}

export async function generateInto(outDir: string, seedOpts: BuildSeedOpts = {}): Promise<GenerateResult> {
  const seed = buildSeed(seedOpts);
  const orgId = String(seed.organizations?.[0]?.id ?? "firma-ab");
  // Principal-id = "inloggad" user → recordPayment/conflict-check får rätt
  // recordedById/checkedById (refererar en user som faktiskt seedas).
  const currentUserId = seedOpts.currentUserId ?? "current-user";
  const principal: Principal = {
    id: currentUserId, email: "generator@ava.local", name: "Demo Generator",
    role: "ADMIN", organizationId: orgId,
  };
  const target = createGitTarget({ principal, writeBack: makeNodeGitWriteBack(outDir) });

  const res = await populate(target.caller, seed);
  const billing = await populateBilling(target.caller, seed); // efter time/expenses
  const documents = await populateDocuments(target.caller, seed, (storagePath, bytes) => {
    const full = join(outDir, storagePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    return bytes.byteLength;
  });
  await target.finalize();
  return { ...res, documents, billing };
}
