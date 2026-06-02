/**
 * Kontrakts-vakt: navigering till en DYNAMISK entitets-detaljroute måste gå via
 * `<EntityLink route id>` / `entityHref` (hård-nav), ALDRIG via Next-`<Link>`,
 * `router.push/replace` eller en rå `<a href={`/route/${id}`}>`. En soft-nav till
 * ett runtime-skapat id (ej i generateStaticParams) kraschar med React #418 i
 * static-export-bygget. Se docs/architecture.md ("Routing till runtime-skapade
 * id:n") och [[entity-link]].
 *
 * Detta test gör löftet i EntityLink-docstringen sant: det FAILAR om fällan
 * smyger tillbaka — något typecheck/eslint inte fångar (fel är ett giltigt
 * strängvärde). Skannar src/app + src/components (UI-lagret); de-facto-
 * primitiverna i src/lib/client/demo beskriver mönstret i prosa och undantas.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = "matters|contacts|invoices|payment-plans|users|templates";

// `<Link href={`/matters/${...}`}>` ELLER rå `<a href={`/invoices/${...}`}>`:
const HREF_TEMPLATE = new RegExp(`href=\\{\`/(${ROUTES})/\\$\\{`);
// `router.push(\`/matters/${...}\`)` / `router.replace(...)`:
const ROUTER_TEMPLATE = new RegExp(`router\\.(push|replace)\\(\`/(${ROUTES})/\\$\\{`);
// `router.push("/invoices/" + id)` (sträng-konkat):
const ROUTER_CONCAT = new RegExp(`router\\.(push|replace)\\(["'\`]/(${ROUTES})/["'\`]\\s*\\+`);

const SCAN_DIRS = ["src/app", "src/components"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true }) as Array<{ name: string; parentPath?: string; path?: string; isFile(): boolean }>) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    out.push(join(entry.parentPath ?? entry.path ?? dir, entry.name));
  }
  return out;
}

describe("inga detalj-route soft-navs (EntityLink-kontraktet)", () => {
  it("ingen <Link>/<a>/router.push mot /<route>/<id> i src/app + src/components", () => {
    const offenders: string[] = [];
    for (const base of SCAN_DIRS) {
      for (const file of tsxFiles(base)) {
        const src = readFileSync(file, "utf8");
        src.split("\n").forEach((line, i) => {
          if (HREF_TEMPLATE.test(line) || ROUTER_TEMPLATE.test(line) || ROUTER_CONCAT.test(line)) {
            offenders.push(`${file}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    }
    expect(
      offenders,
      `Detalj-route soft-nav hittad — använd <EntityLink route id [sub]> / entityHref ` +
        `(hård-nav) istället (annars React #418 för runtime-id:n):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
