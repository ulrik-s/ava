/**
 * Andra bun:test-preloaden (#92) — motsvarar gamla vitest.setup.ts.
 * happy-dom är redan registrerad (se happy-dom-register.ts, körs först),
 * så här kan vi tryggt importera Testing Library.
 *
 *   - Kopplar in @testing-library/jest-dom-matchers (toBeInTheDocument …).
 *   - Rensar renderad DOM mellan tester.
 *   - Spärrar fetch mot AVA Helper-portarna och fäller testet som försökte
 *     (#1368) — se helper-network-guard.ts.
 *   - Binder de lokala databasernas namnrymd (#1347).
 */

import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "bun:test";

import { bindLocalNamespace, SHARED_NAMESPACE } from "@/lib/client/backend/local-data/local-namespace";

import { assertNoHelperTraffic, guardFetch } from "./helper-network-guard";

// Lokala databaser (#1347): i webbläsaren binder bootstrappen namnrymden innan
// något öppnas. Testerna öppnar dem under demons gemensamma namn om inte
// testet självt binder en användare (eller släpper bindningen).
bindLocalNamespace(SHARED_NAMESPACE);

expect.extend(matchers as unknown as Parameters<typeof expect.extend>[0]);

// happy-dom enforce:ar HTML5-constraint-validation vid form-submit (ett tomt
// `required`-fält blockerar submit); jsdom gjorde inte det. Stäng av så
// submit-tester beter sig som under vitest+jsdom.
for (const Ctor of [HTMLFormElement, HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, HTMLButtonElement]) {
  const proto = Ctor.prototype as { checkValidity?: () => boolean; reportValidity?: () => boolean };
  proto.checkValidity = () => true;
  proto.reportValidity = () => true;
}

/** Helper-anrop som vakten spärrat sedan förra testet (exporteras för vaktens eget test). */
export const helperTraffic: string[] = [];
globalThis.fetch = guardFetch(globalThis.fetch, helperTraffic);

afterEach(() => {
  cleanup();
  assertNoHelperTraffic(helperTraffic);
});
