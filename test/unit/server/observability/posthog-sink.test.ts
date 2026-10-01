/**
 * Felrapporteringen till PostHog i EU-regionen (#1343).
 *
 * Det viktiga: ingen nyckel → av; EU är standardvärden och en amerikansk värd
 * vägras; det som skickas är exakt de tillåtna fälten. En mottagare som är
 * nere, långsam eller överbelastad får aldrig märkas i anropet som rapporterade.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest-compat";
import { setErrorReporter, type ErrorReport, type ErrorReporter } from "@/lib/server/observability/error-reporter";
import {
  POSTHOG_EU_HOST, errorSinkFromEnv, posthogEvent, posthogReporter, retryAfterMs, startErrorReporting,
  type ErrorSinkConfig, type SinkResponse,
} from "@/lib/server/observability/posthog-sink";

const TOKEN = "phc_testtoken12345";
const CONFIG: ErrorSinkConfig = {
  endpoint: "https://eu.i.posthog.com/i/v0/e/", token: TOKEN, environment: "production", release: "1.2.3",
};
const REPORT: ErrorReport = {
  timestamp: "2026-10-01T10:00:00.000Z", type: "PostgresError", errorCode: "23505",
  path: "invoice.create", requestId: "ABC234DEF567",
  frames: [{ filename: "src/lib/server/a.ts", function: "f", lineno: 1, colno: 2, in_app: true }],
};
const NOW = new Date("2026-10-01T10:00:01.000Z");

function response(status: number, retryAfter: string | null = null): SinkResponse {
  return { status, headers: { get: (name) => (name === "Retry-After" ? retryAfter : null) } };
}

interface Sent { url: string; init: RequestInit }

function recorder(result: () => Promise<SinkResponse> = () => Promise.resolve(response(200))) {
  const sent: Sent[] = [];
  return { sent, send: (url: string, init: RequestInit) => { sent.push({ url, init }); return result(); } };
}

/** Låt en sändnings `.then/.finally` köra klart. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("errorSinkFromEnv", () => {
  it.each([[{}], [{ AVA_POSTHOG_KEY: "" }], [{ AVA_POSTHOG_KEY: "   " }]])("är av utan nyckel (%j)", (env) => {
    expect(errorSinkFromEnv(env)).toEqual({ kind: "off" });
  });

  it("EU är standardvärden", () => {
    expect(POSTHOG_EU_HOST).toBe("https://eu.i.posthog.com");
    expect(errorSinkFromEnv({ AVA_POSTHOG_KEY: ` ${TOKEN} ` })).toEqual({
      kind: "on", config: { endpoint: "https://eu.i.posthog.com/i/v0/e/", token: TOKEN, environment: "production" },
    });
  });

  it.each(["inte-en-nyckel", "phc_kort", "phx_testtoken12345"])("nyckeln %s är ogiltig", (key) => {
    expect(errorSinkFromEnv({ AVA_POSTHOG_KEY: key })).toEqual({ kind: "invalid", reason: "key" });
  });

  it.each([
    "https://us.i.posthog.com",
    "https://us.posthog.com",
    "https://US.I.POSTHOG.COM",
    "http://eu.i.posthog.com",
    "inte en url",
  ])("värden %s vägras", (host) => {
    expect(errorSinkFromEnv({ AVA_POSTHOG_KEY: TOKEN, AVA_POSTHOG_HOST: host })).toEqual({ kind: "invalid", reason: "host" });
  });

  it("en själv-hostad värd går att välja; sökväg och snedstreck behålls rätt", () => {
    const setup = errorSinkFromEnv({ AVA_POSTHOG_KEY: TOKEN, AVA_POSTHOG_HOST: "https://posthog.byran.se:8443/ph/" });
    expect(setup).toMatchObject({ kind: "on", config: { endpoint: "https://posthog.byran.se:8443/ph/i/v0/e/" } });
  });

  it("tar miljö och release; fel form ignoreras", () => {
    expect(errorSinkFromEnv({ AVA_POSTHOG_KEY: TOKEN, AVA_ERROR_ENVIRONMENT: "staging", AVA_RELEASE: "abc123" }))
      .toMatchObject({ kind: "on", config: { environment: "staging", release: "abc123" } });
    expect(errorSinkFromEnv({ AVA_POSTHOG_KEY: TOKEN, AVA_ERROR_ENVIRONMENT: "två ord", AVA_RELEASE: "ä/ö" }))
      .toEqual({ kind: "on", config: { endpoint: "https://eu.i.posthog.com/i/v0/e/", token: TOKEN, environment: "production" } });
  });
});

describe("posthogEvent", () => {
  it("bär exakt de tillåtna fälten", () => {
    expect(posthogEvent(REPORT, CONFIG)).toEqual({
      token: TOKEN,
      event: "$exception",
      timestamp: "2026-10-01T10:00:00.000Z",
      properties: {
        distinct_id: "ava-server",
        $process_person_profile: false,
        $geoip_disable: true,
        environment: "production",
        release: "1.2.3",
        procedure: "invoice.create",
        request_id: "ABC234DEF567",
        error_code: "23505",
        $exception_list: [{
          type: "PostgresError",
          value: "23505",
          mechanism: { handled: true, synthetic: false },
          stacktrace: {
            type: "raw",
            frames: [{
              platform: "custom", lang: "javascript", function: "f",
              filename: "src/lib/server/a.ts", lineno: 1, colno: 2, in_app: true, resolved: true,
            }],
          },
        }],
      },
    });
  });

  it("utan valfria fält blir de bort; ram utan funktion får platshållare", () => {
    const bare: ErrorReport = { timestamp: REPORT.timestamp, type: "TypeError", frames: [{ filename: "x.ts", lineno: 3, in_app: false }] };
    const event = posthogEvent(bare, { endpoint: CONFIG.endpoint, token: TOKEN, environment: "production" });
    const props = event.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["$exception_list", "$geoip_disable", "$process_person_profile", "distinct_id", "environment"]);
    const [exception] = props.$exception_list as Array<{ value?: string; stacktrace: { frames: Array<Record<string, unknown>> } }>;
    expect(exception?.value).toBeUndefined();
    expect(exception?.stacktrace.frames[0]).toEqual({ platform: "custom", lang: "javascript", function: "<anonymous>", filename: "x.ts", lineno: 3, in_app: false, resolved: true });
  });

  it.each(["$set", "$ip", "message", "user_id", "org_id", "email", "$current_url", "input"])("skickar inte %s", (field) => {
    const props = posthogEvent(REPORT, CONFIG).properties as Record<string, unknown>;
    expect(props).not.toHaveProperty(field);
  });
});

describe("retryAfterMs", () => {
  it.each([["30", 30_000], [null, 60_000], ["inte ett tal", 60_000], ["0", 60_000]])("Retry-After %j → %d ms", (header, ms) => {
    expect(retryAfterMs(response(429, header))).toBe(ms);
  });
});

describe("posthogReporter", () => {
  const fixed = { now: () => NOW };

  it("POST:ar händelsen som JSON till capture-endpointen", () => {
    const { sent, send } = recorder();
    posthogReporter(CONFIG, { ...fixed, send })(REPORT);
    expect(sent[0]?.url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(sent[0]?.init.method).toBe("POST");
    expect(sent[0]?.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual(posthogEvent(REPORT, CONFIG));
  });

  it("ett nätverksfel kastar inte och släpper platsen", async () => {
    const { sent, send } = recorder(() => Promise.reject(new Error("nere")));
    const report = posthogReporter(CONFIG, { ...fixed, send, maxInFlight: 1 });
    expect(() => report(REPORT)).not.toThrow();
    await settle();
    report(REPORT);
    expect(sent).toHaveLength(2);
  });

  it("väntar inte på svaret och kastar det som inte får plats", async () => {
    let release: (r: SinkResponse) => void = () => {};
    const { sent, send } = recorder(() => new Promise((resolve) => { release = resolve; }));
    const report = posthogReporter(CONFIG, { ...fixed, send, maxInFlight: 2 });
    report(REPORT);
    report(REPORT);
    report(REPORT);
    expect(sent).toHaveLength(2);
    release(response(200));
    await settle();
    report(REPORT);
    expect(sent).toHaveLength(3);
  });

  it("timeouten avbryter en sändning som hänger", async () => {
    let signal: AbortSignal | undefined;
    const send = (_url: string, init: RequestInit): Promise<SinkResponse> => {
      signal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("timeout"))));
    };
    posthogReporter(CONFIG, { ...fixed, send, timeoutMs: 5 })(REPORT);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal?.aborted).toBe(true);
  });

  it("429 pausar sändningen i Retry-After sekunder", async () => {
    let now = NOW.getTime();
    const { sent, send } = recorder(() => Promise.resolve(response(429, "10")));
    const report = posthogReporter(CONFIG, { send, now: () => new Date(now) });
    report(REPORT);
    await settle();
    now += 9_000;
    report(REPORT);
    expect(sent).toHaveLength(1);
    now += 1_000;
    report(REPORT);
    expect(sent).toHaveLength(2);
  });

  describe("med standardvärdena", () => {
    const original = globalThis.fetch;
    afterEach(() => { globalThis.fetch = original; });

    it("använder fetch", async () => {
      const { sent, send } = recorder();
      const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await send(String(input), init ?? {});
        return new Response();
      };
      globalThis.fetch = Object.assign(stub, { preconnect: original.preconnect });
      posthogReporter(CONFIG)(REPORT);
      await settle();
      expect(sent[0]?.url).toBe(CONFIG.endpoint);
    });
  });
});

describe("startErrorReporting (inkoppling i servern)", () => {
  function installer(): { installed: ErrorReporter[]; install: (r: ErrorReporter) => void } {
    const installed: ErrorReporter[] = [];
    return { installed, install: (r) => void installed.push(r) };
  }

  it("utan nyckel installeras ingenting", () => {
    const { installed, install } = installer();
    expect(startErrorReporting({}, install)).toBe("felrapportering: av (AVA_POSTHOG_KEY saknas)");
    expect(installed).toHaveLength(0);
  });

  it("en ogiltig nyckel eller värd syns i startloggen och installeras inte", () => {
    const { installed, install } = installer();
    expect(startErrorReporting({ AVA_POSTHOG_KEY: "fel" }, install)).toContain("AVA_POSTHOG_KEY är ogiltig");
    expect(startErrorReporting({ AVA_POSTHOG_KEY: TOKEN, AVA_POSTHOG_HOST: "https://us.i.posthog.com" }, install))
      .toContain("AVA_POSTHOG_HOST är ogiltig eller amerikansk");
    expect(installed).toHaveLength(0);
  });

  it("med nyckel installeras mottagaren; statusraden visar värden men aldrig nyckeln", () => {
    const { installed, install } = installer();
    const { sent, send } = recorder();
    const line = startErrorReporting({ AVA_POSTHOG_KEY: TOKEN }, install, { send });
    expect(line).toBe("felrapportering: PostHog eu.i.posthog.com (production)");
    expect(line).not.toContain(TOKEN);
    installed[0]?.(REPORT);
    expect(sent[0]?.url).toBe("https://eu.i.posthog.com/i/v0/e/");
  });

  it("installerar i den riktiga rapportören som default", () => {
    const placeholder: ErrorReporter = () => {};
    const before = setErrorReporter(placeholder);
    try {
      startErrorReporting({ AVA_POSTHOG_KEY: TOKEN });
      expect(setErrorReporter(before)).not.toBe(placeholder);
    } finally {
      setErrorReporter(before);
    }
  });
});

describe("skydd: ingen amerikansk PostHog-värd i koden", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  }

  it.each(["src", "tooling/docker"])("%s innehåller inte us.i.posthog.com / us.posthog.com", (dir) => {
    const US_HOSTS = ["us.i.posthog.com", "us.posthog.com"];
    const offenders = files(dir).filter((f) => {
      const text = readFileSync(f, "utf8").toLowerCase();
      return US_HOSTS.some((host) => text.includes(host));
    });
    expect(offenders).toEqual([]);
  });

  it("ingen riktig projekt-token i dokumentationen", () => {
    const offenders = files("docs").filter((f) => /phc_[A-Za-z0-9]{20,}/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
