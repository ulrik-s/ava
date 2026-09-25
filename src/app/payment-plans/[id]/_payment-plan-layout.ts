import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/** Avbetalningsplanens paneler (#1184): planen till vänster, inbetalningar och påminnelser till höger. */
export const paymentPlanLayout: DefaultLayout = (add) => {
  addGroup(add, ["summary"]);
  addGroup(add, ["payments"], { referencePanel: "summary", direction: "right" });
  addGroup(add, ["reminders"], { referencePanel: "payments", direction: "below" });
};
