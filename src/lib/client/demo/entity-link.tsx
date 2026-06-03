"use client";

/**
 * `<EntityLink>` — den KANONISKA primitiven för att länka till en entitets
 * detaljsida i demo/static-export-läget. Använd ALLTID denna — ALDRIG en rå
 * `next/link`-`<Link>` mot en `/<route>/<id>`-URL eller `router.push` dit.
 *
 * Hur det funkar (ingen sidomladdning, inget blink): vi soft-navigerar med en
 * Next-`<Link>` till den PRE-RENDERADE `__shell__`-routen och bär id:t som en
 * query-param (`?id=`). Eftersom `__shell__` finns pre-renderad är det en
 * vanlig SPA-övergång (ingen React #418 som vid soft-nav till ett okänt id),
 * och `useRouteId` läser `?id` reaktivt via `useSearchParams`. Direkt-URL:er,
 * reload och 404-shimmen hanteras av samma `?id`/hash-fallback i [[use-route-id]].
 *
 * Tomt/saknat id → ingen länk (en `<span>`), aldrig en trasig URL.
 *
 * Vaktas i CI av `test/unit/lib/client/demo/no-detail-link-regression.test.ts`
 * och e2e `test/e2e/demo-invoice-document.spec.ts`.
 */

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { shellPath } from "./entity-href";

type LinkProps = Omit<ComponentProps<typeof Link>, "href" | "id">;

interface EntityLinkProps extends LinkProps {
  /** Route-segmentet, t.ex. "invoices", "matters", "contacts", "templates". */
  route: string;
  /** Entitetens id (seed eller runtime-skapat — båda funkar via __shell__). */
  id: string | null | undefined;
  /** Valfritt svans-segment för nästlade routes, t.ex. "edit" (templates). */
  sub?: string;
  children: ReactNode;
}

export function EntityLink({ route, id, sub, children, ...rest }: EntityLinkProps) {
  if (!id) {
    const { className } = rest as { className?: string };
    return <span className={className}>{children}</span>;
  }
  return (
    <Link href={shellPath(route, id, sub)} {...rest}>
      {children}
    </Link>
  );
}
