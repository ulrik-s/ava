"use client";

/**
 * Telefonvyn av en dockbar sida (#1185): ingen dragning, en panel i taget med
 * en flikrad i samma ordning som användarens laptop-layout. En valbar panel
 * (#1611) har ett × bredvid fliken som tar bort den, och "Lägg till ruta"
 * (#1612) lägger tillbaka den som aktiv.
 */

import { useState } from "react";
import { AddPanelMenu, type PanelChoices } from "./add-panel-menu";
import type { PanelDef } from "./panel-def";

interface Props {
  panels: readonly PanelDef[];
  /** Paneler som användaren får ta bort. */
  closable?: ReadonlySet<string> | undefined;
  /** Användaren tog bort panelen med ×. */
  onClose?: ((id: string) => void) | undefined;
  /** Dolda valbara paneler; `null`/utan = sidan har inga. */
  choices?: PanelChoices | null | undefined;
}

export function PhonePanels({ panels, closable, onClose, choices }: Props) {
  const [activeId, setActiveId] = useState(panels[0]?.id);
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  const reveal = choices && { ...choices, show: (id: string) => { setActiveId(id); choices.show(id); } };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 pb-1">
        <div role="tablist" aria-label="Paneler" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {panels.map((p) => (
            <span key={p.id} className="flex items-center">
              <button type="button" role="tab" aria-selected={p.id === active?.id} onClick={() => setActiveId(p.id)}
                className={`whitespace-nowrap rounded px-3 py-1.5 text-sm ${p.id === active?.id ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
                {p.title}
              </button>
              {onClose && closable?.has(p.id) && (
                <button type="button" aria-label={`Ta bort ${p.title}`} onClick={() => onClose(p.id)}
                  className="rounded px-1.5 py-1.5 text-sm text-gray-500 hover:bg-gray-100">×</button>
              )}
            </span>
          ))}
        </div>
        {reveal && <AddPanelMenu choices={reveal} />}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-3">{active?.render()}</div>
    </div>
  );
}
