"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EMPTY_CONTACT_FORM, NewContactForm, type ContactForm } from "@/components/contacts/new-contact-form";
import { ListPage } from "@/components/layout/list-page";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pager } from "@/components/ui/pager";
import { useIsReadOnly } from "@/lib/client/demo/demo-mode-context";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { labelForContactType, contactTypeOptions } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";

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

function ContactsContent() {
  const searchParams = useSearchParams();
  const readOnly = useIsReadOnly();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");

  const contacts = trpc.contacts.list.useQuery({
    search,
    contactType: typeFilter || undefined,
    page,
    pageSize: 20,
  } as Parameters<typeof trpc.contacts.list.useQuery>[0]);
  const utils = trpc.useUtils();

  const createContact = trpc.contacts.create.useMutation({
    onSuccess: () => {
      void utils.contacts.list.invalidate();
      setShowForm(false);
      setForm(EMPTY_CONTACT_FORM);
    },
  });

  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT_FORM);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createContact.mutate(form as Parameters<typeof createContact.mutate>[0]);
  }

  return (
    <ListPage
      footer={<Pager data={contacts.data} page={page} onPage={setPage} showTotal />}
      header={(
        <>
      <div className="flex items-center justify-between mb-4">
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

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
        <input type="text" placeholder="Sök kontakter..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 sm:max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Alla typer</option>
          {contactTypeOptions.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
        </>
      )}
    >
      {showForm && (
        <NewContactForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          isPending={createContact.isPending}
          error={createContact.error}
        />
      )}

      <ContactsTable rows={(contacts.data?.contacts ?? []) as ContactRow[]} />
    </ListPage>
  );
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Laddar...</p>}>
      <ContactsContent />
    </Suspense>
  );
}
