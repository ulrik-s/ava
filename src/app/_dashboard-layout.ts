import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/**
 * Startsidans paneler (#1184). 13"-laptop: det som kräver handling till
 * vänster, dagen till höger. Stor skärm: tre kolumner.
 */
export const dashboardLayout: DefaultLayout = (add, screen) => {
  addGroup(add, ["watch"]);
  addGroup(add, ["calendar"], { referencePanel: "watch", direction: "right" });
  addGroup(add, ["time"], { referencePanel: "calendar", direction: "below" });
  if (screen === "large") addGroup(add, ["recent"], { referencePanel: "calendar", direction: "right" });
  else addGroup(add, ["recent"], { referencePanel: "watch", direction: "below" });
};

