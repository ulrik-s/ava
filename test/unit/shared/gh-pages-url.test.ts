/**
 * Tester för `resolveGhPagesUrl` (#27 coverage) — ren sträng→sträng-heuristik
 * som översätter en repo-URL till dess GH Pages-URL.
 */

import { describe, it, expect } from "vitest-compat";
import { resolveGhPagesUrl } from "@/lib/shared/gh-pages-url";

describe("resolveGhPagesUrl", () => {
  it("https://github.com/<user>/<repo> → <user>.github.io/<repo>", () => {
    expect(resolveGhPagesUrl("https://github.com/ulrik-s/ava-demo")).toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("github.com/<user>/<repo> utan protokoll", () => {
    expect(resolveGhPagesUrl("github.com/ulrik-s/ava-demo")).toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("strippar .git-suffix", () => {
    expect(resolveGhPagesUrl("https://github.com/ulrik-s/ava-demo.git")).toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("kort form <user>/<repo>", () => {
    expect(resolveGhPagesUrl("ulrik-s/ava-demo")).toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("strippar trailing slash", () => {
    expect(resolveGhPagesUrl("ulrik-s/ava-demo/")).toBe("https://ulrik-s.github.io/ava-demo");
  });

  it("okänt format returneras som-är (antas redan korrekt)", () => {
    expect(resolveGhPagesUrl("https://example.com/already/correct")).toBe("https://example.com/already/correct");
  });

  it("redan en github.io-URL lämnas orörd", () => {
    expect(resolveGhPagesUrl("https://ulrik-s.github.io/ava-demo")).toBe("https://ulrik-s.github.io/ava-demo");
  });
});
