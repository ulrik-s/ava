"use client";

/**
 * Ärendesidans paneler och standardlayouter (#1185, pilot). Id:na sparas i
 * användarnas layouter — byt aldrig namn på ett id; lägg till nya i stället.
 */

import type { ReactNode } from "react";
import type { DefaultLayout } from "@/components/layout/dock-workspace";
import type { PanelDef } from "@/components/layout/panel-def";

/** Panelernas id — samma lista i registret och standardlayouterna. */
export const MATTER_PANEL_IDS = [
  "time", "expenses", "billing", "receivables", "payment", "watch",
  "contacts", "documents", "events", "suggestions", "notes",
] as const;
export type MatterPanelId = (typeof MATTER_PANEL_IDS)[number];

const TITLES: Record<MatterPanelId, string> = {
  time: "Tid", expenses: "Utlägg", billing: "Fakturering", receivables: "Domstolsbetalningar",
  payment: "Betalningssätt", watch: "Att bevaka", contacts: "Kontakter", documents: "Dokument",
  events: "Händelser", suggestions: "Förslag", notes: "Anteckningar",
};

/** Panelregistret för ett ärende: innehållet kommer från sidan. */
export function matterPanels(content: Record<MatterPanelId, () => ReactNode>): PanelDef[] {
  return MATTER_PANEL_IDS.map((id) => ({ id, title: TITLES[id], render: content[id] }));
}

type Add = Parameters<DefaultLayout>[0];

/** Grupp: första panelen synlig, resten som bakgrundsflikar i samma grupp. */
function group(add: Add, ids: readonly MatterPanelId[], position?: Parameters<Add>[1]): void {
  const [first, ...rest] = ids;
  if (!first) return;
  add(first, position);
  rest.forEach((id) => add(id, { position: { referencePanel: first, direction: "within" }, inactive: true }));
}

/**
 * 13"-laptop: arbetet (tid/utlägg/fakturering) till vänster, till höger det
 * man bevakar överst och dokument/händelser under.
 * Stor skärm: tre kolumner så mer syns utan att klicka på flikar.
 */
export const matterDefaultLayout: DefaultLayout = (add, screen) => {
  if (screen === "laptop") {
    group(add, ["time", "expenses", "billing", "receivables"]);
    group(add, ["watch", "payment", "contacts"], { position: { referencePanel: "time", direction: "right" } });
  } else {
    group(add, ["time", "expenses"]);
    group(add, ["billing", "receivables", "payment"], { position: { referencePanel: "time", direction: "right" } });
    group(add, ["watch", "contacts"], { position: { referencePanel: "billing", direction: "right" } });
  }
  group(add, ["documents", "events", "suggestions", "notes"], { position: { referencePanel: "watch", direction: "below" } });
};
