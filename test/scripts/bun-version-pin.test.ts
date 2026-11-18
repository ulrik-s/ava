/**
 * EN Bun-version överallt. CI pinnade 1.3.14 i `.github/actions/bun-setup`,
 * medan produktionen byggde och migrerade i `oven/bun:1` (flytande) — som
 * pekade på 1.4. Produktionen körde alltså en runtime som CI aldrig testade.
 * Nu läses versionen ur CI-pinnen, och allt annat måste vara samma.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest-compat";

const read = (path: string): string => readFileSync(path, "utf8");
const match = (re: RegExp, text: string): string | undefined => re.exec(text)?.[1];

const ci = match(/^\s*bun-version:\s*(\S+)\s*$/m, read(".github/actions/bun-setup/action.yml"));

describe("Bun-versionen", () => {
  it("CI pinnar en exakt version (inte `latest` eller ett flytande major)", () => {
    expect(ci).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("produktionens bygge och migrering kör samma Bun som CI testar", () => {
    expect(match(/^BUN_IMAGE="oven\/bun:([^"]+)"$/m, read("tooling/scripts/deploy-prod.sh"))).toBe(ci);
    expect(read("tooling/scripts/deploy-prod.sh")).not.toMatch(/oven\/bun:1[\s"]/);
  });

  it("Caddy-e2e:ns stub och dokumentationens kommandon använder samma version", () => {
    expect(match(/oven\/bun:(\S+) bun/, read("tooling/scripts/caddy-e2e/caddy-prod-e2e.sh"))).toBe(ci);
    const docs = [...read("docs/deploy-server-first.md").matchAll(/oven\/bun:(\S+)/g)].map((m) => m[1]);
    expect(docs.length).toBeGreaterThan(0);
    expect(new Set(docs)).toEqual(new Set([ci]));
  });

  it("bun-types (rot och helper-ui) beskriver samma version", () => {
    for (const file of ["package.json", "helper-ui/package.json"]) {
      expect(match(/"bun-types":\s*"\^?([^"]+)"/, read(file))).toBe(ci);
    }
  });
});
