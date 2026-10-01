/**
 * KR-referensen sätts under lås och registreras (#1379).
 *
 * Lasttestet (#1366) visade att två kostnadsräkningar som skickades in
 * samtidigt i samma byrå fick samma `KR-ÅÅÅÅ-NNNN`: referensen togs fram som
 * högsta + 1 utan lås. Nu tar repot ett transaktionslås per byrå och serie,
 * och registret `kr_references` (PK byrå + referens) vägrar en dubblett.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { krReferences } from "@/lib/server/db/schema";
import { krReferencePrefix } from "@/lib/server/repositories/billing-run-repository";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { asId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createPooledTestDb, createTestDb, type TestDbHandle } from "../db/pg-test-db";

const YEAR = 2026;
const PREFIX = krReferencePrefix(YEAR);
const ref = (n: number): string => `${PREFIX}${String(n).padStart(4, "0")}`;

async function newOrgMatter(repos: DrizzleRepositories): Promise<{ org: OrganizationId; matterId: string }> {
  const org = asId<"OrganizationId">(uuidv7()), matterId = uuidv7();
  await repos.matters.create({ id: matterId, organizationId: org, title: "Kostnadsräkning", status: "ACTIVE", matterNumber: "2026-1379" } as never);
  return { org, matterId };
}

function runData(matterId: string, reference: string | null): Record<string, unknown> {
  return {
    id: uuidv7(), matterId, type: "KOSTNADSRAKNING", recipient: "DOMSTOL", status: "PENDING_VERDICT",
    workValueOreAtRun: 0, proposedAmountOre: 0, amountOre: 0, deductedBillingRunIds: [], reference,
  };
}

/** Som `billingRun.createKostnadsrakning`: nästa referens och körningen, i en transaktion. */
function submit(repos: DrizzleRepositories, org: OrganizationId, matterId: string): Promise<{ reference?: string | null | undefined }> {
  return repos.transaction(async (tx) => {
    const reference = await tx.billingRuns.nextKrReference(org, YEAR);
    return tx.billingRuns.create(runData(matterId, reference) as never);
  });
}

describe("KR-referenser från servern (#1379)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  });
  afterAll(async () => { await handle.close(); });

  async function registered(org: OrganizationId): Promise<string[]> {
    return (await handle.db.select().from(krReferences)).filter((r) => r.organizationId === org).map((r) => r.reference).sort();
  }

  it("två kostnadsräkningar i samma byrå får var sin referens, och båda registreras", async () => {
    const { org, matterId } = await newOrgMatter(repos);
    const a = await submit(repos, org, matterId);
    const b = await submit(repos, org, matterId);
    expect([a.reference, b.reference]).toEqual([ref(1), ref(2)]);
    expect(await registered(org)).toEqual([ref(1), ref(2)]);
  });

  it("serierna är per byrå", async () => {
    const one = await newOrgMatter(repos);
    const two = await newOrgMatter(repos);
    await submit(repos, one.org, one.matterId);
    expect((await submit(repos, two.org, two.matterId)).reference).toBe(ref(1));
  });

  it("en registrerad referens utan körning (avbrott) återanvänds inte", async () => {
    const { org, matterId } = await newOrgMatter(repos);
    await handle.db.insert(krReferences).values({ organizationId: org, reference: ref(1), billingRunId: asId<"BillingRunId">(uuidv7()) });
    expect((await submit(repos, org, matterId)).reference).toBe(ref(2));
  });

  it("efter 9999 kommer 10000 — numeriskt, även i registret", async () => {
    const { org, matterId } = await newOrgMatter(repos);
    await repos.billingRuns.create(runData(matterId, ref(9999)) as never);
    expect((await submit(repos, org, matterId)).reference).toBe(`${PREFIX}10000`);
    expect((await submit(repos, org, matterId)).reference).toBe(`${PREFIX}10001`);
  });

  it("databasen vägrar en dubblett inom byrån — och ingen halv körning blir kvar", async () => {
    const { matterId } = await newOrgMatter(repos);
    await repos.billingRuns.create(runData(matterId, ref(7)) as never);
    const dup = runData(matterId, ref(7));
    await expect(repos.billingRuns.create(dup as never)).rejects.toThrow();
    expect(await repos.billingRuns.getById(asId<"BillingRunId">(String(dup.id)))).toBeNull();
  });

  it("körningar utan referens, eller utan känd byrå, registreras inte; utan id genereras ett", async () => {
    const { org, matterId } = await newOrgMatter(repos);
    const { id: _id, ...noId } = runData(matterId, null);
    const created = await repos.billingRuns.create(noId as never);
    expect(created.id).toBeTruthy();
    await repos.billingRuns.create(runData(uuidv7(), ref(3)) as never).catch(() => null);
    expect(await registered(org)).toEqual([]);
  });

  it("en uppdatering skriver aldrig över referensen", async () => {
    const { matterId } = await newOrgMatter(repos);
    const run = await repos.billingRuns.create(runData(matterId, ref(4)) as never);
    const updated = await repos.billingRuns.update(run.id, { reference: ref(99), status: "VOIDED" } as never);
    expect(updated).toMatchObject({ reference: ref(4), status: "VOIDED" });
  });
});

/**
 * Äkta samtidighet: två ANSLUTNINGAR mot riktig Postgres, var sin transaktion
 * som skickar in en kostnadsräkning. Körs i CI:s "Repository (Postgres)"-jobb
 * (`PG_TEST_URL`); hoppas lokalt utan Postgres.
 */
const itPg = process.env.PG_TEST_URL ? it : it.skip;
const pidRows = z.tuple([z.object({ pid: z.number() })]);

describe("KR-referenser — samtidiga anslutningar mot riktig Postgres (#1379)", () => {
  let pooled: TestDbHandle | null = null;

  beforeAll(async () => { pooled = await createPooledTestDb(2); });
  afterAll(async () => { await pooled?.close(); });

  itPg("två anslutningar som skickar in samtidigt får var sin referens, i en obruten serie", async () => {
    if (!pooled) throw new Error("PG_TEST_URL saknas");
    const repos = buildDrizzleRepositories(pooled.db);
    const { org, matterId } = await newOrgMatter(repos);
    // Spärr: ingen transaktion tilldelar förrän BÅDA är öppna — de överlappar garanterat.
    let arrived = 0;
    let release: () => void = () => {};
    const bothOpen = new Promise<void>((resolve) => { release = resolve; });
    const submitConcurrently = () => repos.transactionWithDb(async (tx, txDb) => {
      const [{ pid }] = pidRows.parse(await txDb.execute(sql`SELECT pg_backend_pid() AS pid`));
      if (++arrived === 2) release();
      await bothOpen;
      const reference = await tx.billingRuns.nextKrReference(org, YEAR);
      await tx.billingRuns.create(runData(matterId, reference) as never);
      return { reference, pid };
    });
    const [a, b] = await Promise.all([submitConcurrently(), submitConcurrently()]);
    expect(a.pid).not.toBe(b.pid);
    expect([a.reference, b.reference].sort()).toEqual([ref(1), ref(2)]);
  });
});
