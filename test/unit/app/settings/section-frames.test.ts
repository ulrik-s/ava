/**
 * Inställningar och Min profil följer rutornas innehållslägen (#1847):
 * ingen avdelning har kvar den gamla ramen med stor luft (`p-5 mb-5`).
 * Inställningarnas avdelningar är `SECTION_CARD_CLASS` (flera i samma ruta),
 * Min profils är `SECTION_FILL_CLASS` (hela rutans innehåll).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest-compat";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const tsxIn = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".tsx")).map((f) => `${dir}/${f}`);

const SETTINGS_CARDS = [
  "src/app/settings/page.tsx",
  "src/app/settings/_standard-atgarder-section.tsx",
  "src/app/settings/_vocabulary-sections.tsx",
  "src/components/settings/backup-section.tsx",
  "src/components/settings/datasource-section.tsx",
  "src/components/settings/editor-extensions-section.tsx",
  "src/components/settings/external-edit-section.tsx",
  "src/components/settings/fortnox-section.tsx",
  "src/components/settings/helper-section.tsx",
  "src/components/settings/ledger-accounts-section.tsx",
  "src/components/settings/org-defaults-section.tsx",
  "src/components/settings/org-image-section.tsx",
];
const PROFILE_FILLS = ["src/app/profile/page.tsx", "src/components/settings/integrations-section.tsx"];

describe("rutornas lägen på Inställningar och Min profil (#1847)", () => {
  it("ingen avdelning har kvar ramen p-5 mb-5", () => {
    const files = [...tsxIn("src/app/settings"), ...tsxIn("src/components/settings"), ...tsxIn("src/app/profile")];
    for (const f of files) expect({ f, old: read(f).includes("p-5 mb-5") }).toEqual({ f, old: false });
  });

  it("Inställningarnas avdelningar använder SECTION_CARD_CLASS", () => {
    for (const f of SETTINGS_CARDS) expect({ f, card: read(f).includes("className={SECTION_CARD_CLASS}") }).toEqual({ f, card: true });
  });

  it("Min profils avdelningar använder SECTION_FILL_CLASS med 8 px luft", () => {
    for (const f of PROFILE_FILLS) expect({ f, fill: read(f).includes("className={`${SECTION_FILL_CLASS} p-2`}") }).toEqual({ f, fill: true });
  });
});
