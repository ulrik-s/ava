/**
 * Fakturanumret sätts av servern (#1243, ADR 0012) — pglite.
 *
 * Mervärdesskattelagen (17 kap. 24 § 2 ML) kräver ett löpnummer som ENSAMT
 * identifierar fakturan, i en obruten serie. Klienten räknade fram numret ur
 * de fakturor den kände till lokalt: två jurister som fakturerade under samma
 * avbrott (eller innan synken hunnit ikapp) fick samma nummer.
 *
 * Nu:
 *   - servern sätter numret när en faktura synkas (klientens är preliminärt),
 *   - ett server-only-register (`invoice_numbers`, PK = byrå + nummer) gör en
 *     dubblett omöjlig i databasen,
 *   - numret är oföränderligt: en senare uppdatering med ett gammalt
 *     preliminärt nummer skriver inte över det.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { invoiceNumbers } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { invoiceNumberPrefix } from "@/lib/server/repositories/invoice-repository";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { ocrFromInvoiceNumber } from "@/lib/shared/ocr-reference";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const PREFIX = invoiceNumberPrefix(new Date().getFullYear());
const num = (n: number): string => `${PREFIX}${String(n).padStart(4, "0")}`;

function createInvoice(matterId: string, invoiceNumber: string | null, extra: Record<string, unknown> = {}): QueuedMutation {
  const id = uuidv7();
  return {
    mutationId: uuidv7(), entity: "invoice", kind: "create", enqueuedAt: 0,
    row: {
      id, matterId, amount: 100_00, status: "DRAFT", invoiceType: "STANDARD", invoiceDate: new Date(),
      invoiceNumber, ocrReference: ocrFromInvoiceNumber(invoiceNumber), ...extra,
    },
  };
}

describe("fakturanummer från servern (#1243)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;

  async function newOrgMatter(): Promise<{ org: string; matterId: string }> {
    const org = uuidv7(), matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: org, title: "Fakturering", status: "ACTIVE", matterNumber: "2026-1243" } as never);
    return { org, matterId };
  }

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    sync = new DrizzleSyncStore(handle.db, repos);
  });
  afterAll(async () => { await handle.close(); });

  it("två klienter med SAMMA preliminära nummer → servern ger dem var sitt nummer i serien", async () => {
    const { org, matterId } = await newOrgMatter();
    const a = await sync.push(org, createInvoice(matterId, num(1)));
    const b = await sync.push(org, createInvoice(matterId, num(1)));
    expect(a.status).toBe("accepted");
    expect(b.status).toBe("accepted");
    const numbers = [a, b].map((r) => (r.status === "accepted" ? r.row.invoiceNumber : null));
    expect(numbers).toEqual([num(1), num(2)]);
  });

  it("OCR-referensen följer serverns nummer", async () => {
    const { org, matterId } = await newOrgMatter();
    await sync.push(org, createInvoice(matterId, num(1)));
    const res = await sync.push(org, createInvoice(matterId, num(1)));
    expect(res.status === "accepted" && res.row).toMatchObject({ invoiceNumber: num(2), ocrReference: ocrFromInvoiceNumber(num(2)) });
  });

  it("domstolsfaktura (ingen OCR hos klienten) får ingen OCR av servern heller", async () => {
    const { org, matterId } = await newOrgMatter();
    const res = await sync.push(org, createInvoice(matterId, num(7), { ocrReference: null }));
    expect(res.status === "accepted" && res.row).toMatchObject({ invoiceNumber: num(1), ocrReference: null });
  });

  it("ett preliminärt nummer långt fram i serien ger ändå nästa lediga (obruten serie)", async () => {
    const { org, matterId } = await newOrgMatter();
    const res = await sync.push(org, createInvoice(matterId, num(42)));
    expect(res.status === "accepted" && res.row.invoiceNumber).toBe(num(1));
  });

  it("serien följer fakturadatumets år — en faktura från 31/12 som synkas 1/1 hamnar i förra årets serie", async () => {
    const { org, matterId } = await newOrgMatter();
    const lastYear = new Date().getFullYear() - 1;
    const res = await sync.push(org, createInvoice(matterId, "F-X-1", { invoiceDate: new Date(`${lastYear}-12-31T12:00:00.000Z`) }));
    expect(res.status === "accepted" && res.row.invoiceNumber).toBe(`${invoiceNumberPrefix(lastYear)}0001`);
  });

  it("faktura utan nummer (utkast) förblir utan nummer", async () => {
    const { org, matterId } = await newOrgMatter();
    const res = await sync.push(org, createInvoice(matterId, null));
    expect(res.status === "accepted" && res.row.invoiceNumber).toBeNull();
  });

  it("serierna är per byrå — en annan byrås fakturor påverkar inte numret", async () => {
    const one = await newOrgMatter();
    const two = await newOrgMatter();
    await sync.push(one.org, createInvoice(one.matterId, num(1)));
    const res = await sync.push(two.org, createInvoice(two.matterId, num(1)));
    expect(res.status === "accepted" && res.row.invoiceNumber).toBe(num(1));
  });

  it("numret är oföränderligt: en uppdatering med det gamla preliminära numret skriver inte över", async () => {
    const { org, matterId } = await newOrgMatter();
    await sync.push(org, createInvoice(matterId, num(1)));
    const create = createInvoice(matterId, num(1));
    const created = await sync.push(org, create);
    const id = String(create.row.id);
    expect(created.status === "accepted" && created.row.invoiceNumber).toBe(num(2));
    await sync.push(org, {
      mutationId: uuidv7(), entity: "invoice", kind: "update", enqueuedAt: 0,
      row: { ...create.row, status: "SENT" }, baseVersion: 1,
    });
    expect(await repos.invoices.getById(asId<"InvoiceId">(id))).toMatchObject({ invoiceNumber: num(2), status: "SENT" });
  });

  it("idempotent omspelning av samma create förbrukar inget nytt nummer", async () => {
    const { org, matterId } = await newOrgMatter();
    const m = createInvoice(matterId, num(1));
    await sync.push(org, m);
    await sync.push(org, m);
    const next = await sync.push(org, createInvoice(matterId, num(1)));
    expect(next.status === "accepted" && next.row.invoiceNumber).toBe(num(2));
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

  it("ett registrerat nummer utan fakturarad (avbrott) återanvänds inte", async () => {
    const { org, matterId } = await newOrgMatter();
    await handle.db.insert(invoiceNumbers).values({ organizationId: org, invoiceNumber: num(1), invoiceId: asId<"InvoiceId">(uuidv7()) });
    const res = await sync.push(org, createInvoice(matterId, num(1)));
    expect(res.status === "accepted" && res.row.invoiceNumber).toBe(num(2));
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

  it("registret fylls vid skapande — varje utfärdat nummer finns där, en gång", async () => {
    const { org, matterId } = await newOrgMatter();
    await sync.push(org, createInvoice(matterId, num(1)));
    await sync.push(org, createInvoice(matterId, num(1)));
    const rows = (await handle.db.select().from(invoiceNumbers)).filter((r) => r.organizationId === org);
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual([num(1), num(2)]);
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
