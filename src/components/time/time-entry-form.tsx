"use client";

import { MatterCombobox, type MatterOption } from "@/components/matter/matter-combobox";
import { HoursInput, hasInvalidHours } from "@/components/ui/hours-input";
import { trpc } from "@/lib/client/trpc";
import { isPerDayKind } from "@/lib/shared/brottmalstaxa";
import { toIsoDate, toLocalTime } from "@/lib/shared/iso-date";
import { formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import { TIME_ENTRY_KIND_LABELS, type PaymentMethod, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { applicableStandardAtgarder, type StandardAtgard } from "@/lib/shared/standard-atgard";
import { stockholmDateTime } from "@/lib/shared/stockholm-time";

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
  /** Starttid "HH:MM" för ett förhör (#1855); "" för andra kategorier. */
  startTime: string;
}

/** Kategorier vars post har en starttid med klockslag (förhör, DVFS 2025:5 3 §). */
function hasStartTime(kind: TimeEntryKind): boolean {
  return kind === "FORHOR";
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
  TIDSSPILLAN: "Vardag 08.00–18.00. Ersättning lämnas bara för tid mellan 07.00 och 22.00, och normal måltidspaus är inte tidsspillan (DVFS 2025:4 §§ 2–4). Undantag: tidsspillan i samband med häktningsförhandling under helg (DVFS 2025:7 § 1) eller polisförhör utanför kontorstid (DVFS 2025:8 § 3) ersätts med den här taxan även på helg och mellan 22.00 och 07.00.",
  TIDSSPILLAN_OVRIG_TID: "All tidsspillan utanför vardag 08.00–18.00 — men bara inom 07.00–22.00; tid mellan 22.00 och 07.00 ersätts inte alls. Vid övernattning på annan ort än tjänstestället ersätts 18.00–22.00 endast om den avser restid (DVFS 2025:4 §§ 2, 4). Tidsspillan i samband med häktningsförhandling under helg eller polisförhör utanför kontorstid registreras i stället som Tidsspillan — den ersätts med vardagstaxan (DVFS 2025:7 § 1, 2025:8 § 3).",
  ARBETE_OBEKVAM_TID: "Häktningsförhandling lördag, söndag, helgdag eller midsommar-, jul- eller nyårsafton (DVFS 2025:7 § 1), eller polisförhör vardagar 00.00–07.00 och 18.00–24.00 samt helg (DVFS 2025:8 § 1). Tidsspillan i samband med sådana registreras som Tidsspillan (vardagstaxan), även 22.00–07.00.",
  FORHOR: "Starttid och förhörets längd. Ett uppehåll på 15 minuter eller mer: registrera förhöret som två poster, före och efter uppehållet.",
  ADVOKATBEREDSKAP: "Garantiersättning PER DAG för beredskap vid tingsrätten under helg (DVFS 2025:9 § 1) — ingen tid registreras. Blir du inkallad registrerar du arbetet som Timarvode helg/kväll i stället: garantin utgår inte för dag då sådant arvode utgår (§ 2).",
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
    date: toIsoDate(entry.date),
    minutes: entry.minutes,
    description: entry.description ?? "",
    billable: entry.billable,
    kind: entry.kind ?? "ARBETE",
    standardAtgardId: entry.standardAtgardId ?? "",
    // Ett förhörs klockslag läses tillbaka, så att en ändring inte nollar starttiden (#1855).
    startTime: hasStartTime(entry.kind ?? "ARBETE") ? toLocalTime(entry.date) : "",
  };
}

export function emptyForm(): EditForm {
  return { date: toIsoDate(new Date()), minutes: 30, description: "", billable: true, kind: "ARBETE", standardAtgardId: "", startTime: "" };
}

/** Det mutationerna tar emot: ett förhör får starttiden i datumet (svensk tid), övriga bara dagen. */
export type TimeEntryInput = Omit<EditForm, "startTime">;

