/**
 * Arbetsordrarna ur kodrepot (#2216): sökningen med token, sidbläddring,
 * Intag-raden, delarnas läge, takten (med reservvärde), cachen i 5 minuter
 * för alla användare och att ett fel aldrig kastar.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import {
  FALLBACK_PER_DAY, GithubWorkOrders, intakeNumber, partState, WORK_ORDERS_TTL_MS, workOrderFrom,
} from "@/lib/server/feedback/github-work-orders";
import { nullSink, setLogSink, type LogRecord } from "@/lib/shared/observability/logger";

const NOW = Date.parse("2026-11-27T12:00:00Z");

const row = (over: Record<string, unknown> = {}) => ({
  title: "feat(x): en del", body: "Text\nIntag: ava-feedback#7\n", state: "open", state_reason: null,
  created_at: "2026-11-23T10:00:00Z", labels: [{ name: "agent-task" }], ...over,
});

type Route = (url: string) => { status: number; json: unknown };

function fakeFetch(route: Route) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const r = route(url);
    return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status }));
  };
  return { impl, calls };
}

/** Sökningen efter arbetsordrar ger `orders`; sökningen efter PR:er ger `merged` träffar. */
const github = (orders: unknown[], merged = 70): Route => (url) =>
  url.includes("is%3Apr") ? { status: 200, json: { total_count: merged, items: [] } } : { status: 200, json: { total_count: orders.length, items: orders } };

const logged: LogRecord[] = [];
beforeEach(() => { logged.length = 0; setLogSink((r) => { logged.push(r); }); });
afterEach(() => { setLogSink(nullSink); });

describe("intakeNumber", () => {
  it("läser raden `Intag: ava-feedback#N`", () => {
    expect(intakeNumber("a\nIntag: ava-feedback#132\nb")).toBe(132);
  });

  it("ignorerar omnämnanden mitt i en rad och andra format", () => {
    expect(intakeNumber("- se Intag: ava-feedback#109 för förebilden")).toBeNull();
    expect(intakeNumber("Intag: ava-feedback#15.")).toBeNull();
    expect(intakeNumber("")).toBeNull();
  });
});

describe("partState", () => {
  it.each([
    [false, "completed", [], "klar"],
    [false, "not_planned", [], null],
    [false, null, [], null],
    [true, null, ["blockerad", "pågår"], "vantar_beslut"],
    [true, null, ["pågår"], "pagar"],
    [true, null, ["agent-task"], "i_ko"],
  ] as const)("öppen=%p, %p, %p → %p", (open, reason, labels, expected) => {
    expect(partState(open, reason, labels)).toBe(expected);
  });
});

describe("workOrderFrom", () => {
  it("en arbetsorder med Intag-rad", () => {
    expect(workOrderFrom(row())).toEqual({ intake: 7, title: "feat(x): en del", state: "i_ko", createdAt: "2026-11-23T10:00:00Z" });
  });

  it("hoppar över PR:er, issues utan Intag-rad och de som stängts utan att göras", () => {
    expect(workOrderFrom({ ...row(), pull_request: {} })).toBeNull();
    expect(workOrderFrom({ ...row(), body: null })).toBeNull();
    expect(workOrderFrom({ ...row(), state: "closed", state_reason: "not_planned" })).toBeNull();
  });
});

describe("GithubWorkOrders", () => {
  it("söker i kodrepot med token och räknar takten över 7 dygn", async () => {
    const f = fakeFetch(github([row(), row({ body: "ingen intag" })], 70));
    const snap = await new GithubWorkOrders("ghp_secret", f.impl, () => NOW).snapshot();
    expect(snap).toEqual({ perDay: 10, orders: [{ intake: 7, title: "feat(x): en del", state: "i_ko", createdAt: "2026-11-23T10:00:00Z" }] });
    const urls = f.calls.map((c) => decodeURIComponent(c.url));
    expect(urls.some((u) => u.includes('repo:ulrik-s/ava is:issue in:body "Intag: ava-feedback" updated:>=2026-08-29'))).toBe(true);
    expect(urls.some((u) => u.includes("repo:ulrik-s/ava is:pr is:merged label:agent-pr merged:>=2026-11-20"))).toBe(true);
    expect((f.calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer ghp_secret");
  });

  it("bläddrar tills alla träffar är lästa", async () => {
    const page = Array.from({ length: 100 }, (_, n) => row({ body: `Intag: ava-feedback#${n}` }));
    const f = fakeFetch((url) => {
      if (url.includes("is%3Apr")) return { status: 200, json: { total_count: 7, items: [] } };
      return { status: 200, json: { total_count: 150, items: url.endsWith("&page=1") ? page : page.slice(0, 50) } };
    });
    const snap = await new GithubWorkOrders("t", f.impl, () => NOW).snapshot();
    expect(snap?.orders).toHaveLength(150);
    expect(f.calls.filter((c) => !c.url.includes("is%3Apr"))).toHaveLength(2);
  });

  it("slutar efter en full sida när alla träffar är lästa", async () => {
    const page = Array.from({ length: 100 }, () => row());
    const f = fakeFetch((url) => url.includes("is%3Apr")
      ? { status: 200, json: { total_count: 7, items: [] } }
      : { status: 200, json: { total_count: 100, items: page } });
    await new GithubWorkOrders("t", f.impl, () => NOW).snapshot();
    expect(f.calls.filter((c) => !c.url.includes("is%3Apr"))).toHaveLength(1);
  });

  it("takten faller tillbaka på reservvärdet när PR-sökningen fallerar", async () => {
    const f = fakeFetch((url) => url.includes("is%3Apr") ? { status: 403, json: {} } : github([row()])(url));
    expect((await new GithubWorkOrders("t", f.impl, () => NOW).snapshot())?.perDay).toBe(FALLBACK_PER_DAY);
  });

  it("återanvänder svaret i 5 minuter, för alla anrop, och hämtar sedan igen", async () => {
    let now = NOW;
    const f = fakeFetch(github([row()]));
    const source = new GithubWorkOrders("t", f.impl, () => now);
    await Promise.all([source.snapshot(), source.snapshot()]);
    await source.snapshot();
    expect(f.calls).toHaveLength(2);
    now += WORK_ORDERS_TTL_MS;
    await source.snapshot();
    expect(f.calls).toHaveLength(4);
  });

  it("ett fel kastar aldrig: null första gången, sedan det senaste svaret", async () => {
    let now = NOW;
    let fail = true;
    const f = fakeFetch((url) => fail ? { status: 500, json: {} } : github([row()])(url));
    const source = new GithubWorkOrders("t", f.impl, () => now);
    expect(await source.snapshot()).toBeNull();
    expect(logged.some((r) => r.event === "feedback.work_orders_failed")).toBe(true);
    fail = false;
    now += WORK_ORDERS_TTL_MS;
    const ok = await source.snapshot();
    expect(ok?.orders).toHaveLength(1);
    fail = true;
    now += WORK_ORDERS_TTL_MS;
    expect(await source.snapshot()).toEqual(ok);
  });

  it("felet loggar inte token", async () => {
    const f = fakeFetch(() => ({ status: 401, json: {} }));
    await new GithubWorkOrders("ghp_secret", f.impl, () => NOW).snapshot();
    expect(JSON.stringify(logged)).not.toContain("ghp_secret");
  });
});
