/**
 * Äldre BAD_DEBT-fakturor får sin WriteOff-post (#1809) — körs när servern
 * startat.
 *
 * Gamla repon satte bara statusflaggan `BAD_DEBT` utan daterad post. Demon
 * syntetiserar posten vid läsning (`synthesizeBadDebtWriteOffs`), men i
 * Postgres fanns ingen motsvarighet, så kundreskontran och rapporterna räknade
 * samma faktura på olika sätt. Kundförlust finns på ett sätt: en WriteOff-post
 * (ADR 0007). Jobbet skapar den för varje BAD_DEBT-faktura som saknar post och
 * har något kvar, med beloppet = återstoden (samma beräkning som
 * `invoice.writeOff`) och tidpunkten uppskattad som i demon.
 *
 * Förebild: `public-assignment-backfill.ts` (ADR 0038 §5). Skrivningen går via
 * repona, som loggar i `change_log` → klienterna hämtar posterna (ADR 0017).
 * Bokföringen rörs inte (ingen `invoiceWrittenOff`-händelse). Bara INSERT och
 * idempotent; fel loggas per byrå och stoppar inte starten.
 */

import { estimatedWriteOffDate, MIGRATION_REASON, MIGRATION_SYSTEM_USER_ID } from "@/lib/shared/billing/write-off-migration";
import type { Invoice, WriteOff } from "@/lib/shared/schemas/billing";
import { asId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { gatherInvoiceLedger } from "../billing/invoice-ledger";
import type { Repositories } from "../repositories/repositories";

export interface BadDebtWriteOffBackfillResult {
  /** Antal skapade WriteOff-poster. */
  writeOffs: number;
  /** Antal byråer där jobbet föll. */
  failed: number;
}

/** En faktura: skapa posten om den saknas och något återstår. */
async function backfillInvoice(
  repos: Repositories, orgId: OrganizationId, inv: Invoice, haveWriteOff: ReadonlySet<string>,
): Promise<boolean> {
  if (haveWriteOff.has(inv.id)) return false;
  const { ledger } = await gatherInvoiceLedger(repos, orgId, inv);
  if (ledger.outstanding <= 0) return false;
  await repos.writeOffs.create({
    id: asId<"WriteOffId">(uuidv7()),
    invoiceId: inv.id,
    amount: ledger.outstanding,
    writtenOffAt: estimatedWriteOffDate(inv) ?? inv.createdAt,
    reason: MIGRATION_REASON,
    recordedById: MIGRATION_SYSTEM_USER_ID,
  } satisfies Partial<WriteOff>);
  return true;
}

/** En byrå: antal skapade poster. */
async function backfillOrganization(repos: Repositories, orgId: OrganizationId): Promise<number> {
  const invoices = await repos.invoices.listForOrg(orgId, { status: "BAD_DEBT" });
  const existing = await repos.writeOffs.listByInvoiceIds(invoices.map((inv) => inv.id));
  const haveWriteOff = new Set<string>(existing.map((w) => w.invoiceId));
  let created = 0;
  for (const inv of invoices) {
    if (await backfillInvoice(repos, orgId, inv, haveWriteOff)) created++;
  }
  return created;
}

/** Ge byråernas äldre BAD_DEBT-fakturor sin WriteOff-post. Kastar aldrig. */
export async function backfillBadDebtWriteOffs(
  repos: Repositories, organizationIds: readonly OrganizationId[], onError: (message: string) => void,
): Promise<BadDebtWriteOffBackfillResult> {
  const result: BadDebtWriteOffBackfillResult = { writeOffs: 0, failed: 0 };
  for (const id of organizationIds) {
    try {
      result.writeOffs += await backfillOrganization(repos, id);
    } catch (err) {
      result.failed++;
      onError(`byrå ${id}: ${String(err)}`);
    }
  }
  return result;
}
