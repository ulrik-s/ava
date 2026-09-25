import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/** Rapporternas paneler (#1184): sammanfattning + kundfordringar till vänster, tabellerna som flikar till höger. */
export const reportsLayout: DefaultLayout = (add) => {
  addGroup(add, ["summary"]);
  addGroup(add, ["matters", "weekly", "unbilled"], { referencePanel: "summary", direction: "right" });
  addGroup(add, ["ar"], { referencePanel: "summary", direction: "below" });
};
