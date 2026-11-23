/**
 * Sidkanten på sidor med rutor (#1845): från 768 px bredd har <main> 8 px när
 * `PanelPage` har märkt <html> med `data-panel-page`. Under 768 px och på
 * listsidorna gäller main-elementets egna klasser.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Innehållet i varje `@media (min-width: 768px) { … }`-block (ett nästlingsdjup). */
const desktopBlocks = [...css.matchAll(/@media \(min-width: 768px\) \{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)]
  .map((m) => m[1] ?? "");

describe("globals.css — sidkanten på sidor med rutor (#1845)", () => {
  it("html[data-panel-page] main har 8 px padding inom min-width: 768px", () => {
    const rule = desktopBlocks.join("\n").match(/html\[data-panel-page\] main \{([^}]*)\}/);
    expect(rule?.[1]?.trim()).toBe("padding: 0.5rem;");
  });

  it("regeln står inte i något @layer (annars vinner lg:p-8)", () => {
    expect(css).not.toMatch(/@layer[^{]*\{[^@]*data-panel-page/);
  });
});
