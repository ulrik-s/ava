/**
 * Backfill av fulltextindexet (#1215) mot pglite: ett `index-document`-jobb per
 * levande dokument (tombstonade hoppas över), idempotensnyckel = dokument-id,
 * och anslutningarna stängs även när köandet fallerar.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { documents } from "@/lib/server/db/schema";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { asId, type DocumentId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import {
  enqueueBackfill, type JobSender, listIndexableDocumentIds, resolveUrl, runBackfill,
} from "../../../tooling/scripts/backfill-search-index";
import { createTestDb, type TestDbHandle } from "../server/db/pg-test-db";

let handle: TestDbHandle;
const MATTER = asId<"MatterId">(uuidv7());
const USER = asId<"UserId">(uuidv7());
const live: DocumentId[] = [];

async function addDoc(createdAt: Date, deletedAt: Date | null = null): Promise<DocumentId> {
  const id = asId<"DocumentId">(uuidv7());
  await handle.db.insert(documents).values({
    id, matterId: MATTER, fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 1,
    storagePath: `documents/content/${id}.pdf`, uploadedById: USER, createdAt, deletedAt,
  });
  return id;
}

function recordingSender(): JobSender & { sent: Array<{ name: string; data: object; key: string }> } {
  const sent: Array<{ name: string; data: object; key: string }> = [];
  return {
    sent,
    send: async (name, data, options) => { sent.push({ name, data, key: options.singletonKey }); return "job"; },
  };
}

beforeAll(async () => {
  handle = await createTestDb();
  live.push(await addDoc(new Date("2026-01-02")));
  live.unshift(await addDoc(new Date("2026-01-01")));
  await addDoc(new Date("2026-01-03"), new Date());
});

afterAll(async () => { await handle.close(); });

describe("backfill-search-index", () => {
  it("listar levande dokument äldst först (tombstonade hoppas över)", async () => {
    expect(await listIndexableDocumentIds(handle.db)).toEqual(live);
  });

  it("köar ett index-document-jobb per dokument med dokument-id som singletonKey", async () => {
    const sender = recordingSender();
    expect(await enqueueBackfill(handle.db, sender)).toBe(2);
    expect(sender.sent).toEqual(live.map((id) => ({ name: JOB_QUEUES.indexDocument, data: { documentId: id }, key: id })));
  });

  it("runBackfill ansluter, köar och stänger", async () => {
    const sender = recordingSender();
    let closed = 0;
    const opened: string[] = [];
    const n = await runBackfill("postgres://x", async (url) => {
      opened.push(url);
      return { db: handle.db, sender, close: async () => { closed++; } };
    });
    expect(n).toBe(2);
    expect(opened).toEqual(["postgres://x"]);
    expect(closed).toBe(1);
  });

  it("runBackfill stänger även när köandet fallerar", async () => {
    let closed = 0;
    const failing: JobSender = { send: async () => { throw new Error("kön nere"); } };
    await expect(runBackfill("postgres://x", async () => ({ db: handle.db, sender: failing, close: async () => { closed++; } })))
      .rejects.toThrow("kön nere");
    expect(closed).toBe(1);
  });

  it("resolveUrl: argument före AVA_DATABASE_URL; inget → undefined", () => {
    expect(resolveUrl(["postgres://arg"], { AVA_DATABASE_URL: "postgres://env" })).toBe("postgres://arg");
    expect(resolveUrl([], { AVA_DATABASE_URL: "postgres://env" })).toBe("postgres://env");
    expect(resolveUrl([], {})).toBeUndefined();
  });
});
