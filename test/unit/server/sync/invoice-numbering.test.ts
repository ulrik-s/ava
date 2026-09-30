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
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { invoiceNumbers } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { invoiceNumberPrefix } from "@/lib/server/repositories/invoice-repository";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const PREFIX = invoiceNumberPrefix(new Date().getFullYear());
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
      const invoiceNumber = await tx.invoices.nextInvoiceNumber(asId<"OrganizationId">(org), invoiceDate.getFullYear());
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

  it("nummer på ett utkast som saknade nummer registreras vid uppdatering", async () => {
    const { org, matterId } = await newOrgMatter();
    const draft = await repos.invoices.create({ id: uuidv7(), matterId, amount: 1, status: "DRAFT", invoiceDate: new Date() } as never);
    await repos.invoices.update(draft.id, { invoiceNumber: num(1) });
    const rows = (await handle.db.select().from(invoiceNumbers)).filter((r) => r.organizationId === org);
    expect(rows).toMatchObject([{ invoiceNumber: num(1), invoiceId: draft.id }]);
    expect(await repos.invoices.getById(draft.id)).toMatchObject({ invoiceNumber: num(1) });
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
