/**
 * Vem äger de gemensamma lokala databaserna från före #1347? Avgörs en gång ur
 * configen och sparas; ingen annan användare kan senare ta över dem.
 */
import { beforeEach, describe, expect, it } from "vitest-compat";
import {
  LEGACY_OWNER_KEY, legacyOwner, ownerFromConfig, ownsLegacyData,
} from "@/lib/client/backend/local-data/legacy-owner";
import { localScopeSchema } from "@/lib/client/backend/local-data/local-namespace";

const scope = (principalId: string, organizationId = "org-1") => localScopeSchema.parse({ organizationId, principalId });
const cfg = (over: Partial<{ principalId: string; authorEmail: string; organizationId: string }> = {}) =>
  ({ organizationId: "org-1", authorEmail: "user@firma.local", ...over });

beforeEach(() => { localStorage.clear(); });

describe("ownerFromConfig", () => {
  it("bunden principal (+ e-post)", () => {
    expect(ownerFromConfig(cfg({ principalId: "u-anna", authorEmail: "Anna@Byra.se" })))
      .toEqual({ kind: "user", organizationId: "org-1", principalId: "u-anna", email: "anna@byra.se" });
  });

  it("utloggad med gammal kod: bara e-posten finns kvar", () => {
    expect(ownerFromConfig(cfg({ authorEmail: "anna@byra.se" }))).toEqual({ kind: "user", organizationId: "org-1", email: "anna@byra.se" });
  });

  it("bunden principal men platshållar-e-post → bara principalen", () => {
    expect(ownerFromConfig(cfg({ principalId: "u-anna" }))).toEqual({ kind: "user", organizationId: "org-1", principalId: "u-anna" });
  });

  it("varken principal eller riktig e-post → ingen ägare", () => {
    expect(ownerFromConfig(cfg())).toEqual({ kind: "none" });
    expect(ownerFromConfig(cfg({ authorEmail: "  " }))).toEqual({ kind: "none" });
  });
});

describe("legacyOwner — avgörs en gång", () => {
  it("första gången sparas ägaren; därefter gäller den sparade, oavsett config", () => {
    expect(legacyOwner(cfg({ principalId: "u-anna" }), localStorage)).toMatchObject({ principalId: "u-anna" });
    expect(legacyOwner(cfg({ principalId: "u-bo" }), localStorage)).toMatchObject({ principalId: "u-anna" });
    expect(JSON.parse(localStorage.getItem(LEGACY_OWNER_KEY) ?? "{}")).toMatchObject({ principalId: "u-anna" });
  });

  it("en trasig eller främmande post → ingen ägare (aldrig en gissning)", () => {
    localStorage.setItem(LEGACY_OWNER_KEY, "{ trasig");
    expect(legacyOwner(cfg({ principalId: "u-bo" }), localStorage)).toEqual({ kind: "none" });
    localStorage.setItem(LEGACY_OWNER_KEY, JSON.stringify({ kind: "user", organizationId: "o", hacked: true }));
    expect(legacyOwner(cfg({ principalId: "u-bo" }), localStorage)).toEqual({ kind: "none" });
  });
});

describe("ownsLegacyData", () => {
  it("principalen avgör när den finns", () => {
    const owner = ownerFromConfig(cfg({ principalId: "u-anna", authorEmail: "anna@byra.se" }));
    expect(ownsLegacyData(owner, scope("u-anna"), "anna@byra.se")).toBe(true);
    expect(ownsLegacyData(owner, scope("u-bo"), "anna@byra.se")).toBe(false);
  });

  it("annars e-posten (skiftlägesokänslig) — aldrig platshållaren", () => {
    const owner = ownerFromConfig(cfg({ authorEmail: "anna@byra.se" }));
    expect(ownsLegacyData(owner, scope("u-anna"), "ANNA@byra.se")).toBe(true);
    expect(ownsLegacyData(owner, scope("u-bo"), "bo@byra.se")).toBe(false);
    expect(ownsLegacyData({ kind: "user", organizationId: "org-1" }, scope("u-bo"), "user@firma.local")).toBe(false);
  });

  it("en annan byrå eller ingen ägare → aldrig", () => {
    const owner = ownerFromConfig(cfg({ principalId: "u-anna" }));
    expect(ownsLegacyData(owner, scope("u-anna", "org-2"), "")).toBe(false);
    expect(ownsLegacyData({ kind: "none" }, scope("u-anna"), "anna@byra.se")).toBe(false);
  });
});
