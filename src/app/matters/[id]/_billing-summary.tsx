"use client";

/**
 * Fakturapanelens summa-vy (#819, #1236) — fyra kort som tillsammans täcker
 * ärendets pengar:
 *   - Upparbetat ofakturerat: debiterbart arbete (arvode + utlägg) som ännu inte
 *     frysts/fakturerats (billingRun.proposal, PRUTNING exkl). NETTO (exkl moms).
 *   - Yrkat i kostnadsräkning: yrkat belopp på kostnadsräkningar som skapats/
 *     skickats/beslutats/överklagats men ännu inte fakturerats. BRUTTO.
 *   - Fakturerat: alla fakturor utom annullerade (kreditnotor nettar), med
 *     "varav skapat, ej skickat" när det finns DRAFT-fakturor. BRUTTO.
 *   - Betalt: Σ registrerade betalningar. BRUTTO.
 *
 * `basis` säger bara vad det lagrade talet är; `<Money>` visar alla kort i
 * samma globala inkl/exkl-läge. Beräkningen bor i `lib/shared/billing-summary`.
 *
 * Panelen ligger i en dockpanel som kan vara smal → container query: 2×2 som
 * standard, 4 i rad först när panelen själv är bred (ingen horisontell scroll).
 */
import { Money } from "@/components/ui/money";
import { trpc } from "@/lib/client/trpc";
import { invoicedTotals, krClaimedOre, paidOre, type SummaryRun } from "@/lib/shared/billing-summary";
import type { MatterId } from "@/lib/shared/schemas/ids";

export function BillingSummary({ matterId, runs }: { matterId: MatterId; runs: readonly SummaryRun[] }) {
  const proposal = trpc.billingRun.proposal.useQuery({ matterId });
  const invoices = trpc.invoice.list.useQuery({ matterId });
  // Förslagets värde följer ärendets betalningssätt (rättshjälp: normen). Den
  // redan fakturerade rådgivningstimmen är låst och ingår inte (#1205).
  const unbilledOre = proposal.data?.workValueOre ?? 0;
  const list = invoices.data?.items ?? [];
  const { invoicedOre, draftOre } = invoicedTotals(list);
  return (
    <div className="@container px-6 py-4">
      <div data-testid="billing-summary-grid" className="grid grid-cols-2 @2xl:grid-cols-4 gap-3">
        <Card label="Upparbetat ofakturerat" value={unbilledOre} basis="net" />
        <Card label="Yrkat i kostnadsräkning" value={krClaimedOre(runs)} />
        <Card label="Fakturerat" value={invoicedOre} sub={draftOre !== 0 ? { label: "varav skapat, ej skickat", value: draftOre } : undefined} />
        <Card label="Betalt" value={paidOre(list)} />
      </div>
    </div>
  );
}

interface CardProps {
  label: string;
  value: number;
  basis?: "net" | "gross";
  /** Sekundär rad under beloppet (samma basis som huvudbeloppet). */
  sub?: { label: string; value: number } | undefined;
}

function Card({ label, value, basis = "gross", sub }: CardProps) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <Money ore={value} basis={basis} className="font-mono font-semibold text-sm" />
      {sub && (
        <div className="text-[10px] text-gray-500">
          {sub.label}: <Money ore={sub.value} basis={basis} className="font-mono" />
        </div>
      )}
    </div>
  );
}
