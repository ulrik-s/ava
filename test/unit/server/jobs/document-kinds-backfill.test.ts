/**
 * Backfillen av dokumentens typer (ADR 0038) mot en riktig in-memory-store:
 * äldre fritext, taggar och delar flyttas till `kinds` utan att något tappas,
 * byråns taggvokabulär blir egna typer, och en omkörning gör ingenting.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { backfillDocumentKinds } from "@/lib/server/jobs/document-kinds-backfill";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = asId<"OrganizationId">("org-a");

function setup() {
  const source = prebakeJoins({
    organizations: [{ id: ORG, name: "Byrån", documentTags: ["Kallelse", "Korrespondens", "Bevisning"] }],
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [
      { id: "kr", matterId: "m1", fileName: "kr.pdf", documentType: "Kostnadsräkning" },
      { id: "fup", matterId: "m1", fileName: "scan.pdf", documentType: "KALLELSE", analysisModel: "llm", tags: ["Korrespondens"] },
      { id: "new", matterId: "m1", fileName: "x.pdf", kinds: ["DOM"], documentType: "DOM" },
      { id: "none", matterId: "m1", fileName: "y.pdf" },
    ],
    documentParts: [
      { id: "p1", documentId: "fup", matterId: "m1", ordinal: 0, kind: "KALLELSE", fromPage: 1, toPage: 1, source: "AUTO", version: 1 },
      { id: "p2", documentId: "fup", matterId: "m1", ordinal: 1, kind: "FUP", fromPage: 2, toPage: 3, source: "AUTO", version: 1 },
    ],
  });
  const repos = buildInMemoryRepositories(new LocalStore(source, async () => {}));
  return { repos };
}

describe("backfillDocumentKinds", () => {
  it("flyttar äldre fält till kinds, byråns taggar till egna typer, och är idempotent", async () => {
    const { repos } = setup();
    const first = await backfillDocumentKinds(repos, [ORG], () => {});
    expect(first).toEqual({ documents: 2, organizations: 1, failed: 0 });

    expect(await repos.documents.getById(asId<"DocumentId">("kr"))).toMatchObject({ kinds: ["KOSTNADSRAKNING"], kindsManual: true, documentType: "KOSTNADSRAKNING", tags: [] });
    expect(await repos.documents.getById(asId<"DocumentId">("fup"))).toMatchObject({ kinds: ["KALLELSE", "FUP", "Korrespondens"], kindsManual: false, tags: [] });
    expect(await repos.documents.getById(asId<"DocumentId">("new"))).toMatchObject({ kinds: ["DOM"] });
    expect(await repos.organizations.getById(ORG)).toMatchObject({ documentKinds: ["Korrespondens"], documentTags: [] });

    expect(await backfillDocumentKinds(repos, [ORG], () => {})).toEqual({ documents: 0, organizations: 0, failed: 0 });
  });

  it("ett fel per rad loggas och räknas — resten flyttas ändå", async () => {
    const { repos } = setup();
    const onError = vi.fn();
    // Repona är klassinstanser — en spridning tappar metoderna, så omslaget anger dem.
    const failing = {
      listWithLegacyKinds: () => repos.documents.listWithLegacyKinds(),
      updateMetadata: vi.fn().mockRejectedValueOnce(new Error("db nere"))
        .mockImplementation((id: Parameters<typeof repos.documents.updateMetadata>[0], patch: Parameters<typeof repos.documents.updateMetadata>[1]) => repos.documents.updateMetadata(id, patch)),
    };
    const result = await backfillDocumentKinds({ ...repos, documents: failing }, [], onError);
    expect(result).toEqual({ documents: 1, organizations: 0, failed: 1 });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("db nere"));
  });

  it("listan går inte att läsa → inget flyttas, felet loggas, kastar inte", async () => {
    const { repos } = setup();
    const onError = vi.fn();
    const broken = { listWithLegacyKinds: () => Promise.reject(new Error("timeout")), updateMetadata: vi.fn() };
    expect(await backfillDocumentKinds({ ...repos, documents: broken }, [], onError)).toEqual({ documents: 0, organizations: 0, failed: 1 });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("timeout"));
  });
});
