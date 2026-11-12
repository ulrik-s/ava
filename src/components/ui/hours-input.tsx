"use client";

/**
 * `HoursInput` — tid i timmar med decimal (#1545), lagrad som minuter.
 *
 * Samma mönster som `DecimalInput`: `type="text"` med `inputMode="decimal"`
 * och en lokal textbuffert, så att "1," går att skriva. Texten tolkas med den
 * gemensamma regeln (`parseHoursToMinutes`): komma och punkt accepteras, och
 * ett otillåtet värde ("1,33") visar felet och når aldrig föräldern — ingen
 * tyst avrundning. Felet sätts också som fältets custom validity (webbläsaren
 * stoppar då formuläret), och `hasInvalidHours` låter formulärets submit-
 * handler kontrollera samma sak explicit.
 */

import { useState } from "react";
import { formatDecimalHours } from "@/lib/shared/kr-format";
import { parseHoursToMinutes } from "@/lib/shared/time-hours";

interface Props {
  /** Värdet i minuter (formulärets state bär minuter). */
  minutes: number;
  onChange: (minutes: number) => void;
  /** Rapporterar om texten är ett tillåtet värde — för sparknappar utanför ett `<form>`. */
  onValidChange?: (valid: boolean) => void;
  id: string;
  className?: string;
}

export function HoursInput({ minutes, onChange, onValidChange, id, className }: Props) {
  const [buf, setBuf] = useState<{ shown: number; text: string }>({ shown: minutes, text: formatDecimalHours(minutes) });
  // Föräldern har ändrat värdet utifrån (t.ex. en standardåtgärd) → adoptera det.
  const text = buf.shown === minutes ? buf.text : formatDecimalHours(minutes);
  const parsed = parseHoursToMinutes(text);
  const error = parsed.ok ? null : parsed.error;
  const errorId = `${id}-error`;
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        required
        value={text}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        ref={(el) => { el?.setCustomValidity(error ?? ""); }}
        className={className}
        onChange={(e) => {
          const raw = e.target.value;
          const next = parseHoursToMinutes(raw);
          setBuf({ shown: next.ok ? next.minutes : minutes, text: raw });
          onValidChange?.(next.ok);
          if (next.ok) onChange(next.minutes);
        }}
      />
      {error !== null && <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </>
  );
}

/** Sant när formuläret har ett `HoursInput` med otillåtet värde — submit-
 *  handlerns kontroll, oberoende av webbläsarens egen validering. */
export function hasInvalidHours(form: HTMLFormElement): boolean {
  return form.querySelector('input[aria-invalid="true"]') !== null;
}
