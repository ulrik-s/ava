"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { labelForContactType } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import { NewClientDialog, type PickedClient } from "./new-client-dialog";

interface Props {
  onPick: (client: PickedClient) => void;
  onClose: () => void;
}

interface Hit {
  id: string;
  name: string;
  contactType: string;
  personalNumber?: string | null;
  orgNumber?: string | null;
}

/**
 * "Välj klient…" (#1128): sök bland byråns kontakter som i jävskontrollen —
 * förnamn, efternamn, person-/orgnummer, var för sig eller tillsammans. En
 * dropdown fungerar inte när byrån har många klienter. Hittar man inte
 * klienten skapar man den härifrån ("Ny klient…").
 */
export function ClientPickerDialog({ onPick, onClose }: Props) {
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  if (creating) {
    return <NewClientDialog initialName={term.trim()} onCreated={onPick} onClose={() => setCreating(false)} />;
  }
  return (
    <Modal open title="Välj klient" onClose={onClose} widthClass="max-w-2xl">
      <label htmlFor="client-search" className="sr-only">Sök klient</label>
      <input id="client-search" type="search" autoFocus value={term} onChange={(e) => setTerm(e.target.value)}
        placeholder="Namn, personnummer eller organisationsnummer"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <ClientHits term={term} onPick={onPick} />
      <div className="mt-4 flex justify-between gap-2">
        <button type="button" onClick={() => setCreating(true)}
          className="px-4 py-2 text-sm font-medium text-blue-600 hover:underline">
          + Ny klient…
        </button>
        <button type="button" onClick={onClose}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Avbryt
        </button>
      </div>
    </Modal>
  );
}

/** Träfflistan — bäst först. Tom sökning visar en ledtråd i st.f. alla kontakter. */
function ClientHits({ term, onPick }: { term: string; onPick: (c: PickedClient) => void }) {
  const trimmed = term.trim();
  const search = trpc.contacts.search.useQuery({ term: trimmed }, { enabled: trimmed.length > 0 });
  if (trimmed.length === 0) return <p className="mt-3 text-sm text-gray-500">Skriv för att söka.</p>;
  const hits = (search.data?.contacts ?? []) as Hit[];
  if (search.isLoading) return <p className="mt-3 text-sm text-gray-500">Söker…</p>;
  if (hits.length === 0) return <p className="mt-3 text-sm text-gray-500">Ingen träff — skapa klienten med &quot;Ny klient…&quot;.</p>;
  return (
    <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-gray-100 rounded border border-gray-200" aria-label="Träffar">
      {hits.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onPick({ id: c.id, name: c.name })}
            className="w-full text-left px-3 py-2 hover:bg-blue-50 flex justify-between gap-3">
            <span className="text-sm font-medium text-gray-900">{c.name}</span>
            <span className="text-xs text-gray-500">
              {labelForContactType(c.contactType)}{c.personalNumber || c.orgNumber ? ` · ${c.personalNumber || c.orgNumber}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
