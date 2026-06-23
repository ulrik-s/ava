/**
 * Keep-both end-to-end på server-/data-lagret (ADR 0033 §4, #742): kör HELA
 * 2-användar-konflikt-sekvensen som en jurist faktiskt upplever den och
 * verifierar slut-tillståndet användaren bryr sig om — "en ny fil skapas i
 * ärendet och det finns 2 filer med båda användarnas innehåll".
 *
 * De två lagren testas var för sig på annat håll:
 *   - helperns kö-orkestrering (409 → handleConflict → saveConflictCopy) i
 *     helper-ui/test/queue.test.ts (fejkad saveConflictCopy),
 *   - serverns optimistiska version + saveConflictCopy i upload-content.test.ts.
 * DETTA test kedjar ihop sekvensen mot en riktig in-memory-server (samma
 * `createCaller`-mönster som upload-content.test.ts) och asserterar end-state.
 *
 * Determ. + CI-grönt (ingen docker/browser/OIDC). Den fullt UI-drivna varianten
 * (2 inloggade användare + helpers + browser) spåras separat i #742; se
 * memory `project-conflict-e2e-architecture`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { bytesToBase64 } from "@/lib/shared/content-address";
import { prebakeJoins } from "@/lib/shared/demo-source";

vi.mock("@/lib/server/services/meilisearch", () => ({
  searchDocuments: vi.fn(),
  removeDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/server/services/document-analysis", () => ({
  analyzeDocument: vi.fn().mockResolvedValue(undefined),
}));

const ORG = "org-a";

/**
 * En in-memory-server delad av båda juristerna (samma byrå/org), med ETT ärende
 * och ETT delat textdokument (version 1) som båda öppnar. Returnerar en caller
 * per användare så org-/principal-scope speglar två riktiga inloggningar.
 */
function makeFirm() {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2027-007", title: "Bodelning Bergman" }],
    documentFolders: [],
    documents: [{
      id: "d1", organizationId: ORG, matterId: "m1", fileName: "minnesanteckning.txt",
      mimeType: "text/plain", sizeBytes: 1, storagePath: "documents/content/seed", version: 1,
    }],
  } as DemoSource);
  const store = new DemoDataStore(source, async () => {});
  const repos = buildInMemoryRepositories(store);
  const blobs = new Map<string, Uint8Array>();
  // Originalets innehåll som båda juristerna laddar ner när de öppnar (v1).
  blobs.set("documents/content/seed", new TextEncoder().encode("Ursprunglig text"));
  const ports = {
    email: { send: vi.fn() },
    paymentScanner: { scan: vi.fn() },
    documentAnalyzer: { analyze: vi.fn().mockResolvedValue(undefined) },
    searchIndex: { search: vi.fn(), upsert: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) },
    content: {
      write: async (p: string, b: Uint8Array) => { blobs.set(p, b); },
      read: async (p: string) => blobs.get(p) ?? null,
      exists: async (p: string) => blobs.has(p),
    },
  };
  const callerFor = (userId: string) => {
    const ctx = { user: { id: userId, email: `${userId}@byra.se`, name: userId, role: "LAWYER", organizationId: ORG }, dataStore: store, repos, orgId: ORG, ports };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return documentRouter.createCaller(ctx as any);
  };
  return { anna: callerFor("anna"), björn: callerFor("björn"), blobs };
}

const text = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const decode = (b64: string) => new TextDecoder().decode(Buffer.from(b64, "base64"));

beforeEach(() => vi.clearAllMocks());

describe("keep-both: 2-användar-konflikt → syskon-dokument (#742, ADR 0033 §4)", () => {
  it("båda redigerar offline från v1; en vinner, den andra får syskon-fil — 2 filer, bådas innehåll", async () => {
    const { anna, björn } = makeFirm();

    // Båda öppnar dokumentet → bär samma basversion (v1).
    expect((await anna.downloadContent({ documentId: "d1" })).version).toBe(1);
    expect((await björn.downloadContent({ documentId: "d1" })).version).toBe(1);

    // Anna kommer online först → hennes save vinner (server v1 → v2).
    await anna.uploadContent({ documentId: "d1", contentBase64: text("Annas anteckning"), baseVersion: 1 });

    // Björn kommer online och sparar sin version från SAMMA v1 → 409 (server gått förbi).
    await expect(
      björn.uploadContent({ documentId: "d1", contentBase64: text("Björns anteckning"), baseVersion: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Det är detta helperns kö gör vid 409 (keep-both): materialiserar Björns
    // version som ett syskon-dokument istället för att skriva över Annas.
    const sibling = await björn.saveConflictCopy({
      documentId: "d1", contentBase64: text("Björns anteckning"), label: "2027-03-14 09:15",
    });

    // End-state: ärendet har nu 2 filer.
    const list = await anna.list({ matterId: "m1", folderId: null, page: 1, pageSize: 50 });
    expect(list.documents).toHaveLength(2);

    const original = list.documents.find((d) => d.id === "d1")!;
    const copy = list.documents.find((d) => d.id === sibling.id)!;
    expect(original.fileName).toBe("minnesanteckning.txt"); // originalet orört
    expect(copy.fileName).toBe("minnesanteckning (din ändring 2027-03-14 09:15).txt");

    // …och båda användarnas innehåll finns bevarat, var för sig.
    expect(decode((await anna.downloadContent({ documentId: "d1" })).contentBase64)).toBe("Annas anteckning");
    expect(decode((await anna.downloadContent({ documentId: sibling.id })).contentBase64)).toBe("Björns anteckning");
  });
});
