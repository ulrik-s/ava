import { addGroup, type DefaultLayout } from "@/components/layout/dock-workspace";

/** Betalfilsimportens paneler (#1184): filen till vänster, matchningarna som flikar till höger. */
export const paymentImportLayout: DefaultLayout = (add) => {
  addGroup(add, ["file"]);
  addGroup(add, ["match", "receivables"], { referencePanel: "file", direction: "right" });
};
