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

// ── Seed-uppslagning (#972) ───────────────────────────────────────────────

/**
 * Den del av demons `demo-seed.json` som e2e:t behöver för att hitta sina
 * fixtures. Samma fil appen själv hydrerar ur, så det testet slår upp är per
 * definition det användaren ser.
 *
 * Bakgrund: specarna navigerade till `m-001-vardnad`, `inv-001` och liknande
 * slugs. Seeden översätter numera allt till UUID:n (`translateSeed`), så de
 * sidorna finns inte — och eftersom specarna låg utanför alla configar (#932)
 * märktes det aldrig. Att slå upp id:t i stället för att hårdkoda det är samma
 * mönster som `seedDemoLogin` redan använder för användaren: ett hårdkodat id
 * TYSTNAR till "sidan renderar inte" nästa gång seeden ändras, medan en
 * uppslagning som inte hittar något säger vad som saknas.
 */
export interface DemoSeed {
  matters: Array<{ id: string; title: string }>;
  contacts: Array<{ id: string; name: string }>;
  invoices: Array<{ id: string; matterId: string }>;
  documents: Array<{ id: string; matterId: string; title: string }>;
  timeEntries: Array<{ id: string; matterId: string; description: string }>;
  expenses: Array<{ id: string; matterId: string; description: string }>;
  paymentPlans: Array<{ id: string; invoiceId: string; status: string }>;
  billingRuns: Array<{ id: string; matterId: string; type: string; status: string; kostnadsrakningStatus?: string }>;
}

/** Kostnadsräkningens livscykel-status (#828). */
export type KrStatus = "INSKICKAD" | "BESLUTAD" | "OVERKLAGAD" | "FAKTURERAD";

/**
 * Ärendet vars kostnadsräkning står i `status` (#996/#828). Slås upp i datan i
 * stället för att hårdkodas: VILKET brottmål som vilar i vilket läge bestäms av
 * scenariodispatchern (#882), och flyttas det hör ändringen hemma där — inte i
 * en spec. Saknas läget är det demodatan som tappat det, och felet säger så.
 */
export function matterWithKrStatus(seed: DemoSeed, status: KrStatus): string {
  const hit = seed.billingRuns.find((r) => r.type === "KOSTNADSRAKNING" && r.kostnadsrakningStatus === status);
  if (!hit) throw new Error(`seeden saknar kostnadsräkning i ${status} — demons livscykel-lägen är ofullständiga (#828 steg 6)`);
  return hit.matterId;
}

/** Grupper som bär `matterId` — det e2e:t kan kräva att ett ärende har. */
export type MatterScopedKey = "documents" | "timeEntries" | "expenses" | "invoices";

/** Hämta demons egen seed ur den serverade `out/`. */
export async function fetchDemoSeed(page: Page, baseUrl: string = DEMO_BASE_URL): Promise<DemoSeed> {
  const url = `${baseUrl}/demo-seed.json`;
  const res = await page.request.get(url);
  if (!res.ok()) {
    throw new Error(`kunde inte läsa ${url}: HTTP ${res.status()} — är out/ byggd och serverad?`);
  }
  return await res.json() as DemoSeed;
}

/**
 * Id:t för det första ärendet (id-sorterat → stabilt mellan körningar) som har
 * rader i ALLA angivna grupper. Kravet skrivs ut i felmeddelandet, så en spec
 * som tappar sin fixture säger vad seeden slutade producera i stället för att
 * fälla på en tom sida.
 */
export function matterIdWith(seed: DemoSeed, ...required: MatterScopedKey[]): string {
  const has = (key: MatterScopedKey, id: string): boolean => seed[key].some((r) => r.matterId === id);
  const hit = seed.matters.map((m) => m.id).sort()
    .find((id) => required.every((key) => has(key, id)));
  if (hit === undefined) throw new Error(`seeden saknar ärende med ${required.join(" + ")}`);
  return hit;
}

/** Seed-raderna som hör till ett ärende — det sidan ska visa. */
export function rowsForMatter<K extends MatterScopedKey>(
  seed: DemoSeed, key: K, matterId: string,
): DemoSeed[K] {
  return seed[key].filter((r) => r.matterId === matterId) as DemoSeed[K];
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
