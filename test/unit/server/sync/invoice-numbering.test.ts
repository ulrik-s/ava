/**
 * Fakturanumret sätts av servern (#1243, ADR 0012) — pglite.
 *
 * Mervärdesskattelagen (17 kap. 24 § 2 ML) kräver ett löpnummer som ENSAMT
 * identifierar fakturan, i en obruten serie. Klienten räknade fram numret ur
 * de fakturor den kände till lokalt: två jurister som fakturerade under samma
 * avbrott (eller innan synken hunnit ikapp) fick samma nummer.
 *
 * Nu:
 *   - servern tilldelar numret när den kör om faktureringen i procedurkön
 *     (#1276) — fakturor tas inte längre emot som färdiga rader (#1242),
 *   - ett server-only-register (`invoice_numbers`, PK = byrå + nummer) gör en
 *     dubblett omöjlig i databasen.
 *
 * Här prövas serien och registret direkt mot repot, som routrarna använder.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { invoiceNumbers } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { DrizzleInvoiceRepository } from "@/lib/server/repositories/drizzle-invoice-repository";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { invoiceNumberPrefix } from "@/lib/server/repositories/invoice-repository";
import { asId } from "@/lib/shared/schemas/ids";
import { stockholmYear } from "@/lib/shared/stockholm-time";
import { uuidv7 } from "@/lib/shared/uuid";
import { createPooledTestDb, createTestDb, type TestDbHandle } from "../db/pg-test-db";

const PREFIX = invoiceNumberPrefix(stockholmYear(new Date()));
const num = (n: number): string => `${PREFIX}${String(n).padStart(4, "0")}`;

describe("fakturanummer från servern (#1243)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;

  async function newOrgMatter(): Promise<{ org: string; matterId: string }> {
    const org = uuidv7(), matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: org, title: "Fakturering", status: "ACTIVE", matterNumber: "2026-1243" } as never);
    return { org, matterId };
  }

  /** Som routrarna: nästa nummer i fakturadatumets serie, och fakturan, i en transaktion. */
  function issue(org: string, matterId: string, invoiceDate = new Date()): Promise<{ invoiceNumber?: string | null | undefined }> {
    return repos.transaction(async (tx) => {
      const invoiceNumber = await tx.invoices.nextInvoiceNumber(asId<"OrganizationId">(org), stockholmYear(invoiceDate));
      return tx.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate, invoiceNumber } as never);
    });
  }

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  });
  afterAll(async () => { await handle.close(); });

  it("två fakturor i samma byrå får var sitt nummer i serien", async () => {
    const { org, matterId } = await newOrgMatter();
    const a = await issue(org, matterId);
    const b = await issue(org, matterId);
    expect([a.invoiceNumber, b.invoiceNumber]).toEqual([num(1), num(2)]);
  });

  it("serien följer fakturadatumets år — en faktura från 31/12 hamnar i förra årets serie", async () => {
    const { org, matterId } = await newOrgMatter();
    const lastYear = new Date().getFullYear() - 1;
    const inv = await issue(org, matterId, new Date(`${lastYear}-12-31T12:00:00.000Z`));
    expect(inv.invoiceNumber).toBe(`${invoiceNumberPrefix(lastYear)}0001`);
  });

  it("serierna är per byrå — en annan byrås fakturor påverkar inte numret", async () => {
    const one = await newOrgMatter();
    const two = await newOrgMatter();
    await issue(one.org, one.matterId);
    expect((await issue(two.org, two.matterId)).invoiceNumber).toBe(num(1));
  });

  it("ett registrerat nummer utan fakturarad (avbrott) återanvänds inte", async () => {
    const { org, matterId } = await newOrgMatter();
    await handle.db.insert(invoiceNumbers).values({ organizationId: org, invoiceNumber: num(1), invoiceId: asId<"InvoiceId">(uuidv7()) });
    expect((await issue(org, matterId)).invoiceNumber).toBe(num(2));
  });

  it("registret fylls vid skapande — varje utfärdat nummer finns där, en gång", async () => {
    const { org, matterId } = await newOrgMatter();
    await issue(org, matterId);
    await issue(org, matterId);
    const rows = (await handle.db.select().from(invoiceNumbers)).filter((r) => r.organizationId === org);
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual([num(1), num(2)]);
  });

  it("databasen vägrar en dubblett inom byrån (registret), även förbi synken — och ingen halv fakturarad blir kvar", async () => {
    const { matterId } = await newOrgMatter();
    await repos.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: num(9) } as never);
    const dupId = uuidv7();
    await expect(repos.invoices.create({
      id: dupId, matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: num(9),
    } as never)).rejects.toThrow();
    expect(await repos.invoices.getById(asId<"InvoiceId">(dupId))).toBeNull();
  });

  it("ett nummer som kommer med en uppdatering tas aldrig — varken på fakturan eller i registret (#1350)", async () => {
    const { org, matterId } = await newOrgMatter();
    const draft = await repos.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date() } as never);
    await repos.invoices.update(draft.id, { invoiceNumber: num(1), ocrReference: "1234", amount: 2 });
    const rows = (await handle.db.select().from(invoiceNumbers)).filter((r) => r.organizationId === org);
    expect(rows).toEqual([]);
    expect(await repos.invoices.getById(draft.id)).toMatchObject({ invoiceNumber: null, amount: 2 });
    // Platsen i serien är kvar: nästa utfärdade nummer är 0001.
    expect((await issue(org, matterId)).invoiceNumber).toBe(num(1));
  });

  it("efter 9999 kommer 10000 och 10001 — högsta numret jämförs numeriskt, inte som text (#1350)", async () => {
    const { org, matterId } = await newOrgMatter();
    await repos.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: num(9999) } as never);
    expect((await issue(org, matterId)).invoiceNumber).toBe(`${PREFIX}10000`);
    expect((await issue(org, matterId)).invoiceNumber).toBe(`${PREFIX}10001`);
  });

  it("registret räknas också numeriskt: ett registrerat 10000 utan fakturarad ger 10001", async () => {
    const { org, matterId } = await newOrgMatter();
    await repos.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: num(9999) } as never);
    await handle.db.insert(invoiceNumbers).values({ organizationId: org, invoiceNumber: `${PREFIX}10000`, invoiceId: asId<"InvoiceId">(uuidv7()) });
    expect((await issue(org, matterId)).invoiceNumber).toBe(`${PREFIX}10001`);
  });

  it("nummer som inte är prefix + siffror räknas inte in i serien", async () => {
    const { org, matterId } = await newOrgMatter();
    await repos.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: `${PREFIX}0007-K` } as never);
    expect((await issue(org, matterId)).invoiceNumber).toBe(num(1));
  });

  it("utan år: seriens år är det svenska året från repots klocka — nyårsnatten 00.30 hör till det nya året (#1350)", async () => {
    const { org } = await newOrgMatter();
    const newYearsNight = new Date("2026-12-31T23:30:00Z"); // 00.30 den 1/1 2027 i Stockholm
    const clocked = new DrizzleInvoiceRepository(handle.db, () => newYearsNight);
    expect(await clocked.nextInvoiceNumber(asId<"OrganizationId">(org))).toBe("F-2027-0001");
  });

  it("okänt ärende (ingen byrå) → inget registreras", async () => {
    const before = (await handle.db.select().from(invoiceNumbers)).length;
    await repos.invoices.create({ id: uuidv7(), matterId: uuidv7(), amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: num(5) } as never).catch(() => null);
    expect((await handle.db.select().from(invoiceNumbers)).length).toBe(before);
  });

  it("utan id genereras ett — samma id i registret som på fakturan", async () => {
    const { org, matterId } = await newOrgMatter();
    const created = await repos.invoices.create({ matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber: num(3) } as never);
    const rows = (await handle.db.select().from(invoiceNumbers)).filter((r) => r.organizationId === org);
    expect(rows).toMatchObject([{ invoiceNumber: num(3), invoiceId: created.id }]);
  });

  it("server-routrarnas nummer (samtidiga transaktioner) blir också unika", async () => {
    const { org, matterId } = await newOrgMatter();
    const create = () => repos.transaction(async (tx) => {
      const invoiceNumber = await tx.invoices.nextInvoiceNumber(asId<"OrganizationId">(org));
      return tx.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber } as never);
    });
    const [a, b] = await Promise.all([create(), create()]);
    expect(new Set([a.invoiceNumber, b.invoiceNumber]).size).toBe(2);
  });
});

