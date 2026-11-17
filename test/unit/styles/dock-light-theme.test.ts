/**
 * Dockytans flikar och avdelare i ljust läge (#1635).
 *
 * Reglerna i `globals.css` skriver över dockviews ljusa tema. De får bara
 * träffa ljust läge (mörkt läge ska renderas exakt som förut), och flikarnas
 * text ska vara nästan svart och klara WCAG AA mot både flikraden och den
 * valda fliken.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const LIGHT_SCOPE = ":root:not(.dark) .dockview-theme-light";

/** Selektorerna (före `{`) för regler som rör dockview-temat (#1635-blocket). */
const themeSelectors = [...css.matchAll(/([^{}]*\.dockview-theme-light[^{}]*)\{/g)]
  .map((m) => (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim());

/** Värdet på en `--dv-*`-variabel i det ljusa blocket. */
function lightVar(name: string): string {
  const block = /:root:not\(\.dark\) \.dockview-theme-light \{([^}]*)\}/.exec(css)?.[1] ?? "";
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? "";
}

/** Relativ luminans enligt WCAG 2.x för en `#rrggbb`-färg. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TAB_COLORS = ["activegroup-visiblepanel", "activegroup-hiddenpanel", "inactivegroup-visiblepanel", "inactivegroup-hiddenpanel"];

describe("dockytans ljusa tema (#1635)", () => {
  it("har regler, och alla är avgränsade till ljust läge", () => {
    expect(themeSelectors.length).toBeGreaterThan(0);
    for (const selector of themeSelectors) {
      for (const part of selector.split(",")) expect(part.trim().startsWith(LIGHT_SCOPE)).toBe(true);
    }
  });

  it("rör inte mörkt läges flikar eller avdelare", () => {
    const darkSelectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => (m[1] ?? "").split(","))
      .filter((s) => s.replaceAll(":not(.dark)", "").includes(".dark"));
    expect(darkSelectors.length).toBeGreaterThan(0);
    for (const s of darkSelectors) expect(s).not.toMatch(/\.dockview-theme|\.dv-(tab|groupview|split-view)\b/);
  });

  for (const tab of TAB_COLORS) {
    it(`fliktexten (${tab}) är nästan svart och klarar AA mot flikens bakgrund`, () => {
      const color = lightVar(`dv-${tab}-tab-color`);
      expect(color).toBe("#111827");
      expect(contrast(color, lightVar(`dv-${tab}-tab-background-color`))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("flikraden är tydligt mörkare än rutorna", () => {
    const row = lightVar("dv-tabs-and-actions-container-background-color");
    expect(luminance(row)).toBeLessThan(luminance("#ffffff") * 0.75);
    expect(lightVar("dv-activegroup-visiblepanel-tab-background-color")).toBe("#ffffff");
  });

  it("den valda fliken markeras med mer än textfärgen", () => {
    expect(css).toContain(`${LIGHT_SCOPE} .dv-tab.dv-active-tab { box-shadow:`);
  });

  it("avdelare och gruppkant är mörkare grå", () => {
    expect(luminance(lightVar("dv-separator-border"))).toBeLessThan(luminance("#d1d5db"));
    expect(css).toMatch(/:root:not\(\.dark\) \.dockview-theme-light \.dv-groupview \{ outline: 1px solid #9ca3af !important;/);
  });
});
