"use client";

/**
 * Rapporters filterrad: period, fältet Advokat och exporten. Utbruten ur
 * `page.tsx` (#2116), som `_ar-summary.tsx`. Alternativen i Advokat kommer ur
 * `subjectChoices`: bara sig själv, eller för en Admin **Alla** och alla.
 */

import { useId } from "react";
import { FIRM_CHOICE, type SubjectChoice, type SubjectValue } from "@/lib/shared/report-subject";
import { asId } from "@/lib/shared/schemas/ids";

/** Fältets värde ur `<select>`: **Alla** eller en användares id. */
export function parseSubjectValue(value: string): SubjectValue {
  return value === FIRM_CHOICE ? FIRM_CHOICE : asId<"UserId">(value);
}

interface FilterBarProps {
  from: string;
  to: string;
  /** Valt alternativ; tomt tills rollen är känd. */
  value: SubjectValue | "";
  /** `null` tills rollen och användarna är kända: då visas "Laddar...". */
  choices: readonly SubjectChoice[] | null;
  canExport: boolean;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onSubject: (v: SubjectValue) => void;
  onExport: () => void;
}

/** Period, Advokat och Exportera Excel. */
export function ReportsFilterBar({ from, to, value, choices, canExport, onFrom, onTo, onSubject, onExport }: FilterBarProps) {
  const fromId = useId();
  const toId = useId();
  const lawyerId = useId();
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-end">
        <div>
          <label htmlFor={fromId} className="block text-sm text-gray-500 mb-1">Från</label>
          <input id={fromId} type="date" value={from} onChange={(e) => onFrom(e.target.value)}
            className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor={toId} className="block text-sm text-gray-500 mb-1">Till</label>
          <input id={toId} type="date" value={to} onChange={(e) => onTo(e.target.value)}
            className="w-full sm:w-auto rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="flex-1">
          <label htmlFor={lawyerId} className="block text-sm text-gray-500 mb-1">Advokat</label>
          <select id={lawyerId} value={value} onChange={(e) => onSubject(parseSubjectValue(e.target.value))}
            className="w-full sm:w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {!choices && <option value="">Laddar...</option>}
            {choices?.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <button onClick={onExport} disabled={!canExport} title="Laddar ner rapporten som en CSV-fil som öppnas i Excel"
          className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
          Exportera Excel
        </button>
      </div>
    </div>
  );
}
