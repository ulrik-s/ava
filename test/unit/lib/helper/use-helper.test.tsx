/**
 * Tests för useHelper() + transport-resolution (https→http, ADR 0006).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import {
  useHelper,
  openViaHelper,
  triggerHelperUpdateCheck,
  resetHelperBaseCache,
  resolveHelperBase,
  fetchHelperStatus,
  fetchContentViaHelper,
  configureHelper,
  docSyncStatusMap,
} from "@/lib/client/helper/use-helper";
import type { HelperStatusResponse, HelperSyncEntry } from "@/lib/shared/helper/protocol";

const HTTPS = "https://localhost:48762";
const HTTP = "http://127.0.0.1:48761";
const originalFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  resetHelperBaseCache();
});

/** fetch-mock som svarar per URL-fragment; okända URL:er rejectar. */
function routeFetch(routes: Array<[string, () => Response]>): ReturnType<typeof vi.fn> {
  return vi.fn((url: string | URL) => {
    const u = String(url);
    for (const [frag, make] of routes) {
      if (u.includes(frag)) return Promise.resolve(make());
    }
    return Promise.reject(new Error(`unmocked: ${u}`));
  });
}

function Probe(): React.ReactElement {
  const s = useHelper();
  if (!s.checked) return <p>loading</p>;
  return <p>{s.version ?? "absent"}</p>;
}

describe("useHelper / transport", () => {
  it("använder HTTPS när den svarar (Safari-vägen)", async () => {
    const fetchMock = routeFetch([[`${HTTPS}/ping`, () => new Response("ava-helper v1.2.3\n", { status: 200 })]]);
    global.fetch = fetchMock;
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("v1.2.3")).toBeInTheDocument());
    // HTTPS provades först och räckte → ingen HTTP-ping.
    expect(fetchMock.mock.calls.every(([u]: [string]) => String(u).startsWith(HTTPS))).toBe(true);
  });

  it("faller tillbaka på HTTP när HTTPS inte svarar (Chromium)", async () => {
    const fetchMock = routeFetch([[`${HTTP}/ping`, () => new Response("ava-helper v2.0.0\n", { status: 200 })]]);
    global.fetch = fetchMock; // HTTPS-pingen rejectar (ej mockad) → HTTP
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("v2.0.0")).toBeInTheDocument());
  });

  it("null när varken https eller http svarar", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("absent")).toBeInTheDocument());
  });

  it("null vid trasig ping-text", async () => {
    global.fetch = routeFetch([[`${HTTPS}/ping`, () => new Response("garbage", { status: 200 })]]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByText("absent")).toBeInTheDocument());
  });

  it("negativ-cachar en miss → ingen probe-storm (#653)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    global.fetch = fetchMock;
    expect(await resolveHelperBase()).toBeNull();
    const afterFirst = fetchMock.mock.calls.length; // PROBE_ORDER (https + http)
    expect(afterFirst).toBeGreaterThan(0);
    // En andra probe inom MISS_TTL ska INTE fyra av fler /ping (negativ-cache).
    expect(await resolveHelperBase()).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });
});

describe("openViaHelper", () => {
  it("POST:ar /open på den upplösta basen (HTTPS)", async () => {
    const fetchMock = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/open`, () => new Response("", { status: 200 })],
    ]);
    global.fetch = fetchMock;
    await openViaHelper({ fileName: "x.pdf", downloadUrl: "https://example.com/x" });
    const openCall = fetchMock.mock.calls.find(([u]: [string]) => String(u).endsWith("/open"))!;
    expect(openCall[0]).toBe(`${HTTPS}/open`);
    expect(openCall[1].method).toBe("POST");
    expect(JSON.parse(openCall[1].body)).toMatchObject({ fileName: "x.pdf" });
  });

  it("kastar vid 4xx-respons", async () => {
    global.fetch = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/open`, () => new Response("oops", { status: 400 })],
    ]);
    await expect(openViaHelper({ fileName: "x.pdf", downloadUrl: "u" })).rejects.toThrow(/HTTP 400/);
  });

  it("kastar 'inte tillgänglig' när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down"));
    await expect(openViaHelper({ fileName: "x.pdf", downloadUrl: "u" })).rejects.toThrow(/inte tillgänglig/);
  });
});

describe("fetchHelperStatus", () => {
  const SNAP = { pending: 2, conflict: 1, total: 3, entries: [] };

  it("returnerar kö-status från /status", async () => {
    global.fetch = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/status`, () => new Response(JSON.stringify(SNAP), { status: 200 })],
    ]);
    expect(await fetchHelperStatus()).toEqual(SNAP);
  });

  it("null när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down"));
    expect(await fetchHelperStatus()).toBeNull();
  });

  it("null vid trasigt status-svar (fel form)", async () => {
    global.fetch = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/status`, () => new Response(JSON.stringify({ pending: "nope" }), { status: 200 })],
    ]);
    expect(await fetchHelperStatus()).toBeNull();
  });
});

