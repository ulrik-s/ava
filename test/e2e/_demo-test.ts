/**
 * Delad `test` för demo-e2e:t — med en HERMETICITETS-VAKT (#932).
 *
 * Jobbet kallade sig "snabb + hermetisk" utan att vara det: `out/` serverades
 * på localhost, men appen hämtade sin data från live-demon på GH Pages. När
 * Pages låg nere blev PR:er röda av skäl som inte hade med diffen att göra, och
 * felet såg ut som en UI-regression (`/login` saknade sin knapp) i stället för
 * ett nätverksfel.
 *
 * Vakten gör antagandet till ett PÅSTÅENDE som testas: varje HTTP-förfrågan
 * utanför testets egen origin BLOCKERAS och samlas in, och testet fälls efteråt
 * med hela listan. Att blockera i stället för att bara logga är avsiktligt —
 * annars kan ett test passera på data det inte borde ha haft tillgång till, och
 * vi skulle inte veta att hermeticiteten gått sönder förrän Pages nästa gång
 * låg nere.
 *
 * Vakten är `auto: true` → gäller varje test som importerar `test` härifrån,
 * utan att specen behöver be om den. Den gäller även mot live-demon
 * (`AVA_DEMO_BASE_URL=https://…`): då är datan same-origin ändå, så kravet är
 * detsamma.
 */
import { type BrowserContext, type Page, test as base, expect } from "@playwright/test";

/**
 * Bas-URL för demo-e2e — lokalt serverad `out/` som default, live bara på
 * uttrycklig begäran. Specarna delar konstanten så defaultet finns på ETT
 * ställe; förr bar varje spec sin egen `?? "https://ulrik-s.github.io/ava"`.
 */
export const DEMO_BASE_URL = (
  process.env.AVA_DEMO_BASE_URL ?? `http://localhost:${process.env.DEMO_PORT ?? 8799}/ava`
).replace(/\/+$/, "");

/**
 * Seeda `ava.firma` INNAN sidan laddas — motsvarar vad `/login` skriver.
 *
 * `repo: ""` med flit: då härleder `demoDataBaseUrl` basen ur bundlets eget
 * repo → same-origin (#932). Att i stället stoppa in testets baseURL här skulle
 * tvinga fram same-origin i testet men dölja att APPEN gör fel för en riktig
 * besökare på en lokalt serverad `out/`.
 *
 * Behövs även för att localhost defaultar till `self-hosted` (→ 401):
 * `defaultConfigForHost` känner inte till att vi serverar en demo-`out/`.
 */
export async function seedDemoConfig(
  target: Page | BrowserContext,
  overrides: Record<string, string> = {},
): Promise<void> {
  await target.addInitScript((cfg) => {
    try {
      localStorage.setItem("ava.firma", JSON.stringify(cfg));
    } catch { /* privat läge e.d. — testet failar i så fall på annat sätt */ }
  }, {
    tier: "demo", repo: "", token: "",
    principalId: "", organizationId: "",
    authorName: "AVA Demo", authorEmail: "demo@ava.local",
    ...overrides,
  });
}

/**
 * Som `seedDemoConfig`, men INLOGGAD — sidor bakom auth (ärenden, kontakter,
 * fakturor) dirigerar annars till `/login` och specen ser bara inloggningen.
 *
 * Användaren läses ur den serverade `.ava/meta.json` i stället för att
 * hårdkodas: seed-datat genereras om vid varje `build:demo`, och en hårdkodad
 * UUID hade tystnat till "sidan renderar inte" nästa gång seeden ändras.
 */
export async function seedDemoLogin(page: Page, baseUrl: string = DEMO_BASE_URL): Promise<void> {
  const url = `${baseUrl}/.ava/meta.json`;
  const res = await page.request.get(url);
  if (!res.ok()) {
    throw new Error(`kunde inte läsa ${url}: HTTP ${res.status()} — är out/ byggd och serverad?`);
  }
  const meta = await res.json() as {
    organizationId: string;
    users: Array<{ id: string; name: string; role: string }>;
  };
  const user = meta.users.find((u) => u.role === "ADMIN") ?? meta.users[0];
  if (!user) throw new Error(`${url} saknar users — build-demo-repo har inte seedat klart`);
  await seedDemoConfig(page, {
    principalId: user.id,
    organizationId: meta.organizationId,
    authorName: user.name,
  });
}

/** Icke-HTTP (`data:`, `blob:`, `about:`) är inte nätverk — släpp igenom. */
function isNetworkUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Den enda tillåtna trafiken utanför sidans origin: AVA Helper-proben, som
 * demon kör för att upptäcka om skrivbordshelpern finns. Den lyssnar på två
 * transporter (ADR 0006) — HTTP på 127.0.0.1 och HTTPS på localhost — och båda
 * är loopback, alltså oförmögna att nå internet.
 *
 * Vi släpper igenom exakt de två origins:en, inte loopback i allmänhet: en
 * generös regel hade missat att demon hämtade sin data från
 * `http://localhost:8080/git/firma.git`, vilket är precis vad den här vakten
 * fann. Speglar `HELPER_BASE` / `HELPER_HTTPS_BASE` i
 * `src/lib/shared/helper/protocol.ts` (duplicerat med flit — testet ska inte
 * importera produktionskonstanter det är satt att granska).
 */
const HELPER_PROBE_ORIGINS = ["http://127.0.0.1:48761", "https://localhost:48762"];

export const test = base.extend<{ offsiteRequests: string[] }>({
  offsiteRequests: [
    async ({ page, baseURL }, use) => {
      const offsite: string[] = [];
      const ownOrigin = new URL(baseURL ?? "http://localhost:8799").origin;

      await page.route("**/*", async (route) => {
        const url = route.request().url();
        const origin = isNetworkUrl(url) ? new URL(url).origin : ownOrigin;
        if (origin !== ownOrigin && !HELPER_PROBE_ORIGINS.includes(origin)) {
          offsite.push(url);
          // `blockedbyclient` speglar vad en offline-miljö gör, så appen ser
          // samma felläge som i CI utan nät.
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });

      await use(offsite);

      expect(
        offsite,
        `demon gick utanför sin egen origin (${ownOrigin}) — testet är inte hermetiskt`,
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
