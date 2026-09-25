"use client";

/**
 * Telefonvyn av en dockbar sida (#1185): ingen dragning, en panel i taget med
 * en flikrad i samma ordning som användarens laptop-layout.
 */

import { useState } from "react";
import type { PanelDef } from "./panel-def";

export function PhonePanels({ panels }: { panels: readonly PanelDef[] }) {
  const [activeId, setActiveId] = useState(panels[0]?.id);
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Paneler" className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 pb-1">
        {panels.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === active?.id} onClick={() => setActiveId(p.id)}
            className={`whitespace-nowrap rounded px-3 py-1.5 text-sm ${p.id === active?.id ? "bg-blue-600 text-white" : "text-gray-700 hover:bg-gray-100"}`}>
            {p.title}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-3">{active?.render()}</div>
    </div>
  );
}
