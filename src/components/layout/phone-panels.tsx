"use client";

/**
 * Telefonvyn av en dockbar sida (#1185): ingen dragning, en panel i taget med
 * en flikrad i samma ordning som användarens laptop-layout. En valbar panel
 * (#1611) har ett × bredvid fliken som tar bort den, och "Lägg till ruta"
 * (#1612) lägger tillbaka den som aktiv.
 */

import { useState, type ReactNode } from "react";
import { TabBar } from "@/components/ui/tab-bar";
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
  /** Fliken som ska vara vald vid start och när värdet ändras (#1851); `null`/utan ändrar inget. */
  activePanel?: string | null | undefined;
}

/**
 * Vald flik (#1851): sidans begäran vid start och när den ändras, annars den
 * första. Däremellan väljer användaren själv; propen tar inte tillbaka fliken.
 */
function useActiveTab(firstId: string | undefined, activePanel: string | null | undefined) {
  const [activeId, setActiveId] = useState(activePanel ?? firstId);
  const [requested, setRequested] = useState(activePanel);
  if (activePanel !== requested) {
    setRequested(activePanel);
    if (activePanel) setActiveId(activePanel);
  }
  return [activeId, setActiveId] as const;
}

/** ×-knappen efter en flik som användaren får ta bort, annars inget. */
function closeButton(p: PanelDef, closable: Props["closable"], onClose: Props["onClose"]): ReactNode {
  if (!onClose || !closable?.has(p.id)) return null;
  return (
    <button type="button" aria-label={`Ta bort ${p.title}`} onClick={() => onClose(p.id)}
      className="rounded px-1.5 py-1.5 text-sm text-gray-500 hover:bg-gray-100">×</button>
  );
}

export function PhonePanels({ panels, closable, onClose, choices, activePanel }: Props) {
  const [activeId, setActiveId] = useActiveTab(panels[0]?.id, activePanel);
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  const reveal = choices && { ...choices, show: (id: string) => { setActiveId(id); choices.show(id); } };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 pb-1">
        <TabBar ariaLabel="Paneler" active={active?.id} onSelect={setActiveId}
          tabs={panels.map((p) => ({ id: p.id, label: p.title, after: closeButton(p, closable, onClose) }))} />
        {reveal && <AddPanelMenu choices={reveal} />}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-3 space-y-2">{active?.render()}</div>
    </div>
  );
}
