/**
 * `demoDataBaseUrl` — var demons DATA ligger (`.ava/meta.json`, `manifest.json`,
 * seed-JSON, dokument-blobbar).
 *
 * ## Varför den här funktionen finns (#932)
 *
 * `build-demo.sh` seedar datan **direkt in i `out/`**, så appen och dess data
 * serveras alltid från samma origin — på GH Pages såväl som från en lokalt
 * serverad `out/`. Trots det KONSTRUERADE alla laddare sin bas-URL ur
 * firma-config:ens repo-sträng via `resolveGhPagesUrl`, dvs. `ulrik-s/ava` →
 * `https://ulrik-s.github.io/ava`.
 *
 * Konsekvensen: en `out/` som serverades på `localhost:8799` NAVIGERADE lokalt
 * men HÄMTADE data över nätet från live-demon. Demo-e2e:t kallade sig hermetiskt
 * utan att vara det, och blev rött när GH Pages låg nere — med ett missvisande
 * fel (`/login` saknade sin knapp, eftersom formuläret väntar på användarlistan
 * som aldrig kom).
 *
 * ## Regeln
 *
 * 1. Inte en demo-build (t.ex. `next dev`, server-builden) → oförändrat
 *    beteende: gissa fram GH Pages-URL:en ur repo-strängen.
 * 2. Config:en pekar på ett ANNAT repo än det bundlen byggdes för → användaren
 *    vill uttryckligen se någon annans demo → GH Pages-URL för det repot.
 * 3. Annars → **same-origin**. Datan ligger bredvid appen; att hämta den över
 *    nätet vore fel även när det råkar fungera.
 *
 * På GH Pages ger regel 3 exakt samma URL som den gamla konstruktionen
 * (`origin` + `basePath` = `https://ulrik-s.github.io` + `/ava`), så
 * produktionsbeteendet är oförändrat — skillnaden är att URL:en nu HÄRLEDS ur
 * var appen faktiskt kör i stället för att gissas fram ur en sträng.
 */

import { DEMO_REPO } from "@/lib/client/firma/firma-config";
import { resolveGhPagesUrl } from "@/lib/shared/gh-pages-url";

/** Injicerbara byggtids-/runtime-fakta — gör funktionen ren och testbar. */
export interface DemoDataBaseEnv {
  /** `window.location.origin`, t.ex. `http://localhost:8799`. */
  origin?: string | undefined;
  /** Next:s `basePath`, t.ex. `/ava`. */
  basePath?: string | undefined;
  /** Repot bundlen byggdes för (`NEXT_PUBLIC_DEMO_REPO` vid build). */
  buildRepo?: string | undefined;
  /** Är det här en statisk demo-build (data seedad i `out/`)? */
  isDemoBuild?: boolean | undefined;
}

/** Samma fält som `DemoDataBaseEnv`, men allt ifyllt (inget `undefined` kvar). */
interface ResolvedEnv {
  origin: string;
  basePath: string;
  buildRepo: string;
  isDemoBuild: boolean;
}

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

/** Tom sträng under SSR/prerender — där finns ingen origin att utgå från. */
const currentOrigin = (): string => (typeof window === "undefined" ? "" : window.location.origin);
const buildBasePath = (): string => process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? "";
/** Satt av `build-demo.sh`, som ALLTID seedar datan in i `out/`. */
const isStaticDemoBuild = (): boolean => process.env.NEXT_PUBLIC_DEMO_BUILD === "1";

function readEnv(env: DemoDataBaseEnv = {}): ResolvedEnv {
  const {
    origin = currentOrigin(),
    basePath = buildBasePath(),
    buildRepo = DEMO_REPO,
    isDemoBuild = isStaticDemoBuild(),
  } = env;
  return { origin, basePath, buildRepo, isDemoBuild };
}

/**
 * Bas-URL (utan avslutande `/`) att hämta demons data från.
 *
 * @param repo firma-config:ens `repo` — kortform (`user/repo`), full
 *   github.com-URL, eller en färdig bas-URL som returneras som-är.
 */
export function demoDataBaseUrl(repo: string, env?: DemoDataBaseEnv): string {
  const { origin, basePath, buildRepo, isDemoBuild } = readEnv(env);
  const wanted = stripTrailingSlash(repo || buildRepo);

  // Regel 1 + skyddsnät för SSR (inget `window` → inget origin att utgå från).
  if (!isDemoBuild || !origin) return resolveGhPagesUrl(wanted);
  // Regel 2: uttryckligen pekad mot ett annat repos demo.
  if (wanted !== stripTrailingSlash(buildRepo)) return resolveGhPagesUrl(wanted);
  // Regel 3: datan ligger bredvid appen.
  return stripTrailingSlash(`${origin}${basePath}`);
}
