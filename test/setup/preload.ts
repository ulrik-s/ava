/**
 * Andra bun:test-preloaden (#92) — motsvarar gamla vitest.setup.ts.
 * happy-dom är redan registrerad (se happy-dom-register.ts, körs först),
 * så här kan vi tryggt importera Testing Library.
 *
 *   - Kopplar in @testing-library/jest-dom-matchers (toBeInTheDocument …).
 *   - Rensar renderad DOM mellan tester.
 */

import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "bun:test";

expect.extend(matchers as unknown as Parameters<typeof expect.extend>[0]);

// happy-dom enforce:ar HTML5-constraint-validation vid form-submit (ett tomt
// `required`-fält blockerar submit); jsdom gjorde inte det. Stäng av så
// submit-tester beter sig som under vitest+jsdom.
for (const Ctor of [HTMLFormElement, HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, HTMLButtonElement]) {
  const proto = Ctor.prototype as { checkValidity?: () => boolean; reportValidity?: () => boolean };
  proto.checkValidity = () => true;
  proto.reportValidity = () => true;
}

afterEach(() => {
  cleanup();
});
