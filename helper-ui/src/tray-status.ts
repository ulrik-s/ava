/**
 * Tray-presentation (ADR 0029) — ren mappning från helperns synk-status till
 * vad menyrads-ikonen ska visa. Electron-fri → testbar utan display.
 *
 * Prioritet: ej ansluten → konflikt → väntande → allt synkat (samma ordning
 * som web-appens HelperSection, ADR 0028 §8).
 */

import type { HelperStatusResponse } from "@/lib/shared/helper/protocol";

import type { UpdateStatus } from "./engine/update.ts";

export type TrayState = "absent" | "synced" | "pending" | "conflict";

export interface TrayView {
  state: TrayState;
  /** Kort badge bredvid ikonen (tom = ingen). */
  title: string;
  /** Tooltip / menyrubrik. */
  tooltip: string;
}

export function trayView(present: boolean, status: HelperStatusResponse | null): TrayView {
  if (!present) return { state: "absent", title: "", tooltip: "AVA Helper — inte igång" };
  if (status === null || status.total === 0) return { state: "synced", title: "", tooltip: "AVA Helper — allt synkat" };
  if (status.conflict > 0) {
    return { state: "conflict", title: `!${status.conflict}`, tooltip: `${status.conflict} dokument i konflikt — öppna och spara igen` };
  }
  return { state: "pending", title: String(status.pending), tooltip: `${status.pending} ändring(ar) väntar på synk` };
}

/** "kl 18:05" samma dag, annars "14 nov. 18:05". */
export function checkedAt(at: Date, now: Date): string {
  const time = at.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return `kl ${time}`;
  return `${at.toLocaleDateString("sv-SE", { day: "numeric", month: "short" })} ${time}`;
}

const RESULT_TEXT = {
  "up-to-date": "senaste versionen",
  available: "ny version finns",
  error: "kunde inte söka",
} as const;

/** Menyns statusrad för uppdateringar: version + senaste kontrollen. */
export function updateStatusLine(version: string, s: UpdateStatus, now: Date = new Date()): string {
  if (s.checking) return `${version} — söker efter uppdatering…`;
  if (s.last === null) return `${version} — inte kontrollerad än`;
  return `${version} — ${RESULT_TEXT[s.last.result]} (${checkedAt(s.last.at, now)})`;
}
