"use client";

/**
 * `StandardAtgarderSection` (#956) — byråns standardåtgärder: åtgärder som
 * förekommer i varje ärende och ska registreras med SAMMA beskrivning och SAMMA
 * tidsåtgång av alla på byrån, t.ex. "Inledande åtgärder och genomgång av
 * handlingar" 30 min.
 *
 * Listan redigeras som en enhet (samma mönster som dokument-etiketterna, #621)
 * och sparas via `organization.updateSettings`. Tidsåtgången är byråns
 * HUVUDREGEL — juristen kan avvika per tidspost, annars håller den inte om
 * domstolen frågar.
 */

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { formatMinutes } from "@/lib/client/utils";
import { TIME_ENTRY_KIND_LABELS, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import {
  STANDARD_ATGARD_STAGE_LABELS, type StandardAtgard, type StandardAtgardStage,
} from "@/lib/shared/standard-atgard";

const STAGE_OPTIONS = Object.entries(STANDARD_ATGARD_STAGE_LABELS) as Array<[StandardAtgardStage, string]>;
const KIND_OPTIONS = Object.entries(TIME_ENTRY_KIND_LABELS) as Array<[TimeEntryKind, string]>;

interface Draft {
  description: string;
  minutes: number;
  stage: StandardAtgardStage;
  kind: TimeEntryKind;
}

const emptyDraft = (): Draft => ({ description: "", minutes: 30, stage: "ANY", kind: "ARBETE" });

/** Stabilt id ur beskrivningen (slug) — läsbart i git-diffen, till skillnad från
 *  en uuid. Kollisioner bryts med ett löpnummer mot befintliga id:n. */
function slugId(description: string, taken: ReadonlySet<string>): string {
  const base = description.toLowerCase()
    .replace(/[åä]/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40) || "atgard";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function StandardAtgarderSection() {
  const utils = trpc.useUtils();
  const settings = trpc.organization.getSettings.useQuery();
  const update = trpc.organization.updateSettings.useMutation({
    onSuccess: () => void utils.organization.getSettings.invalidate(),
  });

  const list = settings.data?.standardAtgarder ?? [];
  const save = (next: StandardAtgard[]): void => update.mutate({ standardAtgarder: next });

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <p className="text-sm text-gray-500 mb-3">
        Åtgärder som förekommer i varje ärende. De föreslås när tid registreras och
        fyller beskrivning och tidsåtgång, så alla på byrån redovisar dem likadant.
        Tiden är en <strong>huvudregel</strong> — handläggaren kan justera den i det
        enskilda ärendet.
      </p>

      <AtgardTable list={list} isPending={update.isPending} onSave={save} />
      <AddAtgardForm list={list} isPending={update.isPending} onSave={save} />

      {update.error && (
        <p className="mt-2 text-xs text-red-600">Kunde inte spara standardåtgärderna: {update.error.message}</p>
      )}
      <p className="mt-3 text-xs text-gray-400">
        Skedet styr var åtgärden föreslås. <em>Avställ</em> behåller åtgärden för
        historikens skull men slutar föreslå den — använd det i stället för att ta
        bort en åtgärd som redan använts i ärenden.
      </p>
    </div>
  );
}

interface ListProps {
  list: StandardAtgard[];
  isPending: boolean;
  onSave: (next: StandardAtgard[]) => void;
}

function AtgardTable({ list, isPending, onSave }: ListProps) {
  if (list.length === 0) {
    return <p className="text-xs text-gray-400 italic mb-3">Inga standardåtgärder ännu.</p>;
  }
  return (
    <table className="w-full text-sm mb-4">
      <thead>
        <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
          <th className="py-1.5">Beskrivning</th>
          <th className="py-1.5 text-right">Tid</th>
          <th className="py-1.5">Skede</th>
          <th className="py-1.5">Kategori</th>
          <th className="py-1.5"></th>
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr key={a.id} className={`border-b border-gray-100 ${a.active ? "" : "text-gray-400"}`}>
            <td className="py-1.5">{a.description}</td>
            <td className="py-1.5 text-right font-mono">{formatMinutes(a.minutes)}</td>
            <td className="py-1.5 text-xs">{STANDARD_ATGARD_STAGE_LABELS[a.stage]}</td>
            <td className="py-1.5 text-xs">{TIME_ENTRY_KIND_LABELS[a.kind]}</td>
            <td className="py-1.5 text-right whitespace-nowrap">
              <button type="button" disabled={isPending}
                onClick={() => onSave(list.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)))}
                aria-label={`${a.active ? "Avställ" : "Aktivera"} ${a.description}`}
                className="text-xs text-gray-500 hover:text-blue-600 hover:underline mr-3 disabled:opacity-50">
                {a.active ? "Avställ" : "Aktivera"}
              </button>
              <button type="button" disabled={isPending}
                onClick={() => onSave(list.filter((x) => x.id !== a.id))}
                aria-label={`Ta bort ${a.description}`}
                className="text-xs text-red-500 hover:underline disabled:opacity-50">
                Ta bort
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AddAtgardForm({ list, isPending, onSave }: ListProps) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const description = draft.description.trim();

  const add = (): void => {
    if (!description || draft.minutes <= 0) return;
    const id = slugId(description, new Set(list.map((a) => a.id)));
    onSave([...list, { ...draft, description, id, paymentMethods: [], billable: true, active: true }]);
    setDraft(emptyDraft());
  };

  return (
    <div className="grid grid-cols-12 gap-2 items-end">
      <div className="col-span-5">
        <label htmlFor="sa-desc" className="block text-xs text-gray-500 mb-1">Beskrivning</label>
        <input id="sa-desc" type="text" value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Inledande åtgärder och genomgång av handlingar"
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
      <div className="col-span-2">
        <label htmlFor="sa-min" className="block text-xs text-gray-500 mb-1">Minuter</label>
        <input id="sa-min" type="number" min={1} step={5} value={draft.minutes}
          onChange={(e) => setDraft({ ...draft, minutes: Number.parseInt(e.target.value, 10) || 0 })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
      </div>
      <div className="col-span-2">
        <label htmlFor="sa-stage" className="block text-xs text-gray-500 mb-1">Skede</label>
        <select id="sa-stage" value={draft.stage}
          onChange={(e) => setDraft({ ...draft, stage: e.target.value as StandardAtgardStage })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
          {STAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label htmlFor="sa-kind" className="block text-xs text-gray-500 mb-1">Kategori</label>
        <select id="sa-kind" value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as TimeEntryKind })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
          {KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="col-span-1">
        <button type="button" onClick={add} disabled={isPending || !description || draft.minutes <= 0}
          className="w-full px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          Lägg till
        </button>
      </div>
    </div>
  );
}
