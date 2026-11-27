/**
 * Kontrakts-vakt: en sökväg till en DYNAMISK entitets-detaljroute måste byggas
 * via `<EntityLink route id>` / `shellPath` / `entityHref` (hård-nav), eller
 * bäras som `{ route, id }` (som `WatchlistLink`), ALDRIG som en färdig sträng
 * `/route/<id>`. En soft-nav till ett runtime-skapat id (ej i
 * generateStaticParams) kraschar med React #418 i static-export-bygget. Se
 * docs/architecture.md ("Routing till runtime-skapade id:n") och [[entity-link]].
 *
 * Detta test gör löftet i EntityLink-docstringen sant: det FAILAR om fällan
 * smyger tillbaka — något typecheck/eslint inte fångar (fel är ett giltigt
 * strängvärde). Skannar ALLA `.ts`- och `.tsx`-filer under `src/` (#1871), och
 * fäller en sökväg som byggs med mallsträng (`/matters/${id}`) eller med `+`
 * (`"/matters/" + id`) var den än står: i `href`, `router.push`, en variabel
 * eller ett fält i en DTO (som ava#1217). Kommentarsrader hoppas över.
 *
 * Begränsning: vakten läser rad för rad. En sträng och `+` på olika rader, eller
 * en sökväg byggd med `.join`, `.concat` eller `new URL`, fälls inte.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";
import { sourceFiles } from "../../../../helpers/source-files";

const ROUTES = "matters|contacts|invoices|payment-plans|users|templates";

// En mallsträng som börjar med `/<route>/${`, ev. efter `${base}`: `` `/matters/${id}` ``.
const TEMPLATE = new RegExp(`\`(\\$\\{[^}]*\\})?/(${ROUTES})/\\$\\{`);
// En sträng `"/<route>/"` följd av `+`: `"/invoices/" + id`.
const CONCAT = new RegExp(`["'\`]/(${ROUTES})/["'\`]\\s*\\+`);

/** Kommentarsrad (`//` eller ` * `): beskriver mönstret i prosa, länkar inte. */
const isComment = (line: string): boolean => /^\s*(\/\/|\*)/.test(line);

/** `fil:rad  text` för varje rad i `source` som bygger en sökväg till en detaljsida. */
function detailLinkOffenders(file: string, source: string): string[] {
  return source.split("\n").flatMap((line, i) =>
    !isComment(line) && (TEMPLATE.test(line) || CONCAT.test(line)) ? [`${file}:${i + 1}  ${line.trim()}`] : []);
}

describe("detailLinkOffenders — mönstren (#1871)", () => {
  it.each([
    ["DTO-fältet (ava#1217)", "  href: `/matters/${m.id}`,"],
    ["villkor i ett fält", "  href: task.matterId ? `/matters/${task.matterId}` : \"/watchlist\","],
    ["konkatenering i en variabel", "const url = \"/contacts/\" + c.id;"],
    ["router.push med konkatenering", "router.push(\"/invoices/\" + id);"],
    ["router.push med enkla citattecken", "router.push('/matters/' + id);"],
    ["<Link href>", "<Link href={`/payment-plans/${p.id}`}>"],
    ["base path före routen", "location.assign(`${base}/users/${u.id}/`);"],
    ["router.replace med undersida", "router.replace(`/templates/${t.id}/edit`);"],
  ])("fäller %s", (_name, line) => {
    expect(detailLinkOffenders("x.ts", line)).toEqual([`x.ts:1  ${line.trim()}`]);
  });

  it.each([
    ["shellPath", "router.push(shellPath(\"matters\", id));"],
    ["EntityLink", "<EntityLink route=\"invoices\" id={id}>"],
    ["git-sökväg", "const p = `.ava/users/${id}.json`;"],
    ["API-anrop", "await fetch(`/api/matters/${id}`);"],
    ["statisk sida", "<Link href=\"/templates/new\">"],
    ["//-kommentar", "  // href: `/matters/${id}`"],
    ["blockkommentar", "   * en <Link href={`/matters/${id}`}> kraschar"],
  ])("släpper igenom %s", (_name, line) => {
    expect(detailLinkOffenders("x.ts", line)).toEqual([]);
  });

  it("ger rätt radnummer", () => {
    expect(detailLinkOffenders("a.ts", "const a = 1;\nconst u = \"/users/\" + id;")).toEqual(["a.ts:2  const u = \"/users/\" + id;"]);
  });
});

describe("inga detalj-route-sökvägar som strängar (EntityLink-kontraktet)", () => {
  const files = sourceFiles("src", /\.tsx?$/);

  it("säkerhetsgrind: fillistan har .ts-filer utanför src/app och src/components", () => {
    // Ett fel i fillistan skulle annars få vakten att passera tyst.
    expect(files).toContain(join("src", "lib", "shared", "watchlist.ts"));
    const outsideUi = files.filter((f) => f.endsWith(".ts") && !f.startsWith(join("src", "app")) && !f.startsWith(join("src", "components")));
    expect(outsideUi.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith(".tsx"))).toBe(true);
  });

  it("ingen sökväg till /<route>/<id> byggs med mallsträng eller + i src/", () => {
    const offenders = files.flatMap((f) => detailLinkOffenders(f, readFileSync(f, "utf8")));
    expect(
      offenders,
      "Sökväg till en detaljsida byggd som sträng — använd <EntityLink route id [sub]>, " +
        "shellPath/entityHref (hård-nav), eller bär { route, id } i en DTO (som WatchlistLink) " +
        `(annars React #418 för runtime-id:n):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
