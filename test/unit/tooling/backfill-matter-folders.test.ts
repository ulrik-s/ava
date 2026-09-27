/**
 * Backfill av standardmapparna (#1228) mot pglite: levande ärenden får de
 * saknade mapparna (inkl. undermappar under en befintlig Domstol), tombstonade
 * hoppas över, skrivningarna hamnar i change_log (synkas), en omkörning skapar
 * ingenting, och anslutningen stängs även vid fel.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { changeLog, documentFolders, matters } from "@/lib/server/db/schema";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import {
  backfillMatterFolders, connect, listLiveMatterIds, main, resolveUrl, runFolderBackfill,
} from "../../../tooling/scripts/backfill-matter-folders";
import { createTestDb, type TestDbHandle } from "../server/db/pg-test-db";

let handle: TestDbHandle;
const ORG = asId<"OrganizationId">(uuidv7());
const live: MatterId[] = [];
let deleted: MatterId;
const DOMSTOL = asId<"DocumentFolderId">(uuidv7());

async function addMatter(createdAt: Date, deletedAt: Date | null = null): Promise<MatterId> {
  const id = asId<"MatterId">(uuidv7());
  await handle.db.insert(matters).values({
    id, organizationId: ORG, matterNumber: id.slice(0, 8), title: "T", version: 1, createdAt, deletedAt,
  });
  return id;
}

const foldersOf = (matterId: MatterId) =>
  handle.db.select().from(documentFolders).where(eq(documentFolders.matterId, matterId));

beforeAll(async () => {
  handle = await createTestDb();
  live.push(await addMatter(new Date("2026-01-02")));
  live.unshift(await addMatter(new Date("2026-01-01")));
  deleted = await addMatter(new Date("2026-01-03"), new Date());
  // Äldsta ärendet har redan en Domstol (utan undermappar).
  await handle.db.insert(documentFolders).values({ id: DOMSTOL, matterId: live[0]!, name: "Domstol", parentId: null, version: 1 });
});

afterAll(async () => { await handle.close(); });

describe("backfill-matter-folders", () => {
  it("listar levande ärenden äldst först (tombstonade hoppas över)", async () => {
    expect(await listLiveMatterIds(handle.db)).toEqual(live);
  });

  it("fyller i saknade mappar, inkl. undermappar under befintlig Domstol, och loggar i change_log", async () => {
    expect(await backfillMatterFolders(handle.db)).toEqual({ matters: 2, created: 9 + 10 });
    const first = await foldersOf(live[0]!);
    expect(first).toHaveLength(10);
    expect(first.filter((f) => f.parentId === DOMSTOL).map((f) => f.name).sort())
      .toEqual(["Förordnande", "Föreläggande", "Inlagor", "Kallelse"].sort());
    expect(await foldersOf(live[1]!)).toHaveLength(10);
    expect(await foldersOf(deleted)).toHaveLength(0);
    // Enda skrivningarna i ORG är mapparna → en change_log-rad per ny mapp.
    const logged = await handle.db.select().from(changeLog).where(eq(changeLog.organizationId, ORG));
    expect(logged).toHaveLength(19);
    expect(new Set(logged.map((l) => l.op))).toEqual(new Set(["create"]));
  });

  it("är idempotent — en omkörning skapar ingenting", async () => {
    expect(await backfillMatterFolders(handle.db)).toEqual({ matters: 2, created: 0 });
    expect(await foldersOf(live[1]!)).toHaveLength(10);
  });

  it("runFolderBackfill ansluter, kör och stänger — även vid fel", async () => {
    let closed = 0;
    const opened: string[] = [];
    const r = await runFolderBackfill("postgres://x", async (url) => {
      opened.push(url);
      return { db: handle.db, close: async () => { closed++; } };
    });
    expect(r).toEqual({ matters: 2, created: 0 });
    expect(opened).toEqual(["postgres://x"]);
    const broken: TestDbHandle["db"] = Object.create(handle.db, { select: { value: () => { throw new Error("db nere"); } } });
    await expect(runFolderBackfill("postgres://x", async () => ({ db: broken, close: async () => { closed++; } })))
      .rejects.toThrow("db nere");
    expect(closed).toBe(2);
  });

  it("resolveUrl: argument före AVA_DATABASE_URL; inget → undefined", () => {
    expect(resolveUrl(["postgres://arg"], { AVA_DATABASE_URL: "postgres://env" })).toBe("postgres://arg");
    expect(resolveUrl([], { AVA_DATABASE_URL: "postgres://env" })).toBe("postgres://env");
    expect(resolveUrl([], {})).toBeUndefined();
  });

  it("main: skriver resultatet; utan URL → felkod 1", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const open = async () => ({ db: handle.db, close: async () => {} });
    expect(await main([], { AVA_DATABASE_URL: "postgres://env" }, (s) => out.push(s), (s) => err.push(s), open)).toBe(0);
    expect(out).toEqual(["backfill-matter-folders: 0 mappar skapade i 2 ärenden\n"]);
    expect(await main([], {}, (s) => out.push(s), (s) => err.push(s), open)).toBe(1);
    expect(err[0]).toContain("AVA_DATABASE_URL");
  });

  it("connect ansluter lazily och går att stänga utan att någon fråga körts", async () => {
    const conn = await connect("postgres://nobody@127.0.0.1:1/none");
    expect(typeof conn.close).toBe("function");
    await conn.close();
  });
});
