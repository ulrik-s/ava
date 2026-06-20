"use client";

/**
 * `DocumentTags` (#621) — etikett-redigerare per dokument. Visar dokumentets
 * etiketter som chips (med ×) och en "+ etikett"-meny med byråns vokabulär
 * (de taggar som inte redan är satta). Användaren rättar enkelt LLM:ens
 * felklassning. Etiketter är metadata → `setTags` bumpar inte versionen (#619).
 *
 * Vokabulären hämtas via `organization.getSettings` (react-query dedupar
 * den delade nyckeln så raderna inte ger N nätverksanrop).
 */

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";

export function DocumentTags({
  documentId,
  matterId,
  tags,
}: {
  documentId: string;
  matterId: string;
  tags: readonly string[];
}) {
  const utils = trpc.useUtils();
  const vocabulary = trpc.organization.getSettings.useQuery().data?.documentTags ?? [];
  const setTags = trpc.document.setTags.useMutation({
    onSuccess: () => void utils.document.tree.invalidate({ matterId }),
  });

  const [adding, setAdding] = useState(false);
  const current = tags ?? [];
  const available = vocabulary.filter((t) => !current.includes(t));
  const apply = (next: string[]): void => setTags.mutate({ documentId, tags: next });

  if (current.length === 0 && available.length === 0) return null;

  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {current.map((tag) => (
        <TagChip key={tag} label={tag} disabled={setTags.isPending}
          onRemove={() => apply(current.filter((t) => t !== tag))} />
      ))}
      {available.length > 0 && (
        <div className="relative">
          <button
            type="button"
            disabled={setTags.isPending}
            onClick={() => setAdding((v) => !v)}
            className="text-[10px] px-1.5 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            + etikett
          </button>
          {adding && (
            <AddTagMenu
              options={available}
              onPick={(tag) => { setAdding(false); apply([...current, tag]); }}
              onClose={() => setAdding(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TagChip({ label, onRemove, disabled }: { label: string; onRemove: () => void; disabled: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
      {label}
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Ta bort etiketten ${label}`}
        className="text-blue-400 hover:text-blue-700 disabled:opacity-50 leading-none"
      >
        ×
      </button>
    </span>
  );
}

function AddTagMenu({ options, onPick, onClose }: { options: string[]; onPick: (tag: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute left-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded shadow-lg p-1 min-w-[10rem] max-h-48 overflow-y-auto">
        {options.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onPick(tag)}
            className="block w-full text-left px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 rounded"
          >
            {tag}
          </button>
        ))}
      </div>
    </>
  );
}
