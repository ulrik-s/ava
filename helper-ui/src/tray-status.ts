/**
 * Tray-presentation (ADR 0029) — ren mappning från helperns synk-status till
 * vad menyrads-ikonen ska visa. Electron-fri → testbar utan display.
 *
 * Prioritet: ej ansluten → konflikt → väntande → allt synkat (samma ordning
 * som web-appens HelperSection, ADR 0028 §8).
 */

import type { HelperStatusResponse } from "@/lib/shared/helper/protocol";

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