/** Formuläret som indata till `timeEntry.create`/`update` (#1855). */
export function timeEntryInput(form: EditForm): TimeEntryInput {
  const { startTime, ...rest } = form;
  if (!hasStartTime(form.kind) || startTime === "") return rest;
  return { ...rest, date: stockholmDateTime(form.date, startTime).toISOString() };
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

/** Fältet **Ärende** i Ändra tidregistrering (#2042): valt ärende och listan att välja ur. */
export interface MatterChoice {
  matters: MatterOption[];
  value: MatterId;
  onChange: (matterId: MatterId) => void;
}

interface FormProps {
  form: EditForm;
  /** Visar fältet **Ärende** överst (bara när en post ändras). */
  matter?: MatterChoice | undefined;
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
export function TimeForm({ form, matter, setForm, submitLabel, isPending, isTaxeArende, isCoverage, atgarder, onSubmit, onCancel }: FormProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!hasInvalidHours(e.currentTarget)) onSubmit(); }}>
      <MatterField matter={matter} />
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
              <option key={a.id} value={a.id}>{a.description} ({formatDecimalHoursWithUnit(a.minutes)})</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Byråns standardåtgärder fyller beskrivning och tid. Tiden är en
            huvudregel — justera den om ärendet krävde mer eller mindre.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <DateField form={form} setForm={setForm} />
        <div>
          <label htmlFor="time-minutes" className="block text-xs text-gray-500 mb-1">
            {isPerDayKind(form.kind) ? "Omfattning" : "Tid (h) *"}
          </label>
          {isPerDayKind(form.kind) ? (
            // Beredskap ersätts per dygn (#950) — det finns ingen tid att mata in,
            // och ett tomt minutfält hade sett ut som att något saknades.
            <p id="time-minutes" className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-600">
              1 dygns beredskap
            </p>
          ) : (
            <HoursInput id="time-minutes" minutes={form.minutes}
              onChange={(minutes) => setForm({ ...form, minutes })}
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
          <KindHelp kind={form.kind} isCoverage={isCoverage === true} />
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

/** Ärendet posten ligger i, för att flytta den (#2042). Bara när en post ändras. */
function MatterField({ matter }: { matter: MatterChoice | undefined }) {
  if (!matter) return null;
  return (
    <div className="mb-3">
      <MatterCombobox label="Ärende" matters={matter.matters} value={matter.value} onChange={matter.onChange} />
    </div>
  );
}

/** Datum, och för ett förhör även starttiden (DVFS 2025:5 3 §, #1855). */
function DateField({ form, setForm }: { form: EditForm; setForm: (f: EditForm) => void }) {
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <label htmlFor="time-date" className="block text-xs text-gray-500 mb-1">Datum *</label>
        <input id="time-date" type="date" required value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      {hasStartTime(form.kind) && (
        <div>
          <label htmlFor="time-start" className="block text-xs text-gray-500 mb-1">Starttid *</label>
          <input id="time-start" type="time" required value={form.startTime}
            onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
      )}
    </div>
  );
}

/**
 * Hjälpen under kategorivalet. Normtexten och föreskriftsreglerna gäller
 * rättshjälp och rättsskydd; förhörets hjälp gäller hur posten registreras och
 * visas i alla ärenden (#1855).
 */
function KindHelp({ kind, isCoverage }: { kind: TimeEntryKind; isCoverage: boolean }) {
  const guidance = isCoverage || hasStartTime(kind) ? KIND_GUIDANCE[kind] : undefined;
  return (
    <>
      {isCoverage && (
        <p className="mt-1 text-xs text-gray-500">
          Kategorin avgör vilken av Domstolsverkets normer posten ersätts på.
          Hela ärendet räknas om på slutregleringsårets normer, så en taxehöjning
          slår igenom retroaktivt.
        </p>
      )}
      {guidance !== undefined && <p className="mt-1 text-xs text-amber-700">{guidance}</p>}
    </>
  );
}
