import type { DefaultLayout } from "@/components/layout/dock-workspace";

/** Profilens paneler (#1184): uppgifterna till vänster, anslutna tjänster till höger. */
export const profileLayout: DefaultLayout = (add) => {
  add("basics");
  add("integrations", { position: { referencePanel: "basics", direction: "right" } });
};
