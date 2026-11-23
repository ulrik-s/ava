import type { ReactNode } from "react";

/** En panel på en dockbar sida: stabilt id (sparas i layouten), titel och innehåll. */
export interface PanelDef {
  id: string;
  title: string;
  render: () => ReactNode;
  /**
   * Rutans innehåll är en enda avdelning som går ut till rutans kant (#1844):
   * ingen luft runt den. Utan flaggan får rutan 8 px runt och mellan avdelningarna.
   */
  fill?: boolean;
}
