"use client";

/**
 * Telefonvyn av en dockbar sida (#1185): ingen dragning, en panel i taget med
 * en flikrad i samma ordning som användarens laptop-layout. En valbar panel
 * (#1611) har ett × bredvid fliken som tar bort den.
 */

import { useState } from "react";
import type { PanelDef } from "./panel-def";

interface Props {
  panels: readonly PanelDef[];
  /** Paneler som användaren får ta bort. */
  closable?: ReadonlySet<string> | undefined;
  /** Användaren tog bort panelen med ×. */
  onClose?: ((id: string) => void) | undefined;
}

export function PhonePanels({ panels, closable, onClose }: Props) {
  const [activeId, setActiveId] = useState(panels[0]?.id);
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Paneler" className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 pb-1">
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
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-3">{active?.render()}</div>
    </div>
  );
}
