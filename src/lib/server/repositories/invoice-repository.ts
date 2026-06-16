/**
 * `InvoiceRepository` (ADR 0020, #409 Fas 2 — pilot) — typade metoder i st.f.
 * dynamiska `where`/`include`. Sätter mönstret för övriga entiteters repos:
 *   - bas-CRUD ärvs från `Repository<Invoice>`
 *   - relations-läsningar blir EXPLICITA metoder med typad retur
 *     (`getByIdWithLedger` → `InvoiceWithLedger`)
 *   - lista blir en namngiven metod (`listByMatter`) i st.f. `findMany({ where })`
 *
 * Affärslogik (statemaskin, beräkningar) bor kvar i routrarna; repot är ren
 * dataåtkomst. Två impls: in-memory (browser/offline) + Drizzle (server).
 */

import type {
  AccontoDeduction, Expense, Invoice, Payment, PaymentPlan, PaymentPlanReminder, TimeEntry, WriteOff,
} from "@/lib/shared/schemas/billing";
import type { Document } from "@/lib/shared/schemas/document";
import type { Matter } from "@/lib/shared/schemas/matter";
import type { Repository } from "./types";

/** Faktura + dess avräknings-poster (motsvarar dagens `include` payments/writeOffs). */
export interface InvoiceWithLedger extends Invoice {
  payments: Payment[];
  writeOffs: WriteOff[];
}

/**
 * Faktura + relationerna som fakturadetalj-sidan läser, via relations()-infran
 * (ADR 0020 #439). Self-ref-relationerna (accontoDeductions/deductedOnFinals/
 * creditedInvoice/creditNote) läggs till i steget som migrerar `getById`.
 */
export interface InvoiceWithRelations extends Invoice {
  /** Alltid satt — metoderna org-scopar via ärendet, så en träff har alltid matter. */
  matter: Matter;
  payments: Array<Payment & { recordedBy: { name: string } | null }>;
  writeOffs: WriteOff[];
  paymentPlan: (PaymentPlan & { reminders: PaymentPlanReminder[] }) | null;
  timeEntries: TimeEntry[];
  expenses: Expense[];
  documents: Document[];
}

/** Full faktura-detalj (motsvarar `invoice.getById`-routerns include exakt). */
export interface InvoiceFull extends InvoiceWithRelations {
  accontoDeductions: Array<AccontoDeduction & { accontoInvoice: Invoice | null }>;
  deductedOnFinals: Array<AccontoDeduction & { finalInvoice: Invoice | null }>;
  creditedInvoice: Pick<Invoice, "id" | "invoiceDate" | "amount" | "invoiceType"> | null;
  creditNote: Pick<Invoice, "id" | "invoiceDate" | "amount"> | null;
}

/** Filter för `listForOrg` (alla optional → org-bred lista). */
export interface InvoiceListFilter {
  matterId?: string | undefined;
  invoiceType?: Invoice["invoiceType"] | undefined;
  status?: Invoice["status"] | undefined;
}

/**
 * Faktura-rad för listvyn (motsvarar `invoice.list`-routerns include exakt).
 * Lättare shape än `InvoiceFull`: ärendet är en select-delmängd, inga
 * write-offs/tid/utlägg/dok, och `deductedOnFinals` bara `id` (för räkning).
 */
export interface InvoiceListRow extends Invoice {
  matter: Pick<Matter, "id" | "matterNumber" | "title">;
  paymentPlan: PaymentPlan | null;
  payments: Payment[];
  accontoDeductions: Array<AccontoDeduction & { accontoInvoice: Invoice | null }>;
  deductedOnFinals: Array<Pick<AccontoDeduction, "id">>;
  creditedInvoice: Pick<Invoice, "id" | "invoiceDate" | "amount"> | null;
  creditNote: Pick<Invoice, "id" | "invoiceDate" | "amount"> | null;
}

/** Fakturanummer-prefix för ett år (`F-YYYY-`). Delad mellan repo-impls + router. */
export function invoiceNumberPrefix(year: number): string {
  return `F-${year}-`;
}

/** Nästa nummer givet prefix + senaste numret (öka sekvensen, annars 0001). */
export function nextInvoiceNumberFrom(prefix: string, lastNumber: string | null | undefined): string {
  const seq = lastNumber && lastNumber.startsWith(prefix)
    ? parseInt(lastNumber.slice(prefix.length), 10) + 1
    : 1;
  return `${prefix}${seq.toString().padStart(4, "0")}`;
}

export interface InvoiceRepository extends Repository<Invoice> {
  /** Faktura by id, org-scopad via ärendet (null om saknas/annan org/raderad). */
  getByIdInOrg(id: string, organizationId: string): Promise<Invoice | null>;
  /** Full faktura-detalj (alla relationer inkl. aconto-avdrag/kredit), org-scopad. */
  getByIdFull(id: string, organizationId: string): Promise<InvoiceFull | null>;
  /** Faktura med betalningar + avskrivningar (ledger). Null om saknas/raderad. */
  getByIdWithLedger(id: string): Promise<InvoiceWithLedger | null>;
  /** Faktura + huvudrelationer (matter/payments/writeOffs/plan/tid/utlägg/dok), org-scopad. */
  getByIdWithRelations(id: string, organizationId: string): Promise<InvoiceWithRelations | null>;
  /** Org-bred fakturalista (listvyns include), nyaste först, valfritt filtrerad. */
  listForOrg(organizationId: string, filter?: InvoiceListFilter): Promise<InvoiceListRow[]>;
  /** Nästa lediga fakturanummer (`F-YYYY-NNNN`) för org:en (året från repots klocka). */
  nextInvoiceNumber(organizationId: string): Promise<string>;
  /** Summa krediterat på en faktura: |belopp| av dess kreditnotor, org-scopat (öre). */
  sumCreditNotesFor(invoiceId: string, organizationId: string): Promise<number>;
  /** Kreditnotan för en faktura (`creditedInvoiceId = id`) — null om ej krediterad. */
  getCreditNoteFor(invoiceId: string): Promise<Invoice | null>;
  /** Valda ACCONTO-fakturor i ett ärende som ÄNNU INTE dragits av på en FINAL. Tom vid tomma ids. */
  listDeductibleAccontos(matterId: string, ids: string[]): Promise<Invoice[]>;
  /** Alla (icke-raderade) fakturor i ett ärende, nyaste först. */
  listByMatter(matterId: string): Promise<Invoice[]>;
}
