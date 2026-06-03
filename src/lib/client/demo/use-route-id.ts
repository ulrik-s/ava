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

import { usePathname, useSearchParams } from "next/navigation";

// Sentinel-segmentet som static-export pre-renderar för okända id:n
// (måste matcha SHELL_PARAM i static-params.ts). Inlinad för att hålla
// denna "use client"-fil fri från ev. server-importer i static-params.
const SHELL_PARAM = "__shell__";

/**
 * När en static-export-värd (GH Pages 404.html-shim ELLER nginx try_files)
 * serverar `__shell__`-sentinellen för ett okänt id, bär den det EGENTLIGA
 * id:t i hash:en som `#orig=<encoded original path>`. Plocka id:t därifrån
 * istället för "__shell__". Faller tillbaka på path:en när ingen shell/hash
 * finns (pre-renderade id:n + self-hosted try_files som behåller URL:en).
 */
function effectivePathname(pathname: string): string {
  if (typeof window === "undefined") return pathname;
  if (!pathname.split("/").filter(Boolean).includes(SHELL_PARAM)) return pathname;
  const m = window.location.hash.match(/(?:^#|&)orig=([^&]+)/);
  if (!m) return pathname;
  try { return decodeURIComponent(m[1]); } catch { return pathname; }
}

export function useRouteId(offsetFromEnd = 0): string | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 1. `?id=` — soft-nav till den pre-renderade __shell__-routen (EntityLink)
  //    samt 404-shimmen. REAKTIVT via useSearchParams: id:t uppdateras även vid
  //    shell→shell-övergångar (samma pathname, ny query) utan omladdning.
  const queryId = searchParams?.get("id");
  if (queryId) return queryId;
  // 2. #orig-hash / pathname — direkt-URL, self-hosted (nginx behåller URL:en),
  //    och pre-renderade seed-id:n. Bakåtkompatibelt med äldre shim/länkar.
  if (!pathname) return null;
  const segs = effectivePathname(pathname).split("/").filter(Boolean);
  const idx = segs.length - 1 - offsetFromEnd;
  return idx >= 0 ? segs[idx] ?? null : null;
}
