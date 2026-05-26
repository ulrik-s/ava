"use client";

/**
 * `useRouteId` — läser id:t ur den faktiska URL:en (client) istället för
 * det build-time-bakade route-param:et.
 *
 * Bakgrund: i `output: "export"` genereras dynamiska rutter (`/matters/[id]`)
 * bara för build-time-kända id:n (demo-data). I self-hosted-läget skapar
 * användaren NYA poster med okända id:n. Vi genererar därför en
 * sentinel-shell (`generateStaticParams`) och låter nginx servera den för
 * `/<route>/<id>` — och klienten plockar det riktiga id:t ur `usePathname()`.
 *
 * `offsetFromEnd` hanterar nästlade rutter (t.ex. `/templates/[id]/edit`
 * → offset 1).
 */

import { usePathname } from "next/navigation";

export function useRouteId(offsetFromEnd = 0): string | null {
  const pathname = usePathname();
  if (!pathname) return null;
  const segs = pathname.split("/").filter(Boolean);
  const idx = segs.length - 1 - offsetFromEnd;
  return idx >= 0 ? segs[idx] ?? null : null;
}
