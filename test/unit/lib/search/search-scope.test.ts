/**
 * searchScope (ADR 0028 §4c / ADR 0027) — kapabilitets-tierat sök-omfång.
 */

import { describe, it, expect } from "vitest-compat";
import { searchScope, searchScopeLabel } from "@/lib/client/search/search-scope";

describe("searchScope", () => {
  it("demo (ingen sync) → local oavsett online-flagga", () => {
    expect(searchScope(false, true)).toBe("local");
    expect(searchScope(false, false)).toBe("local");
  });

  it("server-first online → server", () => {
    expect(searchScope(true, true)).toBe("server");
  });

  it("server-first offline → offline (ingen dömd nät-fråga)", () => {
    expect(searchScope(true, false)).toBe("offline");
  });
});

describe("searchScopeLabel", () => {
  it("ger distinkt etikett per omfång", () => {
    const labels = new Set([
      searchScopeLabel("server"),
      searchScopeLabel("local"),
      searchScopeLabel("offline"),
    ]);
    expect(labels.size).toBe(3);
    expect(searchScopeLabel("local")).toMatch(/lokalt/i);
    expect(searchScopeLabel("server")).toMatch(/servern/i);
    expect(searchScopeLabel("offline")).toMatch(/[Oo]ffline/);
  });
});
