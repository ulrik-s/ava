"use client";

import { useId, useState } from "react";
import { MatterCombobox, type MatterOption } from "@/components/matter/matter-combobox";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { periodFrom, periodTo } from "@/lib/client/time-filter";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";

interface TimeRow {
  id: string;
  date: string | Date;
  minutes: number;
  description: string;
  billable: boolean;
  matter: { id: string; matterNumber: string; title: string };
  user?: { name?: string | null } | null;
}

const timeColumns: Column<TimeRow>[] = [
  { key: "date", label: "Datum", sortable: true, sortValue: (e) => new Date(e.date),
    render: (e) => <span className="text-sm text-gray-500">{new Date(e.date).toLocaleDateString("sv-SE")}</span> },
  { key: "matter", label: "Ärende", sortable: true, sortValue: (e) => e.matter.matterNumber,
    render: (e) => (
      <EntityLink route="matters" id={e.matter.id} className="text-sm text-blue-600 hover:underline">
        {e.matter.matterNumber} — {e.matter.title}
      </EntityLink>
    ),
  },
  { key: "user", label: "Advokat", sortable: true, sortValue: (e) => e.user?.name ?? "",
    render: (e) => <span className="text-sm text-gray-900">{e.user?.name ?? "—"}</span> },
  { key: "minutes", label: "Tid", sortable: true, align: "right", sortValue: (e) => e.minutes,
    summary: (rows) => <span className="font-mono">{formatMinutes(rows.reduce((s, r) => s + r.minutes, 0))}</span>,
    render: (e) => <span className="text-sm font-mono text-gray-900">{formatMinutes(e.minutes)}</span> },
  { key: "description", label: "Beskrivning", sortable: true, sortValue: (e) => e.description,
    render: (e) => <span className="text-sm text-gray-700">{e.description}</span> },
  { key: "billable", label: "Deb.", sortable: true, sortValue: (e) => (e.billable ? 1 : 0),
    render: (e) => <span className="text-sm">{e.billable ? "Ja" : "Nej"}</span> },
];

interface PeriodFilterProps {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClear: () => void;
}

function PeriodFilter({ from, to, onFrom, onTo, onClear }: PeriodFilterProps) {
  const fromId = useId();
  const toId = useId();
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor={fromId} className="block text-sm text-gray-500 mb-1">Från</label>
        <input id={fromId} type="date" value={from} max={to || undefined}
          onChange={(e) => onFrom(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label htmlFor={toId} className="block text-sm text-gray-500 mb-1">Till</label>
        <input id={toId} type="date" value={to} min={from || undefined}
          onChange={(e) => onTo(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      {(from || to) && (
        <button onClick={onClear}
          className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          Rensa
        </button>
      )}
    </div>
  );
}

interface TimeForm {
  matterId: string;
  date: string;
  minutes: number;
  description: string;
  billable: boolean;
}

interface TimeEntryFormProps {
  form: TimeForm;
  setForm: (f: TimeForm) => void;
  mattersData: { matters: MatterOption[] } | undefined;
  isPending: boolean;
  onSubmit: () => void;
}

/** Registrerings-formuläret (utbrutet ur TimePage, #6-ratchet). Äger sina
 *  fält-id:n; tar emot form-state + submit som props (presentational). */
function TimeEntryForm({ form, setForm, mattersData, isPending, onSubmit }: TimeEntryFormProps) {
  const dateFieldId = useId();
  const minutesFieldId = useId();
  const descriptionFieldId = useId();
  const matters = mattersData ? mattersData.matters : [];
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <MatterCombobox
            label="Ärende *"
            required
            matters={matters}
            value={form.matterId}
            onChange={(id) => setForm({ ...form, matterId: id })}
          />
          {mattersData && matters.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">Inga aktiva ärenden — skapa ett under Ärenden.</p>
          )}
        </div>
        <div>
          <label htmlFor={dateFieldId} className="block text-sm text-gray-500 mb-1">Datum *</label>
          <input id={dateFieldId} type="date" required value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor={minutesFieldId} className="block text-sm text-gray-500 mb-1">Tid (minuter) *</label>
          <input id={minutesFieldId} type="number" required min={1} value={form.minutes}
            onChange={(e) => setForm({ ...form, minutes: parseInt(e.target.value) || 0 })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor={descriptionFieldId} className="block text-sm text-gray-500 mb-1">Beskrivning *</label>
          <input id={descriptionFieldId} type="text" required value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.billable}
            onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
          Debiterbar
        </label>
        <button type="submit" disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {isPending ? "Sparar..." : "Spara"}
        </button>
      </div>
    </form>
  );
}

export default function TimePage() {
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const timeEntries = trpc.timeEntry.list.useQuery({
    page,
    pageSize: 50,
    from: periodFrom(fromDate),
    to: periodTo(toDate),
  });
  // Hämta alla ACTIVE matters (cap 500 räcker för en advokatbyrå). Tidigare
  // skickades 200 men routern cappade på 100 → Zod-fail → tom dropdown.
  const matters = trpc.matter.list.useQuery({ pageSize: 500, status: "ACTIVE" });
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TimeForm>({
    matterId: "",
    date: new Date().toISOString().split("T")[0]!,
    minutes: 30,
    description: "",
    billable: true,
  });

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      void utils.timeEntry.list.invalidate();
      setShowForm(false);
      setForm({ matterId: "", date: new Date().toISOString().split("T")[0]!, minutes: 30, description: "", billable: true });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tidregistrering</h1>
          {timeEntries.data && (
            <p className="text-sm text-gray-500 mt-1">Totalt: {formatMinutes(timeEntries.data.totalMinutes)}</p>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          {showForm ? "Avbryt" : "+ Registrera tid"}
        </button>
      </div>

      {showForm && (
        <TimeEntryForm
          form={form}
          setForm={setForm}
          mattersData={matters.data}
          isPending={createTimeEntry.isPending}
          onSubmit={() => createTimeEntry.mutate(form)}
        />
      )}

      <PeriodFilter
        from={fromDate}
        to={toDate}
        onFrom={(v) => { setFromDate(v); setPage(1); }}
        onTo={(v) => { setToDate(v); setPage(1); }}
        onClear={() => { setFromDate(""); setToDate(""); setPage(1); }}
      />

      <DataTable
        prefKey="list.time-entries"
        columns={timeColumns}
        data={(timeEntries.data?.entries ?? []) as TimeRow[]}
        rowKey={(e) => e.id}
        emptyMessage="Inga tidsposter."
      />
      {timeEntries.data && timeEntries.data.pages > 1 && (
        <div className="px-6 py-3 mt-2 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-gray-500">Sida {page} av {timeEntries.data.pages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
            <button disabled={page >= timeEntries.data.pages} onClick={() => setPage(page + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
          </div>
        </div>
      )}
    </div>
  );
}
