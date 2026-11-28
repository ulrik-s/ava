/**
 * `fakturaOrgMeta` (#1439) — organisationsinställningarna → fakturans byråfält
 * (namn, org.nr, logga). En mappning för alla fakturaflöden.
 */

import { describe, it, expect } from "vitest-compat";
import { fakturaOrgMeta, pickFakturaOrgMeta } from "@/lib/client/kostnadsrakning/faktura-org-meta";
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

  it("sidfotens uppgifter (#2255): telefon, webbplats, bankgiro och sigill", () => {
    expect(fakturaOrgMeta({ phone: "08-123 456 78", website: "https://www.exempel.se", bankgiro: "123-4567", footerSeal: LOGO }))
      .toEqual({ organizationPhone: "08-123 456 78", organizationWebsite: "https://www.exempel.se", organizationBankgiro: "123-4567", organizationFooterSeal: LOGO });
    expect(fakturaOrgMeta({ phone: "", website: null, bankgiro: undefined, footerSeal: null })).toEqual({});
  });

  it("pickFakturaOrgMeta: bara byråfälten ur en större metadata", () => {
    const meta = { matterNumber: "2026-0001", organizationName: "Byrå AB", organizationBankgiro: "123-4567", organizationFooterSeal: LOGO };
    expect(pickFakturaOrgMeta(meta)).toEqual({ organizationName: "Byrå AB", organizationBankgiro: "123-4567", organizationFooterSeal: LOGO });
  });

  it("inga inställningar alls → inga byråfält", () => {
    expect(fakturaOrgMeta(undefined)).toEqual({});
    expect(fakturaOrgMeta(null)).toEqual({});
  });
});
