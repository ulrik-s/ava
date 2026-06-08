/**
 * Dark-mode divide-overrides måste matcha Tailwind v4:s `divide-y`-selektor.
 *
 * Tailwind v4 implementerar `divide-y` som
 *   `> :not(:last-child) { border-bottom: 1px solid }`
 * — INTE som v3:s `> * + * { border-top: 1px solid }`.
 *
 * Om vår override bara träffar `> * + *` får första radens
 * `border-bottom` Tailwinds default-färg (ljus) → vit linje under första
 * list-item i dark mode. Den buggen får inte återkomma.
 */
import { describe, it, expect } from "vitest-compat";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("dark-mode divide-color overrides", () => {
  for (const tone of ["100", "200"] as const) {
    it(`täcker Tailwind v4-selektorn för divide-gray-${tone}`, () => {
      const v4Pattern = new RegExp(
        `\\.dark[^{]*\\.divide-gray-${tone}[^{]*>\\s*:not\\(:last-child\\)`
      );
      expect(css).toMatch(v4Pattern);
    });
  }
});
