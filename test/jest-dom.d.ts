/**
 * Augmenterar bun:test:s `expect` med @testing-library/jest-dom-matchers
 * (toBeInTheDocument, toHaveAttribute …). Explicit modul-augmentering krävs
 * — jest-doms egna typer riktar sig mot jest/vitest, inte bun:test (#92).
 */
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
   
  interface Matchers<T = unknown> extends TestingLibraryMatchers<unknown, T> {
    // vitest-matchers som finns i buns runtime men saknas i bun-types (#92).
    toHaveBeenCalledOnce(): void;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, void> {}
}
