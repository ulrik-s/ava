import { describe, it, expect } from "vitest-compat";
import { buildAdminUserRow, adminUserGitPath } from "../../tooling/scripts/bootstrap-admin/core";
import { userSchema } from "@/lib/shared/schemas/user";
import { classifyOidcLogin } from "@/lib/client/backend/oidc-principal";
import type { AllowlistedUser } from "@/lib/server/auth/oidc-auth-provider";

const ORG = "11111111-1111-5111-8111-111111111111";

describe("buildAdminUserRow", () => {
  it("bygger en giltig ADMIN-rad (validerar mot userSchema)", () => {
    const row = buildAdminUserRow({ email: "Admin@Byra.SE", organizationId: ORG, now: new Date("2026-06-12T10:00:00Z") });
    expect(userSchema.safeParse(row).success).toBe(true);
    expect(row.role).toBe("ADMIN");
    expect(row.active).toBe(true);
    expect(row.email).toBe("admin@byra.se"); // normaliserad (lowercase + trim)
    expect(row.organizationId).toBe(ORG);
  });

  it("id är deterministiskt (idempotent re-run) men unikt per email", () => {
    const a = buildAdminUserRow({ email: "a@x.se", organizationId: ORG });
    const a2 = buildAdminUserRow({ email: "a@x.se", organizationId: ORG });
    const b = buildAdminUserRow({ email: "b@x.se", organizationId: ORG });
    expect(a.id).toBe(a2.id);
    expect(a.id).not.toBe(b.id);
  });

  it("namn defaultar till email-delen före @", () => {
    expect(buildAdminUserRow({ email: "anna@byra.se", organizationId: ORG }).name).toBe("anna");
    expect(buildAdminUserRow({ email: "x@y.se", organizationId: ORG, name: "Anna A" }).name).toBe("Anna A");
  });
});

describe("bootstrap → OIDC-login (stänger chicken-egg-loopen)", () => {
  it("seedad admin-rad resolvar till ADMIN-principal via classifyOidcLogin (#252)", () => {
    const row = buildAdminUserRow({ email: "admin@byra.se", organizationId: ORG });
    // Den seedade raden är en giltig allowlist-post; OIDC-login mot samma email → ADMIN.
    const outcome = classifyOidcLogin(
      { email: "admin@byra.se", subject: "", issuer: "", name: "Admin" },
      [row as unknown as AllowlistedUser],
    );
    expect(outcome.kind).toBe("authorized");
    if (outcome.kind === "authorized") expect(outcome.principal.role).toBe("ADMIN");
  });
});

describe("adminUserGitPath", () => {
  it("pekar på .ava/users/<email>.json (normaliserad)", () => {
    expect(adminUserGitPath(" Admin@Byra.SE ")).toBe(".ava/users/admin@byra.se.json");
  });
});
