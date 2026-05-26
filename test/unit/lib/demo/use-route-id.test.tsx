/**
 * `useRouteId` — härleder id från URL:en (client) istället för det
 * build-time-bakade route-param:et. Krävs för att statiskt exporterade
 * dynamiska detaljrutter ska funka för GODTYCKLIGA id:n i self-hosted-läget
 * (nginx serverar en sentinel-shell; klienten läser riktiga id:t ur URL:en).
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

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
    expect(renderHook(() => useRouteId()).result.current).toBeNull();
  });
});
