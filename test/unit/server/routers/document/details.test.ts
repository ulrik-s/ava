/**
 * document.updateDetails — juristens egna ändringar av ett dokuments uppgifter,
 * mot en riktig in-memory-store. Viktigast: en rättad klassning ska överleva en
 * ny AI-analys (klassningshanteraren körs efteråt mot samma delar).
 */

import type { Job } from "pg-boss";
import { describe, expect, it } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { createClassifyDocumentHandler } from "@/lib/server/jobs/handlers/classify-document-handler";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

const ORG = "org-a";
const part = (id: string, ordinal: number, pages: [number, number], kind: string) =>
  ({ id, documentId: "d1", matterId: "m1", ordinal, kind, fromPage: pages[0], toPage: pages[1], source: "AUTO", version: 1 });

function makeCaller(docExtra: Record<string, unknown> = {}, parts = [part("p1", 0, [1, 2], "KALLELSE"), part("p2", 1, [3, 3], "STAMNING")]) {
  const source = prebakeJoins({
    organizations: [{ id: ORG, name: "Byrån", documentKinds: ["Korrespondens"] }],
    matters: [
      { id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" },
      { id: "m2", organizationId: "org-b", matterNumber: "2026-2", title: "Annan" },
    ],
    documents: [
      { id: "d1", matterId: "m1", fileName: "inkommet.pdf", documentType: "KALLELSE", analysisModel: "llm", ...docExtra },
      { id: "d2", matterId: "m2", fileName: "annan.pdf" },
    ],
    documentParts: parts,
  });
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store);
  const ctx = { user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: ORG }, dataStore: store, repos, orgId: ORG, ports: {} };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), repos };
}

const doc = async (repos: ReturnType<typeof makeCaller>["repos"]) => repos.documents.getById("d1" as never);

describe("document.updateDetails", () => {
  it("byter visningsnamn; filändelsen behålls och lagringen rörs inte", async () => {
    const { caller, repos } = makeCaller({ storagePath: "documents/content/d1.pdf" });
    await caller.updateDetails({ documentId: "d1", fileName: "Stämningsansökan / Gustafsson" });
    const d = await doc(repos);
    expect(d?.fileName).toBe("Stämningsansökan Gustafsson.pdf");
    expect(d?.storagePath).toBe("documents/content/d1.pdf");
  });

  it("tomt filnamn vägras", async () => {
    const { caller } = makeCaller();
    await expect(caller.updateDetails({ documentId: "d1", fileName: "  " })).rejects.toThrow(/tomt/);
  });

  it("titel, riktning, mottagare och sammanfattning; tom text → null", async () => {
    const { caller, repos } = makeCaller({ title: "Gammal", summary: "x" });
    await caller.updateDetails({ documentId: "d1", title: "Ny titel", direction: "INKOMMANDE", recipient: "DOMSTOL", summary: "" });
    expect(await doc(repos)).toMatchObject({ title: "Ny titel", direction: "INKOMMANDE", recipient: "DOMSTOL", summary: null });
  });

  it("flera typer: sätts i ordning, av en person (kindsManual), primärtypen speglas", async () => {
    const { caller, repos } = makeCaller();
    await caller.updateDetails({ documentId: "d1", kinds: ["Förordnande", "DOM", "Korrespondens"] });
    expect(await doc(repos)).toMatchObject({ kinds: ["FORORDNANDE", "DOM", "Korrespondens"], kindsManual: true, documentType: "FORORDNANDE" });
  });

  it("okänd egen typ nekas med hänvisning till inställningarna", async () => {
    const { caller } = makeCaller();
    await expect(caller.updateDetails({ documentId: "d1", kinds: ["Påhittad"] })).rejects.toThrow(/Okända dokumenttyper: Påhittad/);
  });

  it("en äldre fritexttyp som dokumentet redan har går att behålla", async () => {
    const { caller, repos } = makeCaller({ kinds: ["Gammal fritext"] });
    await caller.updateDetails({ documentId: "d1", kinds: ["Gammal fritext", "DOM"] });
    expect((await doc(repos))?.kinds).toEqual(["Gammal fritext", "DOM"]);
  });

  it("äldre form (documentType från en gammal flik): byter primärtypen, resten står kvar", async () => {
    const { caller, repos } = makeCaller({ kinds: ["KALLELSE", "Korrespondens"] });
    await caller.updateDetails({ documentId: "d1", documentType: "DOM" });
    expect(await doc(repos)).toMatchObject({ kinds: ["DOM", "Korrespondens"], kindsManual: true });
  });

  it("annan byrås dokument → nekas", async () => {
    const { caller } = makeCaller();
    await expect(caller.updateDetails({ documentId: "d2", title: "x" })).rejects.toThrow();
  });

  it("en ny AI-analys skriver inte över typerna en person satt", async () => {
    const { caller, repos } = makeCaller();
    await caller.updateDetails({ documentId: "d1", kinds: ["DOM"] });
    // Samma sidantal som delarna täcker (3) → manuella delar bevaras vid omkörning.
    const pages = ["KALLELSE\nText.", "forts.", "STÄMNINGSANSÖKAN\nText."];
    const job = { id: "j", name: JOB_QUEUES.classifyDocument, data: { documentId: "d1" }, expireInSeconds: 60, heartbeatSeconds: null, retryCount: 0, signal: AbortSignal.abort() } as Job;
    await createClassifyDocumentHandler({ documents: repos.documents, parts: repos.documentParts, readPages: () => Promise.resolve(pages) })(job);
    expect(await doc(repos)).toMatchObject({ kinds: ["DOM"], kindsManual: true, analysisStatus: "DONE" });
  });
});
