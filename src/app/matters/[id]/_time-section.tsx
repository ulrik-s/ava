"use client";

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";

interface Props {
  matterId: string;
  isTaxeArende?: boolean;
}

interface EditForm {
  date: string;
  minutes: number;
  description: string;
  billable: boolean;
}

interface TimeEntryRow {
  id: string;
  date: Date | string;
  minutes: number;
  description: string | null;
  billable: boolean;
  hourlyRate?: number | null;
  user?: { name?: string | null } | null;
  invoiceId?: string | null;
  invoice?: { id: string; invoiceNumber?: string | null } | null;
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
  };
}

function emptyForm(): EditForm {
  return { date: new Date().toISOString().split("T")[0]!, minutes: 30, description: "", billable: true };
}

// eslint-disable-next-line max-lines-per-function -- TODO: refactor (struktur är tabular: kolumndefs + 2 modaler)
export function TimeSection({ matterId, isTaxeArende }: Props) {
  const utils = trpc.useUtils();
  const timeEntries = trpc.timeEntry.list.useQuery({ matterId });
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  function confirmDelete(id: string): void {
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
  onSubmit: () => void;
  onCancel: () => void;
}

function TimeForm({ form, setForm, submitLabel, isPending, isTaxeArende, onSubmit, onCancel }: FormProps) {
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Datum *</label>
          <input type="date" required value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tid (minuter) *</label>
          <input type="number" required min={1} value={form.minutes}
            onChange={(e) => setForm({ ...form, minutes: parseInt(e.target.value) || 0 })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Beskrivning *</label>
          <input type="text" required value={form.description}
            placeholder="Beskrivning *"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm" />
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
