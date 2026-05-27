/**
 * Kloss 1 — `GitAuthProvider`.
 *
 * Auth-seamen: routrarna ser bara en `Principal` via `ctx.user`. HUR den
 * principalen fastställs är en utbytbar `AuthProvider`. Git-backenden
 * (local-first) *själv-deklarerar* principalen (ingen ACL att skydda); en
 * framtida server-backend verifierar den. Det här testet låser
 * Git-implementationens beteende.
 */

import { describe, it, expect } from "vitest";
import { GitAuthProvider, DEMO_DEFAULT_PRINCIPAL } from "@/lib/server/auth/git-auth-provider";
import type { AuthProvider, Principal } from "@/lib/server/auth/principal";

describe("GitAuthProvider", () => {
  it("uppfyller AuthProvider-interfacet", () => {
    const provider: AuthProvider = new GitAuthProvider();
    expect(typeof provider.getPrincipal).toBe("function");
  });

  it("utan config → demo-default-principalen (matchar seedens u-anna)", () => {
    const p = new GitAuthProvider().getPrincipal();
    expect(p).toEqual(DEMO_DEFAULT_PRINCIPAL);
    // Säkrar att vi inte tappar id-kontraktet mot seed-datan
    expect(p?.id).toBe("u-anna");
    expect(p?.organizationId).toBe("demo-firma-ab");
    expect(p?.role).toBe("ADMIN");
  });

  it("med config → överrider per fält, default för resten", () => {
    const p = new GitAuthProvider({
      id: "current-user",
      organizationId: "firma-ab",
      name: "Lokal användare",
      email: "user@firma.local",
    }).getPrincipal();
    expect(p).toEqual({
      id: "current-user",
      email: "user@firma.local",
      name: "Lokal användare",
      role: "ADMIN", // ej överskriven → default
      organizationId: "firma-ab",
    });
  });

  it("getPrincipal returnerar en komplett Principal-shape (alla fält satta)", () => {
    const p = new GitAuthProvider({ organizationId: "x" }).getPrincipal() as Principal;
    for (const key of ["id", "email", "name", "role", "organizationId"] as const) {
      expect(p[key], `fält ${key} ska vara satt`).toBeTruthy();
    }
  });

  it("är ren — upprepade anrop ger samma resultat (ingen mutation)", () => {
    const provider = new GitAuthProvider({ id: "u-bjorn" });
    expect(provider.getPrincipal()).toEqual(provider.getPrincipal());
  });
});
