"use client";

/**
 * "Lägg till ruta" (#1612): lägger tillbaka en valbar panel som användaren
 * tagit bort med ×. Menyn är `ActionMenu` med en textknapp i verktygsradens
 * stil; tomt läge när alla paneler på sidan är borttagna.
 */

import { ActionMenu } from "@/components/ui/action-menu";
import type { PanelDef } from "./panel-def";

/** Verktygsradens knappstil — delas av alla knappar i `LayoutToolbar`. */
export const TOOLBAR_BUTTON = "rounded px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50";

const LABEL = "Lägg till ruta";
const TRIGGER = { text: LABEL, className: TOOLBAR_BUTTON };

/** Dolda valbara paneler och hur en läggs tillbaka. */
export interface PanelChoices {
  /** Valbara paneler som är dolda just nu. */
  hidden: readonly PanelDef[];
  /** Lägg tillbaka panelen. */
  show: (id: string) => void;
}

/** Knappen; inaktiv med förklaring när ingen panel är dold. */
export function AddPanelMenu({ choices }: { choices: PanelChoices }) {
  const none = choices.hidden.length === 0;
  return (
    <ActionMenu
      label={LABEL}
      trigger={TRIGGER}
      disabled={none}
      title={none ? "Alla rutor visas redan" : undefined}
      items={choices.hidden.map((p) => ({ key: p.id, label: p.title, onSelect: () => choices.show(p.id) }))}
    />
  );
}

/** I stället för en tom dockyta: alla paneler på sidan är borttagna. */
export function NoPanels({ choices }: { choices: PanelChoices }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-500">
      <p>Du har tagit bort alla rutor.</p>
      <AddPanelMenu choices={choices} />
    </div>
  );
}
