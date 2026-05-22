/**
 * Tester för `createGhPagesCloneFn` + `resolveGhPagesUrl`.
 */

import { describe, it, expect, vi } from "vitest";
import { createGhPagesCloneFn, resolveGhPagesUrl } from "@/server/local-first/gh-pages-loader";
import { MemFs } from "@/server/local-first/mem-fs";

function fakeFetch(files: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url.toString();
    const key = Object.keys(files).find((k) => u.endsWith(k));
    if (!key) return { ok: false, status: 404 } as Response;
    const body = files[key];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => typeof body === "string" ? body : JSON.stringify(body),
    } as unknown as Response;
  }) as typeof fetch;
}

describe("resolveGhPagesUrl", () => {
  it("github.com/<user>/<repo> → <user>.github.io/<repo>", () => {
    expect(resolveGhPagesUrl("https://github.com/ulrik-s/ava-demo"))
      .toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("user/repo kort form", () => {
    expect(resolveGhPagesUrl("ulrik-s/ava-demo"))
      .toBe("https://ulrik-s.github.io/ava-demo");
  });

  it(".git-suffix tas bort", () => {
    expect(resolveGhPagesUrl("https://github.com/ulrik-s/ava-demo.git"))
      .toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("redan GH Pages-URL → som-är (trailing slash trimmad)", () => {
    expect(resolveGhPagesUrl("https://ulrik-s.github.io/ava-demo/"))
      .toBe("https://ulrik-s.github.io/ava-demo");
  });
});

describe("createGhPagesCloneFn", () => {
  it("fetchar manifest + alla listade filer och skriver dem till MemFs", async () => {
    const fetchFn = fakeFetch({
      "/manifest.json": { paths: ["matters/active/m1.json", "contacts/c1.json"] },
      "/matters/active/m1.json": '{"id":"m1","title":"Demo"}',
      "/contacts/c1.json": '{"id":"c1","name":"Anna"}',
    });
    const fs = new MemFs();
    const clone = createGhPagesCloneFn({ fetchFn });
    await clone(fs, "https://github.com/ulrik-s/ava-demo");
    expect(await fs.readFile("matters/active/m1.json")).toContain("m1");
    expect(await fs.readFile("contacts/c1.json")).toContain("Anna");
  });

  it("kastar med vägledning om manifest saknas", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404 } as Response)) as typeof fetch;
    const clone = createGhPagesCloneFn({ fetchFn });
    await expect(clone(new MemFs(), "ulrik-s/ava-demo")).rejects.toThrow(/GH Pages/);
  });

  it("kastar om manifest har fel format", async () => {
    const fetchFn = fakeFetch({ "/manifest.json": { fel: "format" } });
    const clone = createGhPagesCloneFn({ fetchFn });
    await expect(clone(new MemFs(), "ulrik-s/ava-demo")).rejects.toThrow(/format/);
  });

  it("kastar om manifest är tomt", async () => {
    const fetchFn = fakeFetch({ "/manifest.json": { paths: [] } });
    const clone = createGhPagesCloneFn({ fetchFn });
    await expect(clone(new MemFs(), "ulrik-s/ava-demo")).rejects.toThrow(/tomt|ogiltigt/);
  });

  it("individuella 404:s loggas och hoppas över — resten lyckas", async () => {
    const fetchFn = fakeFetch({
      "/manifest.json": { paths: ["matters/active/m1.json", ".ava/users/u.json"] },
      "/matters/active/m1.json": '{"id":"m1"}',
      // .ava/users/u.json finns inte — Jekyll strippar dot-folders på GH Pages
    });
    const fs = new MemFs();
    const clone = createGhPagesCloneFn({ fetchFn });
    // Skall INTE kasta — load ska lyckas trots saknad fil
    await clone(fs, "ulrik-s/ava-demo");
    // De som finns ska vara skrivna
    expect(await fs.readFile("matters/active/m1.json")).toContain("m1");
    // Den som 404:ade ska inte finnas
    expect(await fs.exists(".ava/users/u.json")).toBe(false);
  });

  it("kastar bara om ALLA filer 404:ar (definitivt fel)", async () => {
    const fetchFn = fakeFetch({
      "/manifest.json": { paths: ["a.json", "b.json"] },
      // Inga filer levereras
    });
    const clone = createGhPagesCloneFn({ fetchFn });
    await expect(clone(new MemFs(), "ulrik-s/ava-demo")).rejects.toThrow(/alla|all/i);
  });

  it("explicit baseUrl override:ar resolveGhPagesUrl", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push(u);
      if (u.endsWith("/manifest.json")) {
        return { ok: true, status: 200, json: async () => ({ paths: ["a.json"] }) } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => "{}" } as unknown as Response;
    }) as typeof fetch;
    const clone = createGhPagesCloneFn({ fetchFn, baseUrl: "https://example.invalid/data" });
    await clone(new MemFs(), "ulrik-s/ava-demo");
    expect(calls[0]).toBe("https://example.invalid/data/manifest.json");
  });
});
