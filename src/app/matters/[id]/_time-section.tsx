"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { TIME_ENTRY_KIND_SHORT } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import { TIME_ENTRY_KIND_LABELS, type PaymentMethod, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { InvoiceId, MatterId, TimeEntryId } from "@/lib/shared/schemas/ids";
import { applicableStandardAtgarder, type StandardAtgard } from "@/lib/shared/standard-atgard";

interface Props {
  matterId: MatterId;
  isTaxeArende?: boolean;
  /** Styr kategori-hjälptexten: rättshjälp/rättsskydd ersätts på Domstolsverkets
   *  normer per kategori, inte på byråns timpris (#953). */
  paymentMethod?: PaymentMethod | undefined;
}

interface EditForm {
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

/** Ärenden där kategorin styr vilken ÅRSNORM slutregleringen värderar posten på. */
const COVERAGE_METHODS = new Set<PaymentMethod>(["RATTSHJALP", "RATTSSKYDD"]);

function isCoverageMethod(method: PaymentMethod | undefined): boolean {
  return method !== undefined && COVERAGE_METHODS.has(method);
}

/** Byråns standardåtgärder (#956) som gäller ärendet — org-inställning, samma
 *  lista för alla på byrån. Tom lista döljer väljaren helt. */
function useStandardAtgarder(paymentMethod: PaymentMethod | undefined): StandardAtgard[] {
  const settings = trpc.organization.getSettings.useQuery();
  return applicableStandardAtgarder(settings.data?.standardAtgarder, paymentMethod);
}

interface TimeEntryRow {
  id: TimeEntryId;
  date: Date | string;
  minutes: number;
  description: string | null;
  billable: boolean;
  kind?: TimeEntryKind | null;
  standardAtgardId?: string | null;
  hourlyRate?: number | null;
  user?: { name?: string | null } | null;
  invoiceId?: InvoiceId | null;
  invoice?: { id: InvoiceId; invoiceNumber?: string | null } | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

function toEditForm(entry: TimeEntryRow): EditForm {
  return {
    date: new Date(entry.date).toISOString().split("T")[0]!,
    minutes: entry.minutes,
    description: entry.description ?? "",
    billable: entry.billable,
    kind: entry.kind ?? "ARBETE",
    standardAtgardId: entry.standardAtgardId ?? "",
  };
}

function emptyForm(): EditForm {
  return { date: new Date().toISOString().split("T")[0]!, minutes: 30, description: "", billable: true, kind: "ARBETE", standardAtgardId: "" };
}

/**
 * Fyll formuläret ur en av byråns standardåtgärder (#956): beskrivning, tid och
 * kategori sätts till byråns huvudregel — allt förblir redigerbart, för avsteg
 * måste vara lätt att göra. Tomt val nollar kopplingen men behåller texten, så
 * man kan utgå från en standard och skriva om den.
 */
function applyStandardAtgard(form: EditForm, atgard: StandardAtgard | undefined): EditForm {
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

// eslint-disable-next-line max-lines-per-function -- TODO: refactor (struktur är tabular: kolumndefs + 2 modaler)
export function TimeSection({ matterId, isTaxeArende, paymentMethod }: Props) {
  const isCoverage = isCoverageMethod(paymentMethod);
  const atgarder = useStandardAtgarder(paymentMethod);
  const utils = trpc.useUtils();
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<TimeEntryId | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [createForm, setCreateForm] = useState<EditForm>(emptyForm);

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      void utils.timeEntry.list.invalidate({ matterId });
      setShowCreate(false);
      setCreateForm(emptyForm());
    },
  });

  const updateTimeEntry = trpc.timeEntry.update.useMutation({
    onSuccess: () => {
      void utils.timeEntry.list.invalidate({ matterId });
      setEditingId(null);
      setEditForm(null);
    },
  });

  const deleteTimeEntry = trpc.timeEntry.delete.useMutation({
    onSuccess: () => utils.timeEntry.list.invalidate({ matterId }),
  });

  function startEdit(entry: TimeEntryRow): void {
    setEditingId(entry.id);
    setEditForm(toEditForm(entry));
  }

  function saveEdit(): void {
    if (!editingId || !editForm) return;
    updateTimeEntry.mutate({ id: editingId, ...editForm });
  }

  function confirmDelete(id: TimeEntryId): void {
    if (confirm("Ta bort tidregistreringen?")) deleteTimeEntry.mutate({ id });
  }

