/**
 * Första bun:test-preloaden (#92): registrera happy-dom globalt INNAN
 * något testbibliotek laddas. Egen fil utan andra imports — ES-import:er
 * hoistas, så `register()` måste köra i en modul vars enda import är
 * happy-dom, annars initieras @testing-library/dom (screen) mot ett
 * ännu icke-existerande `document`.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// url matchar vitests jsdom-default så relativa URL:er + location-beroende
// kod (new URL("/x", location.href) …) beter sig som förut.
GlobalRegistrator.register({ url: "http://localhost:3000/" });

// happy-dom definierar en del globaler (fetch m.fl.) som readonly. Under
// jsdom var `global.fetch = vi.fn()` skrivbart, och många tester gör just
// det. Gör de vanligaste omtilldelbara igen så befintliga tester funkar.
for (const key of ["fetch"]) {
  const value = (globalThis as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
}

// happy-dom gör navigator.clipboard till en readonly getter; flera tester
// gör Object.assign(navigator, { clipboard }) (skrivbart under jsdom).
try {
  Object.defineProperty(navigator, "clipboard", {
    value: (navigator as { clipboard?: unknown }).clipboard ?? {},
    writable: true,
    configurable: true,
  });
} catch {
  /* om navigator/clipboard inte är åtkomlig — strunta i det */
}
