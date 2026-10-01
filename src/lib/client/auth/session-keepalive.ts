/**
 * Sessionen hålls vid liv medan appen är öppen (#1425).
 *
 * oauth2-proxy förnyar sessionen när den är äldre än `COOKIE_REFRESH` — på
 * vilket anrop som helst, också `/oauth2/auth`. `/api` gat:as i Caddy med
 * `forward_auth` mot `/oauth2/auth`, och vid 2xx skickas auth-svarets
 * `Set-Cookie` aldrig till webbläsaren. Förnyelsen sparas då inte, och proxyn
 * förnyar om mot IdP:n på VARJE API-anrop. Anrop under `/oauth2/*` går via
 * `reverse_proxy` och får med `Set-Cookie` — därför frågar klienten
 * `/oauth2/userinfo` med jämna mellanrum: förnyelsen landar då på en väg där
 * den nya cookien når webbläsaren.
 *
 * Utfallet går in i det vanliga sessionsläget, aldrig i en omdirigering:
 *
 *   - `authenticated` → inget.
 *   - `signed-out`    → bannern "Logga in igen" (som efter ett 401 vid synk).
 *   - `unreachable`   → inget; nästa fråga försöker igen (som omvalideringen
 *     vid synk — ett tillfälligt avbrott är inget besked om sessionen).
 *   - `absent`        → ingen OIDC i driften: inget att hålla vid liv, stopp.
 *
 * En flik räcker: cookien delas av alla flikar. Web Locks väljer den flik som
 * frågar med jämna mellanrum; stängs den tar nästa flik över låset. Där Web
 * Locks saknas (osäker sida) frågar varje flik — några extra billiga anrop
 * mot proxyn, inga mot IdP:n. En flik som blir synlig igen, eller får nätet
 * tillbaka, frågar själv (med en kort debounce): den är på väg att göra
 * API-anrop, och den valda fliken kan vara strypt i bakgrunden.
 */

import { isDemoTier, loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { setSessionNotice, type SessionNotice } from "./session-notice";
import { probeSession, type SessionProbe } from "./session-probe";

/**
 * Hur ofta proxyn frågas. Måste ligga väl under oauth2-proxy:s
 * `COOKIE_REFRESH` (30 min i prod, `docker-compose.production.yml`): proxyn
 * förnyar först när sessionen är äldre än så, och anropen till `/api` under
 * tiden tills nästa fråga förnyar utan att spara. Med 5 min av 30 är det
 * fönstret högst en sjättedel av tiden i stället för hela.
 * `test/unit/tooling/session-refresh.test.ts` fäller ett intervall som inte
 * ligger väl under prod-stackarnas `COOKIE_REFRESH`.
 */
export const SESSION_KEEPALIVE_INTERVAL_MS = 5 * 60_000;

/** Väntan efter `visibilitychange`/`online` — en väckt laptop ger båda på en gång. */
export const SESSION_KEEPALIVE_DEBOUNCE_MS = 2_000;

/** Låset som väljer den flik som frågar med jämna mellanrum. */
export const SESSION_KEEPALIVE_LOCK_NAME = "ava-session-keepalive";

/** Den del av `navigator.locks` som används (injicerbar i tester). */
export interface KeepaliveLocks {
  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<void>;
}

/** Det keepalive:n behöver ur webbläsaren (injicerbart i tester). */
export interface KeepaliveEnv {
  probe: () => Promise<SessionProbe>;
  /** Visa "Logga in igen"-bannern. */
  notify: (notice: SessionNotice) => void;
  /** Är någon inloggad? Nej (utloggad, här eller i en annan flik) → stopp. */
  signedIn: () => boolean;
  /** Där `online` kommer (window). */
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Där `visibilitychange` kommer (document). */
  page: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  /** Web Locks, eller undefined där de saknas (då frågar varje flik). */
  locks: KeepaliveLocks | undefined;
  intervalMs?: number;
  debounceMs?: number;
}

interface KeepaliveState {
  stopped: boolean;
  inFlight: boolean;
}

/** Svaret → sessionsläget. Bara `signed-out` är ett besked; `absent` = inget att hålla vid liv. */
function applyProbe(probe: SessionProbe, notify: KeepaliveEnv["notify"], stop: () => void): void {
  if (probe.kind === "signed-out") notify("signed-out");
  else if (probe.kind === "absent") stop();
}

/** En fråga — aldrig två samtidigt, och ingen efter utloggning. */
async function keepaliveOnce(env: KeepaliveEnv, state: KeepaliveState, stop: () => void): Promise<void> {
  if (state.stopped || state.inFlight) return;
  if (!env.signedIn()) { stop(); return; }
  state.inFlight = true;
  try {
    const probe = await env.probe();
    if (!state.stopped) applyProbe(probe, env.notify, stop);
  } finally {
    state.inFlight = false;
  }
}

/**
 * Kör `lead` i den flik som får låset; den håller det tills stoppet. Utan
 * Web Locks leder varje flik. Returnerar stoppet (släpper låset, eller
 * avbryter väntan på det).
 */
export function electLeader(locks: KeepaliveLocks | undefined, lead: () => () => void): () => void {
  if (!locks) return lead();
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  locks.request(SESSION_KEEPALIVE_LOCK_NAME, { signal: controller.signal }, async () => {
    const stopLeading = lead();
    await held;
    stopLeading();
  }).catch(() => undefined); // avbruten innan låset gavs
  return () => { controller.abort(); release?.(); };
}

/** Starta keepalive:n. Returnerar stoppet (vid avmontering). */
export function startSessionKeepalive(env: KeepaliveEnv): () => void {
  const state: KeepaliveState = { stopped: false, inFlight: false };
  const cleanups: Array<() => void> = [];
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    if (state.stopped) return;
    state.stopped = true;
    clearTimeout(debounce);
    for (const cleanup of cleanups) cleanup();
  };
  const tick = (): void => { void keepaliveOnce(env, state, stop); };
  const trigger = (): void => {
    clearTimeout(debounce);
    debounce = setTimeout(tick, env.debounceMs ?? SESSION_KEEPALIVE_DEBOUNCE_MS);
  };
  const onVisibility = (): void => { if (env.page.visibilityState === "visible") trigger(); };
  env.events.addEventListener("online", trigger);
  env.page.addEventListener("visibilitychange", onVisibility);
  cleanups.push(
    () => { env.events.removeEventListener("online", trigger); },
    () => { env.page.removeEventListener("visibilitychange", onVisibility); },
    electLeader(env.locks, () => {
      const timer = setInterval(tick, env.intervalMs ?? SESSION_KEEPALIVE_INTERVAL_MS);
      return () => { clearInterval(timer); };
    }),
  );
  return stop;
}

/** Keepalive:n i webbläsaren — inte i demon, som saknar proxy. */
export function startBrowserSessionKeepalive(): () => void {
  if (isDemoTier()) return () => undefined;
  return startSessionKeepalive({
    probe: () => probeSession(),
    notify: setSessionNotice,
    signedIn: () => Boolean(loadFirmaConfig().principalId),
    events: window,
    page: document,
    locks: typeof navigator === "undefined" ? undefined : navigator.locks,
  });
}
