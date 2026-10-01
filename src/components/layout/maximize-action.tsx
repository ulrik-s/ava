"use client";

/**
 * Maximera/återställ en panelgrupp (#1263). Juristen gör t.ex. Dokument-panelen
 * tillfälligt helbild medan hon ordnar filer och återställer den sedan. Knappen
 * sitter i varje grupps flikrad; maximerad visar den texten "Återställ". Escape
 * återställer (när ingen dialog är öppen och fokus inte står i ett fält eller
 * en meny — där tillhör Escape dem).
 * Maximeringen sparas aldrig (`withoutMaximized`).
 */

import type { IDockviewHeaderActionsProps } from "dockview-react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Där Escape tillhör något annat (#1356): ett inmatningsfält (Escape rensar
 * eller avbryter där), en meny eller lista som stängs med Escape.
 */
const OWNS_ESCAPE = [
  "input", "textarea", "select", '[contenteditable]:not([contenteditable="false"])',
  '[role="menu"]', '[role="menuitem"]', '[role="listbox"]', '[role="option"]', '[role="combobox"]',
].join(", ");

/** Escape tillhör en öppen dialog, eller elementet som har fokus. */
function escapeBelongsElsewhere(target: EventTarget | null): boolean {
  if (document.querySelector('[role="dialog"]')) return true;
  return target instanceof Element && target.closest(OWNS_ESCAPE) !== null;
}

/**
 * Escape återställer — men inte när en dialog är öppen (den äger Escape), och
 * inte när fokus står i ett fält eller en meny (#1356).
 * Lyssnar i capture-fasen på window, alltså FÖRE dialogens egen lyssnare
 * (på document). Annars hade dialogen redan stängts när vi kontrollerade, och
 * samma Escape hade både stängt dialogen och återställt panelen (#1293).
 */
function useEscapeRestores(active: boolean, restore: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !escapeBelongsElsewhere(e.target)) restore();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [active, restore]);
}

const ICON_BUTTON = "mx-1 inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900";
/** Maximerad: en tydlig knapp med text — övriga paneler är dolda och ikonen ensam syntes inte (#1293). */
const RESTORE_BUTTON = "mx-1 inline-flex h-6 items-center gap-1 rounded bg-blue-600 px-2 text-xs font-medium text-white hover:bg-blue-700";

type GroupApi = IDockviewHeaderActionsProps["group"]["api"];

/** Det komponenten läser av dockviews header-props (smalt → testbart utan dockview). */
export interface MaximizeActionProps {
  group: { api: Pick<GroupApi, "isMaximized" | "maximize" | "exitMaximized"> };
  containerApi: { onDidMaximizedGroupChange: (listener: () => void) => { dispose: () => void } };
}

export function MaximizeAction({ group, containerApi }: MaximizeActionProps) {
  const [maximized, setMaximized] = useState(() => group.api.isMaximized());
  useEffect(() => {
    const sub = containerApi.onDidMaximizedGroupChange(() => setMaximized(group.api.isMaximized()));
    return () => sub.dispose();
  }, [group, containerApi]);
  useEscapeRestores(maximized, () => group.api.exitMaximized());

  const label = maximized ? "Återställ panelen" : "Maximera panelen";
  return (
    <button
      type="button"
      aria-label={label}
      title={maximized ? "Återställ panelen (Esc)" : label}
      aria-pressed={maximized}
      onClick={() => (maximized ? group.api.exitMaximized() : group.api.maximize())}
      className={`${maximized ? RESTORE_BUTTON : ICON_BUTTON} focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      {maximized
        ? <><Minimize2 size={14} aria-hidden="true" /><span>Återställ</span></>
        : <Maximize2 size={14} aria-hidden="true" />}
    </button>
  );
}
