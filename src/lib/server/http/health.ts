/**
 * Hälsokontroll för server-first (#1079).
 *
 * ## Varför nginx `/healthz` inte räcker
 *
 * `nginx-selfhosted.conf` svarar `200 "ok"` på en statisk rad. Den säger att
 * NGINX lever — ingenting annat. Är server-first hängd eller Postgres
 * onåbar rapporterar den fortfarande frisk, och en övervakning som litar på
 * den startar aldrig om något.
 *
 * En hälsokontroll som inte kan gå sönder är värdelös. Den här rör därför den
 * verkliga vägen: den frågar databasen.
 *
 * ## Liveness vs readiness
 *
 *   /healthz   LIVENESS  — processen svarar. Snabb, rör inget nätverk.
 *              Faller den är processen hängd → starta om.
 *   /readyz    READINESS — processen KAN göra sitt jobb (db svarar).
 *              Faller den kan orsaken ligga utanför processen (db nere,
 *              nätverk) → starta INTE om blint; det gör bara saken värre.
 *
 * Skillnaden är inte akademisk: startar man om en app vars databas är nere
 * får man en omstartsloop som döljer den verkliga orsaken.
 *
 * ## Tidsgränsen
 *
 * Db-frågan är tidsbegränsad. Utan tak ärver hälsokontrollen just det problem
 * den ska upptäcka: hänger db-anropet hänger hälsokontrollen, övervakningen
 * får inget svar alls och tolkar det som nätverksfel i stället för som en
 * ohälsosam tjänst.
 */

/** Vad kontrollen kom fram till. `detail` är till för människan som felsöker. */
export interface HealthResult {
  status: "ok" | "degraded";
  checks: Record<string, { ok: boolean; detail?: string }>;
}

/** Db-ping: minsta möjliga fråga som bevisar att anslutningen lever. */
export type DbPing = () => Promise<unknown>;

/** Default-tak för db-pingen. Kort — en hälsokontroll ska svara, inte vänta. */
export const HEALTH_TIMEOUT_MS = 2_000;

/** Kör `p` med tak; kastar `Error("timeout")` när taket nås. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout efter ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Readiness: kan tjänsten göra sitt jobb? Kastar aldrig — ett fel ÄR svaret,
 * och en hälsokontroll som kastar ger 500 utan att säga varför.
 */
export async function checkReadiness(ping: DbPing, timeoutMs = HEALTH_TIMEOUT_MS): Promise<HealthResult> {
  try {
    await withTimeout(Promise.resolve(ping()), timeoutMs);
    return { status: "ok", checks: { database: { ok: true } } };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { status: "degraded", checks: { database: { ok: false, detail } } };
  }
}

/** JSON-svar med rätt statuskod. 503 på degraded — det är vad en lastbalanserare läser. */
function json(body: HealthResult): Response {
  return new Response(JSON.stringify(body), {
    status: body.status === "ok" ? 200 : 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Hälso-rutter framför den vanliga handlern. Returnerar null när sökvägen
 * inte är en hälso-rutt, så anroparen kan gå vidare till tRPC.
 *
 * Båda är ÖPPNA (ingen auth). En hälsokontroll bakom inloggning kan inte
 * användas av det som ska övervaka den, och svaret läcker inget: den säger
 * bara om databasen svarar.
 */
export async function handleHealthRoute(
  pathname: string, ping: DbPing, timeoutMs = HEALTH_TIMEOUT_MS,
): Promise<Response | null> {
  if (pathname === "/healthz") {
    // Liveness rör medvetet INGET nätverk: frågan är bara om event-loopen
    // fortfarande betjänar requests.
    return new Response("ok\n", { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  }
  if (pathname === "/readyz") return json(await checkReadiness(ping, timeoutMs));
  return null;
}
