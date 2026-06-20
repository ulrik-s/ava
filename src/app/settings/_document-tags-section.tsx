"use client";

/**
 * `DocumentTagsSection` (#621) — byråns vokabulär av giltiga dokument-etiketter.
 * Dokument får bara bära taggar ur denna lista (LLM-förslag + manuell
 * redigering valideras mot den). Admin lägger till/tar bort etiketter här;
 * hela listan sparas via `organization.updateSettings`.
 */

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";

export function DocumentTagsSection() {
  const utils = trpc.useUtils();
  const settings = trpc.organization.getSettings.useQuery();
  const update = trpc.organization.updateSettings.useMutation({
    onSuccess: () => void utils.organization.getSettings.invalidate(),
  });
  const [draft, setDraft] = useState("");

  const tags = settings.data?.documentTags ?? [];
  const save = (next: string[]): void => update.mutate({ documentTags: next });

  const add = (): void => {
    const t = draft.trim();
    if (!t || tags.includes(t)) { setDraft(""); return; }
    save([...tags, t]);
    setDraft("");
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <p className="text-sm text-gray-500 mb-3">
        Etiketter som dokument kan taggas med. AI:n föreslår ur listan och
        handläggare kan komplettera per dokument — bara dessa värden är giltiga.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 && <span className="text-xs text-gray-400 italic">Inga etiketter ännu.</span>}
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            {tag}
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => save(tags.filter((t) => t !== tag))}
              aria-label={`Ta bort ${tag}`}
              className="text-blue-400 hover:text-blue-700 disabled:opacity-50 leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Ny etikett, t.ex. Sekretess"
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={add}
          disabled={update.isPending || !draft.trim()}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Lägg till
        </button>
      </div>
    </div>
  );
}
