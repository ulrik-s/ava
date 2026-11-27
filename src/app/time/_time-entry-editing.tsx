"use client";

import { useState } from "react";
import { useActiveMatterOptions } from "@/components/matter/use-active-matter-options";
import {
  TimeForm as TimeEntryEditForm,
  toEditForm,
  useStandardAtgarder,
  type EditForm,
  type TimeEntryLike,
} from "@/components/time/time-entry-form";
import { useSaveTimeEntry } from "@/components/time/use-save-time-entry";
import type { Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { invalidateUnbilledWork } from "@/lib/client/billing/invalidate-billing-side-effects";
import { trpc } from "@/lib/client/trpc";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { isLockedEntry, LOCKED_ENTRY_HINT, type LockableEntry } from "@/lib/shared/time-entry-lock";

/** Det /time behöver för att ändra/ta bort en rad — oavsett vilket ärende den
 *  hör till — och låsfälten som avgör om den får ändras (`isLockedEntry`, #1863). */
export interface EditableTimeRow extends TimeEntryLike, LockableEntry {
  id: string;
  /** Ärendet posten ligger i — förval i fältet Ärende (#2042). */
  matterId: MatterId;
}

/** Posten som ändras: formuläret, ärendet den ligger i och ärendet som valts (#2042). */
interface Editing {
  id: string;
  form: EditForm;
  fromMatterId: MatterId;
  matterId: MatterId;
}

/** Ändra + ta bort på /time, med samma formulär som ärendets tidsektion. */
export function useTimeEntryEditing() {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<Editing | null>(null);
  // /time listar alla ärendens poster: en omläsning täcker båda ärendena vid en flytt.
  // Fakturaförslaget hämtas om för alla ärenden (#2201), som listan.
  const refresh = () => { void utils.timeEntry.list.invalidate(); invalidateUnbilledWork(utils); };
  const saver = useSaveTimeEntry({ refresh, done: () => setEditing(null) });
  const remove = trpc.timeEntry.delete.useMutation({ onSuccess: refresh });

  return {
    editing,
    setForm: (form: EditForm) => setEditing((e) => (e ? { ...e, form } : e)),
    setMatter: (matterId: MatterId) => setEditing((e) => (e ? { ...e, matterId } : e)),
    startEdit: (row: EditableTimeRow) => setEditing({ id: row.id, form: toEditForm(row), fromMatterId: row.matterId, matterId: row.matterId }),
    close: () => setEditing(null),
    save: () => {
      if (!editing) return;
      saver.save({ id: asId<"TimeEntryId">(editing.id), fromMatterId: editing.fromMatterId, toMatterId: editing.matterId }, editing.form);
    },
    confirmDelete: (row: EditableTimeRow) => {
      if (confirm("Ta bort tidregistreringen?")) remove.mutate({ id: asId<"TimeEntryId">(row.id) });
    },
    isSaving: saver.isPending,
    error: saver.error?.message ?? remove.error?.message,
  };
}

type TimeEntryEditing = ReturnType<typeof useTimeEntryEditing>;

/** Åtgärdskolumnen: Ändra/Ta bort, eller "Låst" för låsta poster (fakturerade eller frysta). */
export function timeActionsColumn<T extends EditableTimeRow>(ed: TimeEntryEditing): Column<T> {
  return {
    key: "actions", label: "", sortable: false, align: "right", hideable: false,
    render: (row) => (isLockedEntry(row) ? (
      <span className="text-xs text-gray-400" title={LOCKED_ENTRY_HINT}>Låst</span>
    ) : (
      <span className="whitespace-nowrap">
        <button type="button" onClick={() => ed.startEdit(row)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3">Ändra</button>
        <button type="button" onClick={() => ed.confirmDelete(row)} className="text-xs text-red-500 hover:underline">Ta bort</button>
      </span>
    )),
  };
}

/** Ändra-modalen + felraden (t.ex. "posten är låst"). Utan ärendekontext: inga
 *  taxe-/rättshjälpshintar, byråns alla standardåtgärder. */
export function TimeEntryEditModal({ ed }: { ed: TimeEntryEditing }) {
  const atgarder = useStandardAtgarder(undefined);
  const matters = useActiveMatterOptions();
  return (
    <>
    {ed.error && <p role="alert" className="mt-2 text-sm text-red-600">{ed.error}</p>}
    <Modal open={ed.editing !== null} title="Ändra tidregistrering" onClose={ed.close}>
      {ed.editing && (
        <TimeEntryEditForm
          form={ed.editing.form}
          matter={{ matters, value: ed.editing.matterId, onChange: ed.setMatter }}
          setForm={ed.setForm}
          submitLabel={ed.isSaving ? "Sparar..." : "Spara"}
          isPending={ed.isSaving}
          atgarder={atgarder}
          onSubmit={ed.save}
          onCancel={ed.close}
        />
      )}
    </Modal>
    </>
  );
}
