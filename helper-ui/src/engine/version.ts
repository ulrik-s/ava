/**
 * Versionen bakas in vid build (`bundle.ts`: release-taggen, t.ex. `v0.7.24`).
 * Vid dev-körning (`bun src/main.ts`) är symbolen odeklarerad → "dev".
 *
 * `typeof <odeklarerad>` är säkert i JS (kastar inte) → fallbacken
 * funkar utan att symbolen behöver finnas.
 */

declare const __AVA_HELPER_VERSION__: string | undefined;

export const VERSION: string =
  typeof __AVA_HELPER_VERSION__ !== "undefined" ? __AVA_HELPER_VERSION__ : "dev";
