"use client";

/**
 * Dagsbläddring (#2095): en pil bakåt och en framåt runt dagsvalet, ett steg
 * om en kalenderdag, vecka eller månad i taget från den valda dagen (#2111).
 * Stegen räknas med `stepDay` (ren kalenderräkning, #1677), utan gräns åt
 * något håll.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { stepDay, type DayStepUnit } from "@/lib/shared/calendar-periods";

/** Props för {@link DayStepper}. */
export interface DayStepperProps {
  /** Den valda dagen, "YYYY-MM-DD"; tom (ett tömt datumfält) stänger av pilarna. */
  ymd: string;
  /** Anropas med dagen före eller efter `ymd`. */
  onChange: (day: string) => void;
  /** Dagsvalet som står mellan pilarna (knappar, datumfält). */
  children: ReactNode;
  /** Hur långt ett klick stegar: en dag (förval), en vecka eller en månad. */
  unit?: DayStepUnit;
}

/** Pilarnas namn per steg: bakåt och framåt. */
const STEP_LABELS: Readonly<Record<DayStepUnit, readonly [string, string]>> = {
  day: ["Föregående dag", "Nästa dag"],
  week: ["Föregående vecka", "Nästa vecka"],
  month: ["Föregående månad", "Nästa månad"],
};

const ARROW_CLASS = "rounded-md border border-gray-200 p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-50";

/** Pilen **‹** eller **›**. */
function StepButton({ label, disabled, onClick, children }: {
  label: string; disabled: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={ARROW_CLASS}>
      {children}
    </button>
  );
}

/** **‹** `children` **›** — stegar den valda dagen ett `unit` bakåt eller framåt. */
export function DayStepper({ ymd, onChange, children, unit = "day" }: DayStepperProps) {
  const empty = ymd === "";
  const [prevLabel, nextLabel] = STEP_LABELS[unit];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StepButton label={prevLabel} disabled={empty} onClick={() => onChange(stepDay(ymd, unit, -1))}>
        <ChevronLeft size={16} aria-hidden="true" />
      </StepButton>
      {children}
      <StepButton label={nextLabel} disabled={empty} onClick={() => onChange(stepDay(ymd, unit, 1))}>
        <ChevronRight size={16} aria-hidden="true" />
      </StepButton>
    </div>
  );
}
