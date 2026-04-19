"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { matterRoleLabels, contactTypeLabels } from "@/lib/labels";

interface SuggestionsPanelProps {
  matterId: string;
}

export function SuggestionsPanel({ matterId }: SuggestionsPanelProps) {
  const utils = trpc.useUtils();
  const groups = trpc.document.pendingSuggestionsGrouped.useQuery({ matterId });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const invalidateAll = () => {
    utils.document.pendingSuggestionsGrouped.invalidate({ matterId });
    utils.document.pendingSuggestions.invalidate({ matterId });
    utils.matter.getById.invalidate({ id: matterId });
  };

  const acceptGroup = trpc.document.acceptSuggestionGroup.useMutation({
    onSuccess: invalidateAll,
    onSettled: () => setBusyKey(null),
  });
  const rejectGroup = trpc.document.rejectSuggestionGroup.useMutation({
    onSuccess: invalidateAll,
    onSettled: () => setBusyKey(null),
  });

  if (groups.isLoading) return null;
  const list = groups.data ?? [];
  if (list.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg lg:col-span-2">
      <div className="px-6 py-4 border-b border-amber-200">
        <h2 className="font-semibold text-amber-900 flex items-center gap-2">
          🧠 Föreslagna kontakter från dokumentanalys
          <span className="text-xs font-normal text-amber-700">({list.length})</span>
        </h2>
        <p className="text-xs text-amber-800 mt-1">
          AI har identifierat möjliga parter i uppladdade dokument. Samma person/entitet
          visas en gång även om hen förekommer i flera dokument eller roller.
        </p>
      </div>
      <div className="divide-y divide-amber-200">
        {list.map((g) => {
          const isBusy = busyKey === g.key;
          return (
            <div key={g.key} className="px-6 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
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
                <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                  {(g.personalNumber || g.orgNumber) && (
                    <div>
                      {g.personalNumber && <span>Pnr: {g.personalNumber}</span>}
                      {g.personalNumber && g.orgNumber && <span> · </span>}
                      {g.orgNumber && <span>Orgnr: {g.orgNumber}</span>}
                    </div>
                  )}
                  {(g.email || g.phone) && (
                    <div>
                      {g.email && <span>{g.email}</span>}
                      {g.email && g.phone && <span> · </span>}
                      {g.phone && <span>{g.phone}</span>}
                    </div>
                  )}
                  {g.notes.length > 0 && (
                    <ul className="italic text-gray-500 list-disc list-inside">
                      {g.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  )}
                  <div className="text-gray-400">
                    Från: {g.documents.map((d) => d.title || d.fileName).join(", ")}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 flex-shrink-0">
                <button
                  disabled={isBusy}
                  onClick={() => {
                    setBusyKey(g.key);
                    acceptGroup.mutate({ suggestionIds: g.suggestionIds });
                  }}
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
                  onClick={() => {
                    setBusyKey(g.key);
                    rejectGroup.mutate({ suggestionIds: g.suggestionIds });
                  }}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Avvisa
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
