"use client";

import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { contactFormOf, ContactFields, contactInput, EMPTY_CONTACT_FORM, type ContactForm } from "@/components/contacts/contact-fields";
import { PanelPage } from "@/components/layout/panel-page";
import { SECTION_FILL_CLASS } from "@/components/ui/section-tone";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { useRouteId } from "@/lib/client/demo/use-route-id";
import { labelForContactType, labelForMatterRole } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { contactLayout } from "./_contact-layout";

type ContactData = NonNullable<inferRouterOutputs<AppRouter>["contacts"]["getById"]>;

interface ChildForm { name: string; email: string; phone: string; notes: string }

const EMPTY_CHILD: ChildForm = { name: "", email: "", phone: "", notes: "" };

/** All state, mutationer och handlers för kontakt-detaljsidan (#6-ratchet:
 *  lyft ut ur komponenten så vyn blir tunn + presentational). */
function useContactDetail(paramId: string) {
  const router = useRouter();
  // Static export: sentinel-shell för nya id:n → läs riktiga id:t ur URL:en.
  const id = useRouteId() ?? paramId;
  const contact = trpc.contacts.getById.useQuery({ id });
  const utils = trpc.useUtils();

  const [editing, setEditing] = useState(false);
  const [showChildForm, setShowChildForm] = useState(false);
  const [childForm, setChildForm] = useState<ChildForm>(EMPTY_CHILD);
  const [editForm, setEditForm] = useState<ContactForm>(EMPTY_CONTACT_FORM);

  const updateContact = trpc.contacts.update.useMutation({
    onSuccess: () => { void utils.contacts.getById.invalidate({ id }); setEditing(false); },
  });
  const deleteContact = trpc.contacts.delete.useMutation({
    onSuccess: () => { void utils.contacts.list.invalidate(); router.push("/contacts"); },
  });
  const addChild = trpc.contacts.addChild.useMutation({
    onSuccess: () => {
      void utils.contacts.getById.invalidate({ id });
      setShowChildForm(false);
      setChildForm(EMPTY_CHILD);
    },
  });

  function startEditing(): void {
    if (!contact.data) return;
    setEditForm(contactFormOf(contact.data));
    setEditing(true);
  }
  function handleDelete(): void {
    if (!confirm("Är du säker på att du vill ta bort denna part? Parten tas bort från alla ärenden.")) return;
    deleteContact.mutate({ id });
  }

  return {
    id, contact, editing, setEditing, showChildForm, setShowChildForm,
    childForm, setChildForm, editForm, setEditForm,
    updateContact, deleteContact, addChild, startEditing, handleDelete,
  };
}

interface EditFormProps {
  form: ContactForm;
  setForm: (f: ContactForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
}

/** Ändra part: partens fält (#1925) och knapparna Spara och Avbryt. */
function ContactEditForm({ form, setForm, onSubmit, onCancel, isPending }: EditFormProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <ContactFields value={form} onChange={setForm} />
      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {isPending ? "Sparar..." : "Spara"}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
          Avbryt
        </button>
      </div>
    </form>
  );
}

/** E-post/telefon/adress-rutnätet (varsin rad bara om satt). */
function ContactContactFields({ c }: { c: ContactData }) {
  return (
    <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
      {c.email && <div><span className="text-gray-500">E-post:</span> <span className="text-gray-900">{c.email}</span></div>}
      {c.phone && <div><span className="text-gray-500">Telefon:</span> <span className="text-gray-900">{c.phone}</span></div>}
      {c.address && <div><span className="text-gray-500">Adress:</span> <span className="text-gray-900">{c.address}</span></div>}
    </div>
  );
}

interface DetailsViewProps {
  c: ContactData;
  onEdit: () => void;
  onDelete: () => void;
  deletePending: boolean;
}

/** Läs-vyn (rubrik + meta + actions + fält + anteckningar). */
function ContactDetailsView({ c, onEdit, onDelete, deletePending }: DetailsViewProps) {
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{c.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {labelForContactType(c.contactType)}
            {c.personalNumber && ` · ${c.personalNumber}`}
            {c.orgNumber && ` · ${c.orgNumber}`}
          </p>
          {c.parent && (
            <p className="text-sm text-gray-500 mt-1">
              Kontaktperson på{" "}
              <EntityLink route="contacts" id={c.parent.id} className="text-blue-600 hover:underline">{c.parent.name}</EntityLink>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            {c.matterLinks.length} ärenden
          </span>
          <button onClick={onEdit}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
            Redigera
          </button>
          <button onClick={onDelete} disabled={deletePending}
            className="px-3 py-1.5 text-sm border border-red-300 rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-50">
            {deletePending ? "Tar bort..." : "Ta bort"}
          </button>
        </div>
      </div>
      <ContactContactFields c={c} />
      {c.notes && (
        <div className="mt-2">
          <p className="text-sm text-gray-500">Anteckningar</p>
          <p className="text-sm text-gray-900 mt-1">{c.notes}</p>
        </div>
      )}
    </>
  );
}

interface AddChildFormProps {
  form: ChildForm;
  setForm: (f: ChildForm) => void;
  onSubmit: () => void;
  isPending: boolean;
}

/** Formuläret för att lägga till en kontaktperson. */
function AddChildForm({ form, setForm, onSubmit, isPending }: AddChildFormProps) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="p-2 border-b border-gray-200">
      <div className="grid grid-cols-2 gap-3">
        <input type="text" required placeholder="Namn *" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <input type="email" placeholder="E-post" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <input type="text" placeholder="Telefon" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
        <input type="text" placeholder="Roll/anteckning" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
      </div>
      <button type="submit" disabled={isPending}
        className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
        {isPending ? "Lägger till..." : "Lägg till"}
      </button>
    </form>
  );
}

