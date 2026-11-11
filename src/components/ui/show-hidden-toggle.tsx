"use client";

/**
 * Visa/dölj-knapp för rader som är dolda från början (#1522), efter förebilden
 * "Visa avslutade (N)" i feedbacklistan. Valet är lokalt och sparas inte:
 * varje gång listan öppnas är raderna dolda.
 */

import { useState } from "react";
import { partitionHidden } from "@/lib/shared/hidden-billing-rows";

interface ToggleProps {
  /** Antal dolda rader; knappen visas bara när det finns några. */
  hiddenCount: number;
  /** Om de dolda raderna visas just nu. */
  shown: boolean;
  onToggle: () => void;
}

/** Knappen "Visa annullerade (N)" / "Dölj annullerade". */
export function ShowHiddenToggle({ hiddenCount, shown, onToggle }: ToggleProps) {
  if (hiddenCount === 0) return null;
  return (
    <button type="button" onClick={onToggle} aria-pressed={shown} className="text-xs text-gray-600 hover:text-gray-900">
      {shown ? "Dölj annullerade" : `Visa annullerade (${hiddenCount})`}
    </button>
  );
}

/** Raderna som ska visas, och knappens props, för en lista med dolda rader. */
export interface HiddenRows<T> {
  rows: T[];
  toggle: ToggleProps;
}

/** Filtrerar bort dolda rader tills användaren väljer att visa dem. */
export function useHiddenRows<T>(rows: readonly T[], isHidden: (row: T) => boolean): HiddenRows<T> {
  const [shown, setShown] = useState(false);
  const { visible, hidden } = partitionHidden(rows, isHidden);
  return {
    rows: shown ? [...rows] : visible,
    toggle: { hiddenCount: hidden.length, shown, onToggle: () => setShown((s) => !s) },
  };
}
