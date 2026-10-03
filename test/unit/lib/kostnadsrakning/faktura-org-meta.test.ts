/**
 * `fakturaOrgMeta` (#1439) — organisationsinställningarna → fakturans byråfält
 * (namn, org.nr, logga). En mappning för alla fakturaflöden.
 */

import { describe, it, expect } from "vitest-compat";
import { fakturaOrgMeta } from "@/lib/client/kostnadsrakning/faktura-org-meta";
import { orgImageSchema } from "@/lib/shared/org-image";

const LOGO = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

describe("fakturaOrgMeta", () => {
  it("tar med namn, org.nr och logga", () => {
    expect(fakturaOrgMeta({ name: "Byrå AB", orgNumber: "556677-8899", logo: LOGO }))
      .toEqual({ organizationName: "Byrå AB", organizationOrgNumber: "556677-8899", organizationLogo: LOGO });
  });

  it("tomma och saknade fält utelämnas — ingen logga ger ingen nyckel", () => {
    expect(fakturaOrgMeta({ name: "", orgNumber: null, logo: null })).toEqual({});
    expect(fakturaOrgMeta({ name: "Byrå AB" })).toEqual({ organizationName: "Byrå AB" });
  });

  it("inga inställningar alls → inga byråfält", () => {
    expect(fakturaOrgMeta(undefined)).toEqual({});
    expect(fakturaOrgMeta(null)).toEqual({});
  });
});
