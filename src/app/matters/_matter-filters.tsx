"use client";

/**
 * Ärendelistans sökruta + status- och medarbetarfilter (utbrutet ur
 * `page.tsx`). Sökrutan filtrerar live medan man skriver; Sök eller Enter
 * kör dessutom jävskontrollen (#1642).
 */

import type { MatterStatus } from "@/lib/shared/schemas/enums";

export type StatusFilter = MatterStatus | "";
export type NamedOption = { id: string; name: string };

interface MatterFiltersProps {
  search: string;
  status: StatusFilter;
  employeeId: string;
  employeesData: { users: NamedOption[] } | undefined;
  onSearch: (v: string) => void;
  onStatus: (v: StatusFilter) => void;
  onEmployee: (v: string) => void;
  /** Sök/Enter: kör jävskontrollen på sökrutans text (#1642). */
  onSubmit: () => void;
  /** Jävskontrollen pågår. */
  searching: boolean;
}

export function MatterFilters({ search, status, employeeId, employeesData, onSearch, onStatus, onEmployee, onSubmit, searching }: MatterFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-4">
      <form role="search" className="flex flex-1 sm:max-w-md gap-2"
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <input type="text" placeholder="Sök ärenden..." value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
        <button type="submit" disabled={searching || !search.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
          {searching ? "Söker..." : "Sök"}
        </button>
      </form>
      <select value={status}
        onChange={(e) => onStatus(e.target.value as StatusFilter)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Alla statusar</option>
        <option value="ACTIVE">Aktiva</option>
        <option value="CLOSED">Stängda</option>
        <option value="ARCHIVED">Arkiverade</option>
      </select>
      <select value={employeeId}
        onChange={(e) => onEmployee(e.target.value)}
        title="Visa ärenden som medarbetaren har arbetat på (har tidsposter på)"
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
        <option value="">Alla medarbetare</option>
        {employeesData?.users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
    </div>
  );
}