/**
 * Äkta samtidighet (#1350): två ANSLUTNINGAR mot riktig Postgres, var sin
 * transaktion som tilldelar nummer. Testet ovan går över en anslutning (pglite /
 * max 1), där transaktionerna aldrig överlappar — här bevisas att byrålåset
 * (`pg_advisory_xact_lock`) håller när de gör det. Körs i CI:s "Repository
 * (Postgres)"-jobb (`PG_TEST_URL`); hoppas lokalt utan Postgres.
 */
const itPg = process.env.PG_TEST_URL ? it : it.skip;
const pidRows = z.tuple([z.object({ pid: z.number() })]);

describe("fakturanummer — samtidiga anslutningar mot riktig Postgres (#1350)", () => {
  let pooled: TestDbHandle | null = null;

  beforeAll(async () => { pooled = await createPooledTestDb(2); });
  afterAll(async () => { await pooled?.close(); });

  itPg("två anslutningar som fakturerar samtidigt får var sitt nummer, i en obruten serie", async () => {
    if (!pooled) throw new Error("PG_TEST_URL saknas");
    const repos = buildDrizzleRepositories(pooled.db);
    const org = uuidv7(), matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: org, title: "Samtidigt", status: "ACTIVE", matterNumber: "2026-1350" } as never);
    // Spärr: ingen transaktion tilldelar förrän BÅDA är öppna — de överlappar
    // alltså garanterat (med en enda anslutning hade testet hängt sig).
    let arrived = 0;
    let release: () => void = () => {};
    const bothOpen = new Promise<void>((resolve) => { release = resolve; });
    const issueConcurrently = () => repos.transactionWithDb(async (tx, txDb) => {
      const [{ pid }] = pidRows.parse(await txDb.execute(sql`SELECT pg_backend_pid() AS pid`));
      if (++arrived === 2) release();
      await bothOpen;
      const invoiceNumber = await tx.invoices.nextInvoiceNumber(asId<"OrganizationId">(org));
      await tx.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date(), invoiceNumber } as never);
      return { invoiceNumber, pid };
    });
    const [a, b] = await Promise.all([issueConcurrently(), issueConcurrently()]);
    expect(a.pid).not.toBe(b.pid); // två olika anslutningar (backend-processer)
    expect([a.invoiceNumber, b.invoiceNumber].sort()).toEqual([num(1), num(2)]);
  });
});
