"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { labelForContactType, labelForMatterRole, contactTypes } from "@/lib/client/labels";
import { useRouteId } from "@/lib/client/demo/use-route-id";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'ContactDetailClient' has a complexity of 22. Maximum allowed is 8.)
export default function ContactDetailClient({ id: paramId }: { id: string }) {
  const router = useRouter();
  // Static export: sentinel-shell för nya id:n → läs riktiga id:t ur URL:en.
  const id = useRouteId() ?? paramId;
  const contact = trpc.contacts.getById.useQuery({ id });
  const utils = trpc.useUtils();

  const [editing, setEditing] = useState(false);
  const [showChildForm, setShowChildForm] = useState(false);
  const [childForm, setChildForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const editNameId = useId();
  const editTypeId = useId();
  const editPersonalNumberId = useId();
  const editOrgNumberId = useId();
  const editEmailId = useId();
  const editPhoneId = useId();
  const editAddressId = useId();
  const editNotesId = useId();

  const [editForm, setEditForm] = useState({
    name: "", contactType: "PERSON" as string, personalNumber: "", orgNumber: "",
    email: "", phone: "", address: "", notes: "",
  });

  const updateContact = trpc.contacts.update.useMutation({
    onSuccess: () => {
      utils.contacts.getById.invalidate({ id });
      setEditing(false);
    },
  });

  const deleteContact = trpc.contacts.delete.useMutation({
    onSuccess: () => {
      utils.contacts.list.invalidate();
      router.push("/contacts");
    },
  });

  const addChild = trpc.contacts.addChild.useMutation({
    onSuccess: () => {
      utils.contacts.getById.invalidate({ id });
      setShowChildForm(false);
      setChildForm({ name: "", email: "", phone: "", notes: "" });
    },
  });

  function startEditing() {
    if (!contact.data) return;
    const c = contact.data;
    setEditForm({
      name: c.name,
      contactType: c.contactType,
      personalNumber: c.personalNumber ?? "",
      orgNumber: c.orgNumber ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
    });
    setEditing(true);
  }

  function handleDelete() {
    if (!confirm("Är du säker på att du vill ta bort denna kontakt? Kontakten tas bort från alla ärenden.")) return;
    deleteContact.mutate({ id });
  }

  if (contact.isLoading) return <p className="text-gray-500">Laddar...</p>;
  if (contact.error) return <p className="text-red-600">Fel: {contact.error.message}</p>;
  if (!contact.data) return null;

  const c = contact.data;
  const isOrg = c.contactType !== "PERSON";

  return (
    <div>
      <div className="mb-6">
        <Link href="/contacts" className="text-sm text-blue-600 hover:underline">&larr; Tillbaka till kontakter</Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); updateContact.mutate({ id, ...editForm } as Parameters<typeof updateContact.mutate>[0]); }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor={editNameId} className="block text-sm text-gray-500 mb-1">Namn *</label>
                <input id={editNameId} type="text" required value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor={editTypeId} className="block text-sm text-gray-500 mb-1">Typ</label>
                <select id={editTypeId} value={editForm.contactType}
                  onChange={(e) => setEditForm({ ...editForm, contactType: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm">
                  {contactTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={editPersonalNumberId} className="block text-sm text-gray-500 mb-1">Personnummer</label>
                <input id={editPersonalNumberId} type="text" value={editForm.personalNumber}
                  onChange={(e) => setEditForm({ ...editForm, personalNumber: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor={editOrgNumberId} className="block text-sm text-gray-500 mb-1">Organisationsnummer</label>
                <input id={editOrgNumberId} type="text" value={editForm.orgNumber}
                  onChange={(e) => setEditForm({ ...editForm, orgNumber: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor={editEmailId} className="block text-sm text-gray-500 mb-1">E-post</label>
                <input id={editEmailId} type="email" value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor={editPhoneId} className="block text-sm text-gray-500 mb-1">Telefon</label>
                <input id={editPhoneId} type="text" value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="md:col-span-2">
                <label htmlFor={editAddressId} className="block text-sm text-gray-500 mb-1">Adress</label>
                <input id={editAddressId} type="text" value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div className="md:col-span-2">
                <label htmlFor={editNotesId} className="block text-sm text-gray-500 mb-1">Anteckningar</label>
                <textarea id={editNotesId} value={editForm.notes} rows={3}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="submit" disabled={updateContact.isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {updateContact.isPending ? "Sparar..." : "Spara"}
              </button>
              <button type="button" onClick={() => setEditing(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                Avbryt
              </button>
            </div>
          </form>
        ) : (
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
                <button onClick={startEditing}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  Redigera
                </button>
                <button onClick={handleDelete} disabled={deleteContact.isPending}
                  className="px-3 py-1.5 text-sm border border-red-300 rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-50">
                  {deleteContact.isPending ? "Tar bort..." : "Ta bort"}
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              {c.email && <div><span className="text-gray-500">E-post:</span> <span className="text-gray-900">{c.email}</span></div>}
              {c.phone && <div><span className="text-gray-500">Telefon:</span> <span className="text-gray-900">{c.phone}</span></div>}
              {c.address && <div><span className="text-gray-500">Adress:</span> <span className="text-gray-900">{c.address}</span></div>}
            </div>
            {c.notes && (
              <div className="mt-4">
                <p className="text-sm text-gray-500">Anteckningar</p>
                <p className="text-sm text-gray-900 mt-1">{c.notes}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Contact persons for organizations */}
      {isOrg && (
        <div className="bg-white rounded-lg border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Kontaktpersoner</h2>
            <button onClick={() => setShowChildForm(!showChildForm)} className="text-sm text-blue-600 hover:underline">
              {showChildForm ? "Avbryt" : "+ Lägg till"}
            </button>
          </div>
          {showChildForm && (
            <form onSubmit={(e) => { e.preventDefault(); addChild.mutate({ parentId: id, ...childForm }); }}
              className="p-4 border-b border-gray-200">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" required placeholder="Namn *" value={childForm.name}
                  onChange={(e) => setChildForm({ ...childForm, name: e.target.value })}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                <input type="email" placeholder="E-post" value={childForm.email}
                  onChange={(e) => setChildForm({ ...childForm, email: e.target.value })}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                <input type="text" placeholder="Telefon" value={childForm.phone}
                  onChange={(e) => setChildForm({ ...childForm, phone: e.target.value })}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
                <input type="text" placeholder="Roll/anteckning" value={childForm.notes}
                  onChange={(e) => setChildForm({ ...childForm, notes: e.target.value })}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
              </div>
              <button type="submit" disabled={addChild.isPending}
                className="mt-3 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                {addChild.isPending ? "Lägger till..." : "Lägg till"}
              </button>
            </form>
          )}
          <div className="divide-y divide-gray-100">
            {(c.children ?? []).map((child: { id: string; name: string; contactType: string; email: string | null; phone: string | null; notes: string | null }) => (
              <EntityLink key={child.id} route="contacts" id={child.id} className="block px-6 py-3 hover:bg-gray-50">
                <p className="text-sm font-medium text-gray-900">{child.name}</p>
                <p className="text-xs text-gray-500">
                  {child.email && `${child.email} · `}{child.phone}
                  {child.notes && ` · ${child.notes}`}
                </p>
              </EntityLink>
            ))}
            {c.children.length === 0 && !showChildForm && (
              <p className="px-6 py-4 text-sm text-gray-500">Inga kontaktpersoner</p>
            )}
          </div>
        </div>
      )}

      {/* Matters this contact is linked to */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Ärenden</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {c.matterLinks.map((link: { id: string; role: string; matter: { id: string; matterNumber: string; title: string; status: string } }) => (
            <EntityLink key={link.id} route="matters" id={link.matter.id} className="block px-6 py-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {link.matter.matterNumber} — {link.matter.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Roll: <span className="font-medium">{labelForMatterRole(link.role)}</span>
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  link.matter.status === "ACTIVE" ? "bg-green-50 text-green-700"
                    : link.matter.status === "CLOSED" ? "bg-gray-100 text-gray-600"
                    : "bg-yellow-50 text-yellow-700"
                }`}>
                  {link.matter.status === "ACTIVE" ? "Aktivt" : link.matter.status === "CLOSED" ? "Stängt" : "Arkiverat"}
                </span>
              </div>
            </EntityLink>
          ))}
          {c.matterLinks.length === 0 && (
            <p className="px-6 py-4 text-sm text-gray-500">Inte kopplad till några ärenden</p>
          )}
        </div>
      </div>
    </div>
  );
}
