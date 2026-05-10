import { describe, it, expect } from "vitest";
import {
  findExistingContactForSuggestion,
  type ContactCandidate,
  type SuggestionKey,
} from "@/lib/contact-dedup";

function contact(overrides: Partial<ContactCandidate> & { id: string }): ContactCandidate {
  return {
    id: overrides.id,
    name: overrides.name ?? "Anna Svensson",
    contactType: overrides.contactType ?? "PERSON",
    personalNumber: overrides.personalNumber ?? null,
    orgNumber: overrides.orgNumber ?? null,
    organizationId: overrides.organizationId ?? "org-a",
  };
}

function sugg(overrides: Partial<SuggestionKey> = {}): SuggestionKey {
  return {
    name: overrides.name ?? "Anna Svensson",
    contactType: overrides.contactType ?? "PERSON",
    personalNumber: overrides.personalNumber ?? null,
    orgNumber: overrides.orgNumber ?? null,
  };
}

// ─── Priority 1: personalNumber ──────────────────────────────────

describe("findExistingContactForSuggestion — personalNumber", () => {
  it("matchar på exakt personalNumber inom org", () => {
    const anna = contact({ id: "c1", personalNumber: "19850315-1234" });
    const result = findExistingContactForSuggestion(
      sugg({ personalNumber: "19850315-1234" }),
      [anna],
      [],
    );
    expect(result).toEqual({ kind: "match", reason: "personalNumber", contact: anna });
  });

  it("vinner över namn-match i ärendet", () => {
    const byPnr = contact({ id: "c1", name: "Fel namn", personalNumber: "19850315-1234" });
    const byName = contact({ id: "c2", name: "Anna Svensson" });
    const result = findExistingContactForSuggestion(
      sugg({ name: "Anna Svensson", personalNumber: "19850315-1234" }),
      [byPnr, byName],
      [byName],
    );
    expect(result.kind).toBe("match");
    if (result.kind === "match") {
      expect(result.reason).toBe("personalNumber");
      expect(result.contact.id).toBe("c1");
    }
  });
});

// ─── Priority 2: orgNumber ───────────────────────────────────────

describe("findExistingContactForSuggestion — orgNumber", () => {
  it("matchar på exakt orgNumber inom org", () => {
    const abab = contact({ id: "c1", contactType: "COMPANY", orgNumber: "556677-8899" });
    const result = findExistingContactForSuggestion(
      sugg({ contactType: "COMPANY", orgNumber: "556677-8899" }),
      [abab],
      [],
    );
    expect(result).toEqual({ kind: "match", reason: "orgNumber", contact: abab });
  });

  it("använder orgNumber bara när personalNumber saknas", () => {
    const byPnr = contact({ id: "c1", personalNumber: "19850315-1234" });
    const byOrg = contact({ id: "c2", orgNumber: "556677-8899" });
    const result = findExistingContactForSuggestion(
      sugg({ personalNumber: "19850315-1234", orgNumber: "556677-8899" }),
      [byPnr, byOrg],
      [],
    );
    expect(result.kind).toBe("match");
    if (result.kind === "match") {
      expect(result.reason).toBe("personalNumber");
      expect(result.contact.id).toBe("c1");
    }
  });
});

// ─── Priority 3: namn i ärendet ──────────────────────────────────

describe("findExistingContactForSuggestion — namn inom ärende", () => {
  it("matchar exakt namn + contactType i matterContacts", () => {
    const anna = contact({ id: "c1", name: "Anna Svensson", contactType: "PERSON" });
    const result = findExistingContactForSuggestion(
      sugg({ name: "Anna Svensson", contactType: "PERSON" }),
      [anna],
      [anna],
    );
    expect(result.kind).toBe("match");
    if (result.kind === "match") expect(result.reason).toBe("matter-name");
  });

  it("är case-insensitiv och ignorerar leading/trailing whitespace", () => {
    const anna = contact({ id: "c1", name: "Anna Svensson" });
    const result = findExistingContactForSuggestion(
      sugg({ name: "  ANNA svensson  " }),
      [anna],
      [anna],
    );
    expect(result.kind).toBe("match");
  });

  it("matchar INTE när contactType skiljer (PERSON vs COMPANY)", () => {
    const company = contact({ id: "c1", name: "Anna Svensson", contactType: "COMPANY" });
    const result = findExistingContactForSuggestion(
      sugg({ name: "Anna Svensson", contactType: "PERSON" }),
      [company],
      [company],
    );
    expect(result).toEqual({ kind: "no-match" });
  });

  it("matchar INTE om kontakten bara finns i org men inte i ärendet", () => {
    // Viktigt designval: namn-fallback är scopad till ärendet för att
    // förhindra att två olika "Anna Svensson" i olika ärenden mergas.
    const annaAnnat = contact({ id: "c1", name: "Anna Svensson" });
    const result = findExistingContactForSuggestion(
      sugg({ name: "Anna Svensson" }),
      [annaAnnat],
      [],
    );
    expect(result).toEqual({ kind: "no-match" });
  });

  it("hoppar över tomt namn", () => {
    const result = findExistingContactForSuggestion(
      sugg({ name: "   " }),
      [],
      [contact({ id: "c1", name: "Anna Svensson" })],
    );
    expect(result).toEqual({ kind: "no-match" });
  });
});

// ─── Ingen match ─────────────────────────────────────────────────

describe("findExistingContactForSuggestion — ingen match", () => {
  it("returnerar no-match när inget hittas", () => {
    const result = findExistingContactForSuggestion(sugg(), [], []);
    expect(result).toEqual({ kind: "no-match" });
  });

  it("returnerar no-match när kandidaterna inte passar", () => {
    const bo = contact({ id: "c1", name: "Bo Karlsson", personalNumber: "19700101-0000" });
    const result = findExistingContactForSuggestion(
      sugg({ name: "Anna Svensson", personalNumber: "19850315-1234" }),
      [bo],
      [bo],
    );
    expect(result).toEqual({ kind: "no-match" });
  });
});
