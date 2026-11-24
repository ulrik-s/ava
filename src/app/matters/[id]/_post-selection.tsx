"use client";

/**
 * Fakturans postlista (#734, #1888): ofakturerade tidsposter och utlägg med
 * kryssruta, datum, beskrivning och belopp, och ett datumintervall (Från och
 * med / Till och med) som markerar posterna inom intervallet. Utbruten ur
 * `_billing-dialog.tsx` så att kostnadsräkningens dialoger kan använda samma
 * lista.
 *
 * En orörd lista skickar inga id:n — servern tar då allt ofryst, som förut.
 */

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/client/utils";
import { postsInDateRange } from "@/lib/shared/billing-post-selection";
import { stockholmDay } from "@/lib/shared/stockholm-time";

/** Det ur fakturaförslaget (`billingRun.proposal`) som postlistan läser. */
export interface ProposalPosts {
  timeEntries: ReadonlyArray<{ id: string; description: string; valueOre: number; billable: boolean; date: Date | string }>;
  expenses: ReadonlyArray<{ id: string; description: string; amount: number; billable: boolean; date: Date | string }>;
}

interface PostRow { id: string; label: string; valueOre: number; date: Date | string }

/** Valda poster som id-listor till createFinal, eller inget alls (= allt ofryst). */
export type SelectedPostIds = { timeEntryIds: string[]; expenseIds: string[] } | Record<string, never>;

/** Postlistans val: raderna, de markerade nycklarna och intervallet. */
export interface PostSelection {
  rows: PostRow[];
  selected: string[];
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  toggle: (key: string, checked: boolean) => void;
  /** Det som skickas till servern. */
  ids: SelectedPostIds;
}

/**
 * Valet för postlistan. `null` = orörd (allt markerat, inga id:n skickas). Ett
 * ändrat intervall markerar posterna inom det och avmarkerar övriga; två tomma
 * fält markerar allt. Kryss efteråt står kvar tills intervallet ändras igen.
 */
export function usePostSelection(proposal: ProposalPosts | undefined): PostSelection {
  const rows = useMemo(() => unbilledRows(proposal), [proposal]);
  const allKeys = rows.map((p) => p.id);
  const [posts, setPosts] = useState<string[] | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const applyRange = (from: string, to: string): void => {
    setRange({ from, to });
    setPosts(from === "" && to === "" ? null : postsInDateRange(rows, from, to).map((p) => p.id));
  };
  const toggle = (key: string, checked: boolean): void =>
    setPosts((prev) => { const base = prev ?? allKeys; return checked ? [...base, key] : base.filter((k) => k !== key); });
  return {
    rows, selected: posts ?? allKeys, from: range.from, to: range.to,
    setFrom: (v) => applyRange(v, range.to), setTo: (v) => applyRange(range.from, v),
    toggle, ids: splitSelectedPosts(posts),
  };
}

/** Postlistan med datumintervall, rubrik "(x/y valda)" och "Valt värde". */
export function UnbilledPosts({ selection, loading }: { selection: PostSelection; loading: boolean }) {
  if (loading) return <p className="text-xs text-gray-500">Laddar ofakturerade poster…</p>;
  const { rows, selected } = selection;
  if (rows.length === 0) return <p className="text-xs text-gray-500">Inga ofakturerade poster i ärendet.</p>;
  const chosenOre = rows.filter((p) => selected.includes(p.id)).reduce((s, p) => s + p.valueOre, 0);
  return (
    <div>
      <div className="block text-xs text-gray-500 mb-1">{`Poster att fakturera (${selected.length}/${rows.length} valda)`}</div>
      <DateRange selection={selection} />
      <div className="space-y-1 max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
        {rows.map((p) => (
          <label key={p.id} className="flex items-center justify-between gap-2 text-xs cursor-pointer">
            <span className="flex items-center gap-2 min-w-0">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => selection.toggle(p.id, e.target.checked)} />
              <span className="font-mono text-gray-500">{stockholmDay(new Date(p.date))}</span>
              <span className="truncate text-gray-700">{p.label}</span>
            </span>
            <span className="font-mono text-gray-900">{formatCurrency(p.valueOre)}</span>
          </label>
        ))}
        <div className="flex items-center justify-between border-t border-gray-300 pt-1 text-xs font-semibold">
          <span>Valt värde</span>
          <span className="font-mono">{formatCurrency(chosenOre)}</span>
        </div>
      </div>
    </div>
  );
}

function DateRange({ selection }: { selection: PostSelection }) {
  return (
    <div className="mb-1.5 grid grid-cols-2 gap-2">
      <DateField label="Från och med" value={selection.from} onChange={selection.setFrom} />
      <DateField label="Till och med" value={selection.to} onChange={selection.setTo} />
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[11px] text-gray-500">
      {label}
      <input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
    </label>
  );
}

/** Dela upp valda post-nycklar (`te-…`/`ex-…`) i id-listor för createFinal. `null` → utelämna (allt). */
function splitSelectedPosts(posts: string[] | null): SelectedPostIds {
  if (posts === null) return {};
  return {
    timeEntryIds: posts.filter((k) => k.startsWith("te-")).map((k) => k.slice(3)),
    expenseIds: posts.filter((k) => k.startsWith("ex-")).map((k) => k.slice(3)),
  };
}

function unbilledRows(proposal: ProposalPosts | undefined): PostRow[] {
  if (!proposal) return [];
  const time = proposal.timeEntries
    .filter((t) => t.billable)
    .map((t) => ({ id: `te-${t.id}`, label: t.description || "Tidspost", valueOre: t.valueOre, date: t.date }));
  const exp = proposal.expenses
    .filter((e) => e.billable)
    .map((e) => ({ id: `ex-${e.id}`, label: e.description || "Utlägg", valueOre: e.amount, date: e.date }));
  return [...time, ...exp];
}
