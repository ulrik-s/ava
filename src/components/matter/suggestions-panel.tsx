"use client";

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import type { MatterId } from "@/lib/shared/schemas/ids";
import { SuggestionRow, type SuggestionGroup } from "./_suggestion-row";

interface SuggestionsPanelProps {
  matterId: MatterId;
}

export function SuggestionsPanel({ matterId }: SuggestionsPanelProps) {
  const utils = trpc.useUtils();
  const groups = trpc.document.pendingSuggestionsGrouped.useQuery({ matterId });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const invalidateAll = () => {
    void utils.document.pendingSuggestionsGrouped.invalidate({ matterId });
    void utils.document.pendingSuggestions.invalidate({ matterId });
    void utils.matter.getById.invalidate({ id: matterId });
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
  const list = (groups.data ?? []) as SuggestionGroup[];
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
        {list.map((g) => (
          <SuggestionRow
            key={g.key}
            group={g}
            isBusy={busyKey === g.key}
            onAccept={() => {
              setBusyKey(g.key);
              acceptGroup.mutate({ suggestionIds: g.suggestionIds });
            }}
            onReject={() => {
              setBusyKey(g.key);
              rejectGroup.mutate({ suggestionIds: g.suggestionIds });
            }}
          />
        ))}
      </div>
    </div>
  );
}
