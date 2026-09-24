"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { trpc } from "@/lib/client/trpc";
import { EMPTY_CONTACT_FORM, NewContactForm, type ContactForm } from "./new-contact-form";

/** En vald eller nyskapad klient — det nytt ärende behöver. */
export interface PickedClient {
  id: string;
  name: string;
}

interface Props {
  /** Förifyllt namn — det man sökte på innan man valde "Ny klient…". */
  initialName?: string;
  onCreated: (client: PickedClient) => void;
  onClose: () => void;
  /** "klient" eller "kontakt" — styr rubriken. */
  noun?: string;
}

/**
 * "Ny klient…" (#1128): alla uppgifter om klienten i en dialog, OK skapar den
 * och väljer den, Avbryt stänger utan att skapa något. Samma formulär som
 * Kontakter-sidan.
 */
export function NewClientDialog({ initialName = "", onCreated, onClose, noun = "klient" }: Props) {
  const [form, setForm] = useState<ContactForm>({ ...EMPTY_CONTACT_FORM, name: initialName });
  const utils = trpc.useUtils();
  const createContact = trpc.contacts.create.useMutation({
    onSuccess: (contact) => {
      void utils.contacts.list.invalidate();
      void utils.contacts.search.invalidate();
      onCreated({ id: contact.id, name: contact.name });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createContact.mutate(form as Parameters<typeof createContact.mutate>[0]);
  }

  return (
    <Modal open title={`Ny ${noun}`} onClose={onClose} widthClass="max-w-2xl">
      <NewContactForm
        form={form}
        setForm={setForm}
        onSubmit={handleSubmit}
        onCancel={onClose}
        isPending={createContact.isPending}
        error={createContact.error}
        title={null}
        submitLabel="OK"
      />
    </Modal>
  );
}
