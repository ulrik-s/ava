/**
 * `loadDemoMeta` — fetchar meta.json från same-origin-demon. Testen säkrar
 * URL-konstruktionen, validerings-kasten och cache-beteendet.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadDemoMeta, demoMetaUrl, _resetDemoMetaCache } from "@/lib/client/demo/demo-meta";

const VALID_META = {
  organizationId: "demo-firma-ab",
  organizationName: "Demo AB",
  users: [
    { id: "u-anna", name: "Anna", email: "a@ava", role: "ADMIN" as const, title: "Senior partner" },
    { id: "u-bjorn", name: "Björn", email: "b@ava", role: "LAWYER" as const },
  ],
  buildAt: "2026-05-31T10:00:00.000Z",
};

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;
}

beforeEach(() => _resetDemoMetaCache());

describe("demoMetaUrl", () => {
  it("bygger GH Pages-URL från user/repo-form", () => {
    expect(demoMetaUrl("ulrik-s/ava")).toBe("https://ulrik-s.github.io/ava/.ava/meta.json");
  });

  it("respekterar absolut https-URL", () => {
    expect(demoMetaUrl("https://example.com/path/")).toBe("https://example.com/path/.ava/meta.json");
  });
});

describe("loadDemoMeta", () => {
  it("parsar giltig meta.json", async () => {
    const meta = await loadDemoMeta("ulrik-s/ava", mockFetch(VALID_META));
    expect(meta.organizationId).toBe("demo-firma-ab");
    expect(meta.users).toHaveLength(2);
    expect(meta.users[0]!.id).toBe("u-anna");
  });

  it("fetchar med cache:'no-store' så reset/deploy ger färsk meta", async () => {
    let init: RequestInit | undefined;
    const fetchFn: typeof fetch = ((_url: unknown, opts?: RequestInit) => {
      init = opts;
      return Promise.resolve(new Response(JSON.stringify(VALID_META)));
    }) as typeof fetch;
    await loadDemoMeta("ulrik-s/ava", fetchFn);
    expect(init?.cache).toBe("no-store");
  });

  it("cachar resultatet (andra anropet fetchar inte igen)", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = (() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify(VALID_META)));
    }) as typeof fetch;
    await loadDemoMeta("ulrik-s/ava", fetchFn);
    await loadDemoMeta("ulrik-s/ava", fetchFn);
    expect(calls).toBe(1);
  });

  it("kastar vid HTTP-fel", async () => {
    await expect(loadDemoMeta("ulrik-s/ava", mockFetch({}, 404)))
      .rejects.toThrow(/HTTP 404/);
  });

  it("kastar om organizationId saknas", async () => {
    await expect(loadDemoMeta("ulrik-s/ava", mockFetch({ ...VALID_META, organizationId: "" })))
      .rejects.toThrow(/saknar organizationId/);
  });

  it("kastar om users är tom", async () => {
    await expect(loadDemoMeta("ulrik-s/ava", mockFetch({ ...VALID_META, users: [] })))
      .rejects.toThrow(/saknar users/);
  });

  it("kastar om en user-rad saknar id", async () => {
    const bad = { ...VALID_META, users: [{ name: "X", role: "ADMIN" }] };
    await expect(loadDemoMeta("ulrik-s/ava", mockFetch(bad)))
      .rejects.toThrow(/saknar id/);
  });

  it("versionsgrind: vägrar ett demo-repo nyare än koden (ADR 0004)", async () => {
    await expect(loadDemoMeta("ulrik-s/ava", mockFetch({ ...VALID_META, schemaVersion: 9999 })))
      .rejects.toThrow(/nyare AVA-version/);
  });

  it("versionsgrind: parsar schemaVersion när den finns", async () => {
    const meta = await loadDemoMeta("ulrik-s/ava", mockFetch({ ...VALID_META, schemaVersion: 1 }));
    expect(meta.schemaVersion).toBe(1);
  });

  it("versionsgrind: tom schemaVersion → undefined (baslinje), laddar ändå", async () => {
    const meta = await loadDemoMeta("ulrik-s/ava", mockFetch(VALID_META));
    expect(meta.schemaVersion).toBeUndefined();
    expect(meta.organizationId).toBe("demo-firma-ab");
  });
});
