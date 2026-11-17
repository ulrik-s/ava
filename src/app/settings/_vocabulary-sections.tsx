"use client";

/**
 * Byråns ordlistor i inställningarna — en lista strängar som sparas hel via
 * `organization.updateSettings`:
 * - `DocumentKindsSection` (ADR 0038) — byråns egna dokumenttyper, utöver de
 *   inbyggda. Valen i "Redigera uppgifter…" och det AI:n föreslår bland.
 * - `MatterTypesSection` — ärendetyperna man väljer bland när ett ärende läggs upp.
 */

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { KIND_LABELS, KNOWN_KINDS } from "@/lib/shared/document-kind";

type VocabularyField = "documentKinds" | "matterTypes";

interface VocabularySectionProps {
  field: VocabularyField;
  intro: string;
  empty: string;
  placeholder: string;
}

export function DocumentKindsSection() {
  return (
    <VocabularySection
      field="documentKinds"
      intro={`Byråns egna dokumenttyper. De inbyggda finns alltid: ${KNOWN_KINDS.map((k) => KIND_LABELS[k]).join(", ")}. Ett dokument kan ha flera typer; AI:n föreslår bland dessa och handläggarna väljer i "Redigera uppgifter…".`}
      empty="Inga egna dokumenttyper ännu."
      placeholder="Ny dokumenttyp, t.ex. Sekretessbeslut"
    />
  );
}

export function MatterTypesSection() {
  return (
    <VocabularySection
      field="matterTypes"
      intro="Typerna man väljer bland när ett ärende läggs upp. Tom lista = fritext."
      empty="Inga ärendetyper ännu."
      placeholder="Ny ärendetyp, t.ex. Bodelning"
    />
  );
}

function VocabularySection({ field, intro, empty, placeholder }: VocabularySectionProps) {
  const utils = trpc.useUtils();
  const settings = trpc.organization.getSettings.useQuery();
  const update = trpc.organization.updateSettings.useMutation({
    onSuccess: () => void utils.organization.getSettings.invalidate(),
  });
  const [draft, setDraft] = useState("");

  const tags = settings.data?.[field] ?? [];
  const save = (next: string[]): void => update.mutate({ [field]: next });

  const add = (): void => {
    const t = draft.trim();
    if (!t || tags.includes(t)) { setDraft(""); return; }
    save([...tags, t]);
    setDraft("");
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <p className="text-sm text-gray-500 mb-3">{intro}</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 && <span className="text-xs text-gray-400 italic">{empty}</span>}
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
          placeholder={placeholder}
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
