/**
 * `sync.push` (#1156): ett dokument som fått nytt innehåll via synken klassas
 * av SERVERN när bytes:en redan finns där (dedup) — routern kopplar
 * `classify-new-content` mot portarna. Utan nytt innehåll: ingen klassning.
 */
import { describe, expect, it } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { PushResult } from "@/lib/server/data-store/in-memory/sync-transport";
import { appRouter } from "@/lib/server/routers/_app";
import type { SyncStore } from "@/lib/server/sync/sync-store";
import { asId } from "@/lib/shared/schemas/ids";

const ORG = "0190a1b2-0000-7000-8000-00000000000a";
const DOC = "0190a1b2-0000-7000-8000-00000000d0c1";
const OLD = "documents/content/old";
const NEW = "documents/content/new";

function setup(onServer: readonly string[]) {
  const ds = new DemoDataStore({
    organizations: [{ id: ORG, name: "Byrån" }],
    matters: [{ id: "m-1", organizationId: ORG, matterNumber: "1", title: "T", status: "ACTIVE" }],
    documents: [{ id: DOC, matterId: "m-1", fileName: "a.pdf", mimeType: "application/pdf", storagePath: OLD, sizeBytes: 1, version: 1 }],
  }, async () => { /* writable */ });
  const analyzed: string[] = [];
  const pushed: QueuedMutation[] = [];
  const sync: SyncStore = {
    pull: async () => ({ changes: [], cursor: 0 }),
    push: async (_org, m): Promise<PushResult> => { pushed.push(m); return { status: "accepted", row: m.row }; },
  };
  const ports = {
    ...buildGitPorts(ds),
    content: { ...buildGitPorts(ds).content, exists: async (p: string) => onServer.includes(p) },
    documentAnalyzer: { analyze: async (id: string) => { analyzed.push(id); } },
  };
  const caller = appRouter.createCaller(buildContext({
    dataStore: ds, ports, sync,
    principal: { id: asId<"UserId">("u-1"), email: "a@b.se", name: "A", role: "ADMIN", organizationId: asId<"OrganizationId">(ORG) },
  }));
  return { caller, analyzed, pushed };
}

const push = (storagePath: string) => ({
  mutationId: "m-1", entity: "document", kind: "update" as const, enqueuedAt: 0,
  row: { id: DOC, storagePath, fileName: "a.pdf" },
});

describe("sync.push → serverns klassning av nytt innehåll", () => {
  it("nytt innehåll som servern redan har → klassas av servern", async () => {
    const s = setup([NEW]);
    await s.caller.sync.push(push(NEW));
    expect(s.pushed).toHaveLength(1);
    expect(s.analyzed).toEqual([DOC]);
  });

  it("oförändrat innehåll → ingen klassning", async () => {
    const s = setup([OLD, NEW]);
    await s.caller.sync.push(push(OLD));
    expect(s.analyzed).toEqual([]);
  });

  it("innehållet saknas på servern → ingen klassning (uploadContent tar den)", async () => {
    const s = setup([]);
    await s.caller.sync.push(push(NEW));
    expect(s.analyzed).toEqual([]);
  });
});