describe("fetchContentViaHelper", () => {
  const REQ = { downloadUrl: "https://srv/api/documents/9/download", fileName: "a.pdf" };

  it("returnerar bytes från /content", async () => {
    global.fetch = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/content`, () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })],
    ]);
    const bytes = await fetchContentViaHelper(REQ);
    expect(bytes).not.toBeNull();
    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
  });

  it("POST:ar request-bodyn till /content", async () => {
    const fetchMock = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/content`, () => new Response(new Uint8Array([9]), { status: 200 })],
    ]);
    global.fetch = fetchMock;
    await fetchContentViaHelper(REQ);
    const call = fetchMock.mock.calls.find(([u]: [string]) => String(u).endsWith("/content"))!;
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toMatchObject({ downloadUrl: REQ.downloadUrl, fileName: "a.pdf" });
  });

  it("null när helpern saknas (→ caller faller tillbaka)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down"));
    expect(await fetchContentViaHelper(REQ)).toBeNull();
  });

  it("null vid 502 (offline + ej cachat)", async () => {
    global.fetch = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/content`, () => new Response("unavailable", { status: 502 })],
    ]);
    expect(await fetchContentViaHelper(REQ)).toBeNull();
  });
});

describe("configureHelper (ADR 0029)", () => {
  const CFG = { oidcIssuer: "https://idp/realms/ava", oidcClientId: "ava-helper" };

  it("POST:ar configen till /config → true", async () => {
    const fetchMock = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/config`, () => new Response(JSON.stringify({ status: "configured" }), { status: 200 })],
    ]);
    global.fetch = fetchMock;
    expect(await configureHelper(CFG)).toBe(true);
    const call = fetchMock.mock.calls.find(([u]: [string]) => String(u).endsWith("/config"))!;
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toMatchObject({ oidcIssuer: CFG.oidcIssuer });
  });

  it("false när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down"));
    expect(await configureHelper(CFG)).toBe(false);
  });

  it("false vid 4xx", async () => {
    global.fetch = routeFetch([
      [`${HTTPS}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTPS}/config`, () => new Response("bad", { status: 400 })],
    ]);
    expect(await configureHelper(CFG)).toBe(false);
  });
});

describe("triggerHelperUpdateCheck", () => {
  it("anropar /check-update på upplöst bas", async () => {
    const fetchMock = routeFetch([
      [`${HTTP}/ping`, () => new Response("ava-helper v1\n", { status: 200 })],
      [`${HTTP}/check-update`, () => new Response("", { status: 202 })],
    ]);
    global.fetch = fetchMock;
    await triggerHelperUpdateCheck();
    expect(fetchMock.mock.calls.some(([u]: [string]) => String(u) === `${HTTP}/check-update`)).toBe(true);
  });

  it("sväljer fel tyst när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("net"));
    await expect(triggerHelperUpdateCheck()).resolves.toBeUndefined();
  });
});

describe("docSyncStatusMap", () => {
  function status(entries: Partial<HelperSyncEntry>[]): HelperStatusResponse {
    const full = entries.map((e, i) => ({
      id: `q${i}`, fileName: "f", enqueuedAt: 0, attempts: 0, nextAttemptAt: 0,
      status: "pending" as const, ...e,
    })) as HelperSyncEntry[];
    return {
      pending: full.filter((e) => e.status === "pending").length,
      conflict: full.filter((e) => e.status === "conflict").length,
      total: full.length,
      entries: full,
    };
  }

  it("null → tom karta", () => {
    expect(docSyncStatusMap(null).size).toBe(0);
  });

  it("mappar document.id → status; hoppar över poster utan document (demo/PUT)", () => {
    const m = docSyncStatusMap(status([
      { document: { id: "a", trpcUrl: "x" }, status: "pending" },
      { uploadUrl: "http://s/u", status: "pending" }, // demo → ingen doc-id → hoppas
      { document: { id: "b", trpcUrl: "x" }, status: "conflict" },
    ]));
    expect(m.get("a")).toBe("pending");
    expect(m.get("b")).toBe("conflict");
    expect(m.size).toBe(2);
  });

  it("conflict prioriteras över pending för samma dokument", () => {
    const m = docSyncStatusMap(status([
      { document: { id: "a", trpcUrl: "x" }, status: "pending" },
      { document: { id: "a", trpcUrl: "x" }, status: "conflict" },
    ]));
    expect(m.get("a")).toBe("conflict");
  });
});