interface ChildSectionProps {
  c: ContactData;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  childForm: ChildForm;
  setChildForm: (f: ChildForm) => void;
  onAdd: () => void;
  addPending: boolean;
}

/** Kontaktpersoner-sektionen (bara för organisationer). */
function ChildContactsSection(p: ChildSectionProps) {
  const children = p.c.children ?? [];
  return (
    <div className={SECTION_FILL_CLASS}>
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Kontaktpersoner</h2>
        <button onClick={() => p.setShowForm(!p.showForm)} className="text-sm text-blue-600 hover:underline">
          {p.showForm ? "Avbryt" : "+ Lägg till"}
        </button>
      </div>
      {p.showForm && (
        <AddChildForm
          form={p.childForm}
          setForm={p.setChildForm}
          onSubmit={p.onAdd}
          isPending={p.addPending}
        />
      )}
      <div className="divide-y divide-gray-100">
        {children.map((child) => (
          <EntityLink key={child.id} route="contacts" id={child.id} className="block px-2 py-3 hover:bg-gray-50">
            <p className="text-sm font-medium text-gray-900">{child.name}</p>
            <p className="text-xs text-gray-500">
              {child.email && `${child.email} · `}{child.phone}
              {child.notes && ` · ${child.notes}`}
            </p>
          </EntityLink>
        ))}
        {children.length === 0 && !p.showForm && (
          <p className="px-2 py-4 text-sm text-gray-500">Inga kontaktpersoner</p>
        )}
      </div>
    </div>
  );
}

const MATTER_STATUS = {
  ACTIVE: { cls: "bg-green-50 text-green-700", label: "Aktivt" },
  CLOSED: { cls: "bg-gray-100 text-gray-600", label: "Stängt" },
} as const;
const MATTER_STATUS_FALLBACK = { cls: "bg-yellow-50 text-yellow-700", label: "Arkiverat" };
function matterStatus(status: string): { cls: string; label: string } {
  return (MATTER_STATUS as Record<string, { cls: string; label: string }>)[status] ?? MATTER_STATUS_FALLBACK;
}

/** Ärende-listan kontakten är kopplad till. */
function LinkedMattersSection({ matterLinks }: { matterLinks: ContactData["matterLinks"] }) {
  return (
    <div className={SECTION_FILL_CLASS}>
      <div className="px-3 py-2 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Ärenden</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {matterLinks.map((link: { id: string; role: string; matter: { id: string; matterNumber: string; title: string; status: string } }) => {
          const st = matterStatus(link.matter.status);
          return (
            <EntityLink key={link.id} route="matters" id={link.matter.id} className="block px-2 py-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {link.matter.matterNumber} — {link.matter.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Roll: <span className="font-medium">{labelForMatterRole(link.role)}</span>
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                  {st.label}
                </span>
              </div>
            </EntityLink>
          );
        })}
        {matterLinks.length === 0 && (
          <p className="px-2 py-4 text-sm text-gray-500">Inte kopplad till några ärenden</p>
        )}
      </div>
    </div>
  );
}

export default function ContactDetailClient({ id: paramId }: { id: string }) {
  const d = useContactDetail(paramId);

  if (d.contact.isLoading) return <p className="text-gray-500">Laddar...</p>;
  if (d.contact.error) return <p className="text-red-600">Fel: {d.contact.error.message}</p>;
  if (!d.contact.data) return null;

  const c = d.contact.data;
  const isOrg = c.contactType !== "PERSON";

  const details = (
    <div className={`${SECTION_FILL_CLASS} p-2`}>
      {d.editing ? (
        <ContactEditForm
          form={d.editForm}
          setForm={d.setEditForm}
          onSubmit={() => d.updateContact.mutate(contactInput(d.editForm, asId<"ContactId">(d.id)))}
          onCancel={() => d.setEditing(false)}
          isPending={d.updateContact.isPending}
        />
      ) : (
        <ContactDetailsView c={c} onEdit={d.startEditing} onDelete={d.handleDelete} deletePending={d.deleteContact.isPending} />
      )}
    </div>
  );
  const panels = [
    { id: "details", title: "Uppgifter", render: () => details },
    // Kontaktpersoner finns bara för organisationer — panelen saknas för personer.
    ...(isOrg ? [{
      id: "people", title: "Kontaktpersoner", render: () => (
        <ChildContactsSection
          c={c}
          showForm={d.showChildForm}
          setShowForm={d.setShowChildForm}
          childForm={d.childForm}
          setChildForm={d.setChildForm}
          onAdd={() => d.addChild.mutate({ parentId: d.id, ...d.childForm })}
          addPending={d.addChild.isPending}
        />
      ),
      fill: true }] : []),
    { id: "matters", title: "Ärenden", render: () => <LinkedMattersSection matterLinks={c.matterLinks} />, fill: true },
  ];

  return (
    <PanelPage
      page="contact"
      panels={panels}
      defaultLayout={contactLayout}
      header={(
        <div className="mb-2">
          <Link href="/contacts" className="text-xs text-blue-600 hover:underline">&larr; Tillbaka till parter</Link>
        </div>
      )}
    />
  );
}
