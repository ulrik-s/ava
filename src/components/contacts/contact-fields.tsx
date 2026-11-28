"use client";

import type { inferRouterInputs } from "@trpc/server";
import { useId } from "react";
import { contactTypeOptions } from "@/lib/client/labels";
import type { AppRouter } from "@/lib/server/routers/_app";
import { type ContactType, contactTypeSchema } from "@/lib/shared/schemas/enums";
import type { ContactId } from "@/lib/shared/schemas/ids";

/** Fälten i partens formulär, för Ny part och Ändra part (strängar som i inputs). */
export interface ContactForm {
  name: string;
  contactType: ContactType;
  personalNumber: string;
  orgNumber: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

/** Ett tomt formulär för en ny part (en person). */
export const EMPTY_CONTACT_FORM: ContactForm = {
  name: "", contactType: "PERSON", personalNumber: "", orgNumber: "",
  email: "", phone: "", address: "", notes: "",
};

type ContactInputs = inferRouterInputs<AppRouter>["contacts"];
/** Indata till `contacts.create`. */
export type ContactCreateInput = ContactInputs["create"];
/** Indata till `contacts.update`. */
export type ContactUpdateInput = ContactInputs["update"];

/** En sparad part, som formuläret fylls i från vid Ändra part. */
export interface ContactFormSource {
  name: string;
  contactType: ContactType;
  personalNumber?: string | null | undefined;
  orgNumber?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  notes?: string | null | undefined;
}

/** Sparad part → formulär (saknade värden blir ""). */
export function contactFormOf(c: ContactFormSource): ContactForm {
  const s = (v: string | null | undefined): string => v ?? "";
  return {
    name: c.name, contactType: c.contactType,
    personalNumber: s(c.personalNumber), orgNumber: s(c.orgNumber),
    email: s(c.email), phone: s(c.phone), address: s(c.address), notes: s(c.notes),
  };
}

/** Indata till `contacts.create` ur formuläret; med `id` indata till `contacts.update`. */
export function contactInput(form: ContactForm): ContactCreateInput;
export function contactInput(form: ContactForm, id: ContactId): ContactUpdateInput;
export function contactInput(form: ContactForm, id?: ContactId): ContactCreateInput | ContactUpdateInput {
  return id === undefined ? { ...form } : { id, ...form };
}

/** Personnumret visas för en person, och alltid när fältet har ett värde. */
export function showsPersonalNumber(form: ContactForm): boolean {
  return form.contactType === "PERSON" || form.personalNumber !== "";
}

/** Organisationsnumret visas för allt utom en person, och alltid när fältet har ett värde. */
export function showsOrgNumber(form: ContactForm): boolean {
  return form.contactType !== "PERSON" || form.orgNumber !== "";
}

const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1";
const INPUT_CLASS = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

type TextKey = Exclude<keyof ContactForm, "contactType">;

interface TextFieldProps {
  label: string;
  field: TextKey;
  value: ContactForm;
  onChange: (next: ContactForm) => void;
  type?: "text" | "email";
  placeholder?: string;
  required?: boolean;
  className?: string;
}

/** Ett textfält i formuläret (äger sitt fält-id). */
function TextField({ label, field, value, onChange, type = "text", placeholder, required, className }: TextFieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      <input id={id} type={type} required={required} value={value[field]} placeholder={placeholder}
        onChange={(e) => onChange({ ...value, [field]: e.target.value })}
        className={INPUT_CLASS} />
    </div>
  );
}

/** Valet av partens typ, typat ur `contactTypeSchema`. */
function TypeSelect({ value, onChange }: { value: ContactForm; onChange: (next: ContactForm) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>Typ</label>
      <select id={id} value={value.contactType}
        onChange={(e) => onChange({ ...value, contactType: contactTypeSchema.parse(e.target.value) })}
        className={INPUT_CLASS}>
        {contactTypeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
    </div>
  );
}

/** Anteckningarna (två rader, hela bredden). */
function NotesField({ value, onChange }: { value: ContactForm; onChange: (next: ContactForm) => void }) {
  const id = useId();
  return (
    <div className="md:col-span-2">
      <label htmlFor={id} className={LABEL_CLASS}>Anteckningar</label>
      <textarea id={id} value={value.notes} rows={2}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        className={INPUT_CLASS} />
    </div>
  );
}

interface ContactFieldsProps {
  value: ContactForm;
  onChange: (next: ContactForm) => void;
}

/**
 * Partens fält (#1925), delade av Ny part (Parter och "Ny klient…") och Ändra
 * part. Nummerfältet följer typen, men ett ifyllt nummer döljs aldrig.
 */
export function ContactFields({ value, onChange }: ContactFieldsProps) {
  const field = { value, onChange };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <TextField label="Namn *" field="name" required {...field} />
      <TypeSelect {...field} />
      {showsPersonalNumber(value) && <TextField label="Personnummer" field="personalNumber" placeholder="YYYYMMDD-XXXX" {...field} />}
      {showsOrgNumber(value) && <TextField label="Organisationsnummer" field="orgNumber" placeholder="XXXXXX-XXXX" {...field} />}
      <TextField label="E-post" field="email" type="email" {...field} />
      <TextField label="Telefon" field="phone" {...field} />
      <TextField label="Adress" field="address" {...field} />
      <NotesField {...field} />
    </div>
  );
}
