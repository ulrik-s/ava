/**
 * Delad `test` för ALLA e2e-specar — isolerar dem från den riktiga AVA Helper
 * (#1368).
 *
 * Webbappen probar helpern på standardporten på loopback. När e2e-sviten körs
 * på utvecklarens dator svarar den RIKTIGA helpern: "Generera + öppna mail" gick
 * till `/compose-mail` och Mail.app startade om och om igen, och `/open` öppnade
 * dokument i riktiga program.
 *
 * Två lager, båda `auto` så ingen spec behöver be om dem:
 *   1. `helperBase` (option, default `DEAD_HELPER_BASE`) skrivs till
 *      `localStorage["ava.helperBase"]` med ett init-skript INNAN appens kod kör
 *      → appen probar bara den basen (`probeBases` i use-helper.ts). En spec som
 *      testar helper-flöden sätter sin egen bas med
 *      `test.use({ helperBase: "http://127.0.0.1:<port>" })` och fejkar/startar
 *      helpern där.
 *   2. Vakten: varje förfrågan till helperns STANDARD-origins avbryts och
 *      noteras, och testet fälls efteråt med listan. Lager 1 får alltså inte
 *      kringgås i tysthet (t.ex. av en service worker eller en ny kodväg som
 *      inte läser overriden).
 *
 * Standard-origins speglar `HELPER_BASE` / `HELPER_HTTPS_BASE` i
 * `src/lib/shared/helper/protocol.ts` — duplicerat med flit: testet ska inte
 * importera produktionskonstanter det är satt att granska.
 */
import { test as base, expect } from "@playwright/test";

/**
 * En bas där ingen helper kan svara: port 9 (discard) på loopback. Chromium
 * spärrar porten (ERR_UNSAFE_PORT), och vakten avbryter den ändå — proben
 * misslyckas direkt utan att något nätverk berörs.
 */
export const DEAD_HELPER_BASE = "http://127.0.0.1:9";

/** Helperns standard-transporter (ADR 0006): HTTP på 127.0.0.1, HTTPS på localhost. */
export const DEFAULT_HELPER_ORIGINS: readonly string[] = ["http://127.0.0.1:48761", "https://localhost:48762"];

/** localStorage-nyckeln appen läser (`HELPER_BASE_OVERRIDE_KEY`). */
export const HELPER_BASE_OVERRIDE_KEY = "ava.helperBase";

/**
 * Sant för origins som hör till helper-isoleringen (standard-origins + testets
 * egen bas). `_demo-test`:s hermeticitetsvakt släpper dem vidare hit i stället
 * för att räkna dem som utanför-origin-trafik.
 */
export function isHelperOrigin(origin: string, helperBase: string): boolean {
  return DEFAULT_HELPER_ORIGINS.includes(origin) || origin === new URL(helperBase).origin;
}

export const test = base.extend<{ helperBase: string; defaultHelperHits: string[] }>({
  helperBase: [DEAD_HELPER_BASE, { option: true }],
  defaultHelperHits: [
    async ({ context, helperBase }, use) => {
      const hits: string[] = [];
      await context.addInitScript(([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch { /* privat läge — vakten nedan fångar ändå standardporten */ }
      }, [HELPER_BASE_OVERRIDE_KEY, helperBase] as const);
      for (const origin of DEFAULT_HELPER_ORIGINS) {
        await context.route(`${origin}/**`, async (route) => {
          hits.push(route.request().url());
          await route.abort("connectionrefused");
        });
      }
      await context.route(`${DEAD_HELPER_BASE}/**`, (route) => route.abort("connectionrefused"));

      await use(hits);

      expect(hits, "testet nådde AVA Helpers standardport — sätt helperBase (#1368)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
