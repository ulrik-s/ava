/**
 * Kostnadsräkning-dokument: ett genererat KOSTNADSRÄKNING-dokument per
 * KOSTNADSRAKNING-billing-run, så att ett ärende aldrig visar
 * "Kostnadsräkning väntar på dom" utan att kostnadsräkningen faktiskt finns
 * (regressionen upptäcktes på brottmålet ekobrott Carlsson).
 */

import { describe, it, expect } from "vitest-compat";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populateKostnadsrakningDocs } from "../../tooling/demo-generator/populate-kostnadsrakning-docs";
import { buildSeed } from "../../tooling/scripts/seed-data";
import { runDemoSeed } from "./_demo-seed";

const ADMIN = { id: asId<"UserId">("gen"), email: "g@a.se", name: "G", role: userRoleSchema.parse("ADMIN"), organizationId: asId<"OrganizationId">("firma-ab") };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** `document.tree`, inte rot-listningen: KR-dokumenten filas i
 *  Domstol/Kostnadsräkningar sedan #985, och trädet är dessutom vad UI:t läser. */
async function krDocsFor(caller: Any, matterId: string): Promise<Any[]> {
  const { documents } = await caller.document.tree({ matterId });
  return (documents as Any[]).filter((d) => d.documentType === "Kostnadsräkning");
}

describe("populateKostnadsrakningDocs", () => {
  it("genererar ett KR-dokument per KOSTNADSRAKNING-run, taggat documentType=Kostnadsräkning", async () => {
    const seed = buildSeed();
    const writes: string[] = [];
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await runDemoSeed(target.caller, seed);

    const n = await populateKostnadsrakningDocs(target.caller, (p, b) => { writes.push(p); return b.byteLength; });

    const c = target.caller as Any;
    const { runs } = await c.billingRun.list({});
    const krRuns = (runs as Any[]).filter((r) => r.type === "KOSTNADSRAKNING");
    expect(krRuns.length).toBeGreaterThan(0);
    expect(n).toBe(krRuns.length); // ett dokument per KR-run
    expect(writes.every((p) => p.startsWith("documents/content/krdoc-") && p.endsWith(".html"))).toBe(true);
  });

  it("ärendet som väntar på dom får en kostnadsräkning → 'väntar på dom' är inte längre orphan", async () => {
    const seed = buildSeed();
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await runDemoSeed(target.caller, seed);
    const c = target.caller as Any;

    // Ärendet hämtas ur DATAN i st.f. ett hårdkodat seed-id (#972): VILKET brottmål
    // som står kvar i väntan bestäms av scenariodispatchern, inte av det här testet.
    const { runs } = await c.billingRun.list({});
    const pending = (runs as Any[]).find((r) => r.type === "KOSTNADSRAKNING" && r.status === "PENDING_VERDICT");
    expect(pending, "demon ska ha en kostnadsräkning som väntar på dom").toBeDefined();
    const matterId = String(pending.matterId);

    // INNAN steget finns inget kostnadsräknings-dokument (buggen).
    expect(await krDocsFor(c, matterId)).toHaveLength(0);

    // Efter steget finns dokumentet → billing-panelens findKrDocument hittar det.
    await populateKostnadsrakningDocs(c);
    const docs = await krDocsFor(c, matterId);
    expect(docs).toHaveLength(1);
    expect(String(docs[0].fileName)).toContain("Kostnadsräkning");
  });

  it("KR-dokumentet innehåller en FULL specifikation (tidsspec + arvode + total) (#864)", async () => {
    const seed = buildSeed();
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await runDemoSeed(target.caller, seed);
    const htmls: string[] = [];
    await populateKostnadsrakningDocs(target.caller, (_p, b) => { htmls.push(new TextDecoder().decode(b)); return b.byteLength; });
    // Minst en KR har en tidsspecifikation + summering (ej längre "ospecificerad").
    const withSpec = htmls.find((h) => h.includes("Tidsspecifikation"));
    expect(withSpec, "minst en KR ska ha en tidsspecifikation").toBeDefined();
    expect(withSpec).toContain("Summa att fastställa av rätten");
    // Rättshjälps-KR:n (den med rådgivningsnotis) värderas på timkostnadsnormen.
    const rattshjalp = htmls.find((h) => h.includes("Rådgivningstimme"));
    expect(rattshjalp, "en rättshjälps-KR ska ha rådgivningsnotis").toBeDefined();
    expect(rattshjalp).toContain("Arvode (timkostnadsnormen)");
    expect(rattshjalp).toContain("Tidsspecifikation");
  });
});
