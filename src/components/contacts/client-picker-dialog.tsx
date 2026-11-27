"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { labelForContactType } from "@/lib/client/labels";
import { trpc } from "@/lib/client/trpc";
import type { ContactType } from "@/lib/shared/schemas/enums";
import { NewClientDialog, type PickedClient } from "./new-client-dialog";

interface Props {
  onPick: (client: PickedClient) => void;
  onClose: () => void;
  /** Vad som väljs — "klient" (nytt ärende) eller "part" (ärendets parter, #1136, #1647). */
  noun?: string;
  /** Extra fält ovanför sökrutan, t.ex. roll i ärendet. */
  children?: React.ReactNode;
  /**
   * Sökrutans startvärde, t.ex. ärendets titel i Nytt ärende (#1644). Ändras
   * det medan dialogen är öppen fylls en tom sökruta i (#1645); egen text
   * skrivs aldrig över, och ett tomt värde rensar inget.
   */
  initialTerm?: string;
  /**
   * Bara kontakter av den här typen, t.ex. Domstol i kostnadsräkningen (#1891).
   * Då finns inget "+ Ny …": en ny kontakt härifrån blir inte av den typen.
   */
  contactType?: ContactType | undefined;
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
 * klienten skapar man den härifrån ("Ny klient…"). Samma dialog väljer
 * part i ett ärende (`noun="part"`, #1136).
 */
export function ClientPickerDialog({ onPick, onClose, noun = "klient", children, initialTerm = "", contactType }: Props) {
  const [term, setTerm] = useTermFrom(initialTerm);
  const [creating, setCreating] = useState(false);
  if (creating) {
    return <NewClientDialog noun={noun} initialName={term.trim()} onCreated={onPick} onClose={() => setCreating(false)} />;
  }
  return (
    <Modal open title={`Välj ${noun}`} onClose={onClose} widthClass="max-w-2xl">
      {children}
      <label htmlFor="client-search" className="sr-only">{`Sök ${noun}`}</label>
      <input id="client-search" type="search" autoFocus value={term} onChange={(e) => setTerm(e.target.value)}
        placeholder="Namn, personnummer eller organisationsnummer"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <ClientHits term={term} noun={noun} contactType={contactType} onPick={onPick} />
      <div className="mt-4 flex justify-between gap-2">
        {contactType ? <span /> : (
          <button type="button" onClick={() => setCreating(true)}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:underline">
            {`+ Ny ${noun}…`}
          </button>
        )}
        <button type="button" onClick={onClose}
          className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50">
          Avbryt
        </button>
      </div>
    </Modal>
  );
}

/**
 * Sökrutans state, som följer `initialTerm` när det ändras och rutan är tom
 * (#1645: rollen byts till Klient medan dialogen är öppen). Reacts mönster för
 * att justera state när en prop ändras: jämför med föregående värde under
 * render, utan effekt och utan att montera om dialogen.
 */
function useTermFrom(initialTerm: string): [string, (term: string) => void] {
  const [term, setTerm] = useState(initialTerm);
  const [prevInitial, setPrevInitial] = useState(initialTerm);
  if (initialTerm !== prevInitial) {
    setPrevInitial(initialTerm);
    if (initialTerm && !term.trim()) setTerm(initialTerm);
  }
  return [term, setTerm];
}

/** Texten när sökningen inte ger någon träff — med "Ny …" bara när den knappen finns. */
function noHitsText(noun: string, contactType: ContactType | undefined): string {
  return contactType ? "Ingen träff." : `Ingen träff — skapa ${noun}en med "Ny ${noun}…".`;
}

interface HitsProps {
  term: string;
  noun: string;
  contactType: ContactType | undefined;
  onPick: (c: PickedClient) => void;
}

/** Träfflistan — bäst först. Tom sökning visar en ledtråd i st.f. alla kontakter. */
function ClientHits({ term, noun, contactType, onPick }: HitsProps) {
  const trimmed = term.trim();
  const search = trpc.contacts.search.useQuery({ term: trimmed, ...(contactType ? { contactType } : {}) }, { enabled: trimmed.length > 0 });
  if (trimmed.length === 0) return <p className="mt-3 text-sm text-gray-500">Skriv för att söka.</p>;
  const hits = (search.data?.contacts ?? []) as Hit[];
  if (search.isLoading) return <p className="mt-3 text-sm text-gray-500">Söker…</p>;
  if (hits.length === 0) return <p className="mt-3 text-sm text-gray-500">{noHitsText(noun, contactType)}</p>;
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
