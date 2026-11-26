import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/** Rapporternas paneler (#1184): sammanfattning + kundfordringar till vänster, tabellerna och stapeldiagrammet (#2110) som flikar till höger. */
export const reportsLayout: DefaultLayout = (add) => {
  addGroup(add, ["summary"]);
  addGroup(add, ["matters", "weekly", "unbilled", "chart"], { referencePanel: "summary", direction: "right" });
  addGroup(add, ["ar"], { referencePanel: "summary", direction: "below" });
};
