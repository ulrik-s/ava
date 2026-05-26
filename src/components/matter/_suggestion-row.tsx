"use client";

import { matterRoleLabels, contactTypeLabels } from "@/lib/client/labels";

export interface SuggestionGroup {
  key: string;
  name: string;
  contactType: string;
  roles: string[];
  personalNumber: string | null;
  orgNumber: string | null;
  email: string | null;
  phone: string | null;
  notes: string[];
  documents: Array<{ title: string | null; fileName: string }>;
  suggestionIds: string[];
}

interface Props {
  group: SuggestionGroup;
  isBusy: boolean;
  onAccept: () => void;
  onReject: () => void;
}

export function SuggestionRow({ group: g, isBusy, onAccept, onReject }: Props) {
  return (
    <div className="px-6 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900">{g.name}</span>
          <span className="inline-block rounded-full bg-gray-200 text-gray-700 px-2 py-0.5 text-[10px]">
            {contactTypeLabels[g.contactType as keyof typeof contactTypeLabels] ?? g.contactType}
          </span>
          {g.roles.map((role) => (
            <span
              key={role}
              className="inline-block rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px] font-medium"
            >
              {matterRoleLabels[role as keyof typeof matterRoleLabels] ?? role}
            </span>
          ))}
        </div>
        <SuggestionDetails group={g} />
      </div>
      <div className="flex items-start gap-2 flex-shrink-0">
        <button
          disabled={isBusy}
          onClick={onAccept}
          className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
          title={
            g.roles.length > 1
              ? `Skapar/återanvänder kontakt och länkar ${g.roles.length} roller till ärendet`
              : undefined
          }
        >
          Godkänn{g.roles.length > 1 ? ` (${g.roles.length} roller)` : ""}
        </button>
        <button
          disabled={isBusy}
          onClick={onReject}
          className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Avvisa
        </button>
      </div>
    </div>
  );
}

function SuggestionDetails({ group: g }: { group: SuggestionGroup }) {
  return (
    <div className="text-xs text-gray-600 mt-1 space-y-0.5">
      <IdLine personalNumber={g.personalNumber} orgNumber={g.orgNumber} />
      <ContactLine email={g.email} phone={g.phone} />
      {g.notes.length > 0 && (
        <ul className="italic text-gray-500 list-disc list-inside">
          {g.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <div className="text-gray-400">
        Från: {g.documents.map((d) => d.title || d.fileName).join(", ")}
      </div>
    </div>
  );
}

function IdLine({ personalNumber, orgNumber }: { personalNumber: string | null; orgNumber: string | null }) {
  if (!personalNumber && !orgNumber) return null;
  return (
    <div>
      {personalNumber && <span>Pnr: {personalNumber}</span>}
      {personalNumber && orgNumber && <span> · </span>}
      {orgNumber && <span>Orgnr: {orgNumber}</span>}
    </div>
  );
}

function ContactLine({ email, phone }: { email: string | null; phone: string | null }) {
  if (!email && !phone) return null;
  return (
    <div>
      {email && <span>{email}</span>}
      {email && phone && <span> · </span>}
      {phone && <span>{phone}</span>}
    </div>
  );
}
