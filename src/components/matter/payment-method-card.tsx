"use client";

/**
 * Betalningssätt-widget på matter-sidan.
 *
 * Visar nuvarande betalningssätt med färgkodad kreditriskindikering och
 * låter användaren ändra inline. Viktigt i familjerätt/försäkring där vi
 * behöver bedöma risken att få in pengarna.
 */

import { useState } from "react";
import { formatKrPerHour } from "@/components/billing/hourly-rates-fields";
import { invalidateBillingSideEffects } from "@/lib/client/billing/invalidate-billing-side-effects";
import {
  PAYMENT_METHOD_LABELS,
  creditRiskFor,
  CREDIT_RISK_LABELS,
  type CreditRisk,
} from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import {
  HOURLY_TIME_ENTRY_KINDS, TIME_ENTRY_KIND_LABELS, type PaymentMethod,
} from "@/lib/shared/schemas/enums";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { PaymentMethodFields, usesClientShare } from "./payment-method-fields";
import { usePaymentMethodForm, type PaymentMethodInitial } from "./use-payment-method-form";

const RISK_BADGE: Record<CreditRisk, string> = {
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-yellow-50 text-yellow-700 border-yellow-200",
  HIGH: "bg-red-50 text-red-700 border-red-200",
  UNKNOWN: "bg-gray-100 text-gray-600 border-gray-200",
};

interface Props extends PaymentMethodInitial {
  matterId: MatterId;
  paymentMethodDecidedAt: Date | string | null;
  /** Anropas efter en lyckad sparning, t.ex. för att stänga dialogen i ärendehuvudet (#1499). */
  onSaved?: (() => void) | undefined;
}

/** Läsvy: nuvarande betalningssätt + kreditrisk-badge + ev. notering/datum. */
/** Tak-text för läsvyn: belopp (rättsskydd) eller timmar (rättshjälp). */
function capLabel(method: PaymentMethod, rattsskyddMaxOre: number | null, rattshjalpMaxTimmar: number | null): string | null {
  if (method === "RATTSSKYDD") return rattsskyddMaxOre != null ? `Tak: ${rattsskyddMaxOre / 100} kr` : "Tak: ej satt";
  if (method === "RATTSHJALP") return `Tak: ${rattshjalpMaxTimmar ?? 100} tim`;
  return null;
}

function PaymentMethodView({
  paymentMethod,
  paymentMethodNote,
  paymentMethodDecidedAt,
  clientShareBips,
  rattsskyddMaxOre,
  rattshjalpMaxTimmar,
  hourlyRates,
  onEdit,
}: {
  paymentMethod: PaymentMethod;
  paymentMethodNote: string | null;
  paymentMethodDecidedAt: Date | string | null;
  clientShareBips: number | null;
  rattsskyddMaxOre: number | null;
  rattshjalpMaxTimmar: number | null;
  hourlyRates?: HourlyRates | undefined;
  onEdit: () => void;
}) {
  const risk = creditRiskFor(paymentMethod);
  const badgeClass = RISK_BADGE[risk];
  const label = PAYMENT_METHOD_LABELS[paymentMethod] ?? paymentMethod;
  const showShare = usesClientShare(paymentMethod);
  const cap = showShare ? capLabel(paymentMethod, rattsskyddMaxOre, rattshjalpMaxTimmar) : null;
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
            Betalningssätt
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{label}</span>
            <span className={`text-xs rounded-full px-2 py-0.5 border ${badgeClass}`}>
              Kreditrisk: {CREDIT_RISK_LABELS[risk]}
            </span>
            <MatterRateBadge hourlyRates={hourlyRates} />
            {showShare && (
              <span className="text-xs rounded-full px-2 py-0.5 border border-blue-200 bg-blue-50 text-blue-700">
                Klientens andel: {clientShareBips != null ? `${clientShareBips / 100} %` : "ej satt"}
              </span>
            )}
            {cap && (
              <span className="text-xs rounded-full px-2 py-0.5 border border-blue-200 bg-blue-50 text-blue-700">
                {cap}
              </span>
            )}
          </div>
          {paymentMethodNote && <p className="text-sm text-gray-600 mt-1">{paymentMethodNote}</p>}
          {paymentMethodDecidedAt && (
            <p className="text-xs text-gray-400 mt-0.5">
              Beslut mottaget {new Date(paymentMethodDecidedAt).toLocaleDateString("sv-SE")}
            </p>
          )}
        </div>
        <button onClick={onEdit} className="text-sm text-blue-600 hover:underline whitespace-nowrap">
          Ändra
        </button>
      </div>
    </div>
  );
}

/** Ärendets satta priser som "Timarvode 3 000 kr/h · Tidsspillan 1 500 kr/h". */
function matterRateSummary(rates: HourlyRates | undefined): string {
  return HOURLY_TIME_ENTRY_KINDS
    .flatMap((kind) => {
      const ore = rates?.[kind];
      return ore != null ? [`${TIME_ENTRY_KIND_LABELS[kind]} ${formatKrPerHour(ore)}`] : [];
    })
    .join(" · ");
}

/** Syns bara när ärendet har ett avvikande pris — det ovanliga fallet. */
function MatterRateBadge({ hourlyRates }: { hourlyRates: HourlyRates | undefined }) {
  const summary = matterRateSummary(hourlyRates);
  if (!summary) return null;
  return (
    <span className="text-xs rounded-full px-2 py-0.5 border border-amber-200 bg-amber-50 text-amber-800">
      Avvikande timpris: {summary}
    </span>
  );
}

/** Redigeringsformulär: betalningsfälten + spar-mutationen (state i `usePaymentMethodForm`). */
function PaymentMethodEditor({ matterId, initial, onDone }: { matterId: MatterId; initial: Props; onDone: () => void }) {
  const form = usePaymentMethodForm(initial);
  const utils = trpc.useUtils();
  const update = trpc.matter.update.useMutation({
    onSuccess: () => {
      void utils.matter.getById.invalidate({ id: matterId });
      invalidateBillingSideEffects(utils);
      onDone();
      initial.onSaved?.();
    },
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Ändra betalningssätt</p>
      <div className="space-y-3">
        <PaymentMethodFields value={form.values} onChange={form.setValues} />
        <div className="flex gap-2 justify-end">
          <button onClick={onDone} className="px-3 py-1.5 text-sm border border-gray-300 rounded">
            Avbryt
          </button>
          <button
            disabled={update.isPending}
            onClick={() => update.mutate({ id: matterId, ...form.toUpdateInput() })}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {update.isPending ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentMethodCard(props: Props) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <PaymentMethodEditor matterId={props.matterId} initial={props} onDone={() => setEditing(false)} />;
  }
  return (
    <PaymentMethodView {...props} onEdit={() => setEditing(true)} />
  );
}
