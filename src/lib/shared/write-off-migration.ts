/**
 * Migrate-on-read ([ADR 0004] + [ADR 0007]): syntetisera en WriteOff-post för
 * varje faktura med legacy-status `BAD_DEBT` som saknar en. Gamla repon satte
 * bara statusflaggan via `setStatus` (utan daterad post); rapporterna (#140)
 * läser `WriteOff.writtenOffAt`, så de behöver en post även för historisk data.
 *
 * **Idempotent:** hoppar fakturor som redan har en WriteOff → kör i prebakeJoins
 * (delad källnivå-post-process) varje hydrering utan att duplicera.
 *
 * Heuristik: `writtenOffAt` uppskattas till `updatedAt` (≈ när BAD_DEBT sattes,
 * samma val som gamla `reports.ts`), med fallback dueDate → invoiceDate →
 * createdAt. Beloppet = återstoden (`amount − betalt − krediterat`).
 *
 * [ADR 0004]: ../../../docs/adr/0004-schemaversion-och-versionsgrind.md
 * [ADR 0007]: ../../../docs/adr/0007-kundfordringar-konstaterad-kundforlust.md
 */

import { computeInvoiceLedger } from "./write-off-calc";

type Row = Record<string, unknown>;

/** Stabil markör så migrerade poster går att känna igen (och filtrera bort). */
export const MIGRATION_RECORDED_BY = "system:bad-debt-migration";
const MIGRATION_REASON = "Migrerad från BAD_DEBT-status (ADR 0007)";

/** Summera `amount` per `invoiceId` över en rad-uppsättning (payments). */
function paidByInvoiceId(payments: readonly Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of payments) {
    const id = String(p.invoiceId ?? "");
    if (id) m.set(id, (m.get(id) ?? 0) + Number(p.amount ?? 0));
  }
  return m;
}

/** Summera krediterat per ursprungsfaktura (CREDIT-fakturors absolutbelopp). */
function creditedByInvoiceId(invoices: readonly Row[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.invoiceType !== "CREDIT") continue;
    const target = String(inv.creditedInvoiceId ?? "");
    if (target) m.set(target, (m.get(target) ?? 0) + Math.abs(Number(inv.amount ?? 0)));
  }
  return m;
}

/** Uppskatta avskrivnings-tidpunkt ur fakturans datum-fält (mest specifikt först). */
function estimateWrittenOffAt(inv: Row): unknown {
  return inv.updatedAt ?? inv.dueDate ?? inv.dueAt ?? inv.invoiceDate ?? inv.issuedAt ?? inv.createdAt ?? null;
}

/** Bygg den syntetiska WriteOff-raden för en BAD_DEBT-faktura, eller null om inget återstår. */
function migratedWriteOffFor(inv: Row, id: string, paid: Map<string, number>, credited: Map<string, number>): Row | null {
  const ledger = computeInvoiceLedger(Number(inv.amount ?? 0), paid.get(id) ?? 0, credited.get(id) ?? 0, 0);
  if (ledger.outstanding <= 0) return null;
  const at = estimateWrittenOffAt(inv);
  return {
    id: `wo-migrated-${id}`,
    invoiceId: id,
    amount: ledger.outstanding,
    writtenOffAt: at,
    reason: MIGRATION_REASON,
    recordedById: MIGRATION_RECORDED_BY,
    createdAt: at,
    migrated: true,
  };
}

/**
 * Returnerar de syntetiska WriteOff-rader som ska läggas till (en per
 * BAD_DEBT-faktura utan befintlig WriteOff och med utestående > 0).
 */
export function synthesizeBadDebtWriteOffs(
  invoices: readonly Row[],
  payments: readonly Row[],
  writeOffs: readonly Row[],
): Row[] {
  const haveWriteOff = new Set(writeOffs.map((w) => String(w.invoiceId ?? "")));
  const paid = paidByInvoiceId(payments);
  const credited = creditedByInvoiceId(invoices);

  const out: Row[] = [];
  for (const inv of invoices) {
    const id = String(inv.id ?? "");
    if (inv.status !== "BAD_DEBT" || !id || haveWriteOff.has(id)) continue;
    const row = migratedWriteOffFor(inv, id, paid, credited);
    if (row) out.push(row);
  }
  return out;
}