  const columns: Column<TimeEntryRow>[] = [
    { key: "date", label: "Datum", sortable: true, sortValue: (e) => new Date(e.date),
      render: (e) => <span className="text-sm text-gray-500">{new Date(e.date).toLocaleDateString("sv-SE")}</span> },
    { key: "user", label: "Advokat", sortable: true, sortValue: (e) => e.user?.name ?? "",
      render: (e) => <span className="text-sm text-gray-900">{e.user?.name ?? "—"}</span> },
    { key: "minutes", label: "Tid", sortable: true, align: "right", sortValue: (e) => e.minutes,
      summary: (rows) => <span className="font-mono">{formatMinutes(rows.reduce((sum, r) => sum + r.minutes, 0))}</span>,
      render: (e) => <span className="text-sm text-gray-900">{formatMinutes(e.minutes)}</span> },
    { key: "description", label: "Beskrivning", sortable: true, sortValue: (e) => e.description ?? "",
      render: (e) => <span className="text-sm text-gray-700">{e.description}</span> },
    // Kategorin styr vilken av Domstolsverkets normer posten värderas på vid
    // slutreglering (#950/#953) — den påverkar beloppet och hör därför i default-vyn.
    { key: "kind", label: "Kategori", sortable: true, sortValue: (e) => e.kind ?? "ARBETE",
      render: (e) => <span className="text-sm text-gray-700">{TIME_ENTRY_KIND_SHORT[e.kind ?? "ARBETE"]}</span> },
    { key: "billable", label: "Deb.", sortable: true, sortValue: (e) => (e.billable ? 1 : 0),
      render: (e) => <span className="text-sm">{e.billable ? "Ja" : "Nej"}</span> },
    // Notera: kolumnerna "Fakturerad" + "Faktura" finns INTE här. Rättshjälp/
    // rättsskydd-flödet bryter 1:1-kopplingen mellan tidsrad och faktura —
    // samma rad kan ingå i acconto till klient + slutfaktura till myndighet.
    // Vid framtida rättshjälp-stöd hanteras kopplingen via separat invoice-
    // line-modell, inte invoiceId på timeEntry.
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (e) => (
        <span className="whitespace-nowrap">
          <button onClick={() => startEdit(e)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">Ändra</button>
          <button onClick={() => confirmDelete(e.id)} className="text-xs text-red-500 hover:underline">Ta bort</button>
        </span>
      ),
    },
    // Katalog-fält — finns på posten men visas inte i default-vyn. Användaren
    // aktiverar via "+ Visa kolumn → Tillgängliga fält".
    { key: "hourlyRate", label: "Timpris", sortable: true, defaultHidden: true, align: "right",
      sortValue: (e) => e.hourlyRate ?? 0,
      render: (e) => <span className="text-sm font-mono text-gray-500">{e.hourlyRate ? `${e.hourlyRate / 100} kr/h` : "—"}</span> },
    { key: "createdAt", label: "Skapad", sortable: true, defaultHidden: true,
      sortValue: (e) => e.createdAt ? new Date(e.createdAt) : null,
      render: (e) => <span className="text-sm text-gray-500">{fmtDateTime(e.createdAt)}</span> },
    { key: "updatedAt", label: "Uppdaterad", sortable: true, defaultHidden: true,
      sortValue: (e) => e.updatedAt ? new Date(e.updatedAt) : null,
      render: (e) => <span className="text-sm text-gray-500">{fmtDateTime(e.updatedAt)}</span> },
    { key: "id", label: "ID", sortable: true, defaultHidden: true,
      sortValue: (e) => e.id,
      render: (e) => <span className="text-xs font-mono text-gray-400">{e.id.slice(0, 8)}</span> },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 lg:col-span-2">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">
          Tidregistrering
          {timeEntries.data && (
            <span className="ml-2 text-sm font-normal text-gray-500">(totalt {formatMinutes(timeEntries.data.totalMinutes)})</span>
          )}
        </h2>
        <button onClick={() => setShowCreate(true)} className="text-sm text-blue-600 hover:underline">
          + Registrera tid
        </button>
      </div>

      <div className="p-4">
        <DataTable
          prefKey={`list.matter-time.${matterId}`}
          columns={columns}
          data={(timeEntries.data?.entries ?? []) as TimeEntryRow[]}
          rowKey={(e) => e.id}
          emptyMessage="Inga tidsposter."
        />
      </div>

      <Modal open={showCreate} title="Registrera tid" onClose={() => setShowCreate(false)}>
        <TimeForm
          form={createForm}
          setForm={setCreateForm}
          submitLabel={createTimeEntry.isPending ? "Sparar..." : "Spara"}
          isPending={createTimeEntry.isPending}
          isTaxeArende={isTaxeArende}
          isCoverage={isCoverage}
          atgarder={atgarder}
          onSubmit={() => createTimeEntry.mutate({ ...createForm, matterId })}
          onCancel={() => setShowCreate(false)}
        />
      </Modal>

      <Modal open={editingId !== null && editForm !== null} title="Ändra tidregistrering" onClose={() => { setEditingId(null); setEditForm(null); }}>
        {editForm && (
          <TimeForm
            form={editForm}
            setForm={(f) => setEditForm(f)}
            submitLabel={updateTimeEntry.isPending ? "Sparar..." : "Spara"}
            isPending={updateTimeEntry.isPending}
            isTaxeArende={isTaxeArende}
            isCoverage={isCoverage}
            atgarder={atgarder}
            onSubmit={saveEdit}
            onCancel={() => { setEditingId(null); setEditForm(null); }}
          />
        )}
      </Modal>
    </div>
  );
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

function TimeForm({ form, setForm, submitLabel, isPending, isTaxeArende, isCoverage, atgarder, onSubmit, onCancel }: FormProps) {
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
          <label htmlFor="time-minutes" className="block text-xs text-gray-500 mb-1">Tid (minuter) *</label>
          <input id="time-minutes" type="text" inputMode="numeric" required value={form.minutes}
            onChange={(e) => setForm({ ...form, minutes: parseInt(e.target.value) || 0 })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
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
            onChange={(e) => setForm({ ...form, kind: e.target.value as TimeEntryKind })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm">
            {KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {isCoverage && (
            <p className="mt-1 text-xs text-gray-500">
              Kategorin avgör vilken av Domstolsverkets normer posten ersätts på.
              Hela ärendet räknas om på slutregleringsårets normer, så en taxehöjning
              slår igenom retroaktivt.
            </p>
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
