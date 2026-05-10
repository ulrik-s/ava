/**
 * Globalt vitest-setup som körs INNAN varje testfil.
 * - Kopplar in @testing-library/jest-dom så `expect(el).toBeInTheDocument()` fungerar.
 * - Tar bort React-renderade DOM-element mellan tester (jsdom-projektet).
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
