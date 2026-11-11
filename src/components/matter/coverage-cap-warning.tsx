"use client";

/**
 * Varningsbadge när ett rättshjälps-/rättsskyddsärende närmar sig taket (#793).
 * Visas när varningsgränsen i `coverageStatus` nås — påminner om att begära
 * utökad rättshjälp / utökat rättsskydd. Self-gating: renderar null för andra
 * betalningssätt / under taket.
 */

import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";
import { coverageStatus, type CoverageStatus } from "@/lib/shared/coverage-cap";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

interface Props {
  matterId: MatterId;
  paymentMethod: PaymentMethod | null | undefined;
  rattsskyddMaxOre: number | null;
  rattshjalpMaxTimmar: number | null;
  /** `compact` = ärendehuvudet (#1520): tätare, utan bottenmarginal. */
  layout?: CoverageCapLayout | undefined;
}

/** Var varningen sitter: i en panel (standard) eller kompakt i ärendehuvudet. */
export type CoverageCapLayout = "panel" | "compact";

const LAYOUT_CLASS: Record<CoverageCapLayout, string> = {
  panel: "mb-6 px-4 py-2",
  compact: "mt-1 px-3 py-1",
};

function usesCap(method: PaymentMethod | null | undefined): boolean {
  return method === "RATTSSKYDD" || method === "RATTSHJALP";
}

/** Upparbetat/tak som text (belopp resp. timmar). */
function usageText(s: CoverageStatus): { used: string; cap: string } {
  if (s.kind === "amount") return { used: formatCurrency(s.usedOre), cap: formatCurrency(s.capOre) };
  return { used: `${Math.round((s.usedOre / 60) * 10) / 10} tim`, cap: `${s.capOre / 60} tim` };
}

export function CoverageCapWarning({ matterId, paymentMethod, rattsskyddMaxOre, rattshjalpMaxTimmar, layout = "panel" }: Props) {
  const enabled = usesCap(paymentMethod);
  const usage = trpc.matter.coverageUsage.useQuery({ matterId }, { enabled });
  if (!enabled || !usage.data) return null;
  const status = coverageStatus({
    method: paymentMethod,
    rattsskyddMaxOre,
    rattshjalpMaxTimmar,
    billableMinutes: usage.data.billableMinutes,
    billableValueOre: usage.data.billableValueOre,
  });
  if (!status || !status.nearCap) return null;

  const { used, cap } = usageText(status);
  const pct = Math.round(status.ratio * 100);
  const what = paymentMethod === "RATTSHJALP" ? "utökad rättshjälp" : "utökat rättsskydd";
  const heading = status.overCap ? `Taket passerat (${pct} %)` : `Närmar sig taket (${pct} %)`;
  return (
    <div className={`${LAYOUT_CLASS[layout]} rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-900 flex flex-wrap items-center gap-x-2 gap-y-1`}>
      <span className="font-semibold">⚠ {heading}</span>
      <span>{used} av {cap} upparbetat — be om {what}.</span>
    </div>
  );
}
