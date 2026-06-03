/**
 * `useRouteId` — härleder id från URL:en (client) istället för det
 * build-time-bakade route-param:et. Krävs för att statiskt exporterade
 * dynamiska detaljrutter ska funka för GODTYCKLIGA id:n i self-hosted-läget
 * (nginx serverar en sentinel-shell; klienten läser riktiga id:t ur URL:en).
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { useRouteId } from "@/lib/client/demo/use-route-id";

describe("useRouteId", () => {
  it("sista segmentet (matters/[id])", () => {
    pathname = "/matters/m-123";
    expect(renderHook(() => useRouteId()).result.current).toBe("m-123");
  });

  it("hanterar basePath + trailing slash", () => {
    pathname = "/ava/contacts/c-9/";
    expect(renderHook(() => useRouteId()).result.current).toBe("c-9");
  });

  it("offset för nästlad rutt (templates/[id]/edit)", () => {
    pathname = "/templates/t-1/edit";
    expect(renderHook(() => useRouteId(1)).result.current).toBe("t-1");
  });

  it("null på rot", () => {
    pathname = "/";
    window.location.hash = "";
    expect(renderHook(() => useRouteId()).result.current).toBeNull();
  });

  // ── __shell__-shim: läs riktiga id:t ur hash:en (#orig=<path>) ──
  // GH Pages 404.html redirectar /<route>/<id>/ → /<route>/__shell__/#orig=<path>.
  it("läser id:t ur hash:en (#orig) på __shell__-sentinellen", () => {
    pathname = "/invoices/__shell__";
    window.location.hash = "#orig=" + encodeURIComponent("/ava/invoices/inv-abc-final/");
    expect(renderHook(() => useRouteId()).result.current).toBe("inv-abc-final");
  });

  it("faller tillbaka på '__shell__' när hash saknas (= getById hittar inget)", () => {
    pathname = "/invoices/__shell__";
    window.location.hash = "";
    expect(renderHook(() => useRouteId()).result.current).toBe("__shell__");
  });

  it("hash-orig respekterar offset för nästlad rutt", () => {
    pathname = "/templates/__shell__/edit";
    window.location.hash = "#orig=" + encodeURIComponent("/ava/templates/t-9/edit/");
    expect(renderHook(() => useRouteId(1)).result.current).toBe("t-9");
  });
});
