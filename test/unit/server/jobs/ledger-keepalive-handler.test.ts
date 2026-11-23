/**
 * Keepalive-jobbet för bokföringen (#1815): rätt byrå skickas till porten,
 * varje utfall loggas på rätt nivå (utan tokenvärden) och ett fel från porten
 * kastas vidare så att pg-boss försöker igen.
 */

import type { Job } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { createLedgerKeepAliveHandler } from "@/lib/server/jobs/handlers/ledger-keepalive-handler";
import type { LedgerKeepAliveOutcome } from "@/lib/server/ports";
import { arraySink, setLogSink, type LogRecord, type LogSink } from "@/lib/shared/observability/logger";

const job: Job = {
  id: "j1", name: "ledger-keepalive", data: {}, expireInSeconds: 60, heartbeatSeconds: null,
  retryCount: 0, signal: new AbortController().signal,
};

describe("createLedgerKeepAliveHandler", () => {
  let records: LogRecord[] = [];
  let previous: LogSink;
  beforeEach(() => { records = []; previous = setLogSink(arraySink(records)); });
  afterEach(() => { setLogSink(previous); });

  const run = async (outcome: LedgerKeepAliveOutcome) => {
    const keepAlive = vi.fn(() => Promise.resolve(outcome));
    await createLedgerKeepAliveHandler({ ledger: { keepAlive }, orgId: "org-1" })(job);
    return keepAlive;
  };

  it("skickar byråns id till porten", async () => {
    const keepAlive = await run("alive");
    expect(keepAlive).toHaveBeenCalledWith("org-1");
  });

  it.each([
    ["alive", "info", "ledger.keepalive.alive"],
    ["not-connected", "info", "ledger.keepalive.not-connected"],
    ["reconnect-required", "error", "ledger.keepalive.reconnect-required"],
  ] as const)("utfallet %s loggas på %s", async (outcome, level, event) => {
    await run(outcome);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level, event, orgId: "org-1" });
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(["event", "level", "orgId", "ts"]);
  });

  it("ett okänt utfall kastar i stället för att tystas", async () => {
    // Avsiktligt utanför unionen: porten får ett nytt utfall som handlern inte känner till.
    await expect(run("okänt" as never)).rejects.toThrow(/Okänt utfall/);
  });

  it("ett fel från porten kastas vidare (→ pg-boss försöker igen)", async () => {
    const keepAlive = vi.fn((): Promise<LedgerKeepAliveOutcome> => Promise.reject(new Error("503 från bokföringen")));
    await expect(createLedgerKeepAliveHandler({ ledger: { keepAlive }, orgId: "org-1" })(job)).rejects.toThrow(/503/);
    expect(records).toEqual([]);
  });
});
