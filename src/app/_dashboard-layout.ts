import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/**
 * Startsidans paneler (#1184). 13"-laptop: det som kräver handling till
 * vänster, dagens tid till höger. Stor skärm: tre kolumner. Stapeldiagrammet
 * (#2112) ligger under Tidrapportering på båda. Kalendern är borttagen
 * (#1623) — byråerna använder en egen kalender.
 */
export const dashboardLayout: DefaultLayout = (add, screen) => {
  addGroup(add, ["watch"]);
  addGroup(add, ["time"], { referencePanel: "watch", direction: "right" });
  if (screen === "large") addGroup(add, ["recent"], { referencePanel: "time", direction: "right" });
  else addGroup(add, ["recent"], { referencePanel: "watch", direction: "below" });
  addGroup(add, ["chart"], { referencePanel: "time", direction: "below" });
};


/**
 * Rutorna som användaren får ta bort med × och lägga tillbaka (#1612).
 * Alla rutor är valbara; stängs alla visas tomvyn med "Lägg till ruta" (#1623).
 */
export const DASHBOARD_CLOSABLE: readonly string[] = ["watch", "time", "recent", "chart"];
