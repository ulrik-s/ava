/**
 * Radpushen prövar att ett dokument och dess delar hör till sitt ärende och att
 * fakturans dokument stannar i sitt ärende (#2044), genom hela radvägen
 * (`DrizzleSyncStore` → `RowPushDecider` → radpolicyn) mot pglite. Uppslaget
 * görs i samma transaktion som skrivningen. Varje `sync.push` är en egen
 * transaktion; en del ser dokumentets nya ärende när den pushas efter flytten.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { QueuedMutation } from "@/lib/client/local-store/mutation-queue";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { ROW_POLICY_REASONS } from "@/lib/server/sync/row-push-policy";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { pusher } from "./row-pusher";

const ORG = uuidv7();

function mut(entity: string, row: Record<string, unknown>): QueuedMutation {
  return { mutationId: uuidv7(), entity, kind: "update", row, enqueuedAt: 0 };
}

describe("radpushen: samma ärende och låsta fält (#2044, pglite)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    sync = new DrizzleSyncStore(handle.db, repos);
  });
  afterAll(async () => { await handle.close(); });

  /** Två ärenden med en mapp var, och ett dokument med en del i det första. */
  async function setup(docExtra: Record<string, unknown> = {}) {
    const [from, to, fromFolder, toFolder, doc, part] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    for (const id of [from, to]) {
      await repos.matters.create({ id, organizationId: ORG, title: "Ärende", status: "ACTIVE", matterNumber: `2026-${id.slice(-6)}` } as never);
    }
    await repos.documentFolders.create({ id: fromFolder, matterId: from, name: "Domstol" } as never);
    await repos.documentFolders.create({ id: toFolder, matterId: to, name: "Domstol" } as never);
    await repos.documents.create({
      id: doc, matterId: from, folderId: fromFolder, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1,
      storagePath: `documents/content/${doc}`, uploadedById: uuidv7(), ...docExtra,
    } as never);
    await repos.documentParts.create({ id: part, documentId: doc, matterId: from, ordinal: 0, kind: "HUVUDDOKUMENT", fromPage: 1, toPage: 1, source: "MANUAL" } as never);
    return { from, to, toFolder, doc, part };
  }

  const matterOf = async (entity: "documents" | "documentParts", id: string): Promise<unknown> =>
    ((await repos[entity].getById(id as never)) as { matterId?: unknown } | null)?.matterId;

  it("ett dokument och sedan dess del flyttas tillsammans", async () => {
    const s = await setup();
    expect(await sync.push(pusher(ORG), mut("document", { id: s.doc, matterId: s.to, folderId: s.toFolder }))).toMatchObject({ status: "accepted" });
    expect(await sync.push(pusher(ORG), mut("documentPart", { id: s.part, matterId: s.to }))).toMatchObject({ status: "accepted" });
    expect([await matterOf("documents", s.doc), await matterOf("documentParts", s.part)]).toEqual([s.to, s.to]);
  });

  it("vägras dokumentet vägras också delen efter det, och inget ändras", async () => {
    const s = await setup({ billingRunId: uuidv7() });
    expect(await sync.push(pusher(ORG), mut("document", { id: s.doc, matterId: s.to, folderId: s.toFolder })))
      .toMatchObject({ status: "conflict", reason: ROW_POLICY_REASONS.locked });
    expect(await sync.push(pusher(ORG), mut("documentPart", { id: s.part, matterId: s.to })))
      .toMatchObject({ status: "conflict", reason: ROW_POLICY_REASONS.otherMatter });
    expect([await matterOf("documents", s.doc), await matterOf("documentParts", s.part)]).toEqual([s.from, s.from]);
  });

  it("ett dokument som byter ärende men behåller mappen i det gamla vägras", async () => {
    const s = await setup();
    expect(await sync.push(pusher(ORG), mut("document", { id: s.doc, matterId: s.to })))
      .toMatchObject({ status: "conflict", reason: ROW_POLICY_REASONS.otherMatter });
    expect(await matterOf("documents", s.doc)).toBe(s.from);
  });

  it("ett dokument vars mapp inte finns prövas inte mot ärendet", async () => {
    const s = await setup();
    const missingFolder = uuidv7();
    expect(await sync.push(pusher(ORG), mut("document", { id: s.doc, folderId: missingFolder }))).toMatchObject({ status: "accepted" });
    expect(((await repos.documents.getById(s.doc as never)) as { folderId?: unknown } | null)?.folderId).toBe(missingFolder);
  });

  it("en del med inaktuellt ärende efter en flytt vägras och flyttar inte tillbaka", async () => {
    const s = await setup();
    await sync.push(pusher(ORG), mut("document", { id: s.doc, matterId: s.to, folderId: s.toFolder }));
    await sync.push(pusher(ORG), mut("documentPart", { id: s.part, matterId: s.to }));
    expect(await sync.push(pusher(ORG), mut("documentPart", { id: s.part, matterId: s.from })))
      .toMatchObject({ status: "conflict", reason: ROW_POLICY_REASONS.otherMatter });
    expect(await matterOf("documentParts", s.part)).toBe(s.to);
  });
});
