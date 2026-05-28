"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/client/trpc";
import { labelForMatterRole, matterRoles, contactTypes } from "@/lib/client/labels";
import { DataTable, type Column } from "@/components/ui/data-table";

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
  matterId: string;
  contacts: MatterContact[];
}

export function ContactsSection({ matterId, contacts }: Props) {
  const utils = trpc.useUtils();
  const [showContactForm, setShowContactForm] = useState(false);
  const [addMode, setAddMode] = useState<"existing" | "new">("new");

  const [existingContactForm, setExistingContactForm] = useState({
    contactId: "",
    role: "MOTPART" as string,
    notes: "",
  });

  const [newContactForm, setNewContactForm] = useState({
    name: "",
    contactType: "PERSON" as string,
    personalNumber: "",
    orgNumber: "",
    email: "",
    phone: "",
    role: "MOTPART" as string,
    notes: "",
  });

  const existingContacts = trpc.contacts.list.useQuery({ pageSize: 100 });

  const addContact = trpc.matter.addContact.useMutation({
    onSuccess: () => {
      utils.matter.getById.invalidate({ id: matterId });
      setExistingContactForm({ contactId: "", role: "MOTPART", notes: "" });
    },
  });

  const addNewContact = trpc.matter.addNewContact.useMutation({
    onSuccess: () => {
      utils.matter.getById.invalidate({ id: matterId });
      utils.contacts.list.invalidate();
      setShowContactForm(false);
      setNewContactForm({
        name: "",
        contactType: "PERSON",
        personalNumber: "",
        orgNumber: "",
        email: "",
        phone: "",
        role: "MOTPART",
        notes: "",
      });
    },
  });

  const removeContact = trpc.matter.removeContact.useMutation({
    onSuccess: () => utils.matter.getById.invalidate({ id: matterId }),
  });

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Kontakter ({contacts.length})</h2>
        <button onClick={() => setShowContactForm(!showContactForm)} className="text-sm text-blue-600 hover:underline">
          {showContactForm ? "Avbryt" : "+ Lägg till"}
        </button>
      </div>

      {showContactForm && (
        <div className="p-4 border-b border-gray-200 space-y-3">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setAddMode("new")}
              className={`px-3 py-1 text-xs rounded-full ${addMode === "new" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
              Ny kontakt
            </button>
            <button onClick={() => setAddMode("existing")}
              className={`px-3 py-1 text-xs rounded-full ${addMode === "existing" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
              Befintlig kontakt
            </button>
          </div>

          {addMode === "existing" ? (
            <ExistingContactForm
              matterId={matterId}
              form={existingContactForm}
              setForm={setExistingContactForm}
              contacts={existingContacts.data?.contacts ?? []}
              onSubmit={(data) => addContact.mutate(data as Parameters<typeof addContact.mutate>[0])}
              isPending={addContact.isPending}
            />
          ) : (
            <NewContactForm
              matterId={matterId}
              form={newContactForm}
              setForm={setNewContactForm}
              onSubmit={(data) => addNewContact.mutate(data as Parameters<typeof addNewContact.mutate>[0])}
              isPending={addNewContact.isPending}
            />
          )}
        </div>
      )}

      <ContactsList matterId={matterId} contacts={contacts} onRemove={(id) => removeContact.mutate({ matterContactId: id })} />
    </div>
  );
}

function ContactsList({
  matterId,
  contacts,
  onRemove,
}: {
  matterId: string;
  contacts: MatterContact[];
  onRemove: (matterContactId: string) => void;
}) {
  const columns: Column<MatterContact>[] = [
    { key: "name", label: "Namn", sortable: true, sortValue: (mc) => mc.contact.name,
      render: (mc) => (
        <Link href={`/contacts/${mc.contact.id}`} className="text-sm font-medium text-blue-600 hover:underline">
          {mc.contact.name}
        </Link>
      ),
    },
    { key: "role", label: "Roll", sortable: true, sortValue: (mc) => labelForMatterRole(mc.role),
      render: (mc) => <span className="text-sm text-gray-700">{labelForMatterRole(mc.role)}</span> },
    { key: "number", label: "Personnr/Orgnr", sortable: true,
      sortValue: (mc) => mc.contact.personalNumber ?? mc.contact.orgNumber ?? "",
      render: (mc) => <span className="text-sm text-gray-500">{mc.contact.personalNumber || mc.contact.orgNumber || "—"}</span> },
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

type ExistingForm = { contactId: string; role: string; notes: string };

function ExistingContactForm({
  matterId,
  form,
  setForm,
  contacts,
  onSubmit,
  isPending,
}: {
  matterId: string;
  form: ExistingForm;
  setForm: (f: ExistingForm) => void;
  contacts: Array<{ id: string; name: string }>;
  onSubmit: (data: ExistingForm & { matterId: string }) => void;
  isPending: boolean;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ matterId, ...form }); }}>
      <div className="grid grid-cols-2 gap-3">
        <select required value={form.contactId}
          onChange={(e) => setForm({ ...form, contactId: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">Välj kontakt...</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          {matterRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <button type="submit" disabled={isPending}
        className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
        {isPending ? "Lägger till..." : "Lägg till"}
      </button>
    </form>
  );
}

type NewForm = {
  name: string;
  contactType: string;
  personalNumber: string;
  orgNumber: string;
  email: string;
  phone: string;
  role: string;
  notes: string;
};

function NewContactForm({
  matterId,
  form,
  setForm,
  onSubmit,
  isPending,
}: {
  matterId: string;
  form: NewForm;
  setForm: (f: NewForm) => void;
  onSubmit: (data: NewForm & { matterId: string }) => void;
  isPending: boolean;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ matterId, ...form }); }}>
      <div className="grid grid-cols-2 gap-3">
        <input type="text" required placeholder="Namn *" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <select value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          {matterRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={form.contactType}
          onChange={(e) => setForm({ ...form, contactType: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          {contactTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="text" placeholder={form.contactType === "PERSON" ? "Personnummer" : "Orgnummer"}
          value={form.contactType === "PERSON" ? form.personalNumber : form.orgNumber}
          onChange={(e) => form.contactType === "PERSON"
            ? setForm({ ...form, personalNumber: e.target.value })
            : setForm({ ...form, orgNumber: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={isPending}
        className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
        {isPending ? "Lägger till..." : "Skapa & lägg till"}
      </button>
    </form>
  );
}
