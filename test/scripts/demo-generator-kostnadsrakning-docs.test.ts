/**
 * Kostnadsräkning-dokument: ett genererat KOSTNADSRÄKNING-dokument per
 * KOSTNADSRAKNING-billing-run, så att ett ärende aldrig visar
 * "Kostnadsräkning väntar på dom" utan att kostnadsräkningen faktiskt finns
 * (regression: brottmål ekobrott Carlsson — PENDING_VERDICT utan dokument).
 */

import { describe, it, expect } from "vitest-compat";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { populateBilling } from "../../tooling/demo-generator/populate-billing";
import { populateBillingRuns } from "../../tooling/demo-generator/populate-billing-runs";
import { populateKostnadsrakningDocs } from "../../tooling/demo-generator/populate-kostnadsrakning-docs";
import { buildSeed } from "../../tooling/scripts/seed-data";

const ADMIN = { id: "gen", email: "g@a.se", name: "G", role: "ADMIN", organizationId: "firma-ab" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const CARLSSON_MATTER = "m-018-brottmal-ekobrott";

async function krDocsFor(caller: Any, matterId: string): Promise<Any[]> {
  const { documents } = await caller.document.list({ matterId, folderId: null, pageSize: 100 });
  return (documents as Any[]).filter((d) => d.documentType === "Kostnadsräkning");
}

describe("populateKostnadsrakningDocs", () => {
  it("genererar ett KR-dokument per KOSTNADSRAKNING-run, taggat documentType=Kostnadsräkning", async () => {
    const seed = buildSeed();
    const writes: string[] = [];
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, seed);
    await populateBilling(target.caller, seed);
    await populateBillingRuns(target.caller, seed);

    const n = await populateKostnadsrakningDocs(target.caller, (p, b) => { writes.push(p); return b.byteLength; });

    const c = target.caller as Any;
    const { runs } = await c.billingRun.list({});
    const krRuns = (runs as Any[]).filter((r) => r.type === "KOSTNADSRAKNING");
    expect(krRuns.length).toBeGreaterThan(0);
    expect(n).toBe(krRuns.length); // ett dokument per KR-run
    expect(writes.every((p) => p.startsWith("documents/content/krdoc-") && p.endsWith(".html"))).toBe(true);
  });

  it("Carlsson-ärendet (PENDING_VERDICT) får en kostnadsräkning → 'väntar på dom' är inte längre orphan", async () => {
    const seed = buildSeed();
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, seed);
    await populateBilling(target.caller, seed);
    await populateBillingRuns(target.caller, seed);
    const c = target.caller as Any;

    // Precondition: Carlsson HAR en KOSTNADSRAKNING-run i PENDING_VERDICT…
    const { runs } = await c.billingRun.list({ matterId: CARLSSON_MATTER });
    const pending = (runs as Any[]).find((r) => r.type === "KOSTNADSRAKNING" && r.status === "PENDING_VERDICT");
    expect(pending, "Carlsson ska ha en kostnadsräkning som väntar på dom").toBeDefined();

    // …men INNAN steget finns inget kostnadsräknings-dokument (buggen).
    expect(await krDocsFor(c, CARLSSON_MATTER)).toHaveLength(0);

    // Efter steget finns dokumentet → billing-panelens findKrDocument hittar det.
    await populateKostnadsrakningDocs(c);
    const docs = await krDocsFor(c, CARLSSON_MATTER);
    expect(docs).toHaveLength(1);
    expect(String(docs[0].fileName)).toContain("Kostnadsräkning");
  });
});
