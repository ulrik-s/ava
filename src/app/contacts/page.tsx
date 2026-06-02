"use client";

import { Suspense, useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { labelForContactType, contactTypes } from "@/lib/client/labels";
import { useIsReadOnly } from "@/lib/client/demo/demo-mode-context";
import { DataTable, type Column } from "@/components/ui/data-table";

interface ContactRow {
  id: string;
  name: string;
  contactType: string;
  personalNumber?: string | null;
  orgNumber?: string | null;
  email?: string | null;
  _count: { matterLinks: number };
}

const contactColumns: Column<ContactRow>[] = [
  { key: "name", label: "Namn", sortable: true, sortValue: (c) => c.name,
    render: (c) => <EntityLink route="contacts" id={c.id} className="text-sm font-medium text-blue-600 hover:underline">{c.name}</EntityLink> },
  { key: "contactType", label: "Typ", sortable: true, sortValue: (c) => labelForContactType(c.contactType),
    render: (c) => <span className="text-sm text-gray-500">{labelForContactType(c.contactType)}</span> },
  { key: "number", label: "Personnr/Orgnr", sortable: true, sortValue: (c) => c.personalNumber || c.orgNumber || "",
    render: (c) => <span className="text-sm text-gray-500">{c.personalNumber || c.orgNumber || "—"}</span> },
  { key: "email", label: "E-post", sortable: true, sortValue: (c) => c.email || "",
    render: (c) => <span className="text-sm text-gray-500">{c.email || "—"}</span> },
  { key: "matterCount", label: "Ärenden", sortable: true, align: "right", sortValue: (c) => c._count.matterLinks,
    render: (c) => <span className="text-sm text-gray-500">{c._count.matterLinks}</span> },
];

function ContactsTable({ rows }: { rows: ContactRow[] }) {
  return <DataTable prefKey="list.contacts" columns={contactColumns} data={rows} rowKey={(c) => c.id} emptyMessage="Inga kontakter." />;
}

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'ContactsContent' has a complexity of 11. Maximum allowed is 8.)
function ContactsContent() {
  const searchParams = useSearchParams();
  const readOnly = useIsReadOnly();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const nameId = useId();
  const typeId = useId();
  const personalNumberId = useId();
  const orgNumberId = useId();
  const emailId = useId();
  const phoneId = useId();
  const addressId = useId();
  const notesId = useId();

  const contacts = trpc.contacts.list.useQuery({
    search,
    contactType: typeFilter || undefined,
    page,
    pageSize: 20,
  } as Parameters<typeof trpc.contacts.list.useQuery>[0]);
  const utils = trpc.useUtils();

  const createContact = trpc.contacts.create.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      setShowForm(false);
      setForm({ name: "", contactType: "PERSON", personalNumber: "", orgNumber: "", email: "", phone: "", address: "", notes: "" });
    },
  });

  const [form, setForm] = useState({
    name: "",
    contactType: "PERSON" as string,
    personalNumber: "",
    orgNumber: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createContact.mutate(form as Parameters<typeof createContact.mutate>[0]);
  }

  const showPersonalNumber = form.contactType === "PERSON";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Kontakter</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          disabled={readOnly}
          title={readOnly ? "Inte tillgängligt i demo-läget" : undefined}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {showForm ? "Avbryt" : "+ Ny kontakt"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Ny kontakt</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor={nameId} className="block text-sm font-medium text-gray-700 mb-1">Namn *</label>
              <input id={nameId} type="text" required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={typeId} className="block text-sm font-medium text-gray-700 mb-1">Typ</label>
              <select id={typeId} value={form.contactType}
                onChange={(e) => setForm({ ...form, contactType: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {contactTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {showPersonalNumber ? (
              <div>
                <label htmlFor={personalNumberId} className="block text-sm font-medium text-gray-700 mb-1">Personnummer</label>
                <input id={personalNumberId} type="text" value={form.personalNumber}
                  onChange={(e) => setForm({ ...form, personalNumber: e.target.value })}
                  placeholder="YYYYMMDD-XXXX"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            ) : (
              <div>
                <label htmlFor={orgNumberId} className="block text-sm font-medium text-gray-700 mb-1">Organisationsnummer</label>
                <input id={orgNumberId} type="text" value={form.orgNumber}
                  onChange={(e) => setForm({ ...form, orgNumber: e.target.value })}
                  placeholder="XXXXXX-XXXX"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div>
              <label htmlFor={emailId} className="block text-sm font-medium text-gray-700 mb-1">E-post</label>
              <input id={emailId} type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={phoneId} className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
              <input id={phoneId} type="text" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor={addressId} className="block text-sm font-medium text-gray-700 mb-1">Adress</label>
              <input id={addressId} type="text" value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor={notesId} className="block text-sm font-medium text-gray-700 mb-1">Anteckningar</label>
              <textarea id={notesId} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={createContact.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {createContact.isPending ? "Sparar..." : "Spara kontakt"}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
              Avbryt
            </button>
          </div>
          {createContact.error && (
            <p className="mt-2 text-sm text-red-600">{createContact.error.message}</p>
          )}
        </form>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
        <input type="text" placeholder="Sök kontakter..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 sm:max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Alla typer</option>
          {contactTypes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <ContactsTable rows={contacts.data?.contacts ?? []} />
      {contacts.data && contacts.data.pages > 1 && (
        <div className="px-6 py-3 mt-2 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-gray-500">Sida {page} av {contacts.data.pages} ({contacts.data.total} totalt)</p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
            <button disabled={page >= contacts.data.pages} onClick={() => setPage(page + 1)}
              className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Laddar...</p>}>
      <ContactsContent />
    </Suspense>
  );
}
