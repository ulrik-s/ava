/**
 * Tests för useHelper() + transport-resolution (https→http, ADR 0006).
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { render, screen, waitFor } from "@testing-library/react";
import {
  useHelper,
  openViaHelper,
  triggerHelperUpdateCheck,
  resetHelperBaseCache,
} from "@/lib/client/helper/use-helper";

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
