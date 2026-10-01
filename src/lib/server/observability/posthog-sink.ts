/**
 * Felrapportering till PostHog i EU-regionen (#1343).
 *
 * ## Varför EU och varför så lite data
 *
 * Felen kommer från en advokatbyrås server. PostHog EU Cloud ligger i
 * Frankfurt (AWS eu-central-1); standardvärden är därför
 * `https://eu.i.posthog.com` och en amerikansk värd vägras helt. Utan
 * `AVA_POSTHOG_KEY` är rapporteringen av. PostHog är personuppgiftsbiträde —
 * byrån behöver ett biträdesavtal (DPA) innan nyckeln sätts. Se
 * `docs/observability.md`.
 *
 * Det som skickas är exakt `ErrorReport` (se `error-reporter.ts`): felklass,
 * maskinläsbar felkod, procedur, request-id och stackramar (fil:rad + funktion).
 * Aldrig felmeddelandet, användare, byrå, e-post, namn, indata eller URL:er.
 * `distinct_id` är konstant och inga personprofiler eller geoIP skapas.
 *
 * ## Protokollet
 *
 * PostHogs capture-API (https://posthog.com/docs/api/capture,
 * https://posthog.com/docs/error-tracking/installation/manual):
 * `POST {värd}/i/v0/e/` med `{ token, event: "$exception", timestamp,
 * properties: { distinct_id, $exception_list: [{ type, value, mechanism,
 * stacktrace: { type: "raw", frames } }] } }`; varje ram kräver
 * `platform: "custom"`, `lang` och `function`.
 *
 * ## Aldrig i vägen
 *
 * Sändningen väntas inte in, har timeout, och högst `maxInFlight` åt gången
 * (resten kastas). Ett 429 pausar sändningen i `Retry-After` sekunder (default
 * 60). Ett fel mot mottagaren sväljs och loggas inte (det kunde loopa).
 */

import { z } from "zod";
import { setErrorReporter, type ErrorReport, type ErrorReporter } from "./error-reporter";

/** PostHog EU Cloud (Frankfurt). Den enda förvalda värden. */
export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

/** Mottagaren. */
export interface ErrorSinkConfig {
  /** `{värd}/i/v0/e/` */
  endpoint: string;
  /** Projektets token (`phc_…`). Inget hemligt i sig, men loggas aldrig. */
  token: string;
  environment: string;
  release?: string;
}

const SAFE_LABEL = /^[\w.+-]{1,64}$/;

/** Amerikansk PostHog-värd — vägras, även som uttryckligt val. */
function isUsPosthogHost(host: string): boolean {
  return /(^|\.)us(\.i)?\.posthog\.com$/i.test(host);
}

