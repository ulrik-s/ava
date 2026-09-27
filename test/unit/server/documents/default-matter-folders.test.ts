/**
 * Standardmapparna (#1228): hela trädet skapas, rätt föräldrar, idempotent per
 * nivå (skiftlägesokänsligt), och saknade undermappar fylls i under en
 * befintlig "Domstol".
 */

import { describe, expect, it } from "vitest-compat";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { ensureDefaultMatterFolders } from "@/lib/server/documents/default-matter-folders";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { DEFAULT_MATTER_FOLDERS } from "@/lib/shared/default-matter-folders";
import type { DocumentFolder } from "@/lib/shared/schemas/document";
import { asId } from "@/lib/shared/schemas/ids";

const MATTER = asId<"MatterId">("m-1");

function makeRepos(folders: Record<string, unknown>[] = []) {
  const ds = new DemoDataStore({
    organizations: [{ id: "org", name: "X" }],
    matters: [{ id: MATTER, organizationId: "org", matterNumber: "1", title: "T", status: "ACTIVE" }],
    documentFolders: folders,
  }, async () => { /* writable */ });
  return buildInMemoryRepositories(ds);
}

/** Mapparna som `sökväg` ("Domstol/Kallelse") → räknare, för att se dubbletter. */
function paths(folders: DocumentFolder[]): string[] {
  const byId = new Map(folders.map((f) => [f.id, f] as const));
  return folders.map((f) => {
    const parent = f.parentId ? byId.get(f.parentId) : undefined;
    return parent ? `${parent.name}/${f.name}` : f.name;
  }).sort();
}

const EXPECTED = [
  "Avtal", "Beslut", "Domstol", "Domstol/Föreläggande", "Domstol/Förordnande",
  "Domstol/Inlagor", "Domstol/Kallelse", "Faktura", "Korrespondans", "Övrigt",
].sort();

describe("ensureDefaultMatterFolders", () => {
  it("skapar hela standardträdet med undermapparna under Domstol", async () => {
    const repos = makeRepos();
    expect(await ensureDefaultMatterFolders(repos, MATTER)).toBe(10);
    expect(paths(await repos.documentFolders.listByMatter(MATTER))).toEqual(EXPECTED);
  });

  it("skapar i trädets ordning (rotnivån först, undermappar direkt efter sin förälder)", async () => {
    const repos = makeRepos();
    const created: string[] = [];
    const orig = repos.documentFolders.create.bind(repos.documentFolders);
    repos.documentFolders.create = async (data) => { created.push(String(data.name)); return orig(data); };
    await ensureDefaultMatterFolders(repos, MATTER);
    expect(created).toEqual([
      "Faktura", "Domstol", "Kallelse", "Föreläggande", "Förordnande", "Inlagor",
      "Beslut", "Korrespondans", "Avtal", "Övrigt",
    ]);
  });

  it("är idempotent — en omkörning skapar ingenting", async () => {
    const repos = makeRepos();
    await ensureDefaultMatterFolders(repos, MATTER);
    expect(await ensureDefaultMatterFolders(repos, MATTER)).toBe(0);
    expect(await repos.documentFolders.listByMatter(MATTER)).toHaveLength(10);
  });

  it("återanvänder befintliga mappar (skiftlägesokänsligt) och fyller i undermappar under en befintlig Domstol", async () => {
    const repos = makeRepos([
      { id: "f-dom", name: "domstol", matterId: MATTER, parentId: null, createdAt: new Date() },
      { id: "f-kal", name: "Kallelse", matterId: MATTER, parentId: "f-dom", createdAt: new Date() },
      // Samma namn på FEL nivå räknas inte: rotens Faktura saknas fortfarande.
      { id: "f-x", name: "Faktura", matterId: MATTER, parentId: "f-dom", createdAt: new Date() },
    ]);
    expect(await ensureDefaultMatterFolders(repos, MATTER)).toBe(8);
    const all = await repos.documentFolders.listByMatter(MATTER);
    expect(all.filter((f) => f.parentId === "f-dom").map((f) => f.name).sort())
      .toEqual(["Faktura", "Förordnande", "Föreläggande", "Inlagor", "Kallelse"].sort());
    expect(all.filter((f) => f.name.toLowerCase() === "domstol")).toHaveLength(1);
  });

  it("tar ett eget träd (default = DEFAULT_MATTER_FOLDERS)", async () => {
    const repos = makeRepos();
    expect(await ensureDefaultMatterFolders(repos, MATTER, [{ name: "A", children: [{ name: "B" }] }])).toBe(2);
    expect(paths(await repos.documentFolders.listByMatter(MATTER))).toEqual(["A", "A/B"]);
  });
});

describe("DEFAULT_MATTER_FOLDERS", () => {
  it("rotnivån i ordning: Faktura, Domstol, Beslut, Korrespondans, Avtal, Övrigt", () => {
    expect(DEFAULT_MATTER_FOLDERS.map((n) => n.name))
      .toEqual(["Faktura", "Domstol", "Beslut", "Korrespondans", "Avtal", "Övrigt"]);
  });

  it("Domstol har Kallelse, Föreläggande, Förordnande, Inlagor", () => {
    expect(DEFAULT_MATTER_FOLDERS.find((n) => n.name === "Domstol")?.children?.map((n) => n.name))
      .toEqual(["Kallelse", "Föreläggande", "Förordnande", "Inlagor"]);
  });
});
