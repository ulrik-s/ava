/**
 * Dokumentets typer i procedurerna (ADR 0038) mot en riktig in-memory-store:
 * en automatisk skrivning ändrar inte typer som en person satt, en uttrycklig
 * överstyrning gör det, och de äldre formerna (`documentType`, `setTags`) som
 * gamla flikar och köade anrop skickar översätts.
 */
import { describe, expect, it } from "vitest-compat";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { prebakeJoins } from "@/lib/shared/demo-source";

const ORG = "org-a";

function makeCaller(doc: Record<string, unknown> = {}) {
  const source = prebakeJoins({
    organizations: [{ id: ORG, name: "Byrån", documentKinds: ["Korrespondens"] }],
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documents: [{ id: "d1", matterId: "m1", fileName: "a.pdf", kinds: ["KALLELSE"], ...doc }],
  });
  const store = new LocalStore(source, async () => {});
  const repos = buildInMemoryRepositories(store);
  const ctx = { user: { id: "u1", email: "a@b.se", name: "T", role: "LAWYER", organizationId: ORG }, dataStore: store, repos, orgId: ORG, ports: {} };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { caller: documentRouter.createCaller(ctx as any), repos };
}

const get = async (repos: ReturnType<typeof makeCaller>["repos"]) => repos.documents.getById("d1" as never);

describe("document.register (nytt dokument)", () => {
  const base = { matterId: "m1", mimeType: "application/pdf", sizeBytes: 1 };
  const register = (caller: ReturnType<typeof makeCaller>["caller"], id: string, extra: Record<string, unknown>) =>
    caller.register({ ...base, id, fileName: `${id}.pdf`, storagePath: `documents/content/${id}.pdf`, ...extra });

  it("angivna typer är satta av anroparen; äldre documentType normaliseras; inga typer → inga", async () => {
    const { caller, repos } = makeCaller();
    await register(caller, "01a1e8ff-5461-7066-9f5a-4b7719f2b3c1", { kinds: ["Förordnande"] });
    await register(caller, "01a1e8ff-5461-7066-9f5a-4b7719f2b3c2", { documentType: "Faktura" });
    await register(caller, "01a1e8ff-5461-7066-9f5a-4b7719f2b3c3", { kinds: ["DOM"], kindsManual: false });
    await register(caller, "01a1e8ff-5461-7066-9f5a-4b7719f2b3c4", {});
    const kindsOf = async (id: string) => (await repos.documents.getById(id as never));
    expect(await kindsOf("01a1e8ff-5461-7066-9f5a-4b7719f2b3c1")).toMatchObject({ kinds: ["FORORDNANDE"], kindsManual: true });
    expect(await kindsOf("01a1e8ff-5461-7066-9f5a-4b7719f2b3c2")).toMatchObject({ kinds: ["FAKTURA"], kindsManual: true });
    expect(await kindsOf("01a1e8ff-5461-7066-9f5a-4b7719f2b3c3")).toMatchObject({ kinds: ["DOM"], kindsManual: false });
    // Inga typer → inga fält skrivs (Postgres ger `[]`; läsregeln ger [] i båda fallen).
    expect(await kindsOf("01a1e8ff-5461-7066-9f5a-4b7719f2b3c4")).not.toHaveProperty("kinds");
  });
});

describe("document.updateMetadata", () => {
  it("en uttrycklig överstyrning (kindsManual) ändrar även typer en person satt", async () => {
    const { caller, repos } = makeCaller({ kinds: ["AVTAL"], kindsManual: true });
    await caller.updateMetadata({ documentId: "d1", kinds: ["FUP"], kindsManual: true });
    expect(await get(repos)).toMatchObject({ kinds: ["FUP"], kindsManual: true });
  });

  it("utan typer i anropet rörs typerna inte", async () => {
    const { caller, repos } = makeCaller({ kinds: ["AVTAL"] });
    await caller.updateMetadata({ documentId: "d1", title: "Ny" });
    expect(await get(repos)).toMatchObject({ kinds: ["AVTAL"], title: "Ny" });
  });

  it("klientens gissning (äldre documentType) ändrar inte typer en person satt", async () => {
    const { caller, repos } = makeCaller({ kinds: ["AVTAL"], kindsManual: true });
    await caller.updateMetadata({ documentId: "d1", documentType: "KALLELSE", analysisStatus: "DONE" });
    expect(await get(repos)).toMatchObject({ kinds: ["AVTAL"], kindsManual: true, analysisStatus: "DONE" });
  });

  it("gissningen sätter typen när ingen person gjort det", async () => {
    const { caller, repos } = makeCaller({ kinds: [] });
    await caller.updateMetadata({ documentId: "d1", kinds: ["STAMNING"] });
    expect(await get(repos)).toMatchObject({ kinds: ["STAMNING"], kindsManual: false, documentType: "STAMNING" });
  });
});

describe("document.setTags (föråldrad, ADR 0038)", () => {
  it("taggar blir egna typer; de inbyggda står kvar; satt av en person", async () => {
    const { caller, repos } = makeCaller({ kinds: ["KALLELSE", "Gammal"] });
    await caller.setTags({ documentId: "d1", tags: ["Korrespondens"] });
    expect(await get(repos)).toMatchObject({ kinds: ["KALLELSE", "Korrespondens"], kindsManual: true, tags: [] });
  });

  it("okänd tagg nekas; saknat dokument → NOT_FOUND", async () => {
    const { caller } = makeCaller();
    await expect(caller.setTags({ documentId: "d1", tags: ["Påhittad"] })).rejects.toThrow(/Okända dokumenttyper/);
    await expect(caller.setTags({ documentId: "00000000-0000-0000-0000-000000000000", tags: [] })).rejects.toThrow();
  });
});
