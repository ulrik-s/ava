import type { ReactNode } from "react";

/** En panel på en dockbar sida: stabilt id (sparas i layouten), titel och innehåll. */
export interface PanelDef {
  id: string;
  title: string;
  render: () => ReactNode;
}
