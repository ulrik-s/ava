"use client";

import { useState } from "react";
import { ClientPickerDialog } from "@/components/contacts/client-picker-dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { sectionHeaderClass } from "@/components/ui/section-tone";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { labelForMatterRole, matterRoleOptions } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { matterRoleSchema, type MatterRole } from "@/lib/shared/schemas/enums";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";

type Contact = {
  id: string;
  name: string;
  contactType?: string;
  personalNumber?: string | null;
  orgNumber?: string | null;
};

type MatterContact = {
  id: string;
  role: string;
  contact: Contact;
};

interface Props {
  matterId: MatterId;
  contacts: MatterContact[];
}

/**
 * Ärendets kontakter. "+ Lägg till" öppnar samma sökdialog som klientvalet i
 * nytt ärende (#1136) — sök som i jävskontrollen, välj roll, eller skapa en
 * ny kontakt därifrån. En dropdown fungerar inte med många kontakter.
 */
export function ContactsSection({ matterId, contacts }: Props) {
  const utils = trpc.useUtils();
  const [picking, setPicking] = useState(false);
  const [role, setRole] = useState<MatterRole>("MOTPART");

  const addContact = trpc.matter.addContact.useMutation({
    onSuccess: () => {
      void utils.matter.getById.invalidate({ id: matterId });
      setPicking(false);
    },
  });

  const removeContact = trpc.matter.removeContact.useMutation({
    onSuccess: () => utils.matter.getById.invalidate({ id: matterId }),
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className={sectionHeaderClass("blue")}>
        <h2 className="font-semibold text-gray-900">Kontakter ({contacts.length})</h2>
        <button onClick={() => setPicking(true)} className="text-sm text-blue-600 hover:underline">
          + Lägg till
        </button>
      </div>

      {picking && (
        <ClientPickerDialog noun="kontakt" onClose={() => setPicking(false)}
          onPick={(c) => addContact.mutate({ matterId, contactId: asId<"ContactId">(c.id), role })}>
          <RoleSelect role={role} onChange={setRole} />
        </ClientPickerDialog>
      )}

      <ContactsList matterId={matterId} contacts={contacts} onRemove={(id) => removeContact.mutate({ matterContactId: id })} />
    </div>
  );
}

/** Kontaktens roll i ärendet — väljs i dialogen innan man väljer/skapar kontakten. */
function RoleSelect({ role, onChange }: { role: MatterRole; onChange: (r: MatterRole) => void }) {
  return (
    <div className="mb-3">
      <label htmlFor="matter-contact-role" className="block text-xs font-medium text-gray-500 mb-1">Roll i ärendet</label>
      <select id="matter-contact-role" value={role} onChange={(e) => onChange(matterRoleSchema.parse(e.target.value))}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm">
        {matterRoleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
    </div>
  );
}

function ContactsList({
  matterId,
  contacts,
  onRemove,
}: {
  matterId: MatterId;
  contacts: MatterContact[];
  onRemove: (matterContactId: string) => void;
}) {
  const columns: Column<MatterContact>[] = [
    { key: "name", label: "Namn", sortable: true, sortValue: (mc) => mc.contact?.name ?? "",
      render: (mc) => (
        mc.contact ? (
          <EntityLink route="contacts" id={mc.contact.id} className="text-sm font-medium text-blue-600 hover:underline">
            {mc.contact.name}
          </EntityLink>
        ) : <span className="text-sm text-gray-400 italic">(kontakt saknas)</span>
      ),
    },
    { key: "role", label: "Roll", sortable: true, sortValue: (mc) => labelForMatterRole(mc.role),
      render: (mc) => <span className="text-sm text-gray-700">{labelForMatterRole(mc.role)}</span> },
    { key: "number", label: "Personnr/Orgnr", sortable: true,
      sortValue: (mc) => mc.contact?.personalNumber ?? mc.contact?.orgNumber ?? "",
      render: (mc) => <span className="text-sm text-gray-500">{mc.contact?.personalNumber || mc.contact?.orgNumber || "—"}</span> },
    { key: "actions", label: "", sortable: false, align: "right", hideable: false,
      render: (mc) => (
        <button type="button" onClick={() => onRemove(mc.id)} className="text-xs text-red-500 hover:underline">
          Ta bort
        </button>
      ),
    },
  ];
  return (
    <div className="p-4">
      <DataTable
        prefKey={`list.matter-contacts.${matterId}`}
        columns={columns}
        data={contacts}
        rowKey={(mc) => mc.id}
        emptyMessage="Inga kontakter kopplade"
      />
    </div>
  );
}
