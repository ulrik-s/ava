/**
 * `CachedSessionAuthProvider` (#415 / D2, ADR 0018 Option A) — offline-principal
 * ur en cachad session med grace-utgång.
 */

import { describe, it, expect } from "vitest-compat";
import {
  CachedSessionAuthProvider,
  DEFAULT_OFFLINE_GRACE_MS,
} from "@/lib/server/auth/cached-session-auth-provider";
import type { Principal } from "@/lib/server/auth/principal";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = {
  id: asId<"UserId">("u-1"), email: "anna@byra.se", name: "Anna", role: "LAWYER", organizationId: asId<"OrganizationId">("org-1"),
};

describe("CachedSessionAuthProvider", () => {
  it("ger null utan cachad session", () => {
    expect(new CachedSessionAuthProvider(null).getPrincipal()).toBeNull();
  });

  it("ger principalen inom grace-fönstret", () => {
    const now = 1_000_000;
    const provider = new CachedSessionAuthProvider(
      { principal: PRINCIPAL, cachedAt: now - DEFAULT_OFFLINE_GRACE_MS + 1 },
      () => now,
    );
    expect(provider.getPrincipal()).toEqual(PRINCIPAL);
  });

  it("ger null när grace löpt ut", () => {
    const now = 10 * DEFAULT_OFFLINE_GRACE_MS;
    const provider = new CachedSessionAuthProvider(
      { principal: PRINCIPAL, cachedAt: now - DEFAULT_OFFLINE_GRACE_MS - 1 },
      () => now,
    );
    expect(provider.getPrincipal()).toBeNull();
  });

  it("respekterar en custom grace-längd", () => {
    const now = 1_000_000;
    const provider = new CachedSessionAuthProvider(
      { principal: PRINCIPAL, cachedAt: now - 5000, graceMs: 1000 },
      () => now,
    );
    expect(provider.getPrincipal()).toBeNull(); // 5s sedan > 1s grace
  });
});
