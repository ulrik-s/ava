"use client";

/**
 * `<EntityLink>` — den KANONISKA primitiven för att länka till en entitets
 * detaljsida i demo/static-export-läget. Använd ALLTID denna (eller
 * `entityHref` för row-click/`location.assign`) — ALDRIG `next/link`
 * `<Link>` eller `router.push` mot en `/<route>/<id>`-URL.
 *
 * Varför inte `<Link>`? I `output: "export"` pre-renderas dynamiska rutter
 * bara för build-time-kända id:n. En `<Link>` soft-nav till ett runtime-skapat
 * id (ärende/kontakt/faktura/… skapat i demo-sessionen) hittar ingen route,
 * kringgår 404-shimmen helt, och kraschar med React #418. En vanlig `<a href>`
 * gör en HÅRD navigering → 404.html-shim (GH Pages) / nginx try_files
 * (self-hosted) → den pre-renderade `__shell__`-sentinellen → `useRouteId`
 * läser det riktiga id:t. Se [[entity-href]] och [[use-route-id]].
 *
 * Detta är medvetet en tunn `<a>`-wrapper: en namngiven, grep-bar primitiv som
 * gör kontraktet explicit. Att fällan inte smyger tillbaka vaktas i CI av
 * `test/unit/lib/client/demo/no-detail-link-regression.test.ts` (failar på en
 * `<Link>`/`router.push` mot en `/<route>/<id>`-detaljroute).
 */

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { entityHref } from "./entity-href";

interface EntityLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "id"> {
  /** Route-segmentet, t.ex. "invoices", "matters", "contacts", "templates". */
  route: string;
  /** Entitetens id (seed eller runtime-skapat — båda funkar via shimmen). */
  id: string | null | undefined;
  /** Valfritt svans-segment för nästlade routes, t.ex. "edit" (templates). */
  sub?: string;
  children: ReactNode;
}

export function EntityLink({ route, id, sub, children, ...rest }: EntityLinkProps) {
  // Tomt/saknat id → rendera INTE en länk. En `/<route>//`-URL (dubbel slash)
  // kollapsar i 404-shimmen till färre segment än shimmen kräver → den bouncar
  // till dashboarden ("skickad till dashboarden"). Visa bara innehållet istället.
  if (!id) {
    const { className } = rest;
    return <span className={className}>{children}</span>;
  }
  return (
    <a href={entityHref(route, id, sub)} {...rest}>
      {children}
    </a>
  );
}
