import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/**
 * Inställningarnas paneler (#1184). Byråns grunddata till vänster, det admin
 * sätter upp för alla till höger. Stor skärm: tre kolumner.
 */
export const settingsLayout: DefaultLayout = (add, screen) => {
  // "backup" finns bara för administratörer mot en server med backup (#1431).
  addGroup(add, ["org", "offices", "datasource", "devices", "backup"]);
  if (screen === "large") {
    addGroup(add, ["ledger", "tags"], { referencePanel: "org", direction: "right" });
    addGroup(add, ["atgarder", "views", "external"], { referencePanel: "ledger", direction: "right" });
  } else {
    addGroup(add, ["ledger", "tags", "atgarder", "views", "external"], { referencePanel: "org", direction: "right" });
  }
};
