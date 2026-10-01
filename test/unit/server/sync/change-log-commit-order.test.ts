/**
 * `change_log.seq` i commit-ordning (#1381, migration 0040).
 *
 * Delta-pullens cursor är högsta seq klienten sett. Tilldelades seq när raden
 * skrevs (bigserial) kunde en transaktion med lägre seq committa EFTER att en
 * klient sett en högre — raden hamnade under cursorn och hämtades aldrig.
 * Nu numreras raderna om vid commit, under ett lås som släpps först när
 * commiten syns.
 *
 *   - pglite + Postgres: omnumrering vid commit, i skrivordning; den säkra gränsen.
 *   - Bara riktig Postgres (`PG_TEST_URL`, CI:s Postgres-jobb): två samtidiga
 *     transaktioner som committar i omvänd ordning, och att pull och commit
 *     väntar in varandra via publiceringslåset.
 */

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { changeLog } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { readSafeSeq } from "@/lib/server/sync/change-log-safe-seq";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle, type TestDbSession } from "../db/pg-test-db";

const itPg = process.env.PG_TEST_URL ? it : it.skip;
const PUBLISH_LOCK = "hashtextextended('ava.change_log.publish', 0)";

/** Repos med change_log påslagen, på en given handle. */
function loggingRepos(db: AppDb): DrizzleRepositories {
  const repos = buildDrizzleRepositories(db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(db));
  return repos;
}

function createContact(repos: Repositories, organizationId: string, name: string): Promise<unknown> {
  return repos.contacts.create({ id: uuidv7(), organizationId, name, contactType: "PERSON" } as never);
}

/** change_log-rader för byrån, i seq-ordning. */
async function logRows(db: AppDb, organizationId: string): Promise<{ seq: number; rowId: string }[]> {
  return db.select({ seq: changeLog.seq, rowId: changeLog.rowId }).from(changeLog)
    .where(eq(changeLog.organizationId, organizationId)).orderBy(asc(changeLog.seq));
}

/** Löftet har inte avgjorts inom `ms`. */
async function stillPending(p: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol("pending");
  const winner = await Promise.race([p.then(() => null), new Promise((r) => setTimeout(() => r(pending), ms))]);
  return winner === pending;
}

