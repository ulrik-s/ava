"use client";

import { useState } from "react";
import { EMPTY_CONTACT_FORM, NewContactForm, type ContactForm } from "@/components/contacts/new-contact-form";
import { trpc } from "@/lib/client/trpc";

/** Den nyskapade klienten — det nytt-ärende-formuläret behöver för att välja den. */
export interface CreatedClient {
  id: string;
  name: string;
}

interface Props {
  onCreated: (client: CreatedClient) => void;
  onClose: () => void;
}

/**
 * "+ Ny klient" i nytt ärende: skapa kontakten utan att lämna formuläret.
 * Samma formulär som /contacts. Renderas som SYSKON till ärende-formuläret —
 * en <form> i en <form> är ogiltig HTML och submit:ar fel formulär.
 */
export function NewClientDialog({ onCreated, onClose }: Props) {
  const [form, setForm] = useState<ContactForm>(EMPTY_CONTACT_FORM);
  const utils = trpc.useUtils();
  const createContact = trpc.contacts.create.useMutation({
    onSuccess: (contact) => {
      void utils.contacts.list.invalidate();
      onCreated({ id: contact.id, name: contact.name });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createContact.mutate(form as Parameters<typeof createContact.mutate>[0]);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Ny klient"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
      <div className="w-full max-w-2xl">
        <NewContactForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          onCancel={onClose}
          isPending={createContact.isPending}
          error={createContact.error}
          title="Ny klient"
        />
      </div>
    </div>
  );
}
