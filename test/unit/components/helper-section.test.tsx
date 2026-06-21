/**
 * HelperSection — visar AVA Helper-status + synk-status (ADR 0028 §8) i Inställningar.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { HelperSection } from "@/components/settings/helper-section";
import { resetHelperBaseCache } from "@/lib/client/helper/use-helper";

const HTTPS = "https://localhost:48762";
const HTTP = "http://127.0.0.1:48761";

const originalFetch = global.fetch;
beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  resetHelperBaseCache(); // nollställ probe-cache/in-flight/miss-broms (#653) mellan tester
});

/** fetch-mock som svarar per URL-fragment; okända URL:er rejectar (helper-saknas). */
function routeFetch(routes: Array<[string, () => Response]>): ReturnType<typeof vi.fn> {
  return vi.fn((url: string | URL) => {
    const u = String(url);
    for (const [frag, make] of routes) {
      if (u.includes(frag)) return Promise.resolve(make());
    }
    return Promise.reject(new Error(`unmocked: ${u}`));
  });
}

function pingOk(): Response {
  return new Response("ava-helper v1.0.0\n", { status: 200 });
}
function statusBody(snap: { pending: number; conflict: number; total: number }): Response {
  return new Response(JSON.stringify({ ...snap, entries: [] }), { status: 200 });
}

describe("HelperSection — installations-status", () => {
  it("visar 'Kontrollerar…' först", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => { /* hänger */ }));
    render(<HelperSection />);
    expect(screen.getByText(/Kontrollerar/)).toBeInTheDocument();
  });

  it("visar version när helpern svarar", async () => {
    global.fetch = routeFetch([[`${HTTPS}/ping`, pingOk], [`${HTTPS}/status`, () => statusBody({ pending: 0, conflict: 0, total: 0 })]]);
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/Installerad/)).toBeInTheDocument());
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("visar 'Inte installerad' när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/Inte installerad/)).toBeInTheDocument());
  });

  it("alltid visar länk till release-sidan", async () => {
    global.fetch = routeFetch([[`${HTTP}/ping`, pingOk], [`${HTTP}/status`, () => statusBody({ pending: 0, conflict: 0, total: 0 })]]);
    render(<HelperSection />);
    const link = await screen.findByRole("link", { name: /Ladda ner/ });
    expect(link.getAttribute("href")).toMatch(/github\.com\/ulrik-s\/ava\/releases/);
  });
});

describe("HelperSection — synk-status (ADR 0028 §8)", () => {
  it("visar 'Allt synkat' när kön är tom", async () => {
    global.fetch = routeFetch([[`${HTTPS}/ping`, pingOk], [`${HTTPS}/status`, () => statusBody({ pending: 0, conflict: 0, total: 0 })]]);
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/Allt synkat/)).toBeInTheDocument());
  });

  it("visar antal väntande ändringar", async () => {
    global.fetch = routeFetch([[`${HTTPS}/ping`, pingOk], [`${HTTPS}/status`, () => statusBody({ pending: 3, conflict: 0, total: 3 })]]);
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/3 ändringar väntar/)).toBeInTheDocument());
  });

  it("visar konflikt-varning (prioriteras över väntande)", async () => {
    global.fetch = routeFetch([[`${HTTPS}/ping`, pingOk], [`${HTTPS}/status`, () => statusBody({ pending: 1, conflict: 2, total: 3 })]]);
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/2 dokument i konflikt/)).toBeInTheDocument());
  });

  it("döljer synk-status helt när helpern saknas", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down"));
    render(<HelperSection />);
    await waitFor(() => expect(screen.getByText(/Inte installerad/)).toBeInTheDocument());
    expect(screen.queryByText(/Allt synkat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/väntar/)).not.toBeInTheDocument();
  });
});
