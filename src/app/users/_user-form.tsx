"use client";

import Link from "next/link";
import { useId } from "react";

export interface UserFormState {
  name: string;
  title: string;
  email: string;
  role: string;
  matterNumberPrefix: string;
  hourlyRate: string;
  mileageRate: string;
  password: string;
  confirmPassword: string;
}

interface Props {
  form: UserFormState;
  setForm: (f: UserFormState) => void;
  onSubmit: (e: React.FormEvent) => void;
  passwordError: string;
  errorMessage?: string | undefined;
  passwordRequired: boolean;
  passwordPlaceholder?: string;
  submitLabel: string;
  submittingLabel: string;
  isSubmitting: boolean;
  extraActions?: React.ReactNode;
}

export function UserForm({
  form,
  setForm,
  onSubmit,
  passwordError,
  errorMessage,
  passwordRequired,
  passwordPlaceholder,
  submitLabel,
  submittingLabel,
  isSubmitting,
  extraActions,
}: Props) {
  const nameId = useId();
  const titleId = useId();
  const emailId = useId();
  const roleId = useId();
  const matterPrefixId = useId();
  const hourlyRateId = useId();
  const mileageRateId = useId();

  return (
    <form onSubmit={onSubmit}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField id={nameId} label="Namn *">
          <input id={nameId} type="text" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </FormField>
        <FormField id={titleId} label="Titel">
          <input id={titleId} type="text" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </FormField>
        <FormField id={emailId} label="E-post *">
          <input id={emailId} type="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </FormField>
        <FormField id={roleId} label="Roll">
          <select id={roleId} value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="ADMIN">Admin</option>
            <option value="LAWYER">Advokat</option>
            <option value="ASSISTANT">Assistent</option>
          </select>
        </FormField>
        <FormField id={matterPrefixId} label="Ärendenummer-prefix (1–3 versaler)">
          <input id={matterPrefixId} type="text" maxLength={3} value={form.matterNumberPrefix}
            onChange={(e) => setForm({ ...form, matterNumberPrefix: e.target.value.toUpperCase() })}
            placeholder="t.ex. AA"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase" />
          <p className="mt-1 text-xs text-gray-500">
            Juristens egen ärendenummerserie (AA2026-0001). Byte fortsätter serien.
          </p>
        </FormField>
        <FormField id={hourlyRateId} label="Timtaxa (kr/h)">
          <input id={hourlyRateId} type="number" value={form.hourlyRate}
            onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </FormField>
        <FormField id={mileageRateId} label="Milersättning (kr/km)">
          <input id={mileageRateId} type="number" step="0.01" value={form.mileageRate}
            onChange={(e) => setForm({ ...form, mileageRate: e.target.value })}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </FormField>
        <PasswordFields form={form} setForm={setForm} required={passwordRequired} placeholder={passwordPlaceholder} />
      </div>

      {passwordError && <p className="mt-2 text-sm text-red-600">{passwordError}</p>}
      {errorMessage && <p className="mt-2 text-sm text-red-600">{errorMessage}</p>}

      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? submittingLabel : submitLabel}
          </button>
          <Link
            href="/users"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
          >
            Avbryt
          </Link>
        </div>
        {extraActions}
      </div>
    </form>
  );
}

function PasswordFields({
  form,
  setForm,
  required,
  placeholder,
}: {
  form: UserFormState;
  setForm: (f: UserFormState) => void;
  required: boolean;
  placeholder?: string | undefined;
}) {
  const passwordId = useId();
  const confirmPasswordId = useId();
  return (
    <>
      <FormField id={passwordId} label={required ? "Lösenord *" : "Nytt lösenord"}>
        <input id={passwordId} type="password" required={required} value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </FormField>
      <FormField id={confirmPasswordId} label={required ? "Bekräfta lösenord *" : "Bekräfta lösenord"}>
        <input id={confirmPasswordId} type="password" required={required} value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </FormField>
    </>
  );
}

function FormField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
