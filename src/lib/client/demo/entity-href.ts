/**
 * `entityHref` — bygg en URL till en entitets-detaljsida som funkar även för
 * **runtime-skapade (ej pre-renderade) id:n** i static-export-demon.
 *
 * Bakgrund: i `output: "export"` pre-renderas dynamiska rutter (`/invoices/[id]`)
 * bara för build-time-kända id:n. Klickar man en Next-`<Link>` till ett okänt
 * id (t.ex. en faktura skapad i demo-sessionen) hittar klient-routern ingen
 * route och hamnar i ett trasigt tillstånd (hydration-mismatch → React #418,
 * eller fallback till dashboard).
 *
 * Lösningen — samma mönster som [[use-route-id]] beskriver — är en **hård**
 * navigering med en vanlig `<a href>` till `/<route>/<id>/`:
 *   - GH Pages: okänd URL → 404.html-shim → `/<route>/__shell__/#orig=<path>`
 *     → appen bootar på den pre-renderade sentinellen, `useRouteId` läser id:t.
 *   - self-hosted: nginx `try_files` serverar sentinellen men behåller URL:en.
 *
 * Base-path:en (`/ava` på GH Pages, tomt i self-hosted) måste prefixas manuellt
 * eftersom `<a>` kringgår Next:s router (som annars lägger på basePath). Trailing
 * slash matchar `trailingSlash: true`-bygget så 404-shimmen får rätt path.
 */
export function entityHref(route: string, id: string): string {
  const base = process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
  const cleanRoute = route.replace(/^\/+|\/+$/g, "");
  return `${base}/${cleanRoute}/${id}/`;
}
