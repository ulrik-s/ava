import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/** Kalenderns paneler (#1184): smal användarlista till vänster, kalendern bred, uppgifter som flik. */
export const calendarLayout: DefaultLayout = (add) => {
  addGroup(add, ["calendar", "tasks"]);
  add("users", { position: { referencePanel: "calendar", direction: "left" }, initialWidth: 240 });
};