const HostSchema = z.url({ protocol: /^https$/ }).transform((raw, ctx) => {
  const url = new URL(raw);
  if (isUsPosthogHost(url.hostname)) {
    ctx.addIssue({ code: "custom", message: "amerikansk PostHog-värd är inte tillåten" });
    return z.NEVER;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
});

const EnvSchema = z.object({
  AVA_POSTHOG_KEY: z.string().trim().optional(),
  AVA_POSTHOG_HOST: z.string().trim().optional(),
  AVA_ERROR_ENVIRONMENT: z.string().trim().regex(SAFE_LABEL).optional().catch(undefined),
  AVA_RELEASE: z.string().trim().regex(SAFE_LABEL).optional().catch(undefined),
});

const TOKEN = /^phc_[A-Za-z0-9]{8,}$/;

/** Av, felkonfigurerad eller på — en felaktig nyckel/värd ska synas, inte tyst bli "av". */
export type ErrorSinkSetup =
  | { kind: "off" }
  | { kind: "invalid"; reason: "key" | "host" }
  | { kind: "on"; config: ErrorSinkConfig };

export function errorSinkFromEnv(env: Readonly<Record<string, string | undefined>>): ErrorSinkSetup {
  const parsed = EnvSchema.parse(env);
  if (!parsed.AVA_POSTHOG_KEY) return { kind: "off" };
  if (!TOKEN.test(parsed.AVA_POSTHOG_KEY)) return { kind: "invalid", reason: "key" };
  const host = HostSchema.safeParse(parsed.AVA_POSTHOG_HOST || POSTHOG_EU_HOST);
  if (!host.success) return { kind: "invalid", reason: "host" };
  return {
    kind: "on",
    config: {
      endpoint: `${host.data}/i/v0/e/`,
      token: parsed.AVA_POSTHOG_KEY,
      environment: parsed.AVA_ERROR_ENVIRONMENT ?? "production",
      ...(parsed.AVA_RELEASE ? { release: parsed.AVA_RELEASE } : {}),
    },
  };
}

/** En stackram i PostHogs råformat. */
function rawFrame(frame: ErrorReport["frames"][number]): Record<string, unknown> {
  return {
    platform: "custom",
    lang: "javascript",
    function: frame.function ?? "<anonymous>",
    filename: frame.filename,
    lineno: frame.lineno,
    ...(frame.colno !== undefined ? { colno: frame.colno } : {}),
    in_app: frame.in_app,
    resolved: true,
  };
}

/** PostHog-händelsen för en rapport — exakt de fält som får lämna servern. */
export function posthogEvent(report: ErrorReport, config: ErrorSinkConfig): Record<string, unknown> {
  return {
    token: config.token,
    event: "$exception",
    timestamp: report.timestamp,
    properties: {
      distinct_id: "ava-server",
      $process_person_profile: false,
      $geoip_disable: true,
      environment: config.environment,
      ...(config.release ? { release: config.release } : {}),
      ...(report.path ? { procedure: report.path } : {}),
      ...(report.requestId ? { request_id: report.requestId } : {}),
      ...(report.errorCode ? { error_code: report.errorCode } : {}),
      $exception_list: [{
        type: report.type,
        ...(report.errorCode ? { value: report.errorCode } : {}),
        mechanism: { handled: true, synthetic: false },
        stacktrace: { type: "raw", frames: report.frames.map(rawFrame) },
      }],
    },
  };
}

/** Det enda av svaret som läses. `fetch`:s `Response` uppfyller den. */
export interface SinkResponse {
  status: number;
  headers: { get(name: string): string | null };
}

export type SinkSend = (url: string, init: RequestInit) => Promise<SinkResponse>;

export interface SinkOptions {
  send?: SinkSend;
  now?: () => Date;
  /** Samtidiga sändningar; fler kastas. */
  maxInFlight?: number;
  timeoutMs?: number;
}

/** 429 utan läsbar `Retry-After` → 60 s. */
export function retryAfterMs(response: SinkResponse): number {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

/** Mottagaren som skickar rapporterna. Kastar aldrig, väntar aldrig. */
export function posthogReporter(config: ErrorSinkConfig, options: SinkOptions = {}): ErrorReporter {
  const { send = fetch, now = () => new Date(), maxInFlight = 4, timeoutMs = 5000 } = options;
  let inFlight = 0;
  let pausedUntil = 0;
  const onResponse = (response: SinkResponse): void => {
    if (response.status === 429) pausedUntil = now().getTime() + retryAfterMs(response);
  };
  return (report) => {
    if (inFlight >= maxInFlight || now().getTime() < pausedUntil) return;
    inFlight++;
    void send(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(posthogEvent(report, config)),
      signal: AbortSignal.timeout(timeoutMs),
    }).then(onResponse, () => undefined).finally(() => { inFlight--; });
  };
}

/** Statusraden för serverns startlogg — värden, aldrig nyckeln. */
function statusLine(setup: ErrorSinkSetup): string {
  if (setup.kind === "off") return "felrapportering: av (AVA_POSTHOG_KEY saknas)";
  if (setup.kind === "invalid") {
    return setup.reason === "key"
      ? "felrapportering: AV — AVA_POSTHOG_KEY är ogiltig (väntat phc_…)"
      : "felrapportering: AV — AVA_POSTHOG_HOST är ogiltig eller amerikansk (EU är standard)";
  }
  return `felrapportering: PostHog ${new URL(setup.config.endpoint).host} (${setup.config.environment})`;
}

/** Slå på rapporteringen om en nyckel är satt; returnerar statusraden. */
export function startErrorReporting(
  env: Readonly<Record<string, string | undefined>>,
  install: (reporter: ErrorReporter) => unknown = setErrorReporter,
  options?: SinkOptions,
): string {
  const setup = errorSinkFromEnv(env);
  if (setup.kind === "on") install(posthogReporter(setup.config, options));
  return statusLine(setup);
}
