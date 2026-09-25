import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/**
 * Fakturasidans paneler (#1184). 13"-laptop: översikt + betalningar till
 * vänster, underlagen som flikar till höger. Stor skärm: tre kolumner.
 *
 * Ordningen spelar roll: kolumnerna skapas FÖRST, sedan delas vänster kolumn —
 * annars hamnar "under översikten" under hela bredden.
 */
export const invoiceLayout: DefaultLayout = (add, screen) => {
  addGroup(add, ["summary"]);
  if (screen === "large") {
    addGroup(add, ["spec"], { referencePanel: "summary", direction: "right" });
    addGroup(add, ["documents", "dispatch"], { referencePanel: "spec", direction: "right" });
  } else {
    addGroup(add, ["spec", "documents", "dispatch"], { referencePanel: "summary", direction: "right" });
  }
  addGroup(add, ["payments"], { referencePanel: "summary", direction: "below" });
};
