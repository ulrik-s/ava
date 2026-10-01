/**
 * Caddy nekar demodata på prod-domänen (#1352) — försvar på djupet.
 *
 * Prod byggs utan demodata (`AVA_BUILD_TARGET=server`), men en release byggd
 * före #1352 (t.ex. efter `deploy-prod.sh --rollback`) har den kvar, och
 * skalet är oskyddat (#1245). Caddyfile ska därför neka exakt de sökvägar som
 * `check-no-demo-data.ts` kallar demodata, och göra det innan filerna serveras.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";
import { ALLOWED_JSON, DEMO_DATA_PATHS } from "../../../tooling/scripts/check-no-demo-data";

const caddyfile = readFileSync(join(process.cwd(), "tooling/docker/caddy/Caddyfile"), "utf8");
/** Det oskyddade statiska blocket — sista `handle {`. */
const staticHandle = caddyfile.slice(caddyfile.lastIndexOf("\thandle {"));
const matcher = /@demodata \{\s*path ([^\n]+)\n\s*not path ([^\n]+)\n\s*\}/.exec(staticHandle);

describe("Caddyfile nekar demodata (#1352)", () => {
  it("@demodata matchar exakt DEMO_DATA_PATHS", () => {
    expect(matcher?.[1]?.trim().split(/\s+/)).toEqual([...DEMO_DATA_PATHS]);
  });

  it("PWA-manifestet undantas", () => {
    expect(matcher?.[2]?.trim()).toBe(ALLOWED_JSON);
  });

  it("svarar 404 innan shell-rewriten och file_server", () => {
    const respond = staticHandle.indexOf("respond @demodata 404");
    expect(respond).toBeGreaterThan(-1);
    expect(respond).toBeLessThan(staticHandle.indexOf("rewrite @shell"));
    expect(respond).toBeLessThan(staticHandle.indexOf("file_server"));
    // Inuti `route` — där körs direktiven i skriven ordning.
    expect(respond).toBeGreaterThan(staticHandle.indexOf("route {"));
  });
});
