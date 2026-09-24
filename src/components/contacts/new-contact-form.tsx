"use client";

import { useId } from "react";
import { contactTypeOptions } from "@/lib/client/labels";

export const EMPTY_CONTACT_FORM: ContactForm = {
  name: "", contactType: "PERSON", personalNumber: "", orgNumber: "",
  email: "", phone: "", address: "", notes: "",
};

/** Fälten i ny-kontakt-formuläret (strängar som i inputs). */
export interface ContactForm {
  name: string;
  contactType: string;
  personalNumber: string;
  orgNumber: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

interface NewContactFormProps {
  form: ContactForm;
  setForm: (f: ContactForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isPending: boolean;
  error: { message: string } | null | undefined;
  /** Rubrik; `null` = ingen (formuläret ligger i en dialog som redan har en). */
  title?: string | null;
  /** Spara-knappens text — "OK" i klientdialogen (#1128). */
  submitLabel?: string;
}

/** Ny-kontakt-formuläret — delat av /contacts och "+ Ny klient" i nytt ärende.
 *  Äger sina fält-id:n; presentational (form-state + submit som props). */
export function NewContactForm({ form, setForm, onSubmit, onCancel, isPending, error, title = "Ny kontakt", submitLabel = "Spara kontakt" }: NewContactFormProps) {
  const nameId = useId();
  const typeId = useId();
  const personalNumberId = useId();
  const orgNumberId = useId();
  const emailId = useId();
  const phoneId = useId();
  const addressId = useId();
  const notesId = useId();
  const showPersonalNumber = form.contactType === "PERSON";
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      {title && <h2 className="font-semibold text-gray-900 mb-4">{title}</h2>}
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
            {contactTypeOptions.map((t) => (
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
        <button type="submit" disabled={isPending}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {isPending ? "Sparar..." : submitLabel}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Avbryt
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error.message}</p>}
    </form>
  );
}
