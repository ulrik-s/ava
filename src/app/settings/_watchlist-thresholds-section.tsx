"use client";

/**
 * `WatchlistThresholdsSection` (#1912) — byråns trösklar för "Bör faktureras" i
 * Frister (grunden #1911). Två fält som sparas tillsammans med knappen Spara,
 * som `LedgerAccountForm`: inte formulärets debounce, utan ett köat anrop per
 * sparande. Tomt fält = kodens standard (`thresholdsForOrg`). Ny fil, så den
 * skrivs med den nya tRPC-bindningen (`useTRPC`, ADR 0041).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { DecimalInput } from "@/components/ui/decimal-input";
import { SECTION_CARD_CLASS } from "@/components/ui/section-tone";
import { useTRPC } from "@/lib/client/trpc";
import { formatRateKr } from "@/lib/shared/kr-format";
import { DEFAULT_UNBILLED_AGE_DAYS, DEFAULT_UNBILLED_THRESHOLD_ORE } from "@/lib/shared/watchlist";

/** Formulärets utkast: kronor och dagar; `null` = tomt fält (standard). */
export interface ThresholdDraft {
  amountKr: number | null;
  ageDays: number | null;
}

/** Byråns sparade värden (öre och dagar; `null` = standard). */
interface SavedThresholds {
  unbilledThresholdOre: number | null;
  unbilledAgeDays: number | null;
}

/** Sparade värden → utkast i kronor. */
export function toThresholdDraft(saved: SavedThresholds): ThresholdDraft {
  const ore = saved.unbilledThresholdOre;
  return { amountKr: ore == null ? null : ore / 100, ageDays: saved.unbilledAgeDays };
}

/** Utkast → anropets fält: hela öre och hela dagar, tomt fält = `null`. */
export function toThresholdPatch(draft: ThresholdDraft): SavedThresholds {
  return {
    unbilledThresholdOre: draft.amountKr == null ? null : Math.round(draft.amountKr * 100),
    unbilledAgeDays: draft.ageDays == null ? null : Math.round(draft.ageDays),
  };
}

const INPUT_CLASS = "w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500";

export function WatchlistThresholdsSection() {
  const t = useTRPC();
  const settings = useQuery(t.organization.getSettings.queryOptions());
  if (!settings.data) {
    return (
      <div className={SECTION_CARD_CLASS}>
        <p className="text-xs text-gray-400">Laddar…</p>
      </div>
    );
  }
  return (
    <ThresholdsForm initial={toThresholdDraft({
      unbilledThresholdOre: settings.data.unbilledThresholdOre ?? null,
      unbilledAgeDays: settings.data.unbilledAgeDays ?? null,
    })} />
  );
}

function ThresholdsForm({ initial }: { initial: ThresholdDraft }) {
  const t = useTRPC();
  const queryClient = useQueryClient();
  const amountId = useId();
  const ageId = useId();
  const [draft, setDraft] = useState<ThresholdDraft>(initial);
  const [saved, setSaved] = useState(false);
  const save = useMutation(t.organization.updateSettings.mutationOptions({
    onSuccess: () => {
      setSaved(true);
      // Trösklarna gäller direkt i Frister, startsidans ruta och ärendets Frister.
      void queryClient.invalidateQueries(t.organization.getSettings.queryFilter());
      void queryClient.invalidateQueries(t.watchlist.list.queryFilter());
    },
  }));

  function change(patch: Partial<ThresholdDraft>): void {
    setSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  }

  return (
    <div className={SECTION_CARD_CLASS}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={amountId} className="block text-xs font-medium text-gray-700 mb-1">Ofakturerat belopp (kr)</label>
          <DecimalInput id={amountId} value={draft.amountKr} onChange={(amountKr) => change({ amountKr })}
            placeholder={`standard: ${formatRateKr(DEFAULT_UNBILLED_THRESHOLD_ORE)}`} className={INPUT_CLASS} />
        </div>
        <div>
          <label htmlFor={ageId} className="block text-xs font-medium text-gray-700 mb-1">Äldsta ofakturerade (dagar)</label>
          <DecimalInput id={ageId} value={draft.ageDays} onChange={(ageDays) => change({ ageDays })}
            placeholder={`standard: ${DEFAULT_UNBILLED_AGE_DAYS} dagar`} className={INPUT_CLASS} />
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Bör faktureras visas när beloppet eller åldern nås. Tomt fält = standard. Vill byrån bara gå
        på ålder (eller bara på belopp): sätt den andra gränsen så högt att den aldrig nås.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" onClick={() => save.mutate(toThresholdPatch(draft))} disabled={save.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          Spara
        </button>
        {save.isPending && <span className="text-xs text-gray-500">Sparar…</span>}
        {saved && <span className="text-xs text-green-600">Sparat ✓</span>}
        {save.error && <span className="text-xs text-red-600">{save.error.message}</span>}
      </div>
    </div>
  );
}
