import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/** Kontaktsidans paneler (#1184): uppgifterna till vänster, ärenden (och kontaktpersoner) till höger. */
export const contactLayout: DefaultLayout = (add) => {
  addGroup(add, ["details"]);
  addGroup(add, ["matters", "people"], { referencePanel: "details", direction: "right" });
};
