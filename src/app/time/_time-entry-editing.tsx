"use client";

import { useState } from "react";
import {
  TimeForm as TimeEntryEditForm,
  toEditForm,
  useStandardAtgarder,
  type EditForm,
  type TimeEntryLike,
} from "@/components/time/time-entry-form";
import type { Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { trpc } from "@/lib/client/trpc";
import { asId } from "@/lib/shared/schemas/ids";

/** Det /time behöver för att ändra/ta bort en rad — oavsett vilket ärende den hör till. */
export interface EditableTimeRow extends TimeEntryLike {
  id: string;
  /** Satt när posten ingick i en slutfaktura/kostnadsräkning → låst. */
  frozenAt?: Date | string | null;
}

/** Ändra + ta bort på /time, med samma formulär som ärendets tidsektion. */
export function useTimeEntryEditing() {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<{ id: string; form: EditForm } | null>(null);
  const invalidate = () => utils.timeEntry.list.invalidate();
  const update = trpc.timeEntry.update.useMutation({
    onSuccess: () => { void invalidate(); setEditing(null); },
  });
  const remove = trpc.timeEntry.delete.useMutation({ onSuccess: () => invalidate() });

  return {
    editing,
    setForm: (form: EditForm) => setEditing((e) => (e ? { ...e, form } : e)),
    startEdit: (row: EditableTimeRow) => setEditing({ id: row.id, form: toEditForm(row) }),
    close: () => setEditing(null),
    save: () => { if (editing) update.mutate({ id: asId<"TimeEntryId">(editing.id), ...editing.form }); },
    confirmDelete: (row: EditableTimeRow) => {
      if (confirm("Ta bort tidregistreringen?")) remove.mutate({ id: asId<"TimeEntryId">(row.id) });
    },
    isSaving: update.isPending,
    error: update.error?.message ?? remove.error?.message,
  };
}

type Editing = ReturnType<typeof useTimeEntryEditing>;

/** Åtgärdskolumnen: Ändra/Ta bort, eller "Låst" för frysta poster. */
export function timeActionsColumn<T extends EditableTimeRow>(ed: Editing): Column<T> {
  return {
    key: "actions", label: "", sortable: false, align: "right", hideable: false,
    render: (row) => (row.frozenAt ? (
      <span className="text-xs text-gray-400" title="Ingår i en slutfaktura eller kostnadsräkning">Låst</span>
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
export function TimeEntryEditModal({ ed }: { ed: Editing }) {
  const atgarder = useStandardAtgarder(undefined);
  return (
    <>
    {ed.error && <p role="alert" className="mt-2 text-sm text-red-600">{ed.error}</p>}
    <Modal open={ed.editing !== null} title="Ändra tidregistrering" onClose={ed.close}>
      {ed.editing && (
        <TimeEntryEditForm
          form={ed.editing.form}
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
