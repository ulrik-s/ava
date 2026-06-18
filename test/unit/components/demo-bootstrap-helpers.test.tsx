/**
 * Tester för demo-bootstrap:ens pure beslut-/transform-helpers (#61).
 * Själva useEffect-orkestreringen är effekt-tung; här låses den testbara
 * kärnan: bootstrap-grinden, auth-skip-mönstret och dokument-helpers.
 *
 */
import { describe, it, expect, vi, afterEach } from "vitest-compat";
import {
  pathSkipsAuth,
  checkBootstrapGate,
} from "@/components/shell/demo-bootstrap";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";

const baseConfig: FirmaConfig = {
  tier: "demo", repo: "u/r", token: "", organizationId: "org",
  principalId: "p1", authorName: "A", authorEmail: "a@b",
};
// Variant utan principalId (exactOptionalPropertyTypes: nyckeln utelämnas helt).
const { principalId: _omit, ...noPrincipal } = baseConfig;

function setLocation(pathname: string, search = ""): () => void {
  const original = window.location;
  const replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, search, replace },
  });
  return () => Object.defineProperty(window, "location", { configurable: true, value: original });
}

afterEach(() => vi.restoreAllMocks());

describe("pathSkipsAuth", () => {
  it.each([["/demo", true], ["/demo/", true], ["/login", true], ["/login/", true],
    ["/matters", false], ["/", false], ["/demos", false]])(
    "%s → %s", (p, expected) => expect(pathSkipsAuth(p as string)).toBe(expected),
  );
});

describe("checkBootstrapGate", () => {
  it("skip-ready på /demo- och /login-sidor", () => {
    const restore = setLocation("/login/");
    expect(checkBootstrapGate(baseConfig)).toBe("skip-ready");
    restore();
  });

  it("redirect-login när demo-tier saknar principalId", () => {
    const restore = setLocation("/matters");
    const decision = checkBootstrapGate(noPrincipal);
    expect(decision).toBe("redirect-login");
    expect(window.location.replace).toHaveBeenCalledWith(expect.stringContaining("/login/"));
    restore();
  });

  it("skip-loading när ?nodata finns", () => {
    const restore = setLocation("/matters", "?nodata");
    expect(checkBootstrapGate(baseConfig)).toBe("skip-loading");
    restore();
  });

  it("continue i normalfallet (inloggad, vanlig sida)", () => {
    const restore = setLocation("/matters");
    expect(checkBootstrapGate(baseConfig)).toBe("continue");
    restore();
  });

  it("self-hosted utan principalId redirectar INTE (bara demo-tier gör det)", () => {
    const restore = setLocation("/matters");
    expect(checkBootstrapGate({ ...noPrincipal, tier: "self-hosted" }))
      .toBe("continue");
    restore();
  });
});
