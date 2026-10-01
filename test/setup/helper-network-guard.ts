/**
 * Nätverksvakt mot AVA Helper i enhetstesterna (#1368).
 *
 * Webbappen probar helpern på loopback (`HELPER_BASE` / `HELPER_HTTPS_BASE`).
 * Ett test som anropar den koden utan att stubba `fetch` når då den RIKTIGA
 * helpern på utvecklarens dator — som öppnar dokument i riktiga program och
 * Mail.app via `/compose-mail`. Produktionskoden sväljer felet (`pingText`,
 * `tryHelperOpen` …), så testet ser grönt ut medan det skickar trafik.
 *
 * Vakten lindar den globala `fetch` (installeras i preloaden): ett anrop mot en
 * helper-port avvisas direkt, och URL:en noteras. `assertNoHelperTraffic` körs
 * efter varje test och fäller det med listan — ett svalt fel i produktions-
 * koden räcker inte för att dölja anropet. Ett test som installerat en egen
 * `fetch`-stubb ersätter vakten och påverkas inte.
 */
import { HELPER_HTTPS_PORT, HELPER_PORT } from "@/lib/shared/helper/protocol";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);
const HELPER_PORTS: ReadonlySet<string> = new Set([String(HELPER_PORT), String(HELPER_HTTPS_PORT)]);

/** URL:en ur vad `fetch` än fick som första argument. */
export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Sant om URL:en pekar på helperns standardport på loopback. */
export function isHelperUrl(url: string): boolean {
  if (!URL.canParse(url)) return false; // relativ URL → testets egen origin
  const parsed = new URL(url);
  return LOOPBACK_HOSTS.has(parsed.hostname) && HELPER_PORTS.has(parsed.port);
}

/** Felet ett blockerat helper-anrop avvisas med. */
export class HelperNetworkError extends Error {
  constructor(url: string) {
    super(`enhetstest försökte nå den riktiga AVA Helper (${url}) — stubba fetch i testet (#1368)`);
    this.name = "HelperNetworkError";
  }
}

/**
 * `real` lindad: helper-URL:er avvisas och noteras i `violations`, allt annat
 * går vidare oförändrat. Bevarar `real`:s övriga egenskaper (Bun:s
 * `fetch.preconnect`).
 */
export function guardFetch(real: typeof fetch, violations: string[]): typeof fetch {
  const guarded = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (!isHelperUrl(url)) return real(input, init);
    violations.push(url);
    return Promise.reject(new HelperNetworkError(url));
  };
  return Object.assign(guarded, { preconnect: real.preconnect });
}

/** Kastar om något helper-anrop noterats sedan förra kontrollen; tömmer listan. */
export function assertNoHelperTraffic(violations: string[]): void {
  if (violations.length === 0) return;
  const urls = violations.splice(0).join(", ");
  throw new Error(`testet försökte nå den riktiga AVA Helper: ${urls} — stubba fetch (#1368)`);
}
