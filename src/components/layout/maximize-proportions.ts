"use client";

/**
 * Proportionerna består genom en maximering (#1291).
 *
 * dockview döljer de andra grupperna när en grupp maximeras och kommer ihåg
 * deras storlekar i PIXLAR. Byter fönstret storlek under tiden (en
 * tiling-fönsterhanterare gör det hela tiden) sätts de gamla pixlarna tillbaka
 * vid återställningen, och layouten blir skev för gott. Vakten sparar
 * gruppernas andelar av ytan när maximeringen börjar och skalar om dem till
 * den aktuella ytan när den slutar.
 */

import { groupShares, serializedLayoutSchema, type GroupShare } from "@/lib/shared/layout/dock-layout";

/** Den del av dockviews api vakten använder (smal → testbar utan dockview). */
export interface MaximizeProportionsApi {
  readonly width: number;
  readonly height: number;
  toJSON(): { grid: unknown };
  getGroup(id: string): { api: { setSize(size: { width: number; height: number }): void } } | undefined;
  onDidMaximizedGroupChange(listener: (e: { isMaximized: boolean }) => void): { dispose(): void };
}

interface Snapshot { width: number; height: number; shares: Map<string, GroupShare> }

/** Läs andelarna ur layouten; null om den inte går att läsa. */
function snapshot(api: MaximizeProportionsApi): Snapshot | null {
  // dockviews toJSON() under maximering serialiserar layouten som den var före.
  const grid = serializedLayoutSchema.shape.grid.safeParse(api.toJSON().grid);
  return grid.success ? { width: api.width, height: api.height, shares: groupShares(grid.data) } : null;
}

function rescale(api: MaximizeProportionsApi, s: Snapshot): void {
  if (api.width === s.width && api.height === s.height) return; // dockviews återställning stämmer
  for (const [id, share] of s.shares) {
    api.getGroup(id)?.api.setSize({ width: Math.round(share.width * api.width), height: Math.round(share.height * api.height) });
  }
}

/** Lyssna på maximeringar och håll proportionerna. `dispose` slutar lyssna. */
export function keepProportionsAcrossMaximize(api: MaximizeProportionsApi): { dispose(): void } {
  let before: Snapshot | null = null;
  return api.onDidMaximizedGroupChange((e) => {
    if (e.isMaximized) { before = snapshot(api); return; }
    if (before) rescale(api, before);
    before = null;
  });
}
