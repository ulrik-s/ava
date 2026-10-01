/**
 * Sökvägen till dokumentets innehåll (#1372). Content-store:n delas av alla
 * byråer (ett git-repo), så en fritt vald `storagePath` kunde läsa `.git`
 * (alla byråers hashar och innehåll) eller en annan byrås fil. Routrarna tar
 * bara emot rätt form, och bara dokumentets eget innehåll utom för admin.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { documentRouter } from "@/lib/server/routers/document";
import { kostnadsrakningRouter } from "@/lib/server/routers/kostnadsrakning";
import { contentStoragePath } from "@/lib/shared/content-address";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { uuidv7 } from "@/lib/shared/uuid";

const ORG = "org-a";
const SHA = "b".repeat(64);
const MALICIOUS = [
  "documents/content/../.git/index",
  ".git/index",
  "../../etc/passwd",
  "/etc/passwd",
  "documents/content/sub/x.pdf",
  "documents/content/.git",
  "documents/content/",
  "documents/content/a.tar.gz",
  "",
];

type Role = "ADMIN" | "LAWYER";

function setup(role: Role = "LAWYER", queued = false) {
  const source = prebakeJoins({
    matters: [{ id: "m1", organizationId: ORG, matterNumber: "2026-1", title: "T" }],
    documentFolders: [],
    documents: [{
      id: "d-git", organizationId: ORG, matterId: "m1", fileName: "kapad.bin",
      mimeType: "application/octet-stream", sizeBytes: 3, storagePath: ".git/index", version: 1,
    }],
  } as DemoSource);
  const store = new DemoDataStore(source, async () => {});
  const repos = buildInMemoryRepositories(store);
  const blobs = new Map<string, Uint8Array>([[".git/index", new Uint8Array([1, 2, 3])]]);
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
  const ctx = {
    user: { id: "u1", email: "a@b.se", name: "T", role, organizationId: ORG },
    dataStore: store, repos, orgId: ORG, ports,
    ...(queued ? { queued: { mutationId: uuidv7(), at: Date.now() } } : {}),
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    docs: documentRouter.createCaller(ctx as any),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    kr: kostnadsrakningRouter.createCaller(ctx as any),
    repos,
  };
}

const registerInput = (id: string, storagePath: string) => ({
  id, matterId: "m1", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath,
});

const recordInput = (id: string, storagePath: string) => ({
  id, matterId: "m1", fileName: "kr.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath,
  totalInclVat: 100, huvudforhandlingMinutes: 0,
});

beforeEach(() => vi.clearAllMocks());

describe("document.register — sökvägen (#1372)", () => {
  it.each(MALICIOUS)("fel form (%j) → BAD_REQUEST, även för admin, inget dokument", async (path) => {
    const { docs, repos } = setup("ADMIN");
    const id = uuidv7();
    await expect(docs.register(registerInput(id, path) as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await repos.documents.getById(id as never)).toBeNull();
  });

  it("dokumentets eget innehåll (sha256, pending-<id>, <id>.<ext>) → jurist registrerar", async () => {
    const { docs } = setup("LAWYER");
    for (const make of [() => contentStoragePath(SHA), (id: string) => `documents/content/pending-${id}`, (id: string) => `documents/content/${id}.html`]) {
      const id = uuidv7();
      await expect(docs.register(registerInput(id, make(id)) as never)).resolves.toMatchObject({ id });
    }
  });

  it("en annan fil (ett annat dokuments id, seedens namn) → jurist nekas (FORBIDDEN)", async () => {
    const { docs } = setup("LAWYER");
    for (const path of [`documents/content/${uuidv7()}.pdf`, "documents/content/doc-pdf-01.pdf"]) {
      await expect(docs.register(registerInput(uuidv7(), path) as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("seedens namn: admin direkt får (demo-generatorn), men aldrig i kön", async () => {
    await expect(setup("ADMIN").docs.register(registerInput(uuidv7(), "documents/content/doc-pdf-01.pdf") as never)).resolves.toBeTruthy();
    await expect(setup("ADMIN", true).docs.register(registerInput(uuidv7(), "documents/content/doc-pdf-01.pdf") as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("kostnadsrakning.record — sökvägen (#1372)", () => {
  it("fel form → BAD_REQUEST; en annan fil → jurist nekas; eget innehåll → registreras", async () => {
    const { kr } = setup("LAWYER");
    await expect(kr.record(recordInput(uuidv7(), ".git/index") as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(kr.record(recordInput(uuidv7(), `documents/content/${uuidv7()}.pdf`) as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const id = uuidv7();
    await expect(kr.record(recordInput(id, `documents/content/${id}.pdf`) as never)).resolves.toMatchObject({ id });
  });
});

describe("document.downloadContent / missingContent — sökvägen (#1372)", () => {
  it("ett dokument med en sökväg av fel form (skriven före fixen) läses aldrig", async () => {
    await expect(setup("ADMIN").docs.downloadContent({ documentId: "d-git" as never })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missingContent tar inte emot sökvägar av fel form (ingen existens-sond i .git)", async () => {
    const { docs } = setup("LAWYER");
    await expect(docs.missingContent({ storagePaths: [".git/index" as never] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await docs.missingContent({ storagePaths: [contentStoragePath(SHA) as never] })).toEqual({ missing: [contentStoragePath(SHA)] });
  });
});
