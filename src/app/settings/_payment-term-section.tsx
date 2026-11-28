"use client";

/**
 * `PaymentTermSection` (#2265) — byråns betalningsvillkor: hur många dagar efter
 * fakturadagen en ny faktura förfaller när ingen förfallodag anges. Sparas med
 * knappen Spara (ett köat anrop), som `WatchlistThresholdsSection`. Tomt fält =
 * kodens standard (`DEFAULT_PAYMENT_TERM_DAYS`). Ny fil, så den skrivs med den
 * nya tRPC-bindningen (`useTRPC`, ADR 0041).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { SaveStatusRow } from "@/components/settings/save-status-row";
import { DecimalInput } from "@/components/ui/decimal-input";
import { SECTION_CARD_CLASS } from "@/components/ui/section-tone";
import { useTRPC } from "@/lib/client/trpc";
import { DEFAULT_PAYMENT_TERM_DAYS } from "@/lib/shared/billing/payment-terms";
import { paymentTermDaysSchema } from "@/lib/shared/schemas/organization";

/** Texten när antalet dagar ligger utanför serverns gräns (`paymentTermDaysSchema`). */
export const PAYMENT_TERM_INVALID = "Ange 0–365 dagar";

/** Fältets värde → anropets: hela dagar, tomt fält = `null` (standard). */
export function toPaymentTermPatch(days: number | null): { paymentTermDays: number | null } {
  return { paymentTermDays: days == null ? null : Math.round(days) };
}

/** Klarar värdet serverns gräns? Samma schema som servern, ingen egen gräns. */
export function isValidPaymentTerm(days: number | null): boolean {
  return paymentTermDaysSchema.nullable().safeParse(days).success;
}

const INPUT_CLASS = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

/** Betalningsvillkoret i panelen Byråns uppgifter; laddar byråns sparade värde. */
export function PaymentTermSection() {
  const t = useTRPC();
  const settings = useQuery(t.organization.getSettings.queryOptions());
  if (!settings.data) {
    return (
      <div className={SECTION_CARD_CLASS}>
        <p className="text-xs text-gray-400">Laddar…</p>
      </div>
    );
  }
  return <PaymentTermForm initial={settings.data.paymentTermDays ?? null} />;
}

function PaymentTermForm({ initial }: { initial: number | null }) {
  const t = useTRPC();
  const queryClient = useQueryClient();
  const id = useId();
  const [days, setDays] = useState<number | null>(initial);
  const [saved, setSaved] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const save = useMutation(t.organization.updateSettings.mutationOptions({
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries(t.organization.getSettings.queryFilter());
    },
  }));

  function change(next: number | null): void {
    setSaved(false);
    setInvalid(false);
    setDays(next);
  }

  function submit(): void {
    const patch = toPaymentTermPatch(days);
    const ok = isValidPaymentTerm(patch.paymentTermDays);
    setInvalid(!ok);
    if (ok) save.mutate(patch);
  }

  return (
    <div className={SECTION_CARD_CLASS}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">Betalningsvillkor (dagar)</label>
      <DecimalInput id={id} value={days} onChange={change}
        placeholder={`Standard: ${DEFAULT_PAYMENT_TERM_DAYS} dagar`} className={INPUT_CLASS} />
      <p className="mt-1 text-[11px] text-gray-500">
        Fakturans förfallodag är fakturadagen plus så här många dagar, när ingen annan anges.
        Tomt fält = standard: {DEFAULT_PAYMENT_TERM_DAYS} dagar.
      </p>
      <SaveStatusRow onSave={submit} pending={save.isPending} saved={saved}
        invalid={invalid ? PAYMENT_TERM_INVALID : null} error={save.error?.message ?? null} />
    </div>
  );
}
