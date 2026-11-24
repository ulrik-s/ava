/**
 * `webAppOffice365Config` (#1949) — webbappens Entra-app är webbinloggningens:
 * det första värdet i `AVA_IDENTITY_AUDIENCE` och tenanten ur `AVA_IDENTITY_ISSUER`.
 */
import { describe, expect, it } from "vitest-compat";
import { webAppOffice365Config } from "@/lib/server/integrations/msgraph/web-app-config";

const AVA_IDENTITY_ISSUER = "https://login.microsoftonline.com/tid-1/v2.0";

describe("webAppOffice365Config", () => {
  it("ett värde i audience", () => {
    expect(webAppOffice365Config({ AVA_IDENTITY_AUDIENCE: "cid", AVA_IDENTITY_ISSUER }))
      .toEqual({ clientId: "cid", tenantId: "tid-1" });
  });

  it("en lista med två värden: det första gäller, med och utan mellanslag", () => {
    expect(webAppOffice365Config({ AVA_IDENTITY_AUDIENCE: "web,helper", AVA_IDENTITY_ISSUER })?.clientId).toBe("web");
    expect(webAppOffice365Config({ AVA_IDENTITY_AUDIENCE: " web , helper ", AVA_IDENTITY_ISSUER })?.clientId).toBe("web");
  });

  it("tom variabel → null", () => {
    expect(webAppOffice365Config({ AVA_IDENTITY_AUDIENCE: "", AVA_IDENTITY_ISSUER })).toBeNull();
    expect(webAppOffice365Config({ AVA_IDENTITY_AUDIENCE: "cid", AVA_IDENTITY_ISSUER: " " })).toBeNull();
  });

  it("en issuer som inte är Entra → null", () => {
    expect(webAppOffice365Config({ AVA_IDENTITY_AUDIENCE: "cid", AVA_IDENTITY_ISSUER: "https://kc.example/realms/ava" }))
      .toBeNull();
  });

  it("läser processens miljö som standard", () => {
    expect(webAppOffice365Config()).toBeNull();
  });
});
