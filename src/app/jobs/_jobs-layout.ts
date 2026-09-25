import type { DefaultLayout } from "@/components/layout/dock-workspace";

/** Jobbköns paneler (#1184): aktiva till vänster, historik till höger. */
export const jobsLayout: DefaultLayout = (add) => {
  add("active");
  add("history", { position: { referencePanel: "active", direction: "right" } });
};
