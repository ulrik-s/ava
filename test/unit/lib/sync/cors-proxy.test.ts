/**
 * Tester för cors-proxy-resolvern. isomorphic-git i browsern måste gå via
 * en CORS-proxy för fjärr-git-servrar (t.ex. GitHub) men ska prata DIREKT
 * med en lokal/samma-origin-server (round-trip mot docker:8080/git/).
 */

import { describe, it, expect } from "vitest-compat";
import { resolveCorsProxy, isLocalOrSameOrigin, DEFAULT_CORS_PROXY } from "@/lib/client/sync/cors-proxy";

describe("isLocalOrSameOrigin", () => {
  it("true för localhost/127.0.0.1", () => {
    expect(isLocalOrSameOrigin("http://localhost:8080/git/firma.git")).toBe(true);
    expect(isLocalOrSameOrigin("http://127.0.0.1:8080/git/firma.git")).toBe(true);
  });

  it("true för samma origin som sidan", () => {
    expect(isLocalOrSameOrigin("http://app.local/git/firma.git", "http://app.local")).toBe(true);
  });

  it("false för fjärr-host (github)", () => {
    expect(isLocalOrSameOrigin("https://github.com/u/r.git", "http://app.local")).toBe(false);
  });

  it("false för obegriplig url", () => {
    expect(isLocalOrSameOrigin("git@github.com:u/r.git")).toBe(false);
  });
});

describe("resolveCorsProxy", () => {
  it("lokal/samma-origin → tom sträng (ingen proxy)", () => {
    expect(resolveCorsProxy({ url: "http://localhost:8080/git/firma.git" })).toBe("");
    expect(resolveCorsProxy({ url: "http://app.local/git/x.git", origin: "http://app.local" })).toBe("");
  });

  it("fjärr utan konfig → default publik proxy", () => {
    expect(resolveCorsProxy({ url: "https://github.com/u/r.git" })).toBe(DEFAULT_CORS_PROXY);
  });

  it("fjärr med konfigurerad proxy → den konfigurerade", () => {
    expect(
      resolveCorsProxy({ url: "https://git.firma.se/x.git", configured: "https://proxy.firma.se" }),
    ).toBe("https://proxy.firma.se");
  });
});
