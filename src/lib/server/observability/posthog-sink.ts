/**
 * Felrapportering till PostHog (#1080).
 *
 * Loggern (`@/lib/shared/observability/logger`) skriver strukturerade poster;
 * den här destinationen skickar felen (`level: "error"`) till PostHogs
 * felspårning som `$exception`-händelser. Samma regel som loggen: det som
 * inte skickas kan inte läcka. Händelsen byggs BARA av postens deklarerade
 * fält — ingen tRPC-input, inga namn, ingen e-post — och `message` är redan
 * maskerat (`redact.ts`). Ingen personprofil skapas i PostHog.
 *
 * Bäst-möjligt: ett fel mot PostHog loggas inte (det skulle loopa) och fäller
 * aldrig anropet som loggade.
 *
 * API: https://posthog.com/docs/error-tracking/installation/manual —
 * `POST {host}/i/v0/e/` med projektets token.
 */

import type { LogRecord, LogSink } from "@/lib/shared/observability/logger";

/** PostHog-projektets värd (region) och token. */
export interface PosthogConfig {
  host: string;
  token: string;
}

/** Projektets region avgör värden; AVA:s projekt ligger i US. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/** `AVA_POSTHOG_KEY` (+ valfri `AVA_POSTHOG_HOST`); null = av. */
export function posthogConfigFromEnv(env: Readonly<Record<string, string | undefined>>): PosthogConfig | null {
  const token = env.AVA_POSTHOG_KEY?.trim();
  if (!token) return null;
  return { token, host: (env.AVA_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST).replace(/\/+$/, "") };
}

/** Postens fält som följer med som egenskaper — ids och koder, aldrig innehåll. */
const FORWARDED: ReadonlyArray<keyof LogRecord> = ["event", "requestId", "userId", "orgId", "path", "code", "durationMs", "count", "total"];

/** Felet som PostHog grupperar och visar: typ (koden) och det maskerade meddelandet. */
function exceptionList(record: LogRecord): Array<Record<string, unknown>> {
  return [{ type: record.code ?? record.event, value: record.message ?? record.event, mechanism: { handled: true, synthetic: true } }];
}

/** Ett id, aldrig en person: jurist-id:t om anropet hade en användare, annars byrån. */
function distinctId(record: LogRecord): string {
  return record.userId ?? `ava-server:${record.orgId ?? "okänd"}`;
}

/** Samma händelse, kod och procedur grupperas som ett fel. */
function fingerprint(record: LogRecord): string {
  return [record.event, record.code ?? "", record.path ?? ""].join(":");
}

/** `$exception`-händelsen för en felpost. */
export function exceptionEvent(record: LogRecord, token: string): Record<string, unknown> {
  const forwarded = Object.fromEntries(FORWARDED.filter((k) => record[k] !== undefined).map((k) => [k, record[k]]));
  return {
    token, event: "$exception", timestamp: record.ts,
    properties: {
      ...forwarded,
      distinct_id: distinctId(record),
      $process_person_profile: false,
      $exception_list: exceptionList(record),
      $exception_fingerprint: fingerprint(record),
    },
  };
}

type Send = (url: string, init: RequestInit) => Promise<unknown>;

/** Destinationen: felposter till PostHog, allt annat ignoreras. */
export function posthogErrorSink(config: PosthogConfig, send: Send = fetch): LogSink {
  const url = `${config.host}/i/v0/e/`;
  return (record) => {
    if (record.level !== "error") return;
    void send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exceptionEvent(record, config.token)),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  };
}
