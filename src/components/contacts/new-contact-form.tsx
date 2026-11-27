"use client";

import { ContactFields, type ContactForm } from "./contact-fields";

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
export function NewContactForm({ form, setForm, onSubmit, onCancel, isPending, error, title = "Ny part", submitLabel = "Spara part" }: NewContactFormProps) {
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      {title && <h2 className="font-semibold text-gray-900 mb-4">{title}</h2>}
      <ContactFields value={form} onChange={setForm} />
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
