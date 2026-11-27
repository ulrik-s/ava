/**
 * Startjobbet som ger äldre BAD_DEBT-fakturor sin WriteOff-post (#1809), mot
 * Drizzle-repona (pglite lokalt, riktig Postgres i CI). Inte minnesrepona: de
 * kör demons migrate-on-read och skulle göra "ingen ny post"-fallen tomma.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { backfillBadDebtWriteOffs } from "@/lib/server/jobs/bad-debt-write-off-backfill";
import type { ChangeLogEntry } from "@/lib/server/repositories/change-log-recorder";
import type { InvoiceListFilter } from "@/lib/server/repositories/invoice-repository";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { MIGRATION_REASON, MIGRATION_SYSTEM_USER_ID } from "@/lib/shared/billing/write-off-migration";
import type { WriteOff } from "@/lib/shared/schemas/billing";
import { asId, type InvoiceId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { DRIZZLE_NAME, openDrizzleRepos, type OpenRepos } from "../repositories/contract-backends";

const at = new Date("2026-03-01T08:00:00.000Z");

interface Byra { org: OrganizationId; matter: string; user: string }

async function makeByra(repos: Repositories): Promise<Byra> {
  const b = { org: asId<"OrganizationId">(uuidv7()), matter: uuidv7(), user: uuidv7() };
  await repos.matters.create({ id: b.matter, organizationId: b.org, matterNumber: `2026-${b.matter.slice(-4)}`, title: "Kundförlust", status: "ACTIVE" } as never);
  return b;
}

async function invoice(repos: Repositories, b: Byra, status: string, amount = 100_000): Promise<InvoiceId> {
  const id = asId<"InvoiceId">(uuidv7());
  await repos.invoices.create({ id, matterId: b.matter, amount, invoiceDate: at, status } as never);
  return id;
}

const pay = (repos: Repositories, b: Byra, invoiceId: InvoiceId, amount: number) =>
  repos.payments.create({ id: uuidv7(), invoiceId, amount, paidAt: at, recordedById: b.user } as never);

const writeOffsOf = (repos: Repositories, id: InvoiceId): Promise<WriteOff[]> => repos.writeOffs.listByInvoiceIds([id]);

describe(`backfillBadDebtWriteOffs — ${DRIZZLE_NAME}`, () => {
  let open: OpenRepos;
  let repos: Repositories;
  let byra: Byra;
  let log: ChangeLogEntry[];
  const onError = vi.fn();

  beforeEach(async () => {
    log = [];
    open = await openDrizzleRepos((e) => { log.push(e); });
    repos = open.repos;
    byra = await makeByra(repos);
    onError.mockClear();
  });
  afterEach(async () => { await open.close(); });

  it("en BAD_DEBT-faktura utan post får en post på hela återstoden", async () => {
    const id = await invoice(repos, byra, "BAD_DEBT");
    const r = await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    expect(r).toEqual({ writeOffs: 1, failed: 0 });
    const [wo] = await writeOffsOf(repos, id);
    expect(wo).toMatchObject({ invoiceId: id, amount: 100_000, reason: MIGRATION_REASON, recordedById: MIGRATION_SYSTEM_USER_ID });
    expect(new Date(String(wo?.writtenOffAt)).getTime()).toBeGreaterThan(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("en delbetald och delkrediterad faktura får en post på exakt återstoden", async () => {
    const id = await invoice(repos, byra, "BAD_DEBT");
    await pay(repos, byra, id, 30_000);
    await repos.invoices.create({ id: uuidv7(), matterId: byra.matter, amount: -20_000, invoiceDate: at, status: "SENT", invoiceType: "CREDIT", creditedInvoiceId: id } as never);
    await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    expect((await writeOffsOf(repos, id)).map((w) => w.amount)).toEqual([50_000]);
  });

  it("ingen post för en faktura som redan har en WriteOff", async () => {
    const id = await invoice(repos, byra, "BAD_DEBT");
    await repos.writeOffs.create({ id: uuidv7(), invoiceId: id, amount: 40_000, writtenOffAt: at, recordedById: byra.user } as never);
    const r = await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    expect(r.writeOffs).toBe(0);
    expect((await writeOffsOf(repos, id)).map((w) => w.amount)).toEqual([40_000]);
  });

  it("ingen post när inget återstår, och andra statusar rörs inte", async () => {
    const paid = await invoice(repos, byra, "BAD_DEBT");
    await pay(repos, byra, paid, 100_000);
    const sent = await invoice(repos, byra, "SENT");
    const r = await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    expect(r.writeOffs).toBe(0);
    expect(await repos.writeOffs.listByInvoiceIds([paid, sent])).toEqual([]);
  });

  it("en andra körning skapar inget", async () => {
    const id = await invoice(repos, byra, "BAD_DEBT");
    await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    const second = await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    expect(second).toEqual({ writeOffs: 0, failed: 0 });
    expect(await writeOffsOf(repos, id)).toHaveLength(1);
  });

  it("posten ger en rad i change_log", async () => {
    const id = await invoice(repos, byra, "BAD_DEBT");
    log.length = 0;
    await backfillBadDebtWriteOffs(repos, [byra.org], onError);
    const [wo] = await writeOffsOf(repos, id);
    expect(log.map((e) => ({ entity: e.entity, rowId: e.rowId, op: e.op }))).toEqual([
      { entity: "writeOff", rowId: String(wo?.id), op: "create" },
    ]);
  });

  it("ett fel för en byrå räknas i failed och stoppar inte de andra", async () => {
    const trasig = asId<"OrganizationId">(uuidv7());
    const original = repos.invoices.listForOrg.bind(repos.invoices);
    vi.spyOn(repos.invoices, "listForOrg").mockImplementation((org: OrganizationId, filter?: InvoiceListFilter) =>
      org === trasig ? Promise.reject(new Error("databasen svarar inte")) : original(org, filter));
    const id = await invoice(repos, byra, "BAD_DEBT");
    const r = await backfillBadDebtWriteOffs(repos, [trasig, byra.org], onError);
    expect(r).toEqual({ writeOffs: 1, failed: 1 });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining(`byrå ${trasig}: Error: databasen svarar inte`));
    expect(await writeOffsOf(repos, id)).toHaveLength(1);
  });
});
