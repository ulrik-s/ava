"use client";

import { useId, useState } from "react";
import { ListPage } from "@/components/layout/list-page";
import { MatterCombobox, type MatterOption } from "@/components/matter/matter-combobox";
import { MoveTimeEntriesButton, useTimeEntrySelection } from "@/components/time/move-time-entries";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DayStepper } from "@/components/ui/day-stepper";
import { HoursInput, hasInvalidHours } from "@/components/ui/hours-input";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { hasPeriod } from "@/lib/client/time-filter";
import { trpc } from "@/lib/client/trpc";
import { useTimeViewer } from "@/lib/client/use-time-viewer";
import { dayLabel } from "@/lib/shared/iso-date";
import { formatDecimalHours, formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { stockholmDay } from "@/lib/shared/stockholm-time";
import type { LockableEntry } from "@/lib/shared/time-entry-lock";
import { TimeEntryEditModal, timeActionsColumn, useTimeEntryEditing } from "./_time-entry-editing";
import { useTimeList, type TimeList } from "./_use-time-list";

/** En rad på /time, med låsfälten som avgör om den får ändras (#1863). */
interface TimeRow extends LockableEntry {
  id: string;
  matterId: MatterId;
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
  { key: "minutes", label: "Tid (h)", sortable: true, align: "right", sortValue: (e) => e.minutes,
    summary: (rows) => <span className="font-mono">{formatDecimalHours(rows.reduce((s, r) => s + r.minutes, 0))}</span>,
    render: (e) => <span className="text-sm font-mono text-gray-900">{formatDecimalHours(e.minutes)}</span> },
  { key: "description", label: "Beskrivning", sortable: true, sortValue: (e) => e.description, wrap: true,
    render: (e) => <span className="text-sm text-gray-700">{e.description}</span> },
  { key: "billable", label: "Deb.", sortable: true, sortValue: (e) => (e.billable ? 1 : 0),
    render: (e) => <span className="text-sm">{e.billable ? "Ja" : "Nej"}</span> },
];

/** Filtrets fält: dagen (#2096) och perioden, ur {@link useTimeList}. */
type PeriodFilterProps = Pick<TimeList, "day" | "from" | "to" | "onDay" | "onFrom" | "onTo" | "onClear">;

/** Dagens namn mellan pilarna, i en ruta med fast bredd så att **›** står still. */
function DayPicker({ day, onDay }: Pick<PeriodFilterProps, "day" | "onDay">) {
  return (
    <DayStepper ymd={day} onChange={onDay}>
      <span className="w-56 py-2 text-center text-sm font-medium text-gray-900">{dayLabel(day, new Date())}</span>
    </DayStepper>
  );
}

function PeriodFilter({ day, from, to, onDay, onFrom, onTo, onClear }: PeriodFilterProps) {
  const fromId = useId();
  const toId = useId();
  const period = hasPeriod(from, to);
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap items-end gap-4">
      {!period && <DayPicker day={day} onDay={onDay} />}
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
      {period && (
        <button onClick={onClear}
          className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          Rensa
        </button>
      )}
    </div>
  );
}

interface TimeForm {
  matterId: MatterId;
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
    <form onSubmit={(e) => { e.preventDefault(); if (!hasInvalidHours(e.currentTarget)) onSubmit(); }}
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
          {/* Pilarna stegar formulärets datum, inte listans dag (#2097). */}
          <DayStepper ymd={form.date} onChange={(date) => setForm({ ...form, date })}>
            <input id={dateFieldId} type="date" required value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </DayStepper>
        </div>
        <div>
          <label htmlFor={minutesFieldId} className="block text-sm text-gray-500 mb-1">Tid (h) *</label>
          <HoursInput id={minutesFieldId} minutes={form.minutes}
            onChange={(minutes) => setForm({ ...form, minutes })}
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
  // Den som inte är Admin ser bara sina egna poster (#2114).
  const list = useTimeList(useTimeViewer());
  const { query: timeEntries, page, setPage } = list;
  // Hämta alla ACTIVE matters (cap 500 räcker för en advokatbyrå). Tidigare
  // skickades 200 men routern cappade på 100 → Zod-fail → tom dropdown.
  const matters = trpc.matter.list.useQuery({ pageSize: 500, status: "ACTIVE" });
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TimeForm>({
    matterId: asId<"MatterId">(""),
    date: stockholmDay(new Date()),
    minutes: 30,
    description: "",
    billable: true,
  });

  const editing = useTimeEntryEditing();
  const marking = useTimeEntrySelection<TimeRow>();
  const columns = [...timeColumns, timeActionsColumn<TimeRow>(editing)];

  const createTimeEntry = trpc.timeEntry.create.useMutation({
    onSuccess: () => {
      void utils.timeEntry.list.invalidate();
      setShowForm(false);
      setForm({ matterId: asId<"MatterId">(""), date: stockholmDay(new Date()), minutes: 30, description: "", billable: true });
    },
  });

  return (
    <ListPage
      header={(
        <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tidregistrering</h1>
          {timeEntries.data && (
            <p className="text-sm text-gray-500 mt-1">Totalt: {formatDecimalHoursWithUnit(timeEntries.data.totalMinutes)}</p>
          )}
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          {showForm ? "Avbryt" : "+ Registrera tid"}
        </button>
      </div>
        </>
      )}
    >

      {showForm && (
        <TimeEntryForm
          form={form}
          setForm={setForm}
          mattersData={matters.data}
          isPending={createTimeEntry.isPending}
          onSubmit={() => createTimeEntry.mutate(form)}
        />
      )}

      <PeriodFilter day={list.day} from={list.from} to={list.to}
        onDay={list.onDay} onFrom={list.onFrom} onTo={list.onTo} onClear={list.onClear} />

      {/* /time listar alla ärendens poster: en omläsning täcker båda ärendena. */}
      <MoveTimeEntriesButton selected={marking.selection.selected} onMoved={marking.clear}
        refresh={() => { void utils.timeEntry.list.invalidate(); }} />
      <DataTable
        prefKey="list.time-entries"
        columns={columns}
        data={timeEntries.data?.entries ?? []}
        rowKey={(e) => e.id}
        emptyMessage="Inga tidsposter."
        selection={marking.selection}
      />
      <TimeEntryEditModal ed={editing} />
      {timeEntries.data && timeEntries.data.pages > 1 && (
        <div className="px-6 py-3 mt-2 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-gray-500">Sida {page} av {timeEntries.data.pages}</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
            <button disabled={page >= timeEntries.data.pages} onClick={() => setPage(page + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
          </div>
        </div>
      )}
    </ListPage>
  );
}
