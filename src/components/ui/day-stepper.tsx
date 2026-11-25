"use client";

/**
 * Dagsbläddring (#2095): en pil bakåt och en framåt runt dagsvalet, ett steg
 * om en kalenderdag i taget från den valda dagen. Stegen räknas med `addDays`
 * (ren kalenderräkning, #1677), utan gräns åt något håll.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { addDays } from "@/lib/shared/stockholm-time";

/** Props för {@link DayStepper}. */
export interface DayStepperProps {
  /** Den valda dagen, "YYYY-MM-DD"; tom (ett tömt datumfält) stänger av pilarna. */
  ymd: string;
  /** Anropas med dagen före eller efter `ymd`. */
  onChange: (day: string) => void;
  /** Dagsvalet som står mellan pilarna (knappar, datumfält). */
  children: ReactNode;
}

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

/** **‹** `children` **›** — stegar den valda dagen en dag bakåt eller framåt. */
export function DayStepper({ ymd, onChange, children }: DayStepperProps) {
  const empty = ymd === "";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StepButton label="Föregående dag" disabled={empty} onClick={() => onChange(addDays(ymd, -1))}>
        <ChevronLeft size={16} aria-hidden="true" />
      </StepButton>
      {children}
      <StepButton label="Nästa dag" disabled={empty} onClick={() => onChange(addDays(ymd, 1))}>
        <ChevronRight size={16} aria-hidden="true" />
      </StepButton>
    </div>
  );
}