describe("change_log.seq i commit-ordning (#1381)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = loggingRepos(handle.db);
    sync = new DrizzleSyncStore(handle.db, repos);
  });
  afterAll(async () => { await handle.close(); });

  it("numrerar om raderna vid commit, i den ordning de skrevs", async () => {
    const org = uuidv7();
    await createContact(repos, org, "Före");
    const provisional = await repos.transactionWithDb(async (txRepos, tx) => {
      for (const name of ["Ett", "Två", "Tre"]) await createContact(txRepos, org, name);
      return (await logRows(tx, org)).map((r) => r.seq);
    });

    const committed = await logRows(handle.db, org);
    expect(committed).toHaveLength(4);
    const [before, ...inTx] = committed.map((r) => r.seq);
    // Raderna i transaktionen fick nya nummer, högre än allt som fanns och än de preliminära.
    expect(Math.min(...inTx)).toBeGreaterThan(Math.max(...provisional));
    expect(Math.min(...inTx)).toBeGreaterThan(before ?? 0);
    // Skrivordningen behålls: kontakterna i seq-ordning är Ett, Två, Tre.
    const names = await Promise.all(committed.slice(1).map(async (r) => (await repos.contacts.getById(asId<"ContactId">(r.rowId)))?.name));
    expect(names).toEqual(["Ett", "Två", "Tre"]);
  });

  it("den säkra gränsen är 0 i en tom databas och följer sedan sekvensen", async () => {
    const fresh = await createTestDb();
    try {
      expect(await readSafeSeq(fresh.db)).toBe(0);
      const org = uuidv7();
      await createContact(loggingRepos(fresh.db), org, "Första");
      const [row] = await logRows(fresh.db, org);
      expect(await readSafeSeq(fresh.db)).toBe(row?.seq);
    } finally {
      await fresh.close();
    }
  });

  it("cursorn går inte bakåt för en klient som ligger före gränsen", async () => {
    const ahead = (await readSafeSeq(handle.db)) + 1000;
    expect(await sync.pull(uuidv7(), ahead)).toEqual({ changes: [], cursor: ahead, hasMore: false });
  });

  it("en rad som skrivs i en egen sats (autocommit) får också sitt nummer vid commit", async () => {
    const org = uuidv7();
    await createContact(repos, org, "Ensam");
    const res = await sync.pull(org, 0);
    expect(res.changes).toHaveLength(1);
    expect(res.cursor).toBe((await logRows(handle.db, org))[0]?.seq);
  });

  describe("samtidiga transaktioner (riktig Postgres)", () => {
    let a: TestDbSession;
    let b: TestDbSession;

    beforeAll(async () => {
      if (!handle.openSession) return;
      a = await handle.openSession();
      b = await handle.openSession();
    });
    afterAll(async () => {
      await a?.close();
      await b?.close();
    });

    // Issue-scenariot: T1 skriver först (lägre preliminärt seq) men committar
    // sist; en klient pullar emellan. Med seq vid skrivning låg T1:s rad under
    // klientens cursor och kom aldrig.
    itPg("en långlivad klient får raden från transaktionen som committar sist", async () => {
      const org = uuidv7();
      const t1Repos = loggingRepos(a.db);
      const t2Repos = loggingRepos(b.db);

      await a.exec("BEGIN");
      await createContact(t1Repos, org, "T1");
      await b.exec("BEGIN");
      await createContact(t2Repos, org, "T2");
      await b.exec("COMMIT");

      const first = await sync.pull(org, 0);
      expect(first.changes.map((c) => c.row.name)).toEqual(["T2"]);

      await a.exec("COMMIT");
      const second = await sync.pull(org, first.cursor);
      expect(second.changes.map((c) => c.row.name)).toEqual(["T1"]);
      expect(second.cursor).toBeGreaterThan(first.cursor);
      // Den långlivade klienten har nu samma rader som en ny från cursor 0.
      expect((await sync.pull(org, 0)).changes.map((c) => c.row.name).sort()).toEqual(["T1", "T2"]);
    });

    // Varför inte bara ett xid-vattenmärke (`xid < pg_snapshot_xmin`): T2 får
    // sitt transaktions-id FÖRE T1 men sitt seq EFTER. När T2 committat är T1
    // den äldsta pågående, T2:s rad ser "säker" ut, och T1:s lägre seq hade
    // ändå hamnat under cursorn. Commit-numreringen klarar även den ordningen.
    itPg("klarar att transaktions-id och skrivordning går åt olika håll", async () => {
      const org = uuidv7();
      await b.exec("BEGIN");
      await b.exec("SELECT pg_current_xact_id()");
      await a.exec("BEGIN");
      await createContact(loggingRepos(a.db), org, "T1");
      await createContact(loggingRepos(b.db), org, "T2");
      await b.exec("COMMIT");

      const first = await sync.pull(org, 0);
      await a.exec("COMMIT");
      const second = await sync.pull(org, first.cursor);
      const seen = [...first.changes, ...second.changes].map((c) => c.row.name).sort();
      expect(seen).toEqual(["T1", "T2"]);
    });

    // En transaktion som håller på att committa håller låset delat: pullen
    // väntar tills commiten syns, i stället för att läsa förbi den.
    itPg("pullen väntar på en transaktion som håller på att committa", async () => {
      const org = uuidv7();
      await createContact(repos, org, "Synlig");
      await b.exec(`SELECT pg_advisory_lock_shared(${PUBLISH_LOCK})`);
      const pull = sync.pull(org, 0);
      try {
        expect(await stillPending(pull, 300)).toBe(true);
      } finally {
        await b.exec(`SELECT pg_advisory_unlock_shared(${PUBLISH_LOCK})`);
      }
      expect((await pull).changes.map((c) => c.row.name)).toEqual(["Synlig"]);
    });

    // Numreringen sker under låset: en commit väntar medan en pull läser gränsen.
    itPg("commit väntar på publiceringslåset", async () => {
      const org = uuidv7();
      await b.exec(`SELECT pg_advisory_lock(${PUBLISH_LOCK})`);
      await a.exec("BEGIN");
      await createContact(loggingRepos(a.db), org, "Väntar");
      const commit = a.exec("COMMIT");
      try {
        expect(await stillPending(commit, 300)).toBe(true);
        expect(await logRows(handle.db, org)).toHaveLength(0);
      } finally {
        await b.exec(`SELECT pg_advisory_unlock(${PUBLISH_LOCK})`);
      }
      await commit;
      expect(await logRows(handle.db, org)).toHaveLength(1);
    });
  });
});
