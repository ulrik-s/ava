"use client";

/**
 * Kostnadsräkningens mottagare (#1891): domstol och målnummer, valda per
 * kostnadsräkning i båda dialogerna (brottmålsmodalen och rättshjälpens).
 * Förvalt är ärendets domstol och målnummer. En annan domstol (t.ex. högre
 * rätt vid ett överklagande) väljs bland byråns kontakter av typen Domstol,
 * och då är målnumret tomt tills det fylls i. Valet gäller bara dokumentet och
 * anteckningen: ärendets parter och målnummer ändras inte.
 */
import { useState } from "react";
import { ClientPickerDialog } from "@/components/contacts/client-picker-dialog";
import type { PickedClient } from "@/components/contacts/new-client-dialog";
import { asId, type ContactId } from "@/lib/shared/schemas/ids";

/** Domstolen till `createKostnadsrakning`: vald i dialogen, eller (utan id) ärendets. */
export interface KrCourtChoice {
  courtContactId?: ContactId;
}

/** Mottagarvalet i dialogen, med det dokumentet och servern ska få. */
export interface KrRecipient {
  /** Domstolens namn på dokumentet; saknas när ärendet saknar domstol och ingen valts. */
  courtName: string | undefined;
  /** Fältets text. */
  caseNumber: string;
  setCaseNumber: (v: string) => void;
  /** Målnumret till dokumentet: tomt fält ger ingen (rubriken utan "i mål"). */
  courtCaseNumber: string | undefined;
  court: KrCourtChoice;
  pick: (c: PickedClient) => void;
}

interface Court {
  id?: ContactId;
  name: string | undefined;
}

/** State för mottagarvalet, förvalt med ärendets domstol och målnummer. */
export function useKrRecipient(matterCourtName: string | undefined, matterCaseNumber: string | undefined): KrRecipient {
  const [court, setCourt] = useState<Court>({ name: matterCourtName });
  const [caseNumber, setCaseNumber] = useState(matterCaseNumber ?? "");
  const pick = (c: PickedClient): void => {
    setCourt({ id: asId<"ContactId">(c.id), name: c.name });
    setCaseNumber("");
  };
  const trimmed = caseNumber.trim();
  return {
    courtName: court.name, caseNumber, setCaseNumber, pick,
    courtCaseNumber: trimmed === "" ? undefined : trimmed,
    court: court.id ? { courtContactId: court.id } : {},
  };
}

/** Fälten Domstol (med Byt domstol…) och Målnummer. */
export function KrRecipientFields({ recipient }: { recipient: KrRecipient }) {
  const [picking, setPicking] = useState(false);
  return (
    <section aria-label="Mottagare" className="space-y-2 text-sm">
      <div>
        <span className="block text-xs text-gray-600 mb-1">Domstol</span>
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-900" data-testid="kr-court-name">{recipient.courtName ?? "Ingen domstol vald"}</span>
          <button type="button" onClick={() => setPicking(true)} className="text-blue-700 hover:underline">Byt domstol…</button>
        </div>
      </div>
      <label className="block">
        <span className="block text-xs text-gray-600 mb-1">Målnummer</span>
        <input type="text" value={recipient.caseNumber} onChange={(e) => recipient.setCaseNumber(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2" />
      </label>
      {picking && (
        <ClientPickerDialog noun="domstol" contactType="COURT" onClose={() => setPicking(false)}
          onPick={(c) => { recipient.pick(c); setPicking(false); }} />
      )}
    </section>
  );
}
