"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { TIME_ENTRY_KIND_SHORT } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import { isPerDayKind } from "@/lib/shared/brottmalstaxa";
import { TIME_ENTRY_KIND_LABELS, type MatterStatus, type PaymentMethod, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { InvoiceId, MatterId, TimeEntryId } from "@/lib/shared/schemas/ids";
import { applicableStandardAtgarder, type StandardAtgard } from "@/lib/shared/standard-atgard";

/** Det formuläret behöver ur en tidpost (ärende-raden och /time-raden har båda detta). */
export interface TimeEntryLike {
  date: Date | string;
  minutes: number;
  description: string | null;
  billable: boolean;
  kind?: TimeEntryKind | null;
  standardAtgardId?: string | null;
}

/** Formulärets fält (strängar/tal som i inputs). */
export interface EditForm {
  date: string;
  minutes: number;
  description: string;
  billable: boolean;
  kind: TimeEntryKind;
  /** Byråns standardåtgärd posten kommer ur (#956). "" = fritext. */
  standardAtgardId: string;
}

/** Kategorierna i dropdown-ordning — härledd ur labels-kartan (single source). */
const KIND_OPTIONS = Object.entries(TIME_ENTRY_KIND_LABELS) as Array<[TimeEntryKind, string]>;

/**
 * Föreskriftens tillämpningsregler, visade VID kategorivalet (#969).
 *
 * DVFS 2025:4 avgränsar när tidsspillan över huvud taget ersätts. De
 * avgränsningarna är bedömningar bara juristen kan göra — AVA vet varken
 * klockslag, om du övernattat eller om du ätit — så reglerna hör hemma där valet
 * görs, inte som en kontroll efteråt.
 *
 * Alternativet, start- och sluttid på VARJE tidspost, hade kostat vid varje
 * registrering i systemet för att fånga något ovanligt som domstolen dessutom
 * stryker om det blir fel.
 */
const KIND_GUIDANCE: Partial<Record<TimeEntryKind, string>> = {
  TIDSSPILLAN: "Dagtaxan gäller vardag 08.00–18.00. Ersättning lämnas bara för tid mellan 07.00 och 22.00, och normal måltidspaus är inte tidsspillan (DVFS 2025:4 §§ 2–4).",
  TIDSSPILLAN_OVRIG_TID: "All tidsspillan utanför vardag 08.00–18.00 — men bara inom 07.00–22.00; tid mellan 22.00 och 07.00 ersätts inte alls. Vid övernattning på annan ort än tjänstestället ersätts 18.00–22.00 endast om den avser restid (DVFS 2025:4 §§ 2, 4).",
  ARBETE_OBEKVAM_TID: "Häktningsförhandling under helg (DVFS 2025:7) eller polisförhör utanför ordinarie kontorstid (DVFS 2025:8). Tidsspillan i samband med sådana ersätts med DAGTAXAN, även 22.00–07.00.",
  ADVOKATBEREDSKAP: "Garantiersättning PER DAG för beredskap vid tingsrätten under helg (DVFS 2025:9 § 1) — ingen tid registreras. Blir du inkallad registrerar du arbetet som obekväm tid i stället: garantin utgår inte för dag då sådant arvode utgår (§ 2).",
};

/**
 * Byt kategori på formuläret. Per-dygns-kategorier nollar minuterna (#950):
 * beredskap är inte arbetad tid, och en kvarglömd halvtimme från förra posten
 * hade följt med in i varje timbaserad summa.
 */
function withKind<T extends { kind: TimeEntryKind; minutes: number }>(form: T, kind: TimeEntryKind): T {
  return { ...form, kind, minutes: isPerDayKind(kind) ? 0 : form.minutes };
}

/** Byråns standardåtgärder (#956) som gäller ärendet — org-inställning, samma
 *  lista för alla på byrån. Tom lista döljer väljaren helt. */
export function useStandardAtgarder(paymentMethod: PaymentMethod | undefined): StandardAtgard[] {
  const settings = trpc.organization.getSettings.useQuery();
  return applicableStandardAtgarder(settings.data?.standardAtgarder, paymentMethod);
}

export function toEditForm(entry: TimeEntryLike): EditForm {
  return {
    date: new Date(entry.date).toISOString().split("T")[0]!,
    minutes: entry.minutes,
    description: entry.description ?? "",
    billable: entry.billable,
    kind: entry.kind ?? "ARBETE",
    standardAtgardId: entry.standardAtgardId ?? "",
  };
}

export function emptyForm(): EditForm {
  return { date: new Date().toISOString().split("T")[0]!, minutes: 30, description: "", billable: true, kind: "ARBETE", standardAtgardId: "" };
}

/**
 * Fyll formuläret ur en av byråns standardåtgärder (#956): beskrivning, tid och
 * kategori sätts till byråns huvudregel — allt förblir redigerbart, för avsteg
 * måste vara lätt att göra. Tomt val nollar kopplingen men behåller texten, så
 * man kan utgå från en standard och skriva om den.
 */
export function applyStandardAtgard(form: EditForm, atgard: StandardAtgard | undefined): EditForm {
  if (!atgard) return { ...form, standardAtgardId: "" };
  return {
    ...form,
    standardAtgardId: atgard.id,
    description: atgard.description,
    minutes: atgard.minutes,
    kind: atgard.kind,
    billable: atgard.billable,
  };
}

interface FormProps {
  form: EditForm;
  setForm: (f: EditForm) => void;
  submitLabel: string;
  isPending: boolean;
  isTaxeArende?: boolean | undefined;
  isCoverage?: boolean | undefined;
  atgarder: StandardAtgard[];
  onSubmit: () => void;
  onCancel: () => void;
}

/** Tidpost-formuläret — delat av ärendets tidsektion och /time. */
export function TimeForm({ form, setForm, submitLabel, isPending, isTaxeArende, isCoverage, atgarder, onSubmit, onCancel }: FormProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {isTaxeArende && (
        <div className="text-xs text-indigo-900 bg-indigo-50 border border-indigo-200 rounded px-3 py-2 mb-3">
          <strong>Taxeärende</strong> — arvodet ersätts enligt Domstolsverkets
          fastställda taxa (brottmålstaxan / motsv.), inte byråns timpris.
          Registrera ändå faktisk nedlagd tid — domstolen kan frångå taxan
          om &quot;avsevärt mer arbete än normalt&quot; krävts.
        </div>
      )}
      {atgarder.length > 0 && (
        <div className="mb-3">
          <label htmlFor="time-standard" className="block text-xs text-gray-500 mb-1">Standardåtgärd</label>
          <select id="time-standard" value={form.standardAtgardId}
            onChange={(e) => setForm(applyStandardAtgard(form, atgarder.find((a) => a.id === e.target.value)))}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            <option value="">— egen beskrivning —</option>
            {atgarder.map((a) => (
              <option key={a.id} value={a.id}>{a.description} ({formatMinutes(a.minutes)})</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Byråns standardåtgärder fyller beskrivning och tid. Tiden är en
            huvudregel — justera den om ärendet krävde mer eller mindre.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="time-date" className="block text-xs text-gray-500 mb-1">Datum *</label>
          <input id="time-date" type="date" required value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="time-minutes" className="block text-xs text-gray-500 mb-1">
            {isPerDayKind(form.kind) ? "Omfattning" : "Tid (minuter) *"}
          </label>
          {isPerDayKind(form.kind) ? (
            // Beredskap ersätts per dygn (#950) — det finns ingen tid att mata in,
            // och ett tomt minutfält hade sett ut som att något saknades.
            <p id="time-minutes" className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-600">
              1 dygns beredskap
            </p>
          ) : (
            <input id="time-minutes" type="text" inputMode="numeric" required value={form.minutes}
              onChange={(e) => setForm({ ...form, minutes: parseInt(e.target.value) || 0 })}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
          )}
        </div>
        <div className="col-span-2">
          <label htmlFor="time-description" className="block text-xs text-gray-500 mb-1">Beskrivning *</label>
          <input id="time-description" type="text" required value={form.description}
            placeholder="Beskrivning *"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
        <div className="col-span-2">
          <label htmlFor="time-kind" className="block text-xs text-gray-500 mb-1">Arvodeskategori *</label>
          <select id="time-kind" value={form.kind}
            onChange={(e) => setForm(withKind(form, e.target.value as TimeEntryKind))}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            {KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {isCoverage && (
            <>
              <p className="mt-1 text-xs text-gray-500">
                Kategorin avgör vilken av Domstolsverkets normer posten ersätts på.
                Hela ärendet räknas om på slutregleringsårets normer, så en taxehöjning
                slår igenom retroaktivt.
              </p>
              {KIND_GUIDANCE[form.kind] !== undefined && (
                <p className="mt-1 text-xs text-amber-700">{KIND_GUIDANCE[form.kind]}</p>
              )}
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.billable}
            onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
          Debiterbar
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
          Avbryt
        </button>
        <button type="submit" disabled={isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
