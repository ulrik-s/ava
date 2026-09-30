/**
 * Felrapporteringen till PostHog (#1080).
 *
 * Det viktiga är vad som INTE skickas: bara postens deklarerade fält, ingen
 * personprofil, och bara fel. Ett sändfel får aldrig fälla anropet som loggade.
 */

import { describe, it, expect, afterEach } from "vitest-compat";
import {
  DEFAULT_POSTHOG_HOST, exceptionEvent, posthogConfigFromEnv, posthogErrorSink,
} from "@/lib/server/observability/posthog-sink";
import type { LogRecord } from "@/lib/shared/observability/logger";

const ERROR: LogRecord = {
  ts: "2026-09-30T10:00:00.000Z", level: "error", event: "trpc.error",
  requestId: "R1", userId: "u-1", orgId: "org-1", path: "invoice.list",
  code: "INTERNAL_SERVER_ERROR", message: "boom", durationMs: 12,
};

interface Sent { url: string; init: RequestInit }

function recorder(result: () => Promise<unknown> = () => Promise.resolve()): { sent: Sent[]; send: (url: string, init: RequestInit) => Promise<unknown> } {
  const sent: Sent[] = [];
  return { sent, send: (url, init) => { sent.push({ url, init }); return result(); } };
}

function body(s: Sent | undefined): unknown {
  return JSON.parse(String(s?.init.body));
}

describe("posthogConfigFromEnv", () => {
  it("är av utan nyckel", () => {
    expect(posthogConfigFromEnv({})).toBeNull();
    expect(posthogConfigFromEnv({ AVA_POSTHOG_KEY: "  " })).toBeNull();
  });

  it("trimmar nyckeln och faller tillbaka på US-värden", () => {
    expect(posthogConfigFromEnv({ AVA_POSTHOG_KEY: " phc_x " })).toEqual({ token: "phc_x", host: DEFAULT_POSTHOG_HOST });
  });

  it("tar egen värd utan avslutande snedstreck", () => {
    expect(posthogConfigFromEnv({ AVA_POSTHOG_KEY: "phc_x", AVA_POSTHOG_HOST: "https://eu.i.posthog.com//" }))
      .toEqual({ token: "phc_x", host: "https://eu.i.posthog.com" });
  });
});

describe("exceptionEvent", () => {
  it("bygger $exception av postens deklarerade fält", () => {
    expect(exceptionEvent(ERROR, "phc_x")).toEqual({
      token: "phc_x", event: "$exception", timestamp: ERROR.ts,
      properties: {
        event: "trpc.error", requestId: "R1", userId: "u-1", orgId: "org-1",
        path: "invoice.list", code: "INTERNAL_SERVER_ERROR", durationMs: 12,
        distinct_id: "u-1",
        $process_person_profile: false,
        $exception_list: [{ type: "INTERNAL_SERVER_ERROR", value: "boom", mechanism: { handled: true, synthetic: true } }],
        $exception_fingerprint: "trpc.error:INTERNAL_SERVER_ERROR:invoice.list",
      },
    });
  });

  // `message` är redan maskerat men hör hemma i $exception_list, inte som fri egenskap.
  it("skickar inte message eller level som egenskaper", () => {
    const props = exceptionEvent(ERROR, "t").properties;
    expect(props).not.toHaveProperty("message");
    expect(props).not.toHaveProperty("level");
  });

  it("utan användare, kod och meddelande faller den tillbaka på byrån och händelsen", () => {
    const event = exceptionEvent({ ts: ERROR.ts, level: "error", event: "job.failed", orgId: "org-1" }, "t");
    expect(event.properties).toMatchObject({
      distinct_id: "ava-server:org-1",
      $exception_list: [{ type: "job.failed", value: "job.failed" }],
      $exception_fingerprint: "job.failed::",
    });
  });

  it("utan byrå blir distinct_id okänd", () => {
    expect(exceptionEvent({ ts: ERROR.ts, level: "error", event: "x" }, "t").properties)
      .toMatchObject({ distinct_id: "ava-server:okänd" });
  });
});

describe("posthogErrorSink", () => {
  const config = { host: "https://ph.test", token: "phc_x" };

  it("skickar felposter till /i/v0/e/ som JSON", () => {
    const { sent, send } = recorder();
    posthogErrorSink(config, send)(ERROR);
    expect(sent[0]?.url).toBe("https://ph.test/i/v0/e/");
    expect(sent[0]?.init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(body(sent[0])).toEqual(exceptionEvent(ERROR, "phc_x"));
  });

  it("ignorerar allt som inte är fel", () => {
    const { sent, send } = recorder();
    const sink = posthogErrorSink(config, send);
    for (const level of ["debug", "info", "warn"] as const) sink({ ...ERROR, level });
    expect(sent).toHaveLength(0);
  });

  it("sväljer ett sändfel", async () => {
    const { sent, send } = recorder(() => Promise.reject(new Error("nere")));
    expect(() => posthogErrorSink(config, send)(ERROR)).not.toThrow();
    await Promise.resolve();
    expect(sent).toHaveLength(1);
  });

  describe("utan injicerad send", () => {
    const original = globalThis.fetch;
    afterEach(() => { globalThis.fetch = original; });

    it("använder fetch", () => {
      const { sent, send } = recorder();
      const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await send(String(input), init ?? {});
        return new Response();
      };
      globalThis.fetch = Object.assign(stub, { preconnect: original.preconnect });
      posthogErrorSink(config)(ERROR);
      expect(sent[0]?.url).toBe("https://ph.test/i/v0/e/");
    });
  });
});
