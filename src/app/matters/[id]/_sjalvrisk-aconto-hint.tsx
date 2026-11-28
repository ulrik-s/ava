"use client";

/**
 * Självrisk-aconto-påminnelsen (#854, #1852) i ärendets Fakturering.
 *
 * Rättshjälp och rättsskydd: när nettot på det aconto som dialogen Aconto till
 * klient föreslår har nått byråns tröskel påminner rutan om att skicka ett, och
 * knappen öppnar samma dialog som menyvalet. Rutan räknar på samma underlag som
 * dialogen (`billingRun.proposal`, `proposedAccontoOre`) och visas bara när
 * aconto finns bland ärendets åtgärder (ADR 0034). Self-gating.
 */

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/client/trpc";
import { isCoverageMethod, type BillingAction } from "@/lib/shared/billing/billing-flow";
import { DEFAULT_ACCONTO_SHARE_BIPS } from "@/lib/shared/billing/billing-proposal";
import { sjalvriskAccontoDue, unbilledClientShareNetOre } from "@/lib/shared/billing/billing-todo";
import { SJALVRISK_ACCONTO_THRESHOLD_ORE } from "@/lib/shared/billing/rattshjalp";
import { formatKr } from "@/lib/shared/kr-format";
import type { PaymentMethod } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Det påminnelsen behöver veta om ärendet och panelen. */
export interface SjalvriskAccontoHintProps {
  matterId: MatterId;
  paymentMethod: PaymentMethod | null | undefined;
  /** Ärendets klientandel; saknas den används dialogens standard. */
  clientShareBips: number | null | undefined;
  /** Ärendets tillgängliga faktureringsåtgärder (`availableActions`). */
  actions: readonly BillingAction[];
  /** Öppnar dialogen Aconto till klient. */
  onOpen: () => void;
}

/** Gränsbeloppet är en byrå-inställning (#885); faller tillbaka på default-konstanten. */
function useAccontoThreshold(enabled: boolean): number {
  const t = useTRPC();
  const orgThreshold = useQuery(t.organization.getSettings.queryOptions(undefined, { enabled })).data?.accontoThresholdOre;
  return orgThreshold ?? SJALVRISK_ACCONTO_THRESHOLD_ORE;
}

export function SjalvriskAccontoHint({ matterId, paymentMethod, clientShareBips, actions, onOpen }: SjalvriskAccontoHintProps) {
  const accontoAllowed = actions.some((a) => a.type === "ACCONTO");
  const enabled = accontoAllowed && isCoverageMethod(paymentMethod);
  const t = useTRPC();
  const proposal = useQuery(t.billingRun.proposal.queryOptions({ matterId }, { enabled })).data;
  const thresholdOre = useAccontoThreshold(enabled);
  if (!proposal) return null;
  const shareBips = clientShareBips ?? DEFAULT_ACCONTO_SHARE_BIPS;
  const input = { workValueOre: proposal.workValueOre, priorAccontoSumOre: proposal.priorAccontoSumOre, clientShareBips: shareBips };
  if (!sjalvriskAccontoDue({ ...input, method: paymentMethod, thresholdOre, accontoAllowed })) return null;
  const netOre = unbilledClientShareNetOre(input.workValueOre, input.clientShareBips, input.priorAccontoSumOre);
  return (
    <div role="status" className="mx-2 mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span>
        Klientens självrisk{input.priorAccontoSumOre > 0 ? " sedan förra acontot" : ""} har nått{" "}
        <span className="font-mono font-semibold">{formatKr(netOre)}</span> exkl. moms
        (tröskel {formatKr(thresholdOre)}) — dags att skicka ett självrisk-aconto.
      </span>
      <button type="button" onClick={onOpen}
        className="shrink-0 rounded border border-amber-400 bg-white px-2 py-1 font-medium text-amber-900 hover:bg-amber-100">
        Aconto till klient
      </button>
    </div>
  );
}
